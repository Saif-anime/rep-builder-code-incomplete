import { storage } from "./storage";
import { analyzeImageWithVision, mergeVisionResults, type VisionAnalysisResult } from "./visionAnalysis";
import { lookupVehicle, normalizeRegistration } from "./dvlaService";
import crypto from "crypto";
import type { 
  Evidence, 
  CasePipelineResults, 
  CaseAnalysisStep, 
  InsertCaseAnalysisStep,
  ParkingSite,
  SiteRule,
  ParkingSiteSignage
} from "@shared/schema";
import { selectBestSignage, mergeSignageRules } from "./signageExtractionService";

// Store hashes of recent analysis results to detect duplicates
const recentAnalysisHashes = new Map<string, { caseId: string; timestamp: Date }>();
const MAX_HASH_HISTORY = 100;

function computeDecisionHash(decision: DecisionOutput, caseContext: { siteId: number; evidenceCount: number; durationMinutes: number }): string {
  const hashInput = JSON.stringify({
    status: decision.status,
    reasoning: decision.reasoning,
    plainEnglishExplanation: decision.plainEnglishExplanation,
    eligibilityGates: decision.eligibilityGates,
    siteId: caseContext.siteId,
    evidenceCount: caseContext.evidenceCount,
    durationMinutes: caseContext.durationMinutes,
  });
  return crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
}

function checkForDuplicateAnalysis(
  caseId: string,
  decision: DecisionOutput,
  caseContext: { siteId: number; evidenceCount: number; durationMinutes: number }
): { isDuplicate: boolean; duplicateOf?: string; warning?: string } {
  const hash = computeDecisionHash(decision, caseContext);
  
  // Check if this exact analysis has been produced for a different case
  const entries = Array.from(recentAnalysisHashes.entries());
  for (let i = 0; i < entries.length; i++) {
    const [existingHash, data] = entries[i];
    if (existingHash === hash && data.caseId !== caseId) {
      console.warn(`[Pipeline] WARNING: Case ${caseId} produced identical analysis to case ${data.caseId}`);
      return {
        isDuplicate: true,
        duplicateOf: data.caseId,
        warning: `Analysis result matches case ${data.caseId.substring(0, 8)}... - verify this is expected`,
      };
    }
  }
  
  // Store this hash
  recentAnalysisHashes.set(hash, { caseId, timestamp: new Date() });
  
  // Clean old entries
  if (recentAnalysisHashes.size > MAX_HASH_HISTORY) {
    const allEntries = Array.from(recentAnalysisHashes.entries());
    allEntries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
    recentAnalysisHashes.delete(allEntries[0][0]);
  }
  
  return { isDuplicate: false };
}

export type PipelineStepName = 
  | "evidence_normalisation"
  | "vision_analysis"
  | "dvla_enrichment"
  | "regulation_evaluation"
  | "signage_compliance"
  | "context_enrichment"
  | "behaviour_profiling"
  | "bay_rule_evaluation"
  | "decision_engine";

const STEP_ORDER: Record<PipelineStepName, number> = {
  evidence_normalisation: 1,
  vision_analysis: 2,
  dvla_enrichment: 3,
  signage_compliance: 4,  // Moved before regulation_evaluation to extract timing first
  regulation_evaluation: 5,
  context_enrichment: 6,
  behaviour_profiling: 7,
  bay_rule_evaluation: 8,
  decision_engine: 9,
};

const CONFIDENCE_THRESHOLD = 0.7;

interface EvidenceTimelineResult {
  evidenceCount: number;
  imageCount: number;
  videoCount: number;
  timestamps: Array<{
    evidenceId: number;
    timestamp: string;
    source: "ocr" | "exif" | "camera_overlay" | "filename" | "upload_time";
    confidence: number;
    rawOcrText?: string;
  }>;
  entryWindow: { start: string; end: string; confidence: number } | null;
  exitWindow: { start: string; end: string; confidence: number } | null;
  timeRange: { 
    first: string | null; 
    last: string | null; 
    durationMinutes: number;
    rawDurationMinutes?: number;
    timestampQuality?: "high" | "medium" | "low" | "invalid";
    validationIssue?: string | null;
    timeSource?: string;
  };
}

interface VisionResultsOutput {
  vehicleDetections: Array<{
    evidenceId: number;
    detected: boolean;
    type: string;
    confidence: number;
  }>;
  vrmDetections: Array<{
    evidenceId: number;
    plate: string;
    confidence: number;
    method: "ocr" | "vision_gpt";
  }>;
  bayUsageDetections: Array<{
    evidenceId: number;
    bayType: string;
    confidence: number;
  }>;
  timestampExtractions: Array<{
    evidenceId: number;
    extractedTimestamp: string;
    parsedDate: string | null;
    confidence: number;
  }>;
  bestVrmFrame: { evidenceId: number; plate: string; confidence: number } | null;
  overallConfidence: number;
  modelVersions: { yolov8?: string; visionGpt: string };
}

interface DVLADataOutput {
  vrm: string;
  verified: boolean;
  lookupTimestamp: string;
  vehicleData: {
    make: string;
    model?: string;
    colour: string;
    fuelType: string;
    taxStatus: string;
    taxDueDate?: string;
    motStatus: string;
    motExpiryDate?: string;
    yearOfManufacture?: number;
    engineCapacity?: number;
    co2Emissions?: number;
  } | null;
  error?: string;
}

interface RegulationEvaluationOutput {
  siteId: number;
  siteName: string;
  rules: {
    maxStayMinutes: number | null;
    gracePeriodMinutes: number;
    enforcementHours: { start: string; end: string; days: string[] };
    paymentRequired: boolean;
    permitRequired: boolean;
    specialRules: string[];
  };
  evaluation: {
    actualDurationMinutes: number;
    effectiveDurationMinutes?: number;
    allowedDurationMinutes: number | null;
    withinEnforcementHours: boolean;
    breachDetected: boolean;
    breachType: string | null;
    breachExplanation: string | null;
    numericComparison: string;
    complianceResult?: "OK" | "OVERSTAY" | "UNKNOWN";
    ruleSource?: "site_policy" | "signage" | "unknown";
  };
}

interface SignageComplianceOutput {
  inspectionId: number | null;
  inspectionDate: string | null;
  entranceSignage: { status: "pass" | "fail" | "unknown"; notes: string };
  termsVisibility: { status: "pass" | "fail" | "unknown"; notes: string };
  signSpacing: { status: "pass" | "fail" | "unknown"; distanceMeters?: number };
  wordingCompliance: { status: "pass" | "fail" | "unknown"; coreTermsVisible: boolean };
  overallCompliance: "pass" | "fail" | "partial";
  overallConfidence: number;
  issues: string[];
  extractedRegulations: {
    maxStayMinutes: number | null;
    graceMinutes: number | null;
    tariffNotes: string | null;
    confidence: number;
    source: string; // "permanent_signage:TYPE", "ocr", "inspection_data", "merged_signage", "not_available"
  };
  appliedSignageId?: string | null;
  appliedSignageTitle?: string | null;
}

interface ContextEnrichmentOutput {
  weather: {
    conditions: string;
    temperature?: number;
    visibility?: string;
    precipitation?: boolean;
    dataSource: string;
    timestamp: string;
  } | null;
  events: Array<{
    name: string;
    type: string;
    distance?: string;
    impact: "low" | "medium" | "high";
  }>;
  roadworks: Array<{
    location: string;
    type: string;
    impact: "low" | "medium" | "high";
  }>;
  spikeDetection: {
    isSpike: boolean;
    baselineOccupancy: number;
    currentOccupancy: number;
    deviationPercent: number;
    recommendation: "HOLD_PCN" | "PROCEED_PCN" | "REVIEW_REQUIRED" | null;
  } | null;
  anomalies: string[];
  confidenceAdjustment: number;
}

interface BehaviourProfilingOutput {
  driverProfile: {
    vrm: string;
    visitCount: number;
    averageDurationMinutes: number;
    overstayCount: number;
    lastVisit: string | null;
    classification: "FAIR_USER" | "COMMUTER_MISUSE" | "FIRST_TIME_LATE" | "REPEAT_OFFENDER" | "UNKNOWN";
    riskScore: number;
  } | null;
  siteHistory: {
    totalVisits: number;
    complianceRate: number;
    lastCompliantVisit: string | null;
  } | null;
  patternAnalysis: {
    typicalArrivalTime: string | null;
    typicalDuration: number | null;
    weekdayPattern: boolean;
    weekendPattern: boolean;
  } | null;
  mitigatingFactors: string[];
  aggravatingFactors: string[];
}

interface BayRuleEvaluationOutput {
  bayId: number | null;
  bayType: "disabled" | "ev" | "parent_child" | "standard" | "loading" | "permit" | null;
  bayName: string | null;
  ruleApplied: string;
  detections: {
    badgeVisible: boolean | null;
    badgeConfidence: number | null;
    evDetected: boolean | null;
    evConfidence: number | null;
    childDetected: boolean | null;
    childConfidence: number | null;
  };
  decision: "ISSUE_PCN" | "NO_PCN" | "REVIEW_REQUIRED";
  explanation: string;
  evidenceUsed: Array<{
    evidenceId: number;
    timestamp: string;
    contribution: string;
  }>;
  confidenceScore: number;
}

interface DecisionOutput {
  status: "PCN_ELIGIBLE" | "REVIEW_REQUIRED" | "NO_PCN" | "BLOCKED_BY_BAY_RULE";
  eligibilityGates: {
    regulationBreach: boolean;
    signageCompliant: boolean;
    confidenceThresholdMet: boolean;
    noHoldFlags: boolean;
    riskAcceptable: boolean;
    bayRuleAllowsPCN: boolean;
  };
  overallConfidence: number;
  legalRisk: "low" | "medium" | "high";
  recommendation: string;
  reasoning: string;
  plainEnglishExplanation: string;
  blockers: string[];
}

