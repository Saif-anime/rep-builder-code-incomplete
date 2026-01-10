import OpenAI from "openai";
import * as fs from "fs/promises";
import * as path from "path";

const openai = new OpenAI();

interface ExtractedRule {
  ruleType: string;
  value: string | number | null;
  confidence: number;
  sourceText: string;
}

interface ExtractionResult {
  success: boolean;
  extractedText?: string;
  extractedData?: {
    maxStayMinutes: number | null;
    graceMinutes: number | null;
    enforcementHours: {
      start: string;
      end: string;
      days: string[];
    } | null;
    bayRestrictions: Array<{
      type: string;
      description: string;
    }>;
    paymentTerms: {
      required: boolean;
      rates: string | null;
      methods: string[];
    } | null;
    warningLanguage: string | null;
    rawTextExtracted: string | null;
    extractionNotes: string[];
  };
  detectedRules?: ExtractedRule[];
  confidence?: number;
  ocrConfidence?: number;
  notes?: string[];
  error?: string;
}

function parseTimeToMinutes(timeStr: string): number | null {
  const hourMatch = timeStr.match(/(\d+)\s*(?:hour|hr|h)/i);
  const minMatch = timeStr.match(/(\d+)\s*(?:minute|min|m)/i);
  
  let total = 0;
  if (hourMatch) total += parseInt(hourMatch[1]) * 60;
  if (minMatch) total += parseInt(minMatch[1]);
  
  if (total > 0) return total;
  
  const pureNumber = parseInt(timeStr);
  if (!isNaN(pureNumber) && pureNumber > 0) {
    return pureNumber <= 12 ? pureNumber * 60 : pureNumber;
  }
  
  return null;
}

export async function extractSignageRulesFromImage(
  imagePath: string,
  signageType: string
): Promise<ExtractionResult> {
  try {
    const absolutePath = path.isAbsolute(imagePath) 
      ? imagePath 
      : path.join(process.cwd(), imagePath);
    
    const imageBuffer = await fs.readFile(absolutePath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    
    const prompt = buildExtractionPrompt(signageType);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2000,
      messages: [
        {
          role: "system",
          content: `You are a UK parking enforcement signage analyst. Extract ALL parking rules, restrictions, and terms from the signage image. Focus on:
- Maximum stay duration (hours/minutes)
- Grace periods
- Enforcement hours and days
- Bay-specific restrictions (disabled, EV, parent & child)
- Payment requirements and rates
- Warning language and penalties

Return ONLY valid JSON matching the expected format. Be precise with time values.`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: "high",
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    });
    
    const content = response.choices[0]?.message?.content || "";
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        error: "No valid JSON found in response",
        extractedText: content,
        notes: ["Failed to parse structured data from image"],
      };
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    const extractedData = normalizeExtractedData(parsed);
    const detectedRules = buildDetectedRules(parsed);
    const confidence = calculateConfidence(parsed, detectedRules);
    
    return {
      success: true,
      extractedText: parsed.rawText || content,
      extractedData,
      detectedRules,
      confidence,
      ocrConfidence: parsed.ocrConfidence || 0.8,
      notes: parsed.notes || [],
    };
  } catch (error: any) {
    console.error("[SignageExtraction] Error:", error.message);
    return {
      success: false,
      error: error.message,
      notes: ["Image analysis failed"],
    };
  }
}

function buildExtractionPrompt(signageType: string): string {
  return `Analyze this ${signageType} parking signage and extract all rules.

Return JSON in this exact format:
{
  "rawText": "All text visible on the sign",
  "maxStayDuration": "e.g., 2 hours, 30 minutes, 4 hours",
  "gracePeriod": "e.g., 10 minutes, grace period if mentioned",
  "enforcementHours": {
    "start": "08:00",
    "end": "18:00",
    "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
  },
  "bayRestrictions": [
    {"type": "disabled", "description": "Blue badge holders only"},
    {"type": "ev", "description": "Electric vehicle charging only"}
  ],
  "paymentRequired": true,
  "paymentRates": "£1.50 per hour",
  "paymentMethods": ["Card", "App", "Cash"],
  "warningText": "PCN may be issued for violations",
  "penaltyAmount": "£100 reduced to £60 if paid within 14 days",
  "notes": ["Any other observations"],
  "ocrConfidence": 0.85
}

Extract values exactly as shown on the signage. Use null for missing information.`;
}

function normalizeExtractedData(parsed: any): ExtractionResult["extractedData"] {
  return {
    maxStayMinutes: parsed.maxStayDuration ? parseTimeToMinutes(parsed.maxStayDuration) : null,
    graceMinutes: parsed.gracePeriod ? parseTimeToMinutes(parsed.gracePeriod) : null,
    enforcementHours: parsed.enforcementHours || null,
    bayRestrictions: parsed.bayRestrictions || [],
    paymentTerms: parsed.paymentRequired !== undefined ? {
      required: !!parsed.paymentRequired,
      rates: parsed.paymentRates || null,
      methods: parsed.paymentMethods || [],
    } : null,
    warningLanguage: parsed.warningText || null,
    rawTextExtracted: parsed.rawText || null,
    extractionNotes: [
      ...(parsed.notes || []),
      parsed.penaltyAmount ? `Penalty: ${parsed.penaltyAmount}` : null,
    ].filter(Boolean) as string[],
  };
}

