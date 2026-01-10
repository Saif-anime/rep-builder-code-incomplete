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
  SignageInspection
} from "@shared/schema";

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
  | "decision_engine";

const STEP_ORDER: Record<PipelineStepName, number> = {
  evidence_normalisation: 1,
  vision_analysis: 2,
  dvla_enrichment: 3,
  regulation_evaluation: 4,
  signage_compliance: 5,
  context_enrichment: 6,
  behaviour_profiling: 7,
  decision_engine: 8,
};

const CONFIDENCE_THRESHOLD = 0.7;

interface EvidenceTimelineResult {
  evidenceCount: number;
  imageCount: number;
  videoCount: number;
  timestamps: Array<{
    evidenceId: number;
    timestamp: string;
    source: "exif" | "camera_overlay" | "filename" | "upload_time";
    confidence: number;
  }>;
  entryWindow: { start: string; end: string; confidence: number } | null;
  exitWindow: { start: string; end: string; confidence: number } | null;
  timeRange: { first: string; last: string; durationMinutes: number };
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
    allowedDurationMinutes: number | null;
    withinEnforcementHours: boolean;
    breachDetected: boolean;
    breachType: string | null;
    breachExplanation: string | null;
    numericComparison: string;
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

interface DecisionOutput {
  status: "PCN_ELIGIBLE" | "REVIEW_REQUIRED" | "NO_PCN";
  eligibilityGates: {
    regulationBreach: boolean;
    signageCompliant: boolean;
    confidenceThresholdMet: boolean;
    noHoldFlags: boolean;
    riskAcceptable: boolean;
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
  evidenceTimeline?: EvidenceTimelineResult;
  visionResults?: VisionResultsOutput;
  dvlaData?: DVLADataOutput;
  regulationEvaluation?: RegulationEvaluationOutput;
  signageCompliance?: SignageComplianceOutput;
  contextEnrichment?: ContextEnrichmentOutput;
  behaviourProfiling?: BehaviourProfilingOutput;
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
      
      let source: "exif" | "camera_overlay" | "filename" | "upload_time" = "upload_time";
      let confidence = 0.5;
      
      if (ev.metadata && typeof ev.metadata === "object") {
        if ("exifTimestamp" in ev.metadata) {
          source = "exif";
          confidence = 0.9;
        } else if ("cameraOverlayTime" in ev.metadata) {
          source = "camera_overlay";
          confidence = 0.85;
        }
      }
      
      if (ev.notes?.includes("filename_derived")) {
        source = "filename";
        confidence = 0.7;
      }
      
      timestamps.push({
        evidenceId: ev.id,
        timestamp: ev.timestamp.toISOString(),
        source,
        confidence,
      });
    }
    
    timestamps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    const first = timestamps[0]?.timestamp || new Date().toISOString();
    const last = timestamps[timestamps.length - 1]?.timestamp || first;
    const durationMinutes = Math.round(
      (new Date(last).getTime() - new Date(first).getTime()) / (1000 * 60)
    );
    
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
      timeRange: { first, last, durationMinutes },
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
  