export interface PipelineContext {
  caseId: string;
  siteId: number;
  userId?: string;
  selectedBayType?: string | null;  // Bay type selected by user at upload
  evidenceTimeline?: EvidenceTimelineResult;
  visionResults?: VisionResultsOutput;
  dvlaData?: DVLADataOutput;
  regulationEvaluation?: RegulationEvaluationOutput;
  signageCompliance?: SignageComplianceOutput;
  contextEnrichment?: ContextEnrichmentOutput;
  behaviourProfiling?: BehaviourProfilingOutput;
  bayRuleEvaluation?: BayRuleEvaluationOutput;
  decision?: DecisionOutput;
}

async function createOrUpdateStep(
  caseId: string, 
  stepName: PipelineStepName, 
  status: string, 
  data?: Omit<Partial<InsertCaseAnalysisStep>, 'caseId' | 'stepName' | 'stepOrder' | 'status'>
): Promise<CaseAnalysisStep> {
  const existingSteps = await storage.getAnalysisStepsByCase(caseId);
  const existing = existingSteps.find(s => s.stepName === stepName);
  
  if (existing) {
    const updated = await storage.updateAnalysisStep(existing.id, { status, ...data });
    return updated!;
  }
  
  const newStep: InsertCaseAnalysisStep = {
    caseId,
    stepName,
    stepOrder: STEP_ORDER[stepName],
    status,
    ...data,
  };
  return await storage.createAnalysisStep(newStep);
}

async function stepEvidenceNormalisation(
  ctx: PipelineContext,
  evidenceItems: Evidence[]
): Promise<EvidenceTimelineResult> {
  const step = await createOrUpdateStep(ctx.caseId, "evidence_normalisation", "running", {
    startedAt: new Date(),
  });
  
  try {
    const timestamps: EvidenceTimelineResult["timestamps"] = [];
    let imageCount = 0;
    let videoCount = 0;
    
    for (const ev of evidenceItems) {
      if (ev.imagePath) imageCount++;
      if (ev.videoPath) videoCount++;
      
      // Initial placeholder - will be replaced by OCR-extracted timestamps after Vision analysis
      // Do NOT use metadata sources (EXIF, upload time, etc.) - only OCR from visible image text
      timestamps.push({
        evidenceId: ev.id,
        timestamp: ev.timestamp.toISOString(), // Placeholder - will be overwritten by OCR
        source: "upload_time" as const, // Will be replaced with "ocr" after Vision analysis
        confidence: 0.1, // Low confidence until OCR extraction
      });
    }
    
    timestamps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    const first = timestamps[0]?.timestamp || new Date().toISOString();
    const last = timestamps[timestamps.length - 1]?.timestamp || first;
    let rawDurationMinutes = Math.round(
      (new Date(last).getTime() - new Date(first).getTime()) / (1000 * 60)
    );
    
    // Validate duration - flag unreasonable values
    const MAX_REASONABLE_DURATION_MINUTES = 24 * 60; // 24 hours
    const MIN_REASONABLE_DURATION_MINUTES = 0;
    let durationValidationIssue: string | null = null;
    let timestampQuality: "high" | "medium" | "low" | "invalid" = "high";
    
    // Check timestamp source quality - CRITICAL: 85% confidence threshold per enforcement spec
    // Note: Tesseract returns confidence as 0-100, not 0-1
    const OCR_CONFIDENCE_THRESHOLD = 85;
    const highConfidenceTimestamps = timestamps.filter(t => t.confidence >= OCR_CONFIDENCE_THRESHOLD);
    const lowConfidenceCount = timestamps.filter(t => t.source === "upload_time").length;
    
    if (timestamps.length === 0) {
      timestampQuality = "invalid";
      durationValidationIssue = "No timestamps available";
    } else if (timestamps.length === 1) {
      timestampQuality = "low";
      durationValidationIssue = "Only one timestamp - cannot calculate duration accurately";
      rawDurationMinutes = 0;
    } else if (lowConfidenceCount === timestamps.length) {
      timestampQuality = "low";
      durationValidationIssue = "All timestamps derived from upload time - duration may be inaccurate";
    } else if (highConfidenceTimestamps.length < 2) {
      timestampQuality = "medium";
    }
    
    if (rawDurationMinutes > MAX_REASONABLE_DURATION_MINUTES) {
      durationValidationIssue = `Calculated duration of ${Math.floor(rawDurationMinutes / 60)}h ${rawDurationMinutes % 60}m exceeds 24 hours - likely timestamp error`;
      timestampQuality = "invalid";
    } else if (rawDurationMinutes < MIN_REASONABLE_DURATION_MINUTES) {
      durationValidationIssue = "Negative duration calculated - timestamp order error";
      timestampQuality = "invalid";
      rawDurationMinutes = 0;
    }
    
    // Use validated duration (cap at reasonable max for display, but flag the issue)
    const durationMinutes = timestampQuality === "invalid" 
      ? 0 
      : rawDurationMinutes;
    
    let entryWindow: EvidenceTimelineResult["entryWindow"] = null;
    let exitWindow: EvidenceTimelineResult["exitWindow"] = null;
    
    if (timestamps.length >= 2) {
      entryWindow = {
        start: timestamps[0].timestamp,
        end: timestamps[Math.min(1, timestamps.length - 1)].timestamp,
        confidence: timestamps[0].confidence,
      };
      exitWindow = {
        start: timestamps[Math.max(0, timestamps.length - 2)].timestamp,
        end: last,
        confidence: timestamps[timestamps.length - 1].confidence,
      };
    }
    
    const result: EvidenceTimelineResult = {
      evidenceCount: evidenceItems.length,
      imageCount,
      videoCount,
      timestamps,
      entryWindow,
      exitWindow,
      timeRange: { 
        first, 
        last, 
        durationMinutes,
        rawDurationMinutes,
        timestampQuality,
        validationIssue: durationValidationIssue,
      },
    };
    
    await createOrUpdateStep(ctx.caseId, "evidence_normalisation", "completed", {
      completedAt: new Date(),
      durationMs: Date.now() - (step.startedAt?.getTime() || Date.now()),
      outputData: result,
    });
    
    return result;
  } catch (error: any) {
    await createOrUpdateStep(ctx.caseId, "evidence_normalisation", "failed", {
      completedAt: new Date(),
      errorMessage: error.message,
    });
    throw error;
  }
}

