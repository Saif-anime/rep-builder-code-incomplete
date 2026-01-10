import { db } from "./db";
import { evidence, parkingEvents, bays, numberPlates, detections, caseEvidence, enforcementCases } from "@shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { analyzeEvidence } from "./ai-analysis";
import { analyzeImageWithVision } from "./visionAnalysis";
import { lookupAndStorePlate, normalizeRegistration, validateUKRegistration } from "./dvlaService";
import { storage } from "./storage";
import * as fs from "fs";
import * as path from "path";

let workerInterval: NodeJS.Timeout | null = null;
const WORKER_INTERVAL_MS = 10000; // 10 seconds

interface AIResult {
  violationDetected: boolean;
  violationType: string | null;
  confidence: number;
  numberPlate: string | null;
  explanation: string;
  factors?: string[];
  uncertainties?: string[];
  recommendation?: string;
  visionAnalysis?: {
    vehicleDetected: boolean;
    vehicleType: string;
    evIndicators: boolean;
    humanPresent: boolean;
    childPresent: boolean;
    disabledBadgeVisible: boolean;
    signageVisible: boolean;
    visibilityQuality: string;
  };
}

async function processEvidenceItem(evidenceItem: typeof evidence.$inferSelect): Promise<void> {
  const evidenceId = evidenceItem.id;
  
  console.log(`[Evidence Worker] Processing evidence ID: ${evidenceId}`);

  try {
    await db.update(evidence)
      .set({ 
        status: "analyzing",
        analysisStartedAt: new Date(),
      })
      .where(eq(evidence.id, evidenceId));

    const bayData = evidenceItem.bayId 
      ? await db.select().from(bays).where(eq(bays.id, evidenceItem.bayId)).then(r => r[0] || null)
      : null;

    const detectionsData = await db.select()
      .from(detections)
      .where(eq(detections.evidenceId, evidenceId));

    const plateData = await db.select()
      .from(numberPlates)
      .where(eq(numberPlates.evidenceId, evidenceId))
      .then(r => r[0] || null);

    let visionResult = null;
    let detectedPlate: string | null = null;

    if (evidenceItem.imagePath) {
      try {
        const imagePath = path.join(process.cwd(), evidenceItem.imagePath.replace(/^\//, ''));
        
        if (fs.existsSync(imagePath)) {
          console.log(`[Evidence Worker] Running Vision GPT analysis for evidence ID: ${evidenceId}`);
          const visionResponse = await analyzeImageWithVision({ imagePath });
          
          if (visionResponse.success && visionResponse.result) {
            visionResult = visionResponse.result;
            
            if (visionResult.numberPlateDetected) {
              detectedPlate = normalizeRegistration(visionResult.numberPlateDetected);
              console.log(`[Evidence Worker] Detected plate from Vision GPT: ${detectedPlate}`);
              
              if (validateUKRegistration(detectedPlate)) {
                const caseLink = await db.select()
                  .from(caseEvidence)
                  .where(eq(caseEvidence.evidenceId, evidenceId))
                  .then(r => r[0] || null);
                
                if (caseLink?.caseId) {
                  console.log(`[Evidence Worker] Triggering DVLA lookup for plate ${detectedPlate} on case ${caseLink.caseId}`);
                  try {
                    const plateReadings = [{
                      reading: visionResult.numberPlateDetected,
                      confidence: visionResult.visibilityQuality === "clear" ? 0.9 : 
                                  visionResult.visibilityQuality === "partial" ? 0.7 : 0.5,
                      evidenceId: evidenceId,
                    }];
                    
                    await lookupAndStorePlate(
                      caseLink.caseId,
                      plateReadings,
                      [evidenceId],
                      [],
                      storage
                    );
                    
                    const existingCase = await storage.getCaseById(caseLink.caseId);
                    if (existingCase && !existingCase.vrm) {
                      await db.update(enforcementCases)
                        .set({ vrm: detectedPlate, updatedAt: new Date() })
                        .where(eq(enforcementCases.id, caseLink.caseId));
                      console.log(`[Evidence Worker] Updated case VRM to ${detectedPlate}`);
                    }
                  } catch (dvlaError: any) {
                    console.error(`[Evidence Worker] DVLA lookup failed for ${detectedPlate}:`, dvlaError.message);
                  }
                }
              }
            }
          }
        } else {
          console.warn(`[Evidence Worker] Image file not found: ${imagePath}`);
        }
      } catch (visionError: any) {
        console.error(`[Evidence Worker] Vision GPT analysis failed for evidence ID ${evidenceId}:`, visionError.message);
      }
    }

    const analysisResult = await analyzeEvidence(
      evidenceItem,
      bayData,
      detectionsData,
      plateData
    );

    const aiResult: AIResult = {
      violationDetected: analysisResult.isViolation,
      violationType: analysisResult.violationType,
      confidence: analysisResult.confidence,
      numberPlate: detectedPlate || plateData?.plateText || null,
      explanation: analysisResult.explanation,
      factors: analysisResult.reasoning.factors,
      uncertainties: analysisResult.reasoning.uncertainties,
      recommendation: analysisResult.reasoning.recommendation,
    };

    if (visionResult) {
      aiResult.visionAnalysis = {
        vehicleDetected: visionResult.vehicleDetected,
        vehicleType: visionResult.vehicleType,
        evIndicators: visionResult.evIndicators,
        humanPresent: visionResult.humansDetected?.adult || false,
        childPresent: visionResult.humansDetected?.child || false,
        disabledBadgeVisible: visionResult.disabledBadgeVisible,
        signageVisible: visionResult.signageVisible,
        visibilityQuality: visionResult.visibilityQuality,
      };
      
      if (visionResult.vehicleDetected && !analysisResult.isViolation) {
        aiResult.factors = [
          ...(aiResult.factors || []),
          `Vehicle detected: ${visionResult.vehicleType}`,
          visionResult.evIndicators ? "EV indicators visible" : "No EV indicators",
          visionResult.disabledBadgeVisible ? "Disabled badge visible" : "No disabled badge visible",
        ];
      }
    }

    await db.update(evidence)
      .set({
        status: "completed",
        analysisCompletedAt: new Date(),
        aiResult: aiResult,
        confidenceScore: analysisResult.confidence,
        analysisError: null,
      })
      .where(eq(evidence.id, evidenceId));

    const [existingEvent] = await db.select()
      .from(parkingEvents)
      .where(eq(parkingEvents.evidenceId, evidenceId));

    if (existingEvent) {
      await db.update(parkingEvents)
        .set({
          aiConfidence: analysisResult.confidence,
          aiExplanation: analysisResult.explanation,
          aiReasoning: analysisResult.reasoning,
          isViolation: analysisResult.isViolation,
          violationType: analysisResult.violationType || existingEvent.violationType,
          status: "analyzed",
          updatedAt: new Date(),
        })
        .where(eq(parkingEvents.id, existingEvent.id));
    }

    console.log(`[Evidence Worker] Completed analysis for evidence ID: ${evidenceId} - Violation: ${analysisResult.isViolation}, Plate: ${detectedPlate || 'not detected'}`);
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error during analysis";
    console.error(`[Evidence Worker] Failed to analyze evidence ID ${evidenceId}:`, errorMessage);

    await db.update(evidence)
      .set({
        status: "failed",
        analysisCompletedAt: new Date(),
        analysisError: errorMessage,
      })
      .where(eq(evidence.id, evidenceId));
  }
}

async function runWorker(): Promise<void> {
  try {
    const pendingEvidence = await db.select()
      .from(evidence)
      .where(
        and(
          eq(evidence.status, "pending"),
          isNotNull(evidence.imagePath)
        )
      )
      .limit(5);

    if (pendingEvidence.length === 0) {
      return;
    }

    console.log(`[Evidence Worker] Found ${pendingEvidence.length} pending evidence items`);

    for (const item of pendingEvidence) {
      await processEvidenceItem(item);
    }
  } catch (error: any) {
    console.error("[Evidence Worker] Error in worker cycle:", error.message || error);
  }
}

export function startEvidenceWorker(): void {
  if (workerInterval) {
    console.log("[Evidence Worker] Worker already running");
    return;
  }

  console.log(`[Evidence Worker] Starting worker (interval: ${WORKER_INTERVAL_MS / 1000}s)`);
  
  runWorker();
  
  workerInterval = setInterval(runWorker, WORKER_INTERVAL_MS);
}

export function stopEvidenceWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log("[Evidence Worker] Worker stopped");
  }
}

