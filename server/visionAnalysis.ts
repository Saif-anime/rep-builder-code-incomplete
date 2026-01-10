import OpenAI from "openai";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const openai = new OpenAI();

export interface VisionAnalysisInput {
  imagePath: string;
  siteName?: string;
  bayTypeExpected?: string;
  violationType?: string;
  timestamp?: string;
  cameraName?: string;
  caseId?: string;
}

export interface HumanDetection {
  adult: boolean;
  child: boolean;
}

export interface VisionAnalysisResult {
  vehicleDetected: boolean;
  vehicleType: "car" | "van" | "motorcycle" | "unknown";
  bayTypeVisible: "disabled" | "parent-child" | "ev" | "standard" | "unclear";
  evIndicators: boolean;
  disabledBadgeVisible: boolean;
  humansDetected: HumanDetection;
  signageVisible: boolean;
  visibilityQuality: "clear" | "partial" | "poor";
  confidenceNotes: string;
  numberPlateDetected?: string;
  timestampOverlay?: string;
  analysedAt: string;
  modelVersion: string;
  imageHash: string;
}

export interface VisionAnalysisResponse {
  success: boolean;
  result?: VisionAnalysisResult;
  error?: string;
  cached?: boolean;
}

const analysisCache = new Map<string, VisionAnalysisResult>();

function computeImageHash(imagePath: string): string {
  try {
    const fullPath = path.join(process.cwd(), imagePath.startsWith("/") ? imagePath.slice(1) : imagePath);
    if (!fs.existsSync(fullPath)) {
      return "";
    }
    const buffer = fs.readFileSync(fullPath);
    return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  } catch (error) {
    return "";
  }
}

function imageToBase64(imagePath: string): string | null {
  try {
    const fullPath = path.join(process.cwd(), imagePath.startsWith("/") ? imagePath.slice(1) : imagePath);
    if (!fs.existsSync(fullPath)) {
      console.error("[Vision GPT] Image not found:", fullPath);
      return null;
    }
    const buffer = fs.readFileSync(fullPath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  } catch (error: any) {
    console.error("[Vision GPT] Failed to read image:", error.message);
    return null;
  }
}

const VISION_PROMPT = `You are analysing parking enforcement evidence.

Identify ONLY what is clearly visible.
Do NOT guess.
If unsure, say 'uncertain'.

Detect and return:
- Vehicle presence
- Vehicle type (car, van, motorcycle)
- EV indicators (charging port, badge, cable)
- Bay markings (disabled, EV, parent-child, standard)
- Ground text and symbols
- Disabled badge visibility (blue badge on dashboard)
- Humans (adult, child)
- Signage visibility
- Number plate if visible
- Obstructions or unclear view
- TIMESTAMP/DATE overlay text (camera overlays often show date/time like "10/01/2026 14:35:22" or "2026-01-10 14:35")

Return ONLY valid JSON in this exact format:
{
  "vehicleDetected": boolean,
  "vehicleType": "car" | "van" | "motorcycle" | "unknown",
  "bayTypeVisible": "disabled" | "parent-child" | "ev" | "standard" | "unclear",
  "evIndicators": boolean,
  "disabledBadgeVisible": boolean,
  "humansDetected": {
    "adult": boolean,
    "child": boolean
  },
  "signageVisible": boolean,
  "visibilityQuality": "clear" | "partial" | "poor",
  "numberPlateDetected": "string or null",
  "timestampOverlay": "string or null - if a date/time is visible in camera overlay text, extract it exactly as shown",
  "confidenceNotes": "string explaining any uncertainties"
}`;

export async function analyzeImageWithVision(input: VisionAnalysisInput): Promise<VisionAnalysisResponse> {
  console.log("[Vision GPT] Analyzing image:", input.imagePath);
  
  const imageHash = computeImageHash(input.imagePath);
  if (!imageHash) {
    return { success: false, error: "Could not read or hash image file" };
  }
  
  if (analysisCache.has(imageHash)) {
    console.log("[Vision GPT] Returning cached result for:", imageHash);
    return { success: true, result: analysisCache.get(imageHash)!, cached: true };
  }
  
  const base64Image = imageToBase64(input.imagePath);
  if (!base64Image) {
    return { success: false, error: "Could not load image file" };
  }
  
  const contextInfo = [
    input.siteName ? `Site: ${input.siteName}` : null,
    input.bayTypeExpected ? `Expected bay type: ${input.bayTypeExpected}` : null,
    input.violationType ? `Suspected violation: ${input.violationType}` : null,
    input.timestamp ? `Timestamp: ${input.timestamp}` : null,
    input.cameraName ? `Camera: ${input.cameraName}` : null,
  ].filter(Boolean).join("\n");
  
  const userPrompt = contextInfo 
    ? `Context:\n${contextInfo}\n\nAnalyze this parking enforcement evidence image.`
    : "Analyze this parking enforcement evidence image.";
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content: VISION_PROMPT,
        },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: base64Image, detail: "high" } },
          ],
        },
      ],
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { success: false, error: "No response from Vision GPT" };
    }
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[Vision GPT] Could not parse JSON from response:", content);
      return { success: false, error: "Could not parse structured response" };
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    const result: VisionAnalysisResult = {
      vehicleDetected: Boolean(parsed.vehicleDetected),
      vehicleType: parsed.vehicleType || "unknown",
      bayTypeVisible: parsed.bayTypeVisible || "unclear",
      evIndicators: Boolean(parsed.evIndicators),
      disabledBadgeVisible: Boolean(parsed.disabledBadgeVisible),
      humansDetected: {
        adult: Boolean(parsed.humansDetected?.adult),
        child: Boolean(parsed.humansDetected?.child),
      },
      signageVisible: Boolean(parsed.signageVisible),
      visibilityQuality: parsed.visibilityQuality || "partial",
      confidenceNotes: parsed.confidenceNotes || "",
      numberPlateDetected: parsed.numberPlateDetected || undefined,
      timestampOverlay: parsed.timestampOverlay || undefined,
      analysedAt: new Date().toISOString(),
      modelVersion: "gpt-4o",
      imageHash,
    };
    
    if (result.timestampOverlay) {
      console.log("[Vision GPT] Extracted timestamp from overlay:", result.timestampOverlay);
    }
    
    analysisCache.set(imageHash, result);
    console.log("[Vision GPT] Analysis complete:", result.vehicleDetected ? "Vehicle detected" : "No vehicle");
    
    return { success: true, result };
  } catch (error: any) {
    console.error("[Vision GPT] API error:", error.message);
    return { success: false, error: error.message };
  }
}