function parseTimestampOverlay(timestampStr: string): string | null {
  if (!timestampStr) return null;
  
  // Patterns for various camera timestamp formats
  // UK Hikvision format: "30-12-2025 Tue 14:32:27" (DD-MM-YYYY Day HH:MM:SS)
  const patterns = [
    /(\d{2})-(\d{2})-(\d{4})\s+\w{3}\s+(\d{2}):(\d{2}):(\d{2})/,  // DD-MM-YYYY Day HH:MM:SS
    /(\d{2})\/(\d{2})\/(\d{4})\s+\w{3}\s+(\d{2}):(\d{2}):(\d{2})/, // DD/MM/YYYY Day HH:MM:SS
    /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,         // DD/MM/YYYY HH:MM:SS
    /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,           // YYYY-MM-DD HH:MM:SS
    /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/,             // YYYY-MM-DDTHH:MM:SS
    /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,           // DD-MM-YYYY HH:MM:SS
    /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/,                 // DD/MM/YYYY HH:MM
    /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,         // YYYY/MM/DD HH:MM:SS
  ];
  
  for (const pattern of patterns) {
    const match = timestampStr.match(pattern);
    if (match) {
      try {
        let year: number, month: number, day: number, hour: number, minute: number, second: number;
        
        if (pattern.source.startsWith("(\\d{2})\\/")) {
          day = parseInt(match[1]);
          month = parseInt(match[2]);
          year = parseInt(match[3]);
          hour = parseInt(match[4]);
          minute = parseInt(match[5]);
          second = match[6] ? parseInt(match[6]) : 0;
        } else if (pattern.source.startsWith("(\\d{4})")) {
          year = parseInt(match[1]);
          month = parseInt(match[2]);
          day = parseInt(match[3]);
          hour = parseInt(match[4]);
          minute = parseInt(match[5]);
          second = match[6] ? parseInt(match[6]) : 0;
        } else {
          day = parseInt(match[1]);
          month = parseInt(match[2]);
          year = parseInt(match[3]);
          hour = parseInt(match[4]);
          minute = parseInt(match[5]);
          second = match[6] ? parseInt(match[6]) : 0;
        }
        
        const date = new Date(year, month - 1, day, hour, minute, second);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      } catch {
        continue;
      }
    }
  }
  
  try {
    const parsed = new Date(timestampStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  } catch {
    return null;
  }
  
  return null;
}

async function stepVisionAnalysis(
  ctx: PipelineContext,
  evidenceItems: Evidence[]
): Promise<VisionResultsOutput> {
  const step = await createOrUpdateStep(ctx.caseId, "vision_analysis", "running", {
    startedAt: new Date(),
  });
  
  try {
    const vehicleDetections: VisionResultsOutput["vehicleDetections"] = [];
    const vrmDetections: VisionResultsOutput["vrmDetections"] = [];
    const bayUsageDetections: VisionResultsOutput["bayUsageDetections"] = [];
    const timestampExtractions: VisionResultsOutput["timestampExtractions"] = [];
    const visionResults: VisionAnalysisResult[] = [];
    
    const imageEvidence = evidenceItems.filter(e => e.imagePath);
    
    for (const ev of imageEvidence) {
      if (!ev.imagePath) continue;
      
      // CRITICAL: First check if evidence already has OCR data saved from previous analysis
      // This avoids re-running vision analysis (which may fail due to Gemini quota)
      const existingAiResult = ev.aiResult as any;
      const existingVisionAnalysis = existingAiResult?.visionAnalysis;
      
      if (existingVisionAnalysis?.timestampOverlay) {
        // Use existing OCR timestamp data from database
        const parsedDate = parseTimestampOverlay(existingVisionAnalysis.timestampOverlay);
        const ocrConf = existingVisionAnalysis.ocrTimestampConfidence ?? (parsedDate ? 90 : 50);
        
        timestampExtractions.push({
          evidenceId: ev.id,
          extractedTimestamp: existingVisionAnalysis.timestampOverlay,
          parsedDate,
          confidence: ocrConf,
        });
        console.log(`[Pipeline] Using saved OCR timestamp for evidence ${ev.id}: ${existingVisionAnalysis.timestampOverlay} -> ${parsedDate} (conf: ${ocrConf.toFixed(1)}%)`);
        
        // Also extract other vision data from saved aiResult
        vehicleDetections.push({
          evidenceId: ev.id,
          detected: existingVisionAnalysis.vehicleDetected ?? false,
          type: existingVisionAnalysis.vehicleType || "unknown",
          confidence: existingVisionAnalysis.vehicleDetected ? 0.85 : 0.3,
        });
        
        if (existingVisionAnalysis.numberPlateDetected) {
          vrmDetections.push({
            evidenceId: ev.id,
            plate: normalizeRegistration(existingVisionAnalysis.numberPlateDetected),
            confidence: 0.8,
            method: "vision_gpt",
          });
        }
        
        if (existingVisionAnalysis.bayTypeVisible && existingVisionAnalysis.bayTypeVisible !== "unclear") {
          bayUsageDetections.push({
            evidenceId: ev.id,
            bayType: existingVisionAnalysis.bayTypeVisible,
            confidence: 0.75,
          });
        }
        
        continue; // Skip re-running vision analysis for this evidence
      }
      
      // No existing OCR data - run fresh vision analysis
      const result = await analyzeImageWithVision({
        imagePath: ev.imagePath,
        caseId: ctx.caseId,
      });
      
      if (result.success && result.result) {
        visionResults.push(result.result);
        
        vehicleDetections.push({
          evidenceId: ev.id,
          detected: result.result.vehicleDetected,
          type: result.result.vehicleType,
          confidence: result.result.vehicleDetected ? 0.85 : 0.3,
        });
        
        if (result.result.numberPlateDetected) {
          vrmDetections.push({
            evidenceId: ev.id,
            plate: normalizeRegistration(result.result.numberPlateDetected),
            confidence: 0.8,
            method: "vision_gpt",
          });
        }
        
        if (result.result.bayTypeVisible !== "unclear") {
          bayUsageDetections.push({
            evidenceId: ev.id,
            bayType: result.result.bayTypeVisible,
            confidence: 0.75,
          });
        }
        
        if (result.result.timestampOverlay) {
          const parsedDate = parseTimestampOverlay(result.result.timestampOverlay);
          // CRITICAL: Use actual OCR confidence from Tesseract, NOT hardcoded values
          // Tesseract returns 0-100 scale; pipeline thresholds expect 0-100 (85 = 85%)
          const ocrConf = result.result.ocrTimestampConfidence ?? (parsedDate ? 90 : 50);
          timestampExtractions.push({
            evidenceId: ev.id,
            extractedTimestamp: result.result.timestampOverlay,
            parsedDate,
            confidence: ocrConf,
          });
          console.log(`[Pipeline] Extracted timestamp for evidence ${ev.id}: ${result.result.timestampOverlay} -> ${parsedDate} (conf: ${ocrConf.toFixed(1)}%)`);
        }
      }
    }
    
    let bestVrmFrame: VisionResultsOutput["bestVrmFrame"] = null;
    if (vrmDetections.length > 0) {
      const best = vrmDetections.reduce((a, b) => a.confidence > b.confidence ? a : b);
      bestVrmFrame = {
        evidenceId: best.evidenceId,
        plate: best.plate,
        confidence: best.confidence,
      };
    }
    
    const merged = mergeVisionResults(visionResults);
    const overallConfidence = merged ? 0.8 : 0.5;
    
    const result: VisionResultsOutput = {
      vehicleDetections,
      vrmDetections,
      bayUsageDetections,
      timestampExtractions,
      bestVrmFrame,
      overallConfidence,
      modelVersions: { visionGpt: "automated_vision" },
    };
    
    await createOrUpdateStep(ctx.caseId, "vision_analysis", "completed", {
      completedAt: new Date(),
      durationMs: Date.now() - (step.startedAt?.getTime() || Date.now()),
      outputData: result,
    });
    
    return result;
  } catch (error: any) {
    await createOrUpdateStep(ctx.caseId, "vision_analysis", "failed", {
      completedAt: new Date(),
      errorMessage: error.message,
    });
    throw error;
  }
}

async function stepDVLAEnrichment(
  ctx: PipelineContext,
  vrm: string | null
): Promise<DVLADataOutput> {
  const step = await createOrUpdateStep(ctx.caseId, "dvla_enrichment", "running", {
    startedAt: new Date(),
  });
  
  try {
    if (!vrm) {
      const result: DVLADataOutput = {
        vrm: "",
        verified: false,
        lookupTimestamp: new Date().toISOString(),
        vehicleData: null,
        error: "No VRM detected from vision analysis",
      };
      
      await createOrUpdateStep(ctx.caseId, "dvla_enrichment", "skipped", {
        completedAt: new Date(),
        durationMs: Date.now() - (step.startedAt?.getTime() || Date.now()),
        outputData: result,
      });
      
      return result;
    }
    
    const normalized = normalizeRegistration(vrm);
    const dvlaResult = await lookupVehicle(normalized, ctx.caseId);
    
    const result: DVLADataOutput = {
      vrm: normalized,
      verified: dvlaResult.success,
      lookupTimestamp: new Date().toISOString(),
      vehicleData: dvlaResult.success && dvlaResult.data ? {
        make: dvlaResult.data.make || "Unknown",
        model: dvlaResult.data.model,
        colour: dvlaResult.data.colour || "Unknown",
        fuelType: dvlaResult.data.fuelType || "Unknown",
        taxStatus: dvlaResult.data.taxStatus || "Unknown",
        taxDueDate: dvlaResult.data.taxDueDate,
        motStatus: dvlaResult.data.motStatus || "Unknown",
        motExpiryDate: dvlaResult.data.motExpiryDate,
        yearOfManufacture: dvlaResult.data.yearOfManufacture,
        engineCapacity: dvlaResult.data.engineCapacity,
        co2Emissions: dvlaResult.data.co2Emissions,
      } : null,
      error: dvlaResult.error,
    };
    
    await createOrUpdateStep(ctx.caseId, "dvla_enrichment", dvlaResult.success ? "completed" : "failed", {
      completedAt: new Date(),
      durationMs: Date.now() - (step.startedAt?.getTime() || Date.now()),
      outputData: result,
      errorMessage: dvlaResult.error,
    });
    
    return result;
  } catch (error: any) {
    await createOrUpdateStep(ctx.caseId, "dvla_enrichment", "failed", {
      completedAt: new Date(),
      errorMessage: error.message,
    });
    throw error;
  }
}

async function stepRegulationEvaluation(
  ctx: PipelineContext,
  site: ParkingSite,
  siteRules: SiteRule | undefined,
  signageCompliance: SignageComplianceOutput | undefined,
  durationMinutes: number,
  timestampQuality?: "high" | "medium" | "low" | "invalid"
): Promise<RegulationEvaluationOutput> {
  const step = await createOrUpdateStep(ctx.caseId, "regulation_evaluation", "running", {
    startedAt: new Date(),
  });
  
  try {
    // Priority order for max stay: signage (high confidence) > site policy > unknown
    // Signage-extracted timing takes precedence when confidence is sufficient
    // Fallback gracefully if signage compliance failed or is unavailable
    const signageMaxStay = signageCompliance?.extractedRegulations?.maxStayMinutes ?? null;
    const signageConfidence = signageCompliance?.extractedRegulations?.confidence ?? 0;
    const signageGrace = signageCompliance?.extractedRegulations?.graceMinutes ?? null;
    
    let maxStayMinutes: number | null;
    let ruleSource: "site_policy" | "signage" | "unknown";
    
    // Use signage timing if available with sufficient confidence (>0.6)
    if (signageMaxStay !== null && signageConfidence >= 0.6) {
      maxStayMinutes = signageMaxStay;
      ruleSource = "signage";
      console.log(`[Regulation] Using signage-based max stay: ${maxStayMinutes}m (confidence: ${signageConfidence})`);
    } else if (siteRules?.maxStayMinutes) {
      maxStayMinutes = siteRules.maxStayMinutes;
      ruleSource = "site_policy";
      console.log(`[Regulation] Using site policy max stay: ${maxStayMinutes}m`);
    } else {
      maxStayMinutes = null;
      ruleSource = "unknown";
      console.log(`[Regulation] No max stay configured - manual review required`);
    }
    
    // Grace period: signage > site rules > default
    const graceEntryMinutes = signageGrace !== null ? Math.floor(signageGrace / 2) : (siteRules?.graceEntryMinutes ?? 5);
    const graceExitMinutes = signageGrace !== null ? Math.ceil(signageGrace / 2) : (siteRules?.graceExitMinutes ?? 5);
    const gracePeriodMinutes = graceEntryMinutes + graceExitMinutes;
    
    const enforcementMode = siteRules?.enforcementMode || "standard";
    const enforcementStart = "00:00";
    const enforcementEnd = "23:59";
    const enforcementDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    
    const now = new Date();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const currentDay = dayNames[now.getDay()];
    const currentTime = now.toTimeString().slice(0, 5);
    
    const withinEnforcementHours = 
      enforcementMode !== "disabled" &&
      enforcementDays.includes(currentDay) &&
      currentTime >= enforcementStart &&
      currentTime <= enforcementEnd;
    
    let breachDetected = false;
    let breachType: string | null = null;
    let breachExplanation: string | null = null;
    let complianceResult: "OK" | "OVERSTAY" | "UNKNOWN" = "UNKNOWN";
    
    const formatDuration = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };
    
    const effectiveAllowedDuration = maxStayMinutes ? maxStayMinutes + gracePeriodMinutes : null;
    
    // Calculate effective duration (after grace period)
    const effectiveDurationMinutes = Math.max(0, durationMinutes - gracePeriodMinutes);
    
    // Determine compliance result
    if (timestampQuality === "invalid" || durationMinutes === 0) {
      complianceResult = "UNKNOWN";
      breachExplanation = "Cannot determine compliance - timestamp data is invalid or missing.";
    } else if (maxStayMinutes === null) {
      complianceResult = "UNKNOWN";
      breachExplanation = "Maximum stay limit not configured for this site. Manual review required.";
    } else if (durationMinutes > effectiveAllowedDuration!) {
      breachDetected = true;
      breachType = "OVERSTAY";
      complianceResult = "OVERSTAY";
      const overstayAmount = durationMinutes - effectiveAllowedDuration!;
      breachExplanation = `Vehicle parked for ${formatDuration(durationMinutes)}. Maximum stay per ${ruleSource.replace("_", " ")}: ${formatDuration(maxStayMinutes)}. Grace period: ${gracePeriodMinutes}m. Effective duration: ${formatDuration(effectiveDurationMinutes)}. Result: Overstay by ${formatDuration(overstayAmount)}.`;
    } else {
      complianceResult = "OK";
      breachExplanation = `Vehicle parked for ${formatDuration(durationMinutes)}. Maximum stay: ${formatDuration(maxStayMinutes)}. Within allowed limits.`;
    }
    
    // Build numeric comparison string with full time math
    let numericComparison: string;
    if (maxStayMinutes) {
      const overstayAmount = Math.max(0, durationMinutes - effectiveAllowedDuration!);
      if (complianceResult === "OVERSTAY") {
        numericComparison = `${formatDuration(durationMinutes)} parked | ${formatDuration(maxStayMinutes)} max stay | ${gracePeriodMinutes}m grace | Overstay: ${formatDuration(overstayAmount)}`;
      } else {
        numericComparison = `${formatDuration(durationMinutes)} parked | ${formatDuration(maxStayMinutes)} max stay | ${gracePeriodMinutes}m grace | OK`;
      }
    } else {
      numericComparison = `${formatDuration(durationMinutes)} parked | Max stay: UNKNOWN | Review required`;
    }
    
    const result: RegulationEvaluationOutput = {
      siteId: site.id,
      siteName: site.siteName,
      rules: {
        maxStayMinutes,
        gracePeriodMinutes,
        enforcementHours: { start: enforcementStart, end: enforcementEnd, days: enforcementDays },
        paymentRequired: false,
        permitRequired: false,
        specialRules: [],
      },
      evaluation: {
        actualDurationMinutes: durationMinutes,
        effectiveDurationMinutes,
        allowedDurationMinutes: maxStayMinutes,
        withinEnforcementHours,
        breachDetected,
        breachType,
        breachExplanation,
        numericComparison,
        complianceResult,
        ruleSource,
      },
    };
    
    await createOrUpdateStep(ctx.caseId, "regulation_evaluation", "completed", {
      completedAt: new Date(),
      durationMs: Date.now() - (step.startedAt?.getTime() || Date.now()),
      outputData: result,
    });
    
    return result;
  } catch (error: any) {
    await createOrUpdateStep(ctx.caseId, "regulation_evaluation", "failed", {
      completedAt: new Date(),
      errorMessage: error.message,
    });
    throw error;
  }
}