  const patterns = [
    /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
    /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/,
    /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/,
    /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
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
          timestampExtractions.push({
            evidenceId: ev.id,
            extractedTimestamp: result.result.timestampOverlay,
            parsedDate,
            confidence: parsedDate ? 0.9 : 0.5,
          });
          console.log(`[Pipeline] Extracted timestamp for evidence ${ev.id}: ${result.result.timestampOverlay} -> ${parsedDate}`);
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
  durationMinutes: number
): Promise<RegulationEvaluationOutput> {
  const step = await createOrUpdateStep(ctx.caseId, "regulation_evaluation", "running", {
    startedAt: new Date(),
  });
  
  try {
    const maxStayMinutes = siteRules?.maxStayMinutes ?? null;
    const graceEntryMinutes = siteRules?.graceEntryMinutes ?? 5;
    const graceExitMinutes = siteRules?.graceExitMinutes ?? 5;
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
    
    const effectiveAllowedDuration = maxStayMinutes ? maxStayMinutes + gracePeriodMinutes : null;
    
    if (maxStayMinutes && durationMinutes > effectiveAllowedDuration!) {
      breachDetected = true;
      breachType = "OVERSTAY";
      breachExplanation = `Vehicle parked for ${durationMinutes} minutes, exceeding maximum stay of ${maxStayMinutes} minutes (plus ${gracePeriodMinutes}min grace period).`;
    }
    
    const formatDuration = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };
    
    const numericComparison = maxStayMinutes 
      ? `${formatDuration(durationMinutes)} vs ${formatDuration(maxStayMinutes)} allowed`
      : `${formatDuration(durationMinutes)} (no max stay limit)`;
    
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
        allowedDurationMinutes: maxStayMinutes,
        withinEnforcementHours,
        breachDetected,
        breachType,
        breachExplanation,
        numericComparison,
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
  inspection: SignageInspection | undefined
): Promise<SignageComplianceOutput> {
  const step = await createOrUpdateStep(ctx.caseId, "signage_compliance", "running", {
    startedAt: new Date(),
  });
  
  try {
    if (!inspection) {
      const result: SignageComplianceOutput = {
        inspectionId: null,
        inspectionDate: null,
        entranceSignage: { status: "unknown", notes: "No signage inspection on record" },
        termsVisibility: { status: "unknown", notes: "No signage inspection on record" },
        signSpacing: { status: "unknown" },
        wordingCompliance: { status: "unknown", coreTermsVisible: false },
        overallCompliance: "partial",
        overallConfidence: 0.3,
        issues: ["No signage inspection data available for this site"],
      };
      
      await createOrUpdateStep(ctx.caseId, "signage_compliance", "completed", {
        completedAt: new Date(),
        durationMs: Date.now() - (step.startedAt?.getTime() || Date.now()),
        outputData: result,
      });
      
      return result;
    }
    
    const issues: string[] = [];
    
    const entrancePresent = inspection.entranceSignagePresent ?? false;
    const entranceSignage: SignageComplianceOutput["entranceSignage"] = {
      status: entrancePresent ? "pass" : "fail",
      notes: entrancePresent 
        ? "Entrance signage confirmed present" 
        : "Entrance signage not present or not verified",
    };
    if (!entrancePresent) {
      issues.push("Missing entrance signage");
    }
    
    const termsVisible = (inspection.tcTariffVisible && inspection.tcFontReadable) ?? false;
    const termsVisibility: SignageComplianceOutput["termsVisibility"] = {
      status: termsVisible ? "pass" : "fail",
      notes: termsVisible 
        ? "Core parking terms are visible to drivers"
        : "Core parking terms not clearly visible",
    };
    if (!termsVisible) {
      issues.push("Core terms not visible");
    }
    
    const distanceReadable = inspection.tcDistanceReadable;
    const signSpacing: SignageComplianceOutput["signSpacing"] = {
      status: distanceReadable && distanceReadable <= 3 ? "pass" : distanceReadable ? "fail" : "unknown",
      distanceMeters: distanceReadable ?? undefined,
    };
    if (distanceReadable && distanceReadable > 3) {
      issues.push("Sign spacing inadequate");
    }
    
    const wordingCorrect = (inspection.entranceCorrectWording && inspection.tcLanguageCorrect) ?? false;
    const wordingCompliance: SignageComplianceOutput["wordingCompliance"] = {
      status: wordingCorrect ? "pass" : "fail",
      coreTermsVisible: termsVisible,
    };
    if (!wordingCorrect) {
      issues.push("Wording not compliant with regulations");
    }
    
    const passCount = [
      entranceSignage.status === "pass",
      termsVisibility.status === "pass",
      signSpacing.status === "pass",
      wordingCompliance.status === "pass",
    ].filter(Boolean).length;
    
    let overallCompliance: "pass" | "fail" | "partial";
    if (passCount === 4) {
      overallCompliance = "pass";
    } else if (passCount === 0) {
      overallCompliance = "fail";
    } else {
      overallCompliance = "partial";
    }
    
    const overallConfidence = passCount / 4;
    
    const result: SignageComplianceOutput = {
      inspectionId: inspection.id,
      inspectionDate: inspection.inspectionDate?.toISOString() || null,
      entranceSignage,
      termsVisibility,
      signSpacing,
      wordingCompliance,
      overallCompliance,
      overallConfidence,
      issues,
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

function stepDecisionEngine(
  ctx: PipelineContext,
  regulationEval: RegulationEvaluationOutput,
  signageCompliance: SignageComplianceOutput,
  visionConfidence: number,
  contextEnrichment: ContextEnrichmentOutput,
  behaviourProfiling: BehaviourProfilingOutput
): DecisionOutput {
  const regulationBreach = regulationEval.evaluation.breachDetected;
  const signageCompliant = signageCompliance.overallCompliance === "pass";
  const adjustedConfidence = visionConfidence + contextEnrichment.confidenceAdjustment;
  const confidenceThresholdMet = adjustedConfidence >= CONFIDENCE_THRESHOLD;
  
  const hasHoldFlag = contextEnrichment.spikeDetection?.recommendation === "HOLD_PCN";
  const noHoldFlags = !hasHoldFlag;
  
  const riskScore = behaviourProfiling.driverProfile?.riskScore || 0.5;
  const riskAcceptable = riskScore <= 0.8;
  
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
  
  for (const factor of behaviourProfiling.mitigatingFactors) {
    blockers.push(`Mitigating: ${factor}`);
  }
  
  let status: DecisionOutput["status"];
  let legalRisk: DecisionOutput["legalRisk"];
  let recommendation: string;
  let reasoning: string;
  let plainEnglishExplanation: string;
  
  const allGatesPassed = regulationBreach && signageCompliant && confidenceThresholdMet && noHoldFlags && riskAcceptable;
  
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
    totalSteps: 8,
    analysisStartedAt: new Date(),
    triggeredBy: userId,
  });
  
  const ctx: PipelineContext = {
    caseId,
    siteId: caseData.siteId,
    userId,
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
    
    if (ctx.visionResults.timestampExtractions.length > 0) {
      console.log(`[Pipeline] Updating timeline with ${ctx.visionResults.timestampExtractions.length} extracted timestamps`);
      
      for (const extraction of ctx.visionResults.timestampExtractions) {
        if (extraction.parsedDate) {
          const existingTs = ctx.evidenceTimeline.timestamps.find(t => t.evidenceId === extraction.evidenceId);
          if (existingTs) {
            existingTs.timestamp = extraction.parsedDate;
            existingTs.source = "camera_overlay";
            existingTs.confidence = extraction.confidence;
          }
        }
      }
      
      ctx.evidenceTimeline.timestamps.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      const timestamps = ctx.evidenceTimeline.timestamps;
      const first = timestamps[0]?.timestamp || new Date().toISOString();
      const last = timestamps[timestamps.length - 1]?.timestamp || first;
      const durationMinutes = Math.round(
        (new Date(last).getTime() - new Date(first).getTime()) / (1000 * 60)
      );
      
      ctx.evidenceTimeline.timeRange = { first, last, durationMinutes };
      
      if (timestamps.length >= 2) {
        ctx.evidenceTimeline.entryWindow = {
          start: timestamps[0].timestamp,
          end: timestamps[Math.min(1, timestamps.length - 1)].timestamp,
          confidence: timestamps[0].confidence,
        };
        ctx.evidenceTimeline.exitWindow = {
          start: timestamps[Math.max(0, timestamps.length - 2)].timestamp,
          end: last,
          confidence: timestamps[timestamps.length - 1].confidence,
        };
      }
      
      console.log(`[Pipeline] Updated timeline: ${first} to ${last} (${durationMinutes} minutes)`);
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
      currentStep: "regulation_evaluation",
      completedSteps: 3,
      dvlaData: ctx.dvlaData,
    }) as CasePipelineResults;
    
    const site = await storage.getParkingSite(caseData.siteId);
    if (!site) {
      throw new Error(`Site ${caseData.siteId} not found`);
    }
    
    const siteRules = await storage.getSiteRules(caseData.siteId);
    const durationMinutes = ctx.evidenceTimeline.timeRange.durationMinutes;
    
    console.log(`[Pipeline] Step 4: Regulation Evaluation`);
    ctx.regulationEvaluation = await stepRegulationEvaluation(ctx, site, siteRules, durationMinutes);
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "signage_compliance",
      completedSteps: 4,
      regulationEvaluation: ctx.regulationEvaluation,
    }) as CasePipelineResults;
    
    const signageInspection = await storage.getLatestSignageInspection(caseData.siteId);
    
    console.log(`[Pipeline] Step 5: Signage Compliance`);
    ctx.signageCompliance = await stepSignageCompliance(ctx, signageInspection);
    pipelineResults = await storage.updateCasePipelineResults(caseId, {
      currentStep: "context_enrichment",
      completedSteps: 5,
      signageCompliance: ctx.signageCompliance,
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
      currentStep: "decision_engine",
      completedSteps: 7,
      behaviourProfiling: ctx.behaviourProfiling,
    }) as CasePipelineResults;
    
    console.log(`[Pipeline] Step 8: Decision Engine`);
    const decisionStep = await createOrUpdateStep(caseId, "decision_engine", "running", {
      startedAt: new Date(),
    });
    
    ctx.decision = stepDecisionEngine(
      ctx,
      ctx.regulationEvaluation,
      ctx.signageCompliance,
      ctx.visionResults.overallConfidence,
      ctx.contextEnrichment,
      ctx.behaviourProfiling
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
      completedSteps: 8,
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