function buildDetectedRules(parsed: any): ExtractedRule[] {
  const rules: ExtractedRule[] = [];
  
  if (parsed.maxStayDuration) {
    rules.push({
      ruleType: "MAX_STAY",
      value: parseTimeToMinutes(parsed.maxStayDuration),
      confidence: 0.9,
      sourceText: parsed.maxStayDuration,
    });
  }
  
  if (parsed.gracePeriod) {
    rules.push({
      ruleType: "GRACE_PERIOD",
      value: parseTimeToMinutes(parsed.gracePeriod),
      confidence: 0.85,
      sourceText: parsed.gracePeriod,
    });
  }
  
  if (parsed.bayRestrictions?.length > 0) {
    for (const restriction of parsed.bayRestrictions) {
      rules.push({
        ruleType: `BAY_${restriction.type.toUpperCase()}`,
        value: restriction.type,
        confidence: 0.9,
        sourceText: restriction.description,
      });
    }
  }
  
  if (parsed.paymentRequired) {
    rules.push({
      ruleType: "PAYMENT_REQUIRED",
      value: parsed.paymentRates || "yes",
      confidence: 0.9,
      sourceText: parsed.paymentRates || "Payment required",
    });
  }
  
  if (parsed.enforcementHours) {
    rules.push({
      ruleType: "ENFORCEMENT_HOURS",
      value: `${parsed.enforcementHours.start}-${parsed.enforcementHours.end}`,
      confidence: 0.85,
      sourceText: `${parsed.enforcementHours.start} to ${parsed.enforcementHours.end}`,
    });
  }
  
  return rules;
}

function calculateConfidence(parsed: any, rules: ExtractedRule[]): number {
  if (rules.length === 0) return 0.3;
  
  const baseConfidence = parsed.ocrConfidence || 0.7;
  const ruleConfidences = rules.map(r => r.confidence);
  const avgRuleConfidence = ruleConfidences.reduce((a, b) => a + b, 0) / ruleConfidences.length;
  
  const hasMaxStay = rules.some(r => r.ruleType === "MAX_STAY");
  const hasEnforcementHours = rules.some(r => r.ruleType === "ENFORCEMENT_HOURS");
  
  let bonus = 0;
  if (hasMaxStay) bonus += 0.05;
  if (hasEnforcementHours) bonus += 0.05;
  
  return Math.min(0.95, (baseConfidence * 0.4) + (avgRuleConfidence * 0.6) + bonus);
}

export async function extractSignageRulesFromText(
  text: string,
  signageType: string
): Promise<ExtractionResult> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content: `You are a UK parking enforcement expert. Extract parking rules from the provided text. Return JSON only.`,
        },
        {
          role: "user",
          content: `Extract parking rules from this ${signageType} signage text:

${text}

Return JSON:
{
  "maxStayDuration": "time string or null",
  "gracePeriod": "time string or null",
  "enforcementHours": { "start": "HH:MM", "end": "HH:MM", "days": [...] } or null,
  "bayRestrictions": [{ "type": "...", "description": "..." }],
  "paymentRequired": boolean,
  "paymentRates": "rate string or null",
  "warningText": "warning or null",
  "notes": ["observations"]
}`,
        },
      ],
    });
    
    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      return {
        success: false,
        error: "Could not parse extracted rules",
        extractedText: text,
      };
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    const extractedData = normalizeExtractedData(parsed);
    const detectedRules = buildDetectedRules(parsed);
    
    return {
      success: true,
      extractedText: text,
      extractedData,
      detectedRules,
      confidence: calculateConfidence({ ocrConfidence: 0.9 }, detectedRules),
      notes: parsed.notes || [],
    };
  } catch (error: any) {
    console.error("[SignageExtraction] Text extraction error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

export function selectBestSignage(
  signageList: Array<{
    id: string;
    signageType: string;
    confidenceScore: number | null;
    effectiveFrom: Date;
    extractedData: any;
  }>
): typeof signageList[0] | null {
  if (signageList.length === 0) return null;
  
  const typePriority: Record<string, number> = {
    ENTRANCE: 5,
    TERMS: 4,
    BAY: 3,
    PAYMENT: 2,
    WARNING: 1,
    OTHER: 0,
  };
  
  const scored = signageList.map(s => ({
    ...s,
    score: (typePriority[s.signageType] || 0) * 10 + (s.confidenceScore || 0) * 100,
  }));
  
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

export function mergeSignageRules(
  signageList: Array<{
    extractedData: any;
    confidenceScore: number | null;
    signageType: string;
  }>
): ExtractionResult["extractedData"] | null {
  if (signageList.length === 0) return null;
  
  const merged: NonNullable<ExtractionResult["extractedData"]> = {
    maxStayMinutes: null,
    graceMinutes: null,
    enforcementHours: null,
    bayRestrictions: [],
    paymentTerms: null,
    warningLanguage: null,
    rawTextExtracted: null,
    extractionNotes: [],
  };
  
  for (const signage of signageList) {
    const data = signage.extractedData;
    if (!data) continue;
    
    if (data.maxStayMinutes && !merged.maxStayMinutes) {
      merged.maxStayMinutes = data.maxStayMinutes;
      merged.extractionNotes.push(`Max stay from ${signage.signageType} signage`);
    }
    
    if (data.graceMinutes && !merged.graceMinutes) {
      merged.graceMinutes = data.graceMinutes;
      merged.extractionNotes.push(`Grace period from ${signage.signageType} signage`);
    }
    
    if (data.enforcementHours && !merged.enforcementHours) {
      merged.enforcementHours = data.enforcementHours;
    }
    
    if (data.bayRestrictions?.length > 0) {
      merged.bayRestrictions.push(...data.bayRestrictions);
    }
    
    if (data.paymentTerms && !merged.paymentTerms) {
      merged.paymentTerms = data.paymentTerms;
    }
    
    if (data.warningLanguage && !merged.warningLanguage) {
      merged.warningLanguage = data.warningLanguage;
    }
  }
  
  return merged;
}