async function stepSignageCompliance(
  ctx: PipelineContext,
  permanentSignage: ParkingSiteSignage[]
): Promise<SignageComplianceOutput> {
  // CRITICAL: Signage is ONLY loaded from Parking Site configuration
  // Evidence images are NOT used for signage extraction - only for vehicle behavior/timing
  const step = await createOrUpdateStep(ctx.caseId, "signage_compliance", "running", {
    startedAt: new Date(),
  });
  
  try {
    // Extract timing from permanent site signage (the ONLY source)
    let signageMaxStay: number | null = null;
    let signageGrace: number | null = null;
    let signageConfidence = 0;
    let signageSource: string = "not_available";
    let signageNotes: string | null = null;
    let appliedSignageId: string | null = null;
    let appliedSignageTitle: string | null = null;
    
    if (permanentSignage.length > 0) {
      // Select best signage by type priority and confidence
      const bestSignage = selectBestSignage(permanentSignage);
      if (bestSignage) {
        appliedSignageId = bestSignage.id;
        appliedSignageTitle = (bestSignage as any).title || null;
        const extractedData = bestSignage.extractedData as any;
        if (extractedData) {
          signageMaxStay = extractedData.maxStayMinutes ?? null;
          signageGrace = extractedData.graceMinutes ?? null;
          signageConfidence = bestSignage.confidenceScore || 0.6;
          signageSource = `site_signage:${bestSignage.signageType}`;
          if (extractedData.rawTextExtracted) {
            signageNotes = `Extracted from ${bestSignage.signageType} signage (Parking Site Configuration)`;
          }
        }
      }
      
      // Also merge rules from all signage for bay restrictions
      const mergedRules = mergeSignageRules(permanentSignage as any);
      if (mergedRules && !signageMaxStay && mergedRules.maxStayMinutes) {
        signageMaxStay = mergedRules.maxStayMinutes;
        signageGrace = mergedRules.graceMinutes;
        signageConfidence = 0.7;
        signageSource = "merged_site_signage";
      }
      
      // Record signage usage for audit
      if (appliedSignageId) {
        try {
          await storage.createSignageUsageAudit({
            caseId: ctx.caseId,
            signageId: appliedSignageId,
            rulesApplied: {
              maxStayMinutes: signageMaxStay,
              graceMinutes: signageGrace,
              enforcementActive: true,
              bayRestrictions: [],
            },
            confidenceAtUsage: signageConfidence,
            explanationGenerated: signageNotes,
          });
        } catch (auditError: any) {
          console.warn(`[Pipeline] Failed to record signage audit: ${auditError.message}`);
        }
      }
    }
    
    // No site signage configured - mark as NOT_AVAILABLE and reduce confidence
    if (permanentSignage.length === 0) {
      const result: SignageComplianceOutput = {
        inspectionId: null,
        inspectionDate: null,
        entranceSignage: { status: "unknown", notes: "No site signage configured" },
        termsVisibility: { status: "unknown", notes: "No site signage configured" },
        signSpacing: { status: "unknown" },
        wordingCompliance: { status: "unknown", coreTermsVisible: false },
        overallCompliance: "partial",
        overallConfidence: 0.3,
        issues: ["No signage configured for this site - upload signage PDFs in Parking Sites > Site Signage"],
        extractedRegulations: {
          maxStayMinutes: null,
          graceMinutes: null,
          tariffNotes: null,
          confidence: 0,
          source: "not_available",
        },
      };
      
      await createOrUpdateStep(ctx.caseId, "signage_compliance", "completed", {
        completedAt: new Date(),
        durationMs: Date.now() - (step.startedAt?.getTime() || Date.now()),
        outputData: result,
      });
      
      return result;
    }
    
    // Site signage exists - evaluate based on configured signage data
    const hasSignageData = signageMaxStay !== null || signageConfidence > 0.5;
    const issues: string[] = hasSignageData ? [] : ["Signage data incomplete - review site signage configuration"];
    
    const result: SignageComplianceOutput = {
      inspectionId: null,
      inspectionDate: null,
      entranceSignage: { 
        status: hasSignageData ? "pass" : "unknown", 
        notes: appliedSignageTitle ? `Rules from: ${appliedSignageTitle}` : "From Parking Site Configuration" 
      },
      termsVisibility: { 
        status: hasSignageData ? "pass" : "unknown", 
        notes: signageNotes || "From Parking Site Configuration" 
      },
      signSpacing: { status: "unknown" },
      wordingCompliance: { status: "unknown", coreTermsVisible: true },
      overallCompliance: hasSignageData ? "pass" : "partial",
      overallConfidence: signageConfidence,
      issues,
      extractedRegulations: {
        maxStayMinutes: signageMaxStay,
        graceMinutes: signageGrace,
        tariffNotes: signageNotes,
        confidence: signageConfidence,
        source: signageSource,
      },
      appliedSignageId,
      appliedSignageTitle,
    };
    
    await createOrUpdateStep(ctx.caseId, "signage_compliance", "completed", {
      completedAt: new Date(),
      durationMs: Date.now() - (step.startedAt?.getTime() || Date.now()),
      outputData: result,
    });
    
    return result;
    
  } catch (error: any) {
    await createOrUpdateStep(ctx.caseId, "signage_compliance", "failed", {
      completedAt: new Date(),
      errorMessage: error.message,
    });
    throw error;
  }
}

// Signage now comes ONLY from Parking Site configuration (not from evidence images)

function stepContextEnrichment(
  ctx: PipelineContext,
  eventDate: Date
): ContextEnrichmentOutput {
  const anomalies: string[] = [];
  let confidenceAdjustment = 0;
  
  const weather = {
    conditions: "Clear",
    temperature: 15,
    visibility: "Good",
    precipitation: false,
    dataSource: "mock",
    timestamp: new Date().toISOString(),
  };
  
  const events: ContextEnrichmentOutput["events"] = [];
  const roadworks: ContextEnrichmentOutput["roadworks"] = [];
  
  let spikeDetection: ContextEnrichmentOutput["spikeDetection"] = null;
  
  if (weather.precipitation) {
    anomalies.push("Adverse weather conditions may affect driver behaviour");
    confidenceAdjustment -= 0.05;
  }
  
  return {
    weather,
    events,
    roadworks,
    spikeDetection,
    anomalies,
    confidenceAdjustment,
  };
}

