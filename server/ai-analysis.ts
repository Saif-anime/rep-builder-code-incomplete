import OpenAI from "openai";
import { storage } from "./storage";
import type { Evidence, ParkingEvent, Bay, Detection, NumberPlate } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface ViolationAnalysis {
  isViolation: boolean;
  violationType: string | null;
  confidence: number;
  explanation: string;
  reasoning: {
    factors: string[];
    uncertainties: string[];
    recommendation: string;
  };
}

interface PCNDetails {
  pcnNumber: string;
  amount: number;
  explanation: string;
}

export async function analyzeEvidence(
  evidenceData: Evidence,
  bayData: Bay | null,
  detections: Detection[],
  plateData: NumberPlate | null
): Promise<ViolationAnalysis> {
  const bayType = bayData?.type || "unknown";
  const detectedObjects = detections.map((d) => ({
    type: d.objectType,
    confidence: d.confidence,
    attributes: d.attributes,
  }));

  const prompt = `You are an AI parking enforcement analyst for Euro Parking Services (UK).
Analyze the following parking evidence and determine if there is a violation.

Bay Type: ${bayType}
Bay Rules: ${JSON.stringify(bayData?.rules || {})}
Detected Objects: ${JSON.stringify(detectedObjects)}
Number Plate: ${plateData?.plateText || "Not detected"}
Number Plate Valid UK Format: ${plateData?.isValidUkFormat || false}
Evidence Type: ${evidenceData.type}
Timestamp: ${evidenceData.timestamp}
Officer Notes: ${evidenceData.notes || "None"}

UK Parking Violation Rules:
1. DISABLED BAY: Only valid if wheelchair user, elderly with assistance, or blue badge visible. Violation if healthy adult without visible blue badge.
2. EV BAY: Only for electric vehicles actively charging. Non-EV vehicles or EVs not charging are violations.
3. PARENT & CHILD BAY: Must have adult with young child (under 12). Adult alone or with teenager is a violation.
4. OVERSTAY: Exceeding time limit is a violation.
5. NO PERMIT: Parking in permit-only bay without valid permit is a violation.

Analyze the evidence and provide:
1. Whether this is a violation (true/false)
2. The type of violation if applicable
3. Your confidence level (0.0 to 1.0)
4. A clear explanation suitable for the vehicle owner
5. Detection factors that influenced your decision
6. Any uncertainties in your analysis
7. Your recommendation for the enforcement officer

Respond in JSON format:
{
  "isViolation": boolean,
  "violationType": string or null,
  "confidence": number,
  "explanation": string,
  "factors": string[],
  "uncertainties": string[],
  "recommendation": string
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from AI");
    }

    const analysis = JSON.parse(content);
    return {
      isViolation: analysis.isViolation || false,
      violationType: analysis.violationType || null,
      confidence: analysis.confidence || 0.5,
      explanation: analysis.explanation || "Unable to analyze evidence.",
      reasoning: {
        factors: analysis.factors || [],
        uncertainties: analysis.uncertainties || [],
        recommendation: analysis.recommendation || "Manual review required.",
      },
    };
  } catch (error) {
    console.error("AI analysis error:", error);
    return {
      isViolation: false,
      violationType: null,
      confidence: 0,
      explanation: "AI analysis failed. Manual review required.",
      reasoning: {
        factors: [],
        uncertainties: ["AI analysis unavailable"],
        recommendation: "Please review evidence manually.",
      },
    };
  }
}

export async function generatePCN(
  event: ParkingEvent,
  plateText: string,
  bayType: string
): Promise<PCNDetails> {
  const pcnAmounts: Record<string, number> = {
    disabled_bay: 70,
    ev_bay: 50,
    parent_child: 50,
    overstay: 35,
    no_permit: 60,
  };

  const baseAmount = pcnAmounts[event.violationType || ""] || 50;
  const pcnNumber = `EPS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const prompt = `Generate a formal explanation for a UK Penalty Charge Notice (PCN).

PCN Number: ${pcnNumber}
Vehicle: ${plateText}
Violation Type: ${event.violationType}
Bay Type: ${bayType}
Amount: £${baseAmount}
AI Analysis: ${event.aiExplanation || "N/A"}
Date: ${new Date().toLocaleDateString("en-GB")}

Write a clear, professional explanation suitable for the PCN document that:
1. States the violation clearly
2. References the UK parking regulations
3. Explains the penalty amount
4. Provides appeal information

Keep it under 200 words and formal in tone.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 512,
    });

    const explanation = response.choices[0]?.message?.content || 
      `Penalty Charge Notice issued for ${event.violationType?.replace("_", " ")} violation. Amount: £${baseAmount}.`;

    return {
      pcnNumber,
      amount: baseAmount,
      explanation,
    };
  } catch (error) {
    console.error("PCN generation error:", error);
    return {
      pcnNumber,
      amount: baseAmount,
      explanation: `Penalty Charge Notice issued for ${event.violationType?.replace("_", " ")} violation at ${bayType} bay. Amount due: £${baseAmount}. You may appeal within 28 days.`,
    };
  }
}

export async function generateAppealSummary(event: ParkingEvent): Promise<string> {
  const prompt = `Generate an appeal-ready evidence summary for a parking violation case.

Violation Type: ${event.violationType}
AI Confidence: ${(event.aiConfidence || 0) * 100}%
AI Explanation: ${event.aiExplanation || "N/A"}
AI Reasoning: ${JSON.stringify(event.aiReasoning || {})}

Create a balanced summary that:
1. Presents the evidence objectively
2. Acknowledges any uncertainties
3. Would be suitable for presentation at an appeal tribunal
4. Maintains professional and impartial tone

Keep it under 300 words.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 512,
    });

    return response.choices[0]?.message?.content || "Appeal summary generation failed.";
  } catch (error) {
    console.error("Appeal summary error:", error);
    return "Unable to generate appeal summary. Please contact Euro Parking Services for assistance.";
  }
}

export function validateUKNumberPlate(plateText: string): boolean {
  const cleanPlate = plateText.replace(/\s/g, "").toUpperCase();
  
  // Current format: AB12 CDE (2001-present)
  const currentFormat = /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/;
  
  // Prefix format: A123 BCD (1983-2001)
  const prefixFormat = /^[A-Z][0-9]{1,3}[A-Z]{3}$/;
  
  // Suffix format: ABC 123D (1963-1983)
  const suffixFormat = /^[A-Z]{3}[0-9]{1,3}[A-Z]$/;
  
  // Dateless format: 1234 AB or AB 1234
  const datelessFormat = /^([0-9]{1,4}[A-Z]{1,3}|[A-Z]{1,3}[0-9]{1,4})$/;

  return (
    currentFormat.test(cleanPlate) ||
    prefixFormat.test(cleanPlate) ||
    suffixFormat.test(cleanPlate) ||
    datelessFormat.test(cleanPlate)
  );
}