export async function analyzeEvidenceById(evidenceId: number): Promise<boolean> {
  const [item] = await db.select()
    .from(evidence)
    .where(eq(evidence.id, evidenceId));

  if (!item) {
    console.error(`[Evidence Worker] Evidence ID ${evidenceId} not found`);
    return false;
  }

  if (item.status === "analyzing") {
    console.log(`[Evidence Worker] Evidence ID ${evidenceId} is already being analyzed`);
    return false;
  }

  await processEvidenceItem(item);
  return true;
}

export async function retryFailedAnalysis(evidenceId: number): Promise<boolean> {
  const [item] = await db.select()
    .from(evidence)
    .where(
      and(
        eq(evidence.id, evidenceId),
        eq(evidence.status, "failed")
      )
    );

  if (!item) {
    console.error(`[Evidence Worker] No failed evidence found with ID ${evidenceId}`);
    return false;
  }

  await db.update(evidence)
    .set({ status: "pending", analysisError: null })
    .where(eq(evidence.id, evidenceId));

  await processEvidenceItem(item);
  return true;
}

export async function reanalyzeEvidenceWithVision(evidenceId: number): Promise<boolean> {
  const [item] = await db.select()
    .from(evidence)
    .where(eq(evidence.id, evidenceId));

  if (!item) {
    console.error(`[Evidence Worker] Evidence ID ${evidenceId} not found`);
    return false;
  }

  await db.update(evidence)
    .set({ status: "pending", analysisError: null })
    .where(eq(evidence.id, evidenceId));

  await processEvidenceItem(item);
  return true;
}