function stepBehaviourProfiling(
  ctx: PipelineContext,
  vrm: string | null
): BehaviourProfilingOutput {
  const mitigatingFactors: string[] = [];
  const aggravatingFactors: string[] = [];
  
  let driverProfile: BehaviourProfilingOutput["driverProfile"] = null;
  
  if (vrm) {
    driverProfile = {
      vrm,
      visitCount: 1,
      averageDurationMinutes: ctx.evidenceTimeline?.timeRange.durationMinutes || 0,
      overstayCount: 0,
      lastVisit: null,
      classification: "UNKNOWN",
      riskScore: 0.5,
    };
    
    if (driverProfile.overstayCount === 0) {
      mitigatingFactors.push("No prior overstay history at this site");
    }
    if (driverProfile.visitCount === 1) {
      mitigatingFactors.push("First recorded visit to this site");
    }
  }
  
  return {
    driverProfile,
    siteHistory: null,
    patternAnalysis: null,
    mitigatingFactors,
    aggravatingFactors,
  };
}

async function stepBayRuleEvaluation(
  ctx: PipelineContext,
  evidenceItems: Evidence[],
  visionResults: VisionResultsOutput,
  dvlaData: DVLADataOutput | undefined
): Promise<BayRuleEvaluationOutput> {
  // Bay type priority: 1. User-selected at upload, 2. Camera->Bay mapping, 3. Evidence->Bay, 4. Standard
  let bay: { id: number; name: string; type: string } | null = null;
  let resolvedBayType: BayRuleEvaluationOutput["bayType"] = "standard";
  
  // Priority 1: Use bay type selected by user at evidence upload
  if (ctx.selectedBayType) {
    // Map the selected bay type to the internal bay type format
    const bayTypeMapping: Record<string, BayRuleEvaluationOutput["bayType"]> = {
      "general_parking": "standard",
      "disabled_bay": "disabled",
      "ev_bay": "ev",
      "loading_bay": "loading",
      "permit_holders": "permit",
      "no_parking": "standard",
      "drop_off_pickup": "loading",
      "staff_parking": "permit",
      "standard": "standard",
      "disabled": "disabled",
      "ev": "ev",
      "loading": "loading",
      "permit": "permit",
      "parent_child": "parent_child",
    };
    resolvedBayType = bayTypeMapping[ctx.selectedBayType] || "standard";
    console.log(`[Pipeline] Using user-selected bay type: ${ctx.selectedBayType} -> ${resolvedBayType}`);
  } else {
    // Priority 2/3: Check if any evidence has a camera with a bay mapping
    for (const ev of evidenceItems) {
      if (ev.cameraId) {
        const bayFromCamera = await storage.getBayByCamera(ev.cameraId);
        if (bayFromCamera) {
          bay = { id: bayFromCamera.id, name: bayFromCamera.name, type: bayFromCamera.type };
          break;
        }
      }
      if (ev.bayId) {
        const directBay = await storage.getBay(ev.bayId);
        if (directBay) {
          bay = { id: directBay.id, name: directBay.name, type: directBay.type };
          break;
        }
      }
    }
    
    // Priority 4: Default to standard if no bay found
    resolvedBayType = (bay?.type?.toLowerCase() as BayRuleEvaluationOutput["bayType"]) || "standard";
  }
  
  const bayType = resolvedBayType;
  const bayId = bay?.id || null;
  const bayName = bay?.name || null;
  
  // Extract detection data from vision results and DVLA data
  const detections: BayRuleEvaluationOutput["detections"] = {
    badgeVisible: null,
    badgeConfidence: null,
    evDetected: null,
    evConfidence: null,
    childDetected: null,
    childConfidence: null,
  };
  
  // Evidence used tracking
  const evidenceUsed: BayRuleEvaluationOutput["evidenceUsed"] = [];
  
  // Check DVLA fuel type for EV detection
  if (dvlaData?.vehicleData?.fuelType) {
    const fuelType = dvlaData.vehicleData.fuelType.toUpperCase();
    const isEV = fuelType === "ELECTRIC" || fuelType === "ELECTRICITY" || fuelType.includes("ELECTRIC");
    detections.evDetected = isEV;
    detections.evConfidence = dvlaData.verified ? 0.95 : 0.6;
  }
  
  // Check vision results for vehicle type (EV indicators)
  for (const detection of visionResults.vehicleDetections) {
    if (detection.detected) {
      const vehicleType = detection.type.toLowerCase();
      if (vehicleType.includes("electric") || vehicleType.includes("ev") || vehicleType.includes("tesla")) {
        detections.evDetected = true;
        detections.evConfidence = Math.max(detections.evConfidence || 0, detection.confidence);
      }
      evidenceUsed.push({
        evidenceId: detection.evidenceId,
        timestamp: ctx.evidenceTimeline?.timestamps.find(t => t.evidenceId === detection.evidenceId)?.timestamp || new Date().toISOString(),
        contribution: `Vehicle detection: ${detection.type}`,
      });
    }
  }
  
  // Check bay usage detections for badge/child/EV indicators
  for (const bayDetection of visionResults.bayUsageDetections) {
    const bayInfo = bayDetection.bayType.toLowerCase();
    
    if (bayInfo.includes("badge") || bayInfo.includes("disabled")) {
      if (bayInfo.includes("visible") || bayInfo.includes("present")) {
        detections.badgeVisible = true;
        detections.badgeConfidence = Math.max(detections.badgeConfidence || 0, bayDetection.confidence);
      } else if (bayInfo.includes("not visible") || bayInfo.includes("absent") || bayInfo.includes("no badge")) {
        detections.badgeVisible = false;
        detections.badgeConfidence = Math.max(detections.badgeConfidence || 0, bayDetection.confidence);
      }
    }
    
    if (bayInfo.includes("child") || bayInfo.includes("minor")) {
      if (bayInfo.includes("detected") || bayInfo.includes("visible") || bayInfo.includes("present") || bayInfo.includes("exits")) {
        detections.childDetected = true;
        detections.childConfidence = Math.max(detections.childConfidence || 0, bayDetection.confidence);
      } else if (bayInfo.includes("not detected") || bayInfo.includes("absent") || bayInfo.includes("no child")) {
        detections.childDetected = false;
        detections.childConfidence = Math.max(detections.childConfidence || 0, bayDetection.confidence);
      }
    }
    
    evidenceUsed.push({
      evidenceId: bayDetection.evidenceId,
      timestamp: ctx.evidenceTimeline?.timestamps.find(t => t.evidenceId === bayDetection.evidenceId)?.timestamp || new Date().toISOString(),
      contribution: `Bay analysis: ${bayDetection.bayType}`,
    });
  }
  
  // Apply bay-specific rules
  let decision: BayRuleEvaluationOutput["decision"];
  let explanation: string;
  let ruleApplied: string;
  let confidenceScore = 0.5;
  
  switch (bayType) {
    case "disabled":
      ruleApplied = "Disabled Bay Rule - Blue badge verification required";
      if (detections.badgeVisible === true) {
        decision = "NO_PCN";
        explanation = `Disabled badge was detected on the vehicle dashboard/windscreen. The vehicle is entitled to park in this disabled bay.`;
        confidenceScore = detections.badgeConfidence || 0.8;
      } else if (detections.badgeVisible === false) {
        decision = "ISSUE_PCN";
        explanation = `No disabled badge was detected on the vehicle. The vehicle appears to be parked in a disabled bay without displaying a valid blue badge.`;
        confidenceScore = detections.badgeConfidence || 0.7;
      } else {
        decision = "REVIEW_REQUIRED";
        explanation = `Unable to determine if a disabled badge is displayed. Manual review required to verify badge presence before issuing PCN.`;
        confidenceScore = 0.4;
      }
      break;
      
    case "ev":
      ruleApplied = "EV Charging Bay Rule - Electric vehicle verification required";
      if (detections.evDetected === true) {
        decision = "NO_PCN";
        explanation = `Vehicle confirmed as electric (fuel type: ${dvlaData?.vehicleData?.fuelType || 'Electric'}). The vehicle is entitled to use this EV charging bay.`;
        confidenceScore = detections.evConfidence || 0.85;
      } else if (detections.evDetected === false) {
        decision = "ISSUE_PCN";
        explanation = `Vehicle is not electric (fuel type: ${dvlaData?.vehicleData?.fuelType || 'Non-electric'}). Non-electric vehicles are not permitted in EV charging bays.`;
        confidenceScore = detections.evConfidence || 0.8;
      } else {
        decision = "REVIEW_REQUIRED";
        explanation = `Unable to determine if vehicle is electric. Manual review required to verify vehicle type before issuing PCN.`;
        confidenceScore = 0.4;
      }
      break;
      
    case "parent_child":
      ruleApplied = "Parent & Child Bay Rule - Child presence verification required";
      if (detections.childDetected === true) {
        decision = "NO_PCN";
        explanation = `A child was detected exiting or entering the vehicle. The vehicle is entitled to use this Parent & Child bay.`;
        confidenceScore = detections.childConfidence || 0.75;
      } else if (detections.childDetected === false) {
        decision = "ISSUE_PCN";
        explanation = `No child was detected with the vehicle. Parent & Child bays are reserved for vehicles with children.`;
        confidenceScore = detections.childConfidence || 0.7;
      } else {
        decision = "REVIEW_REQUIRED";
        explanation = `Unable to determine if a child was present with the vehicle. Manual review of evidence frames required before issuing PCN.`;
        confidenceScore = 0.4;
      }
      break;
      
    case "standard":
    case "loading":
    case "permit":
    default:
      ruleApplied = `Standard Bay Rule - Time/permit restrictions apply`;
      decision = "ISSUE_PCN"; // Allow normal regulation evaluation to proceed
      explanation = `Standard parking bay rules apply. PCN eligibility determined by time restrictions and site regulations.`;
      confidenceScore = 0.9;
      break;
  }
  
  return {
    bayId,
    bayType,
    bayName,
    ruleApplied,
    detections,
    decision,
    explanation,
    evidenceUsed,
    confidenceScore,
  };
}