export async function analyzeMultipleImages(
  inputs: VisionAnalysisInput[],
  maxConcurrent: number = 3
): Promise<VisionAnalysisResponse[]> {
  const results: VisionAnalysisResponse[] = [];
  
  for (let i = 0; i < inputs.length; i += maxConcurrent) {
    const batch = inputs.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(batch.map(input => analyzeImageWithVision(input)));
    results.push(...batchResults);
  }
  
  return results;
}

export function mergeVisionResults(results: VisionAnalysisResult[]): VisionAnalysisResult | null {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];
  
  const merged: VisionAnalysisResult = {
    vehicleDetected: results.some(r => r.vehicleDetected),
    vehicleType: "unknown",
    bayTypeVisible: "unclear",
    evIndicators: results.some(r => r.evIndicators),
    disabledBadgeVisible: results.some(r => r.disabledBadgeVisible),
    humansDetected: {
      adult: results.some(r => r.humansDetected.adult),
      child: results.some(r => r.humansDetected.child),
    },
    signageVisible: results.some(r => r.signageVisible),
    visibilityQuality: "partial",
    confidenceNotes: "",
    analysedAt: new Date().toISOString(),
    modelVersion: "gpt-4o-merged",
    imageHash: results.map(r => r.imageHash).join("-"),
  };
  
  const vehicleTypes = results.filter(r => r.vehicleType !== "unknown").map(r => r.vehicleType);
  if (vehicleTypes.length > 0) {
    const typeCount: Record<string, number> = {};
    vehicleTypes.forEach(t => { typeCount[t] = (typeCount[t] || 0) + 1; });
    merged.vehicleType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0][0] as any;
  }
  
  const bayTypes = results.filter(r => r.bayTypeVisible !== "unclear").map(r => r.bayTypeVisible);
  if (bayTypes.length > 0) {
    const bayCount: Record<string, number> = {};
    bayTypes.forEach(t => { bayCount[t] = (bayCount[t] || 0) + 1; });
    merged.bayTypeVisible = Object.entries(bayCount).sort((a, b) => b[1] - a[1])[0][0] as any;
  }
  
  const visibilities = results.map(r => r.visibilityQuality);
  if (visibilities.includes("clear")) {
    merged.visibilityQuality = "clear";
  } else if (visibilities.includes("partial")) {
    merged.visibilityQuality = "partial";
  } else {
    merged.visibilityQuality = "poor";
  }
  
  const plates = results.filter(r => r.numberPlateDetected).map(r => r.numberPlateDetected);
  if (plates.length > 0) {
    merged.numberPlateDetected = plates[0];
  }
  
  const notes = results.map(r => r.confidenceNotes).filter(Boolean);
  merged.confidenceNotes = notes.length > 0 
    ? `Merged from ${results.length} images. ${notes.join(" | ")}`
    : `Merged analysis from ${results.length} images.`;
  
  return merged;
}