function stepDecisionEngine(
  ctx: PipelineContext,
  regulationEval: RegulationEvaluationOutput,
  signageCompliance: SignageComplianceOutput,
  visionConfidence: number,
  contextEnrichment: ContextEnrichmentOutput,
  behaviourProfiling: BehaviourProfilingOutput,
  bayRuleEvaluation: BayRuleEvaluationOutput
): DecisionOutput {
  // CRITICAL: Check for valid OCR timestamps first - enforcement requires reliable time data
  const timestampQuality = ctx.evidenceTimeline?.timeRange?.timestampQuality;
  const validationIssue = ctx.evidenceTimeline?.timeRange?.validationIssue;
  const hasOcrTimestamps = ctx.evidenceTimeline?.timestamps?.some(t => t.source === "ocr") ?? false;
  const hasValidOcrTimestamps = timestampQuality === "high" && hasOcrTimestamps;
  
  // If no valid OCR timestamps or timestamp quality is not high, immediately return REVIEW_REQUIRED
  if (!hasValidOcrTimestamps || timestampQuality !== "high") {
    return {
      status: "REVIEW_REQUIRED",
      eligibilityGates: {
        regulationBreach: false,
        signageCompliant: signageCompliance.overallCompliance === "pass",
        confidenceThresholdMet: false,
        noHoldFlags: true,
        riskAcceptable: true,
        bayRuleAllowsPCN: false,
      },
      overallConfidence: 0.1,
      legalRisk: "high",
      recommendation: "Manual review required - unable to extract reliable timestamp from evidence images",
      reasoning: validationIssue || "Unable to reliably extract timestamp from evidence images",
      plainEnglishExplanation: `This case requires manual review because the system could not extract reliable timestamp information from the evidence images. All enforcement decisions must be based on timestamps visible in the evidence, not upload times or file metadata. ${validationIssue || ""}`,
      blockers: [validationIssue || "Unable to reliably extract timestamp from evidence images"],
    };
  }
  
  const regulationBreach = regulationEval.evaluation.breachDetected;
  const signageCompliant = signageCompliance.overallCompliance === "pass";
  const adjustedConfidence = visionConfidence + contextEnrichment.confidenceAdjustment;
  const confidenceThresholdMet = adjustedConfidence >= CONFIDENCE_THRESHOLD;
  
  const hasHoldFlag = contextEnrichment.spikeDetection?.recommendation === "HOLD_PCN";
  const noHoldFlags = !hasHoldFlag;
  
  const riskScore = behaviourProfiling.driverProfile?.riskScore || 0.5;
  const riskAcceptable = riskScore <= 0.8;
  
  // Bay rule gate - check if bay-specific rules allow PCN issuance
  const bayRuleAllowsPCN = bayRuleEvaluation.decision === "ISSUE_PCN";
  const bayRuleRequiresReview = bayRuleEvaluation.decision === "REVIEW_REQUIRED";
  
  // SIGNAGE GATE: PCN is only valid if we have ACTIVE signage with sufficient confidence
  // This ensures legal defensibility of enforcement actions
  const SIGNAGE_CONFIDENCE_THRESHOLD = 0.5;
  const signageDataAvailable = signageCompliance.extractedRegulations.source !== "not_available";
  const signageConfidenceMet = signageCompliance.extractedRegulations.confidence >= SIGNAGE_CONFIDENCE_THRESHOLD;
  const ruleSourceKnown = regulationEval.evaluation.ruleSource !== "unknown";
  const signageGatePassed = signageDataAvailable && (signageConfidenceMet || ruleSourceKnown);
  
  const blockers: string[] = [];
  
  if (!regulationBreach) {
    blockers.push("No regulation breach detected");
  }
  if (!signageCompliant) {
    blockers.push(`Signage compliance: ${signageCompliance.overallCompliance} (${signageCompliance.issues.join(", ")})`);
  }
  if (!confidenceThresholdMet) {
    blockers.push(`Evidence confidence ${(adjustedConfidence * 100).toFixed(0)}% below threshold ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}%`);
  }
  if (!noHoldFlags) {
    blockers.push("HOLD_PCN flag active - unusual activity detected");
  }
  if (!riskAcceptable) {
    blockers.push("Risk score exceeds acceptable threshold");
  }
  if (!bayRuleAllowsPCN && !bayRuleRequiresReview) {
    blockers.push(`Bay rule blocked: ${bayRuleEvaluation.explanation}`);
  }
  if (bayRuleRequiresReview) {
    blockers.push(`Bay rule requires review: ${bayRuleEvaluation.explanation}`);
  }
  
  // CRITICAL: Block PCN if signage data is insufficient for legal defensibility
  if (!signageGatePassed) {
    if (!signageDataAvailable) {
      blockers.push("SIGNAGE GATE: No active signage data available for this site - enforcement may be challenged");
    } else if (!signageConfidenceMet && !ruleSourceKnown) {
      blockers.push(`SIGNAGE GATE: Signage confidence ${(signageCompliance.extractedRegulations.confidence * 100).toFixed(0)}% below threshold and rule source unknown`);
    }
  }
  
  for (const factor of behaviourProfiling.mitigatingFactors) {
    blockers.push(`Mitigating: ${factor}`);
  }
  
  let status: DecisionOutput["status"];
  let legalRisk: DecisionOutput["legalRisk"];
  let recommendation: string;
  let reasoning: string;
  let plainEnglishExplanation: string;
  
  // Check if bay rule explicitly blocks PCN (e.g., badge visible, child detected, EV verified)
  if (bayRuleEvaluation.decision === "NO_PCN") {
    status = "BLOCKED_BY_BAY_RULE";
    legalRisk = "low";
    recommendation = `No PCN - ${bayRuleEvaluation.ruleApplied}`;
    reasoning = bayRuleEvaluation.explanation;
    plainEnglishExplanation = bayRuleEvaluation.explanation;
    
    return {
      status,
      eligibilityGates: {
        regulationBreach,
        signageCompliant,
        confidenceThresholdMet,
        noHoldFlags,
        riskAcceptable,
        bayRuleAllowsPCN: false,
      },
      overallConfidence: bayRuleEvaluation.confidenceScore,
      legalRisk,
      recommendation,
      reasoning,
      plainEnglishExplanation,
      blockers,
    };
  }
  
  // Check if bay rule requires manual review
  if (bayRuleRequiresReview) {
    status = "REVIEW_REQUIRED";
    legalRisk = "medium";
    recommendation = `Manual review required - ${bayRuleEvaluation.ruleApplied}`;
    reasoning = bayRuleEvaluation.explanation;
    plainEnglishExplanation = bayRuleEvaluation.explanation;
    
    return {
      status,
      eligibilityGates: {
        regulationBreach,
        signageCompliant,
        confidenceThresholdMet,
        noHoldFlags,
        riskAcceptable,
        bayRuleAllowsPCN: false,
      },
      overallConfidence: bayRuleEvaluation.confidenceScore,
      legalRisk,
      recommendation,
      reasoning,
      plainEnglishExplanation,
      blockers,
    };
  }
  
  // Check if compliance result is UNKNOWN (missing max stay or invalid timestamps)
  const complianceResult = regulationEval.evaluation.complianceResult;
  if (complianceResult === "UNKNOWN") {
    blockers.push("Compliance cannot be determined - max stay unknown or timestamp data invalid");
    
    return {
      status: "REVIEW_REQUIRED",
      eligibilityGates: {
        regulationBreach: false,
        signageCompliant,
        confidenceThresholdMet,
        noHoldFlags,
        riskAcceptable,
        bayRuleAllowsPCN,
      },
      overallConfidence: 0.3,
      legalRisk: "high",
      recommendation: "Manual review required - unable to calculate overstay",
      reasoning: regulationEval.evaluation.breachExplanation || "Duration or max stay data is invalid or missing.",
      plainEnglishExplanation: `This case requires manual review because ${regulationEval.evaluation.breachExplanation || "the system could not determine if a parking violation occurred. The maximum stay limit may not be configured for this site, or the timestamp data in the evidence is unreliable."}`,
      blockers,
    };
  }
  
  const allGatesPassed = regulationBreach && signageCompliant && confidenceThresholdMet && noHoldFlags && riskAcceptable && bayRuleAllowsPCN;
  
  if (allGatesPassed) {
    status = "PCN_ELIGIBLE";
    legalRisk = "low";
    recommendation = "Issue PCN - all eligibility criteria met";
    reasoning = `Regulation breach confirmed (${regulationEval.evaluation.breachType}). Signage compliant. Evidence confidence sufficient. No hold flags. Risk acceptable.`;
    plainEnglishExplanation = `This case was flagged because the vehicle stayed for ${regulationEval.evaluation.actualDurationMinutes} minutes, exceeding the maximum allowed time of ${regulationEval.evaluation.allowedDurationMinutes} minutes. The site signage was verified as compliant, and there are no unusual circumstances that would prevent issuing a penalty.`;
  } else if (regulationBreach && !signageCompliant) {
    status = "REVIEW_REQUIRED";
    legalRisk = "high";
    recommendation = "Manual review required - signage compliance issues";
    reasoning = `Regulation breach detected but signage compliance is ${signageCompliance.overallCompliance}. PCN may be challenged.`;
    plainEnglishExplanation = `This case needs manual review because while a parking violation was detected, there are concerns about whether the site signage meets legal requirements. Issuing a penalty without resolving this could result in a successful appeal.`;
  } else if (regulationBreach && !confidenceThresholdMet) {
    status = "REVIEW_REQUIRED";
    legalRisk = "medium";
    recommendation = "Manual review required - evidence confidence below threshold";
    reasoning = `Regulation breach detected but evidence confidence is ${(adjustedConfidence * 100).toFixed(0)}%, below ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}% threshold.`;
    plainEnglishExplanation = `This case needs manual review because the evidence quality is not high enough to confidently issue a penalty. An operator should review the images and timestamps to confirm the violation.`;
  } else if (regulationBreach && !noHoldFlags) {
    status = "REVIEW_REQUIRED";
    legalRisk = "medium";
    recommendation = "Manual review required - hold flag active";
    reasoning = `Regulation breach detected but HOLD_PCN flag is active due to unusual site activity.`;
    plainEnglishExplanation = `This case is on hold because unusual activity was detected at the site during this time period. A manual review is needed to determine if the circumstances warrant issuing a penalty.`;
  } else {
    status = "NO_PCN";
    legalRisk = "low";
    recommendation = "No PCN warranted - no breach detected";
    reasoning = "Analysis did not identify a regulation breach.";
    plainEnglishExplanation = `No penalty is recommended because the analysis did not find a clear parking violation. The vehicle appeared to be parked within the allowed time limits.`;
  }
  
  const overallConfidence = (
    (regulationBreach ? 0.3 : 0) +
    (signageCompliant ? 0.2 : 0) +
    (adjustedConfidence * 0.3) +
    (noHoldFlags ? 0.1 : 0) +
    (riskAcceptable ? 0.1 : 0)
  );
  
  return {
    status,
    eligibilityGates: {
      regulationBreach,
      signageCompliant,
      confidenceThresholdMet,
      noHoldFlags,
      riskAcceptable,
      bayRuleAllowsPCN,
    },
    overallConfidence,
    legalRisk,
    recommendation,
    reasoning,
    plainEnglishExplanation,
    blockers,
  };
}

export async function runCaseAnalysisPipeline(
  caseId: string,
  userId?: string
): Promise<CasePipelineResults> {
  console.log(`[Pipeline] Starting analysis for case ${caseId}`);
  
  const caseData = await storage.getCaseById(caseId);
  if (!caseData) {
    throw new Error(`Case ${caseId} not found`);
  }
  
  if (!caseData.siteId) {
    throw new Error(`Case ${caseId} has no associated site`);
  }
  
  await storage.deleteAnalysisStepsByCase(caseId);
  
  await storage.updateCaseStatus(caseId, "ANALYSING");
  
  let pipelineResults = await storage.createCasePipelineResults({
    caseId,
    pipelineStatus: "running",
    currentStep: "evidence_normalisation",
    completedSteps: 0,
    totalSteps: 9,
    analysisStartedAt: new Date(),
    triggeredBy: userId,
  });
  
  const ctx: PipelineContext = {
    caseId,
    siteId: caseData.siteId,
    userId,
    selectedBayType: caseData.bayType,  // Bay type selected at upload
  };
  
  try {
    const caseEvidenceItems = await storage.getCaseEvidence(caseId);
    const evidenceItems: Evidence[] = caseEvidenceItems
      .filter(ce => ce.evidence)
      .map(ce => ce.evidence!);
    
    if (evidenceItems.length === 0) {
      throw new Error("No evidence items found for case");
    }
    
    console.log(`[Pipeline] Step 1: Evidence Normalisation (${evidenceItems.length} items)`);
    ctx.evidenceTimeline = await stepEvidenceNormalisation(ctx, evidenceItems);
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "vision_analysis",
      completedSteps: 1,
      evidenceTimeline: ctx.evidenceTimeline,
    }) as CasePipelineResults;
    
    console.log(`[Pipeline] Step 2: Vision Analysis`);
    ctx.visionResults = await stepVisionAnalysis(ctx, evidenceItems);
    
    // CRITICAL: Rebuild timeline using ONLY OCR-extracted timestamps from visible image text
    // Do NOT use upload time, file metadata, EXIF data, or backend timestamps
    console.log(`[Pipeline] Rebuilding timeline with OCR-only timestamps (${ctx.visionResults.timestampExtractions.length} extractions)`);
    
    // Filter to only valid OCR extractions with successfully parsed dates
    const validOcrTimestamps = ctx.visionResults.timestampExtractions
      .filter(extraction => extraction.parsedDate)
      .map(extraction => ({
        evidenceId: extraction.evidenceId,
        timestamp: extraction.parsedDate!,
        source: "ocr" as const,
        confidence: extraction.confidence,
        rawOcrText: extraction.extractedTimestamp,
      }));
    
    // Replace timeline timestamps with OCR-only data
    ctx.evidenceTimeline.timestamps = validOcrTimestamps;
    
    // Determine timestamp quality based on OCR results
    // CRITICAL: 85% confidence threshold per enforcement specification
    // Note: Tesseract returns confidence as 0-100, not 0-1
    const OCR_CONFIDENCE_THRESHOLD = 85;
    let ocrTimestampQuality: "high" | "medium" | "low" | "invalid" = "invalid";
    let ocrValidationIssue: string | null = "Unable to reliably extract timestamp from evidence images";
    let ocrTimeSource: string = "IMAGE OCR FAILED";
    
    // Count timestamps meeting the 85% confidence threshold
    const highConfidenceOcrTimestamps = validOcrTimestamps.filter(t => t.confidence >= OCR_CONFIDENCE_THRESHOLD);
    const lowConfidenceOcrTimestamps = validOcrTimestamps.filter(t => t.confidence < OCR_CONFIDENCE_THRESHOLD);
    
    if (highConfidenceOcrTimestamps.length >= 2) {
      ocrTimestampQuality = "high";
      ocrValidationIssue = null;
      ocrTimeSource = "Evidence Image Timestamp (OCR)";
    } else if (highConfidenceOcrTimestamps.length === 1 && lowConfidenceOcrTimestamps.length >= 1) {
      ocrTimestampQuality = "medium";
      ocrValidationIssue = "Some timestamps below 85% confidence threshold - manual review recommended";
      ocrTimeSource = "Evidence Image Timestamp (OCR) - REVIEW REQUIRED";
    } else if (validOcrTimestamps.length >= 2 && highConfidenceOcrTimestamps.length < 2) {
      ocrTimestampQuality = "low";
      ocrValidationIssue = "OCR timestamps below 85% confidence threshold - REVIEW_REQUIRED";
      ocrTimeSource = "Evidence Image Timestamp (OCR) - LOW CONFIDENCE";
    } else if (validOcrTimestamps.length === 1) {
      ocrTimestampQuality = "low";
      ocrValidationIssue = "Only one OCR timestamp - cannot calculate duration accurately";
      ocrTimeSource = "Evidence Image Timestamp (OCR) - SINGLE IMAGE";
    } else {
      ocrTimestampQuality = "invalid";
      ocrValidationIssue = "NO_VALID_TIMESTAMP - Unable to reliably extract timestamp from evidence images";
      ocrTimeSource = "IMAGE OCR FAILED";
    }
    
    // Log confidence details for audit trail
    console.log(`[Pipeline] OCR confidence check: ${highConfidenceOcrTimestamps.length}/${validOcrTimestamps.length} timestamps >= 85% threshold`);
    
    // Sort OCR timestamps chronologically
    ctx.evidenceTimeline.timestamps.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    const ocrTimestamps = ctx.evidenceTimeline.timestamps;
    // CRITICAL: Do NOT fallback to current time - if no OCR timestamps found, leave as null
    const ocrFirst = ocrTimestamps.length > 0 ? ocrTimestamps[0].timestamp : null;
    const ocrLast = ocrTimestamps.length > 0 ? ocrTimestamps[ocrTimestamps.length - 1].timestamp : null;
    const ocrDurationMinutes = (ocrFirst && ocrLast && validOcrTimestamps.length >= 2)
      ? Math.round((new Date(ocrLast).getTime() - new Date(ocrFirst).getTime()) / (1000 * 60))
      : 0;
    
    ctx.evidenceTimeline.timeRange = { 
      first: ocrFirst, 
      last: ocrLast, 
      durationMinutes: ocrDurationMinutes,
      timestampQuality: ocrTimestampQuality,
      validationIssue: ocrValidationIssue,
      timeSource: ocrTimeSource,
    };
    
    if (ocrTimestamps.length >= 2) {
      ctx.evidenceTimeline.entryWindow = {
        start: ocrTimestamps[0].timestamp,
        end: ocrTimestamps[Math.min(1, ocrTimestamps.length - 1)].timestamp,
        confidence: ocrTimestamps[0].confidence,
      };
      ctx.evidenceTimeline.exitWindow = {
        start: ocrTimestamps[Math.max(0, ocrTimestamps.length - 2)].timestamp,
        end: ocrTimestamps[ocrTimestamps.length - 1].timestamp,
        confidence: ocrTimestamps[ocrTimestamps.length - 1].confidence,
      };
    } else {
      ctx.evidenceTimeline.entryWindow = null;
      ctx.evidenceTimeline.exitWindow = null;
    }
    
    console.log(`[Pipeline] OCR timeline: ${ocrFirst} to ${ocrLast} (${ocrDurationMinutes} minutes, quality: ${ocrTimestampQuality})`);
    if (ocrValidationIssue) {
      console.log(`[Pipeline] Timestamp issue: ${ocrValidationIssue}`);
    }
    
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "dvla_enrichment",
      completedSteps: 2,
      visionResults: ctx.visionResults,
      evidenceTimeline: ctx.evidenceTimeline,
    }) as CasePipelineResults;
    
    const detectedVrm = ctx.visionResults.bestVrmFrame?.plate || caseData.vrm || null;
    
    console.log(`[Pipeline] Step 3: DVLA Enrichment (VRM: ${detectedVrm || "none"})`);
    ctx.dvlaData = await stepDVLAEnrichment(ctx, detectedVrm);
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "signage_compliance",
      completedSteps: 3,
      dvlaData: ctx.dvlaData,
    }) as CasePipelineResults;
    
    const site = await storage.getParkingSite(caseData.siteId);
    if (!site) {
      throw new Error(`Site ${caseData.siteId} not found`);
    }
    
    const siteRules = await storage.getSiteRules(caseData.siteId);
    const durationMinutes = ctx.evidenceTimeline.timeRange.durationMinutes;
    const timestampQuality = ctx.evidenceTimeline.timeRange.timestampQuality;
    
    // Step 4: Signage Compliance (runs BEFORE regulation evaluation to extract timing)
    // CRITICAL: Load ONLY permanent site signage for rule extraction (signage configured at site level)
    // Evidence images are NOT used to extract signage - only for vehicle behavior/timing
    const permanentSignage = await storage.getActiveSignageBySite(caseData.siteId);
    console.log(`[Pipeline] Step 4: Signage Compliance (site signage records: ${permanentSignage.length})`);
    ctx.signageCompliance = await stepSignageCompliance(ctx, permanentSignage);
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "regulation_evaluation",
      completedSteps: 4,
      signageCompliance: ctx.signageCompliance,
    }) as CasePipelineResults;
    
    // Step 5: Regulation Evaluation (uses signage timing when available)
    console.log(`[Pipeline] Step 5: Regulation Evaluation (duration: ${durationMinutes}m, quality: ${timestampQuality || "unknown"})`);
    ctx.regulationEvaluation = await stepRegulationEvaluation(ctx, site, siteRules, ctx.signageCompliance, durationMinutes, timestampQuality);
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "context_enrichment",
      completedSteps: 5,
      regulationEvaluation: ctx.regulationEvaluation,
    }) as CasePipelineResults;
    
    console.log(`[Pipeline] Step 6: Context Enrichment`);
    const contextStep = await createOrUpdateStep(caseId, "context_enrichment", "running", {
      startedAt: new Date(),
    });
    
    const eventDate = ctx.evidenceTimeline.timestamps[0]?.timestamp 
      ? new Date(ctx.evidenceTimeline.timestamps[0].timestamp)
      : new Date();
    ctx.contextEnrichment = stepContextEnrichment(ctx, eventDate);
    
    await createOrUpdateStep(caseId, "context_enrichment", "completed", {
      completedAt: new Date(),
      durationMs: Date.now() - (contextStep.startedAt?.getTime() || Date.now()),
      outputData: ctx.contextEnrichment,
    });
    
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "behaviour_profiling",
      completedSteps: 6,
      contextEnrichment: ctx.contextEnrichment,
    }) as CasePipelineResults;
    
    console.log(`[Pipeline] Step 7: Behaviour Profiling`);
    const behaviourStep = await createOrUpdateStep(caseId, "behaviour_profiling", "running", {
      startedAt: new Date(),
    });
    
    const vrm = ctx.visionResults.bestVrmFrame?.plate || caseData.vrm || null;
    ctx.behaviourProfiling = stepBehaviourProfiling(ctx, vrm);
    
    await createOrUpdateStep(caseId, "behaviour_profiling", "completed", {
      completedAt: new Date(),
      durationMs: Date.now() - (behaviourStep.startedAt?.getTime() || Date.now()),
      outputData: ctx.behaviourProfiling,
    });
    
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "bay_rule_evaluation",
      completedSteps: 7,
      behaviourProfiling: ctx.behaviourProfiling,
    }) as CasePipelineResults;
    
    console.log(`[Pipeline] Step 8: Bay Rule Evaluation`);
    const bayRuleStep = await createOrUpdateStep(caseId, "bay_rule_evaluation", "running", {
      startedAt: new Date(),
    });
    
    ctx.bayRuleEvaluation = await stepBayRuleEvaluation(ctx, evidenceItems, ctx.visionResults, ctx.dvlaData);
    
    await createOrUpdateStep(caseId, "bay_rule_evaluation", "completed", {
      completedAt: new Date(),
      durationMs: Date.now() - (bayRuleStep.startedAt?.getTime() || Date.now()),
      outputData: ctx.bayRuleEvaluation,
    });
    
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "decision_engine",
      completedSteps: 8,
      bayRuleEvaluation: ctx.bayRuleEvaluation,
    }) as CasePipelineResults;
    
    console.log(`[Pipeline] Step 9: Decision Engine`);
    const decisionStep = await createOrUpdateStep(caseId, "decision_engine", "running", {
      startedAt: new Date(),
    });
    
    ctx.decision = stepDecisionEngine(
      ctx,
      ctx.regulationEvaluation,
      ctx.signageCompliance,
      ctx.visionResults.overallConfidence,
      ctx.contextEnrichment,
      ctx.behaviourProfiling,
      ctx.bayRuleEvaluation
    );
    
    // Check for duplicate analysis results
    const duplicateCheck = checkForDuplicateAnalysis(caseId, ctx.decision, {
      siteId: ctx.siteId,
      evidenceCount: evidenceItems.length,
      durationMinutes: ctx.evidenceTimeline.timeRange.durationMinutes,
    });
    
    if (duplicateCheck.isDuplicate) {
      console.warn(`[Pipeline] Duplicate analysis detected: ${duplicateCheck.warning}`);
      // Add warning to decision blockers
      ctx.decision.blockers.push(`WARNING: ${duplicateCheck.warning}`);
    }
    
    await createOrUpdateStep(caseId, "decision_engine", "completed", {
      completedAt: new Date(),
      durationMs: Date.now() - (decisionStep.startedAt?.getTime() || Date.now()),
      outputData: { ...ctx.decision, duplicateWarning: duplicateCheck.warning || null },
    });
    
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      pipelineStatus: "completed",
      currentStep: null,
      completedSteps: 9,
      decision: ctx.decision,
      analysisCompletedAt: new Date(),
    }) as CasePipelineResults;
    
    let caseStatus: string;
    switch (ctx.decision.status) {
      case "PCN_ELIGIBLE":
        caseStatus = "PCN_ELIGIBLE";
        break;
      case "REVIEW_REQUIRED":
        caseStatus = "REVIEW_REQUIRED";
        break;
      case "NO_PCN":
        caseStatus = "ANALYSED";
        break;
      case "BLOCKED_BY_BAY_RULE":
        caseStatus = "BLOCKED_BY_BAY_RULE";
        break;
      default:
        caseStatus = "ANALYSED";
    }
    await storage.updateCaseStatus(caseId, caseStatus);
    
    console.log(`[Pipeline] Completed analysis for case ${caseId}: ${ctx.decision.status} → Case status: ${caseStatus}`);
    
    return pipelineResults;
    
  } catch (error: any) {
    console.error(`[Pipeline] Failed for case ${caseId}:`, error.message);
    
    await storage.updateCasePipelineResults(caseId, {
      pipelineStatus: "failed",
      analysisError: error.message,
      analysisCompletedAt: new Date(),
    });
    
    await storage.updateCaseStatus(caseId, "FAILED");
    
    throw error;
  }
}

export async function getAnalysisReport(caseId: string) {
  const pipelineResults = await storage.getCasePipelineResults(caseId);
  const steps = await storage.getAnalysisStepsByCase(caseId);
  const caseData = await storage.getCaseById(caseId);
  
  if (!pipelineResults || !caseData) {
    return null;
  }
  
  const site = caseData.siteId ? await storage.getParkingSite(caseData.siteId) : null;
  
  return {
    caseSummary: {
      caseId,
      siteName: site?.siteName || "Unknown",
      vrm: pipelineResults.dvlaData?.vrm || caseData.vrm || "Unknown",
      vehicleType: pipelineResults.visionResults?.vehicleDetections[0]?.type || "Unknown",
      totalDuration: pipelineResults.evidenceTimeline?.timeRange.durationMinutes || 0,
      allowedDuration: pipelineResults.regulationEvaluation?.rules.maxStayMinutes || null,
      outcome: pipelineResults.decision?.status || "PENDING",
    },
    whatWasAnalysed: {
      evidenceCount: pipelineResults.evidenceTimeline?.evidenceCount || 0,
      imageCount: pipelineResults.evidenceTimeline?.imageCount || 0,
      videoCount: pipelineResults.evidenceTimeline?.videoCount || 0,
      timeRange: pipelineResults.evidenceTimeline?.timeRange,
      analysisComponents: ["Image Interpretation", "Object Detection", pipelineResults.dvlaData?.verified ? "Vehicle Registry" : null].filter(Boolean),
      externalServicesUsed: pipelineResults.dvlaData?.verified ? ["DVLA"] : [],
    },
    howItWasMeasured: {
      entryExitMethod: pipelineResults.evidenceTimeline?.entryWindow ? "timestamp_based" : "single_point",
      durationCalculation: "first_to_last_evidence",
      visionConfidence: pipelineResults.visionResults?.overallConfidence || 0,
      ocrConfidence: pipelineResults.visionResults?.bestVrmFrame?.confidence || 0,
    },
    regulationsApplied: pipelineResults.regulationEvaluation,
    signageAssessment: pipelineResults.signageCompliance,
    bayRuleEvaluation: pipelineResults.bayRuleEvaluation ? {
      bayType: pipelineResults.bayRuleEvaluation.bayType,
      bayName: pipelineResults.bayRuleEvaluation.bayName,
      ruleApplied: pipelineResults.bayRuleEvaluation.ruleApplied,
      detections: pipelineResults.bayRuleEvaluation.detections,
      decision: pipelineResults.bayRuleEvaluation.decision,
      explanation: pipelineResults.bayRuleEvaluation.explanation,
      confidenceScore: pipelineResults.bayRuleEvaluation.confidenceScore,
      evidenceUsed: pipelineResults.bayRuleEvaluation.evidenceUsed,
    } : null,
    riskAndConfidence: {
      overallConfidence: pipelineResults.decision?.overallConfidence || 0,
      legalRisk: pipelineResults.decision?.legalRisk || "unknown",
      recommendation: pipelineResults.decision?.recommendation || "",
      blockers: pipelineResults.decision?.blockers || [],
    },
    auditLog: {
      steps: steps.map(s => ({
        stepName: s.stepName,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationMs: s.durationMs,
        errorMessage: s.errorMessage,
      })),
      analysisStartedAt: pipelineResults.analysisStartedAt,
      analysisCompletedAt: pipelineResults.analysisCompletedAt,
      triggeredBy: pipelineResults.triggeredBy,
    },
    decision: pipelineResults.decision,
  };
}
