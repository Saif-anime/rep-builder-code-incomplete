import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, serial, real, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ==================== USERS ====================
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("operator"), // admin, operator, enforcement_officer
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastLogin: timestamp("last_login"),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  lastLogin: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ==================== CAMERAS ====================
export const cameras = pgTable("cameras", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  ipAddress: text("ip_address").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  rtspUrl: text("rtsp_url"),
  isapiUrl: text("isapi_url"),
  isActive: boolean("is_active").notNull().default(true),
  status: text("status").notNull().default("offline"), // online, offline, checking
  statusMessage: text("status_message"),
  siteId: text("site_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSnapshot: timestamp("last_snapshot"),
  lastCheckedAt: timestamp("last_checked_at"),
  lastOnlineAt: timestamp("last_online_at"),
});

export const insertCameraSchema = createInsertSchema(cameras).omit({
  id: true,
  createdAt: true,
  lastSnapshot: true,
  lastCheckedAt: true,
  lastOnlineAt: true,
  statusMessage: true,
});

export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type Camera = typeof cameras.$inferSelect;

// ==================== BAYS ====================
export const bays = pgTable("bays", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // disabled, ev, parent_child, standard, loading, permit
  cameraId: integer("camera_id").references(() => cameras.id),
  location: text("location"),
  rules: jsonb("rules").$type<{
    requiresBlueBadge?: boolean;
    requiresChild?: boolean;
    requiresEvCharging?: boolean;
    maxDuration?: number;
    permitRequired?: boolean;
  }>(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBaySchema = createInsertSchema(bays).omit({
  id: true,
  createdAt: true,
});

export type InsertBay = z.infer<typeof insertBaySchema>;
export type Bay = typeof bays.$inferSelect;

// ==================== EVIDENCE ====================
export const evidence = pgTable("evidence", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // camera, manual
  bundleId: integer("bundle_id"),
  siteId: integer("site_id").references(() => parkingSites.id),
  cameraId: integer("camera_id").references(() => cameras.id),
  bayId: integer("bay_id").references(() => bays.id),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  imagePath: text("image_path"),
  videoPath: text("video_path"),
  thumbnailPath: text("thumbnail_path"),
  timestamp: timestamp("timestamp").notNull(),
  sha256Hash: text("sha256_hash"),
  metadata: jsonb("metadata").$type<{
    width?: number;
    height?: number;
    format?: string;
    duration?: number;
    fileSize?: number;
  }>(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // pending, analyzing, completed, failed, reviewed, approved, rejected
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  analysisStartedAt: timestamp("analysis_started_at"),
  analysisCompletedAt: timestamp("analysis_completed_at"),
  aiResult: jsonb("ai_result").$type<{
    violationDetected: boolean;
    violationType: string | null;
    confidence: number;
    numberPlate: string | null;
    explanation: string;
    factors?: string[];
    uncertainties?: string[];
    recommendation?: string;
  }>(),
  confidenceScore: real("confidence_score"),
  analysisError: text("analysis_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEvidenceSchema = createInsertSchema(evidence).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
});

export type InsertEvidence = z.infer<typeof insertEvidenceSchema>;
export type Evidence = typeof evidence.$inferSelect;

// ==================== ENFORCEMENT CASES ====================
export const enforcementCases = pgTable("enforcement_cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteId: integer("site_id").references(() => parkingSites.id),
  vrm: text("vrm"),
  status: text("status").notNull().default("NEW"), // NEW, ANALYSING, ANALYSED, REVIEW_REQUIRED, PCN_ELIGIBLE, PCN_ISSUED, FAILED
  evidenceCount: integer("evidence_count").notNull().default(0),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEnforcementCaseSchema = createInsertSchema(enforcementCases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  evidenceCount: true,
});

export type InsertEnforcementCase = z.infer<typeof insertEnforcementCaseSchema>;
export type EnforcementCase = typeof enforcementCases.$inferSelect;

// ==================== CASE EVIDENCE LINK ====================
export const caseEvidence = pgTable("case_evidence", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").references(() => enforcementCases.id).notNull(),
  evidenceId: integer("evidence_id").references(() => evidence.id).notNull(),
  source: text("source").notNull().default("manual"), // camera, manual, pdf
  keyFinding: text("key_finding"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCaseEvidenceSchema = createInsertSchema(caseEvidence).omit({
  id: true,
  createdAt: true,
});

export type InsertCaseEvidence = z.infer<typeof insertCaseEvidenceSchema>;
export type CaseEvidence = typeof caseEvidence.$inferSelect;

// ==================== CASE ANALYSIS ====================
export const caseAnalysis = pgTable("case_analysis", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").references(() => enforcementCases.id).notNull().unique(),
  summary: text("summary"),
  vehicleDetails: jsonb("vehicle_details").$type<{
    detected: boolean;
    type: string;
    plate: string | null;
    evIndicators: boolean;
  }>(),
  bayType: text("bay_type"),
  signageFindings: jsonb("signage_findings").$type<{
    visible: boolean;
    compliant: boolean;
    notes: string;
  }>(),
  humanDetection: jsonb("human_detection").$type<{
    adult: boolean;
    child: boolean;
    disabledBadgeVisible: boolean;
  }>(),
  violations: jsonb("violations").$type<{
    type: string;
    detected: boolean;
    confidence: number;
    explanation: string;
  }[]>(),
  confidenceScore: real("confidence_score"),
  riskAssessment: text("risk_assessment"), // Low, Medium, High
  recommendation: text("recommendation"), // Issue PCN, Review, No Action
  timelineSummary: text("timeline_summary"),
  timeWindow: jsonb("time_window").$type<{
    firstSeen: string;
    lastSeen: string;
    durationMinutes: number;
    gaps: string[];
    conflicts: string[];
  }>(),
  mergedDetections: jsonb("merged_detections").$type<{
    vehicles: Array<{ type: string; confidence: number; evidenceId: number }>;
    persons: Array<{ type: string; confidence: number; evidenceId: number }>;
    bayMarkings: Array<{ type: string; confidence: number; evidenceId: number }>;
  }>(),
  modelVersions: jsonb("model_versions").$type<{
    visionGPT: string;
  }>(),
  supportingEvidenceIds: jsonb("supporting_evidence_ids").$type<number[]>(),
  partialFailures: jsonb("partial_failures").$type<Array<{ evidenceId: number; error: string }>>(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export const insertCaseAnalysisSchema = createInsertSchema(caseAnalysis).omit({
  id: true,
  generatedAt: true,
});

export type InsertCaseAnalysis = z.infer<typeof insertCaseAnalysisSchema>;
export type CaseAnalysis = typeof caseAnalysis.$inferSelect;

// ==================== CASE VEHICLES (DVLA VERIFIED) ====================
export const caseVehicles = pgTable("case_vehicles", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").references(() => enforcementCases.id).notNull(),
  registrationNumber: text("registration_number").notNull(),
  make: text("make"),
  model: text("model"),
  colour: text("colour"),
  fuelType: text("fuel_type"),
  taxStatus: text("tax_status"),
  taxDueDate: text("tax_due_date"),
  motStatus: text("mot_status"),
  motExpiryDate: text("mot_expiry_date"),
  engineCapacity: integer("engine_capacity"),
  co2Emissions: integer("co2_emissions"),
  yearOfManufacture: integer("year_of_manufacture"),
  firstRegistrationDate: text("first_registration_date"),
  wheelplan: text("wheelplan"),
  revenueWeight: integer("revenue_weight"),
  euroStatus: text("euro_status"),
  markedForExport: boolean("marked_for_export"),
  confidenceScore: real("confidence_score").notNull(),
  sourceEvidenceIds: jsonb("source_evidence_ids").$type<number[]>(),
  sourceBundleIds: jsonb("source_bundle_ids").$type<number[]>(),
  detectionMethod: text("detection_method").notNull().default("vision_gpt"), // vision_gpt, anpr, manual
  plateReadings: jsonb("plate_readings").$type<{
    reading: string;
    confidence: number;
    evidenceId?: number;
    bundleId?: number;
  }[]>(),
  conflictDetected: boolean("conflict_detected").notNull().default(false),
  conflictDetails: text("conflict_details"),
  dvlaVerified: boolean("dvla_verified").notNull().default(false),
  dvlaLookupError: text("dvla_lookup_error"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCaseVehicleSchema = createInsertSchema(caseVehicles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
});

export type InsertCaseVehicle = z.infer<typeof insertCaseVehicleSchema>;
export type CaseVehicle = typeof caseVehicles.$inferSelect;

// ==================== CASE ANALYSIS PIPELINE STEPS ====================
export type AnalysisStepName = 
  | "evidence_normalisation"
  | "vision_analysis"
  | "dvla_enrichment"
  | "regulation_evaluation"
  | "signage_compliance"
  | "decision_engine";

export type AnalysisStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export const caseAnalysisSteps = pgTable("case_analysis_steps", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").references(() => enforcementCases.id).notNull(),
  stepName: text("step_name").notNull(), // evidence_normalisation, vision_analysis, dvla_enrichment, regulation_evaluation, signage_compliance, decision_engine
  stepOrder: integer("step_order").notNull(),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, skipped
  inputData: jsonb("input_data"),
  outputData: jsonb("output_data"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  modelVersion: text("model_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCaseAnalysisStepSchema = createInsertSchema(caseAnalysisSteps).omit({
  id: true,
  createdAt: true,
});

export type InsertCaseAnalysisStep = z.infer<typeof insertCaseAnalysisStepSchema>;
export type CaseAnalysisStep = typeof caseAnalysisSteps.$inferSelect;

// ==================== PCN ISSUANCE ====================
export type PcnStatus = "draft" | "issued" | "cancelled" | "appealed" | "paid";
export type PcnEligibility = "eligible" | "blocked_signage" | "blocked_confidence" | "blocked_regulation" | "review_required";

export const pcns = pgTable("pcns", {
  id: serial("id").primaryKey(),
  pcnNumber: text("pcn_number").notNull().unique(),
  caseId: varchar("case_id").references(() => enforcementCases.id).notNull(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  vrm: text("vrm").notNull(),
  status: text("status").notNull().default("draft"), // draft, issued, cancelled, appealed, paid
  eligibility: text("eligibility").notNull(), // eligible, blocked_signage, blocked_confidence, blocked_regulation, review_required
  
  // Regulation breach details
  regulationBreached: text("regulation_breached"),
  breachDetails: jsonb("breach_details").$type<{
    allowedDuration: number;
    actualDuration: number;
    enforcementWindow: { start: string; end: string };
    breachTime: string;
    ruleDescription: string;
  }>(),
  
  // Signage confirmation
  signageCompliant: boolean("signage_compliant").notNull().default(false),
  signageConfirmation: jsonb("signage_confirmation").$type<{
    entranceSignage: "pass" | "fail" | "unknown";
    termsVisibility: "pass" | "fail" | "unknown";
    overallConfidence: number;
    notes: string;
  }>(),
  
  // Analysis snapshot (frozen at time of issuance)
  analysisSnapshot: jsonb("analysis_snapshot").$type<{
    evidenceTimeline: any;
    visionResults: any;
    dvlaData: any;
    regulationEvaluation: any;
    signageCompliance: any;
    decision: any;
    confidence: number;
    generatedAt: string;
  }>(),
  
  // PCN content
  amount: real("amount").notNull(),
  explanation: text("explanation"), // Plain English summary
  evidenceReferences: jsonb("evidence_references").$type<number[]>(),
  
  // Issuance details
  issuedBy: varchar("issued_by").references(() => users.id),
  issuedAt: timestamp("issued_at"),
  generatedBy: text("generated_by").notNull().default("system"), // system, user
  
  // Override tracking
  overrideReason: text("override_reason"),
  overrideBy: varchar("override_by").references(() => users.id),
  overrideAt: timestamp("override_at"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPcnSchema = createInsertSchema(pcns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  issuedAt: true,
  overrideAt: true,
});

export type InsertPcn = z.infer<typeof insertPcnSchema>;
export type Pcn = typeof pcns.$inferSelect;

// ==================== CASE PIPELINE RESULTS ====================
// Extended analysis with full pipeline step outputs
export const casePipelineResults = pgTable("case_pipeline_results", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").references(() => enforcementCases.id).notNull().unique(),
  
  // Pipeline status
  pipelineStatus: text("pipeline_status").notNull().default("pending"), // pending, running, completed, failed, partial
  currentStep: text("current_step"),
  completedSteps: integer("completed_steps").notNull().default(0),
  totalSteps: integer("total_steps").notNull().default(9),
  
  // Step 1: Evidence Normalisation
  evidenceTimeline: jsonb("evidence_timeline").$type<{
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
  }>(),
  
  // Step 2: Vision Analysis (YOLOv8 + Vision GPT)
  visionResults: jsonb("vision_results").$type<{
    vehicleDetections: Array<{
      evidenceId: number;
      detected: boolean;
      type: string;
      confidence: number;
      boundingBox?: { x: number; y: number; width: number; height: number };
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
    bestVrmFrame: { evidenceId: number; plate: string; confidence: number } | null;
    overallConfidence: number;
    modelVersions: { yolov8?: string; visionGpt: string };
  }>(),
  
  // Step 3: DVLA Enrichment
  dvlaData: jsonb("dvla_data").$type<{
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
  }>(),
  
  // Step 4: Regulation Evaluation
  regulationEvaluation: jsonb("regulation_evaluation").$type<{
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
      numericComparison: string; // e.g., "2h 43m vs 2h allowed"
    };
  }>(),
  
  // Step 5: Signage Compliance
  signageCompliance: jsonb("signage_compliance").$type<{
    inspectionId: number | null;
    inspectionDate: string | null;
    entranceSignage: { status: "pass" | "fail" | "unknown"; notes: string };
    termsVisibility: { status: "pass" | "fail" | "unknown"; notes: string };
    signSpacing: { status: "pass" | "fail" | "unknown"; distanceMeters?: number };
    wordingCompliance: { status: "pass" | "fail" | "unknown"; coreTermsVisible: boolean };
    overallCompliance: "pass" | "fail" | "partial";
    overallConfidence: number;
    issues: string[];
  }>(),
  
  // Step 6: Context Enrichment
  contextEnrichment: jsonb("context_enrichment").$type<{
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
  }>(),
  
  // Step 7: Behaviour Profiling
  behaviourProfiling: jsonb("behaviour_profiling").$type<{
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
  }>(),
  
  // Step 8: Bay Rule Evaluation
  bayRuleEvaluation: jsonb("bay_rule_evaluation").$type<{
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
  }>(),
  
  // Step 9: Decision Engine
  decision: jsonb("decision").$type<{
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
  }>(),
  
  // Audit trail
  analysisStartedAt: timestamp("analysis_started_at"),
  analysisCompletedAt: timestamp("analysis_completed_at"),
  analysisError: text("analysis_error"),
  triggeredBy: varchar("triggered_by").references(() => users.id),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCasePipelineResultsSchema = createInsertSchema(casePipelineResults).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCasePipelineResults = z.infer<typeof insertCasePipelineResultsSchema>;
export type CasePipelineResults = typeof casePipelineResults.$inferSelect;

// ==================== EVIDENCE BUNDLES ====================
export const evidenceBundles = pgTable("evidence_bundles", {
  id: serial("id").primaryKey(),
  caseId: varchar("case_id").references(() => enforcementCases.id).notNull(),
  name: text("name"),
  status: text("status").notNull().default("pending"), // pending, analyzing, analyzed, failed
  fileCount: integer("file_count").notNull().default(0),
  aiResult: jsonb("ai_result").$type<{
    summary: string;
    vehicleDetails: {
      detected: boolean;
      type: string;
      plate: string | null;
      evIndicators: boolean;
      color?: string;
    };
    bayType: string;
    signageFindings: {
      visible: boolean;
      compliant: boolean;
      notes: string;
    };
    humanDetection: {
      adult: boolean;
      child: boolean;
      disabledBadgeVisible: boolean;
    };
    violations: Array<{
      type: string;
      detected: boolean;
      confidence: number;
      explanation: string;
    }>;
    timeWindow: {
      firstSeen: string;
      lastSeen: string;
      durationMinutes: number;
      gaps: string[];
    };
    confidenceScore: number;
    riskAssessment: string;
    recommendation: string;
    modelVersion: string;
  }>(),
  analysisStartedAt: timestamp("analysis_started_at"),
  analysisCompletedAt: timestamp("analysis_completed_at"),
  analysisError: text("analysis_error"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEvidenceBundleSchema = createInsertSchema(evidenceBundles).omit({
  id: true,
  createdAt: true,
  analysisStartedAt: true,
  analysisCompletedAt: true,
});

export type InsertEvidenceBundle = z.infer<typeof insertEvidenceBundleSchema>;
export type EvidenceBundle = typeof evidenceBundles.$inferSelect;

// ==================== DETECTIONS ====================
export const detections = pgTable("detections", {
  id: serial("id").primaryKey(),
  evidenceId: integer("evidence_id").references(() => evidence.id).notNull(),
  objectType: text("object_type").notNull(), // person, child, car, van, truck, bus, motorcycle, wheelchair, ev
  confidence: real("confidence").notNull(),
  boundingBox: jsonb("bounding_box").$type<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>(),
  attributes: jsonb("attributes").$type<{
    isElderly?: boolean;
    hasWheelchair?: boolean;
    hasBlueBadge?: boolean;
    isCharging?: boolean;
    hasChild?: boolean;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDetectionSchema = createInsertSchema(detections).omit({
  id: true,
  createdAt: true,
});

export type InsertDetection = z.infer<typeof insertDetectionSchema>;
export type Detection = typeof detections.$inferSelect;

// ==================== PARKING EVENTS ====================
export const parkingEvents = pgTable("parking_events", {
  id: serial("id").primaryKey(),
  evidenceId: integer("evidence_id").references(() => evidence.id).notNull(),
  bayId: integer("bay_id").references(() => bays.id),
  numberPlateId: integer("number_plate_id").references(() => numberPlates.id),
  violationType: text("violation_type"), // disabled_bay, ev_bay, parent_child, overstay, no_permit
  isViolation: boolean("is_violation").notNull().default(false),
  aiConfidence: real("ai_confidence"),
  aiExplanation: text("ai_explanation"),
  aiReasoning: jsonb("ai_reasoning").$type<{
    factors: string[];
    uncertainties: string[];
    recommendation: string;
  }>(),
  status: text("status").notNull().default("pending"), // pending, confirmed, dismissed, appealed
  pcnNumber: text("pcn_number"),
  pcnIssuedAt: timestamp("pcn_issued_at"),
  pcnAmount: real("pcn_amount"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertParkingEventSchema = createInsertSchema(parkingEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  pcnIssuedAt: true,
});

export type InsertParkingEvent = z.infer<typeof insertParkingEventSchema>;
export type ParkingEvent = typeof parkingEvents.$inferSelect;

// ==================== NUMBER PLATES ====================
export const numberPlates = pgTable("number_plates", {
  id: serial("id").primaryKey(),
  evidenceId: integer("evidence_id").references(() => evidence.id).notNull(),
  plateText: text("plate_text").notNull(),
  plateImage: text("plate_image"),
  confidence: real("confidence").notNull(),
  isValidUkFormat: boolean("is_valid_uk_format").notNull().default(false),
  boundingBox: jsonb("bounding_box").$type<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNumberPlateSchema = createInsertSchema(numberPlates).omit({
  id: true,
  createdAt: true,
});

export type InsertNumberPlate = z.infer<typeof insertNumberPlateSchema>;
export type NumberPlate = typeof numberPlates.$inferSelect;

// ==================== AUDIT LOGS ====================
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  action: text("action").notNull(), // create, update, delete, view, login, logout, approve, reject
  entityType: text("entity_type").notNull(), // evidence, parking_event, user, camera, bay
  entityId: text("entity_id"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// ==================== PARKING SITES ====================
export const parkingSites = pgTable("parking_sites", {
  id: serial("id").primaryKey(),
  siteName: text("site_name").notNull(),
  locationCode: text("location_code"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  addressLine3: text("address_line_3"),
  addressLine4: text("address_line_4"),
  city: text("city"),
  postcode: text("postcode"),
  regulations: text("regulations"),
  enforcer: text("enforcer"),
  totalBays: integer("total_bays").default(0),
  disabledBays: integer("disabled_bays").default(0),
  evBays: integer("ev_bays").default(0),
  parentChildBays: integer("parent_child_bays").default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertParkingSiteSchema = createInsertSchema(parkingSites).omit({
  id: true,
  createdAt: true,
});

export type InsertParkingSite = z.infer<typeof insertParkingSiteSchema>;
export type ParkingSite = typeof parkingSites.$inferSelect;

// Keep legacy sites table for backwards compatibility
export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  postcode: text("postcode"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSiteSchema = createInsertSchema(sites).omit({
  id: true,
  createdAt: true,
});

export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Site = typeof sites.$inferSelect;

// ==================== SITE RULES ====================
export const siteRules = pgTable("site_rules", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  maxStayMinutes: integer("max_stay_minutes"),
  graceEntryMinutes: integer("grace_entry_minutes").default(5),
  graceExitMinutes: integer("grace_exit_minutes").default(5),
  enforcementMode: text("enforcement_mode").notNull().default("standard"), // standard, lenient, strict, disabled
  allowlists: jsonb("allowlists").$type<{
    vrms?: string[];
    permitTypes?: string[];
    vehicleTypes?: string[];
  }>(),
  denylists: jsonb("denylists").$type<{
    vrms?: string[];
    reasons?: string[];
  }>(),
  // Enforcement override configuration for spike detection
  spikeOverridePolicy: text("spike_override_policy").default("hold_on_disruption"), // hold_on_disruption, always_enforce, review_required
  enforceOnWeather: boolean("enforce_on_weather").default(false), // If true, enforce even during weather disruptions
  enforceOnEvents: boolean("enforce_on_events").default(false), // If true, enforce even during local events
  spikeThresholdMultiplier: real("spike_threshold_multiplier").default(1.5), // Multiplier above baseline to trigger spike
  baselineWindowDays: integer("baseline_window_days").default(28), // Days to look back for baseline calculation
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSiteRuleSchema = createInsertSchema(siteRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSiteRule = z.infer<typeof insertSiteRuleSchema>;
export type SiteRule = typeof siteRules.$inferSelect;

// ==================== SITE POLICIES ====================
export const sitePolicies = pgTable("site_policies", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull().unique(),
  eventCategoriesEnforce: text("event_categories_enforce").array().default([]), // Categories where enforcement proceeds (e.g., SPORTS_MATCH)
  eventCategoriesGrace: text("event_categories_grace").array().default([]), // Categories where PCN is held (e.g., WEATHER, ROAD_CLOSURE)
  defaultEventPolicy: text("default_event_policy").notNull().default("hold"), // hold, enforce, review
  weatherPolicy: text("weather_policy").notNull().default("hold"), // hold, enforce, review
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSitePolicySchema = createInsertSchema(sitePolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSitePolicy = z.infer<typeof insertSitePolicySchema>;
export type SitePolicy = typeof sitePolicies.$inferSelect;

// ==================== SITE NOTES ====================
export const siteNotes = pgTable("site_notes", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  noteType: text("note_type").notNull().default("general"), // general, policy, warning, info, enforcement
  content: text("content").notNull(),
  tags: text("tags").array(),
  validFrom: timestamp("valid_from").notNull().defaultNow(),
  validTo: timestamp("valid_to"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSiteNoteSchema = createInsertSchema(siteNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSiteNote = z.infer<typeof insertSiteNoteSchema>;
export type SiteNote = typeof siteNotes.$inferSelect;

// ==================== SITE SURROUNDINGS ====================
export const siteSurroundings = pgTable("site_surroundings", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull().unique(),
  nearbyPlaces: jsonb("nearby_places").$type<{
    shops?: Array<{ name: string; type?: string; distance?: string }>;
    offices?: Array<{ name: string; type?: string; distance?: string }>;
    venues?: Array<{ name: string; type?: string; distance?: string }>;
    other?: Array<{ name: string; type?: string; distance?: string }>;
  }>(),
  freeTextSummary: text("free_text_summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSiteSurroundingsSchema = createInsertSchema(siteSurroundings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSiteSurroundings = z.infer<typeof insertSiteSurroundingsSchema>;
export type SiteSurroundings = typeof siteSurroundings.$inferSelect;

// ==================== AI SETTINGS ====================
export const aiSettings = pgTable("ai_settings", {
  id: serial("id").primaryKey(),
  settingKey: text("setting_key").notNull().unique(),
  settingValue: jsonb("setting_value").$type<unknown>(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAiSettingSchema = createInsertSchema(aiSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertAiSetting = z.infer<typeof insertAiSettingSchema>;
export type AiSetting = typeof aiSettings.$inferSelect;

// ==================== RELATIONS ====================
export const usersRelations = relations(users, ({ many }) => ({
  evidence: many(evidence),
  auditLogs: many(auditLogs),
}));

export const camerasRelations = relations(cameras, ({ many }) => ({
  bays: many(bays),
  evidence: many(evidence),
}));

export const baysRelations = relations(bays, ({ one, many }) => ({
  camera: one(cameras, {
    fields: [bays.cameraId],
    references: [cameras.id],
  }),
  evidence: many(evidence),
  parkingEvents: many(parkingEvents),
}));

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
  camera: one(cameras, {
    fields: [evidence.cameraId],
    references: [cameras.id],
  }),
  bay: one(bays, {
    fields: [evidence.bayId],
    references: [bays.id],
  }),
  uploader: one(users, {
    fields: [evidence.uploadedBy],
    references: [users.id],
  }),
  reviewer: one(users, {
    fields: [evidence.reviewedBy],
    references: [users.id],
  }),
  detections: many(detections),
  parkingEvents: many(parkingEvents),
  numberPlates: many(numberPlates),
}));

export const detectionsRelations = relations(detections, ({ one }) => ({
  evidence: one(evidence, {
    fields: [detections.evidenceId],
    references: [evidence.id],
  }),
}));

export const parkingEventsRelations = relations(parkingEvents, ({ one }) => ({
  evidence: one(evidence, {
    fields: [parkingEvents.evidenceId],
    references: [evidence.id],
  }),
  bay: one(bays, {
    fields: [parkingEvents.bayId],
    references: [bays.id],
  }),
  numberPlate: one(numberPlates, {
    fields: [parkingEvents.numberPlateId],
    references: [numberPlates.id],
  }),
}));

export const numberPlatesRelations = relations(numberPlates, ({ one, many }) => ({
  evidence: one(evidence, {
    fields: [numberPlates.evidenceId],
    references: [evidence.id],
  }),
  parkingEvents: many(parkingEvents),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

// ==================== CONVERSATIONS (for AI chat) ====================
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// ==================== ANPR EVENTS ====================
export const anprEventTypeEnum = ["ENTRY", "EXIT"] as const;
export type AnprEventType = typeof anprEventTypeEnum[number];

export const anprEvents = pgTable("anpr_events", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  vrm: text("vrm").notNull(), // Vehicle Registration Mark (number plate)
  eventType: text("event_type").notNull(), // ENTRY | EXIT
  occurredAt: timestamp("occurred_at").notNull(),
  cameraId: integer("camera_id").references(() => cameras.id),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
  confidence: real("confidence"),
  source: text("source"), // e.g. "hikvision", "manual", "third_party"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAnprEventSchema = createInsertSchema(anprEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertAnprEvent = z.infer<typeof insertAnprEventSchema>;
export type AnprEvent = typeof anprEvents.$inferSelect;

// ==================== PARKING SESSIONS ====================
export const parkingSessionStatusEnum = ["OPEN", "CLOSED", "ORPHAN"] as const;
export type ParkingSessionStatus = typeof parkingSessionStatusEnum[number];

export const parkingSessions = pgTable("parking_sessions", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  vrm: text("vrm").notNull(),
  entryEventId: integer("entry_event_id").references(() => anprEvents.id),
  exitEventId: integer("exit_event_id").references(() => anprEvents.id),
  entryAt: timestamp("entry_at"),
  exitAt: timestamp("exit_at"),
  durationMinutes: integer("duration_minutes"),
  status: text("status").notNull().default("OPEN"), // OPEN | CLOSED | ORPHAN
  derivedFrom: jsonb("derived_from").$type<{
    orphanReason?: string;
    matchingWindowHours?: number;
    pairedAt?: string;
    notes?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertParkingSessionSchema = createInsertSchema(parkingSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertParkingSession = z.infer<typeof insertParkingSessionSchema>;
export type ParkingSession = typeof parkingSessions.$inferSelect;

// ==================== ANPR RELATIONS ====================
export const anprEventsRelations = relations(anprEvents, ({ one }) => ({
  site: one(parkingSites, {
    fields: [anprEvents.siteId],
    references: [parkingSites.id],
  }),
  camera: one(cameras, {
    fields: [anprEvents.cameraId],
    references: [cameras.id],
  }),
}));

export const parkingSessionsRelations = relations(parkingSessions, ({ one }) => ({
  site: one(parkingSites, {
    fields: [parkingSessions.siteId],
    references: [parkingSites.id],
  }),
  entryEvent: one(anprEvents, {
    fields: [parkingSessions.entryEventId],
    references: [anprEvents.id],
  }),
  exitEvent: one(anprEvents, {
    fields: [parkingSessions.exitEventId],
    references: [anprEvents.id],
  }),
}));

// ==================== SIGNAGE INSPECTIONS ====================
export const signageInspectionStatusEnum = ["draft", "submitted", "approved", "rejected"] as const;
export type SignageInspectionStatus = typeof signageInspectionStatusEnum[number];

export const signageConditionEnum = ["good", "damaged", "missing"] as const;
export type SignageCondition = typeof signageConditionEnum[number];

export const signageInspections = pgTable("signage_inspections", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  inspectionDate: timestamp("inspection_date").notNull(),
  inspectorId: varchar("inspector_id").references(() => users.id).notNull(),
  inspectorName: text("inspector_name").notNull(),
  siteCode: text("site_code"),
  siteAddress: text("site_address"),
  status: text("status").notNull().default("draft"), // draft, submitted, approved, rejected
  
  // Section 2: Entrance Signage
  entranceSignagePresent: boolean("entrance_signage_present"),
  entranceClearlyVisible: boolean("entrance_clearly_visible"),
  entranceCorrectWording: boolean("entrance_correct_wording"),
  entranceHeightCompliant: boolean("entrance_height_compliant"),
  entranceLightingDay: boolean("entrance_lighting_day"),
  entranceLightingNight: boolean("entrance_lighting_night"),
  entranceCondition: text("entrance_condition"), // good, damaged, missing
  
  // Section 3: Terms & Conditions Signage
  tcTariffVisible: boolean("tc_tariff_visible"),
  tcFontReadable: boolean("tc_font_readable"),
  tcDistanceReadable: real("tc_distance_readable"), // in meters
  tcLanguageCorrect: boolean("tc_language_correct"),
  tcLightingPresent: boolean("tc_lighting_present"),
  
  // Section 4: Bay-Specific Signage - Disabled
  disabledSignPresent: boolean("disabled_sign_present"),
  disabledMarkingsVisible: boolean("disabled_markings_visible"),
  disabledUprightSign: boolean("disabled_upright_sign"),
  disabledWordingCorrect: boolean("disabled_wording_correct"),
  
  // Section 4: Bay-Specific Signage - EV
  evSignPresent: boolean("ev_sign_present"),
  evMarkingsVisible: boolean("ev_markings_visible"),
  evUprightSign: boolean("ev_upright_sign"),
  evWordingCorrect: boolean("ev_wording_correct"),
  
  // Section 4: Bay-Specific Signage - Parent & Child
  parentChildSignPresent: boolean("parent_child_sign_present"),
  parentChildMarkingsVisible: boolean("parent_child_markings_visible"),
  parentChildUprightSign: boolean("parent_child_upright_sign"),
  parentChildWordingCorrect: boolean("parent_child_wording_correct"),
  
  // Section 5: General Compliance Check
  bpaIpcCompliant: boolean("bpa_ipc_compliant"),
  conflictingSignagePresent: boolean("conflicting_signage_present"),
  obstructionsPresent: boolean("obstructions_present"),
  weatherDamage: boolean("weather_damage"),
  graffitiPresent: boolean("graffiti_present"),
  generalNotes: text("general_notes"),
  
  // Section 6: Declaration
  signatureData: text("signature_data"), // Base64 encoded signature image
  declarationTimestamp: timestamp("declaration_timestamp"),
  
  // Compliance Scores (calculated)
  overallComplianceScore: real("overall_compliance_score"),
  entranceScore: real("entrance_score"),
  tcScore: real("tc_score"),
  baySignageScore: real("bay_signage_score"),
  generalScore: real("general_score"),
  appealRiskScore: real("appeal_risk_score"),
  nightVisibilityRisk: real("night_visibility_risk"),
  
  // AI Analysis
  aiAnalysis: jsonb("ai_analysis").$type<{
    summary?: string;
    weaknesses?: string[];
    recommendations?: string[];
    legalRisks?: string[];
    complianceIssues?: string[];
  }>(),
  
  // Metadata
  submittedAt: timestamp("submitted_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSignageInspectionSchema = createInsertSchema(signageInspections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  approvedAt: true,
});

export type InsertSignageInspection = z.infer<typeof insertSignageInspectionSchema>;
export type SignageInspection = typeof signageInspections.$inferSelect;

// ==================== SIGNAGE PHOTOS ====================
export const signagePhotos = pgTable("signage_photos", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id").references(() => signageInspections.id, { onDelete: "cascade" }).notNull(),
  section: text("section").notNull(), // entrance, tc, disabled, ev, parent_child, general
  photoPath: text("photo_path").notNull(),
  thumbnailPath: text("thumbnail_path"),
  caption: text("caption"),
  sha256Hash: text("sha256_hash"),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  metadata: jsonb("metadata").$type<{
    width?: number;
    height?: number;
    format?: string;
    fileSize?: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSignagePhotoSchema = createInsertSchema(signagePhotos).omit({
  id: true,
  createdAt: true,
});

export type InsertSignagePhoto = z.infer<typeof insertSignagePhotoSchema>;
export type SignagePhoto = typeof signagePhotos.$inferSelect;

// ==================== SIGNAGE RELATIONS ====================
export const signageInspectionsRelations = relations(signageInspections, ({ one, many }) => ({
  site: one(parkingSites, {
    fields: [signageInspections.siteId],
    references: [parkingSites.id],
  }),
  inspector: one(users, {
    fields: [signageInspections.inspectorId],
    references: [users.id],
  }),
  approver: one(users, {
    fields: [signageInspections.approvedBy],
    references: [users.id],
  }),
  photos: many(signagePhotos),
}));

export const signagePhotosRelations = relations(signagePhotos, ({ one }) => ({
  inspection: one(signageInspections, {
    fields: [signagePhotos.inspectionId],
    references: [signageInspections.id],
  }),
  uploader: one(users, {
    fields: [signagePhotos.uploadedBy],
    references: [users.id],
  }),
}));

// ==================== ENRICHMENT RUNS ====================
export const enrichmentRuns = pgTable("enrichment_runs", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  status: text("status").notNull().default("completed"), // pending, running, completed, failed
  results: jsonb("results").$type<{
    weatherSummary: {
      provider: string;
      conditions: string;
      temperature?: number;
      precipitation?: string;
      windSpeed?: string;
      alerts?: string[];
      rawData?: any;
    } | null;
    localEventsSummary: {
      provider: string;
      events: Array<{
        name: string;
        type: string;
        startTime?: string;
        endTime?: string;
        expectedAttendance?: number;
        distance?: string;
      }>;
      rawData?: any;
    } | null;
    siteInventoryHits: Array<{
      source: string;
      matchedTags: string[];
      relevantNotes: string[];
      ruleMatches: string[];
    }>;
    anomalySummary: {
      totalSessions: number;
      overstayCount: number;
      overstayRate: number;
      averageOverstayMinutes: number;
      peakOverstayHour?: number;
      isSpike: boolean;
      spikeMultiplier?: number;
      baselineOverstayRate?: number;
    };
  }>(),
  errorMessage: text("error_message"),
});

export const insertEnrichmentRunSchema = createInsertSchema(enrichmentRuns).omit({
  id: true,
  createdAt: true,
});

export type InsertEnrichmentRun = z.infer<typeof insertEnrichmentRunSchema>;
export type EnrichmentRun = typeof enrichmentRuns.$inferSelect;

export const enrichmentRunsRelations = relations(enrichmentRuns, ({ one }) => ({
  site: one(parkingSites, {
    fields: [enrichmentRuns.siteId],
    references: [parkingSites.id],
  }),
  creator: one(users, {
    fields: [enrichmentRuns.createdBy],
    references: [users.id],
  }),
}));

// ==================== SESSION FLAGS ====================
export const sessionFlags = pgTable("session_flags", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => parkingSessions.id).notNull(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  enrichmentRunId: integer("enrichment_run_id").references(() => enrichmentRuns.id),
  flagType: text("flag_type").notNull(), // POSSIBLE_DISRUPTION, WEATHER_DISRUPTION, EVENT_DISRUPTION, ROAD_INCIDENT
  severity: text("severity").notNull().default("medium"), // low, medium, high, critical
  reason: text("reason").notNull(),
  recommendation: text("recommendation"), // HOLD_PCN, REVIEW_REQUIRED, AUTO_DISMISS
  evidence: jsonb("evidence").$type<{
    weatherConditions?: string;
    weatherAlerts?: string[];
    localEvents?: Array<{ name: string; type: string; distance?: string }>;
    overstayRate?: number;
    baselineRate?: number;
    spikeMultiplier?: number;
    siteInventoryHits?: string[];
  }>(),
  status: text("status").notNull().default("OPEN"), // OPEN, RESOLVED, DISMISSED
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSessionFlagSchema = createInsertSchema(sessionFlags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});

export type InsertSessionFlag = z.infer<typeof insertSessionFlagSchema>;
export type SessionFlag = typeof sessionFlags.$inferSelect;

export const sessionFlagsRelations = relations(sessionFlags, ({ one }) => ({
  session: one(parkingSessions, {
    fields: [sessionFlags.sessionId],
    references: [parkingSessions.id],
  }),
  site: one(parkingSites, {
    fields: [sessionFlags.siteId],
    references: [parkingSites.id],
  }),
  enrichmentRun: one(enrichmentRuns, {
    fields: [sessionFlags.enrichmentRunId],
    references: [enrichmentRuns.id],
  }),
  resolver: one(users, {
    fields: [sessionFlags.resolvedBy],
    references: [users.id],
  }),
}));

// ==================== DRIVER PROFILES ====================
export type BehaviourClassification = 
  | "COMMUTER_PATTERN"      // Frequent short stays at same time-of-day, low variance
  | "OCCASIONAL_PATRON"     // Low frequency, moderate duration
  | "FIRST_TIME_LATE"       // First visit with slight overstay
  | "REGULAR_PATRON"        // Frequent visits with normal durations
  | "UNKNOWN";              // Insufficient data

export type DriverRiskFlag = 
  | "POSSIBLE_COMMUTER_MISUSE"  // Using car park to go elsewhere
  | "LIKELY_FAIR_USER"          // Genuine patron behaviour
  | "FIRST_VISIT_GRACE"         // First-time visitor, give benefit of doubt
  | "NONE";

export const driverProfiles = pgTable("driver_profiles", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  vrm: varchar("vrm", { length: 20 }).notNull(),
  firstSeen: timestamp("first_seen").notNull(),
  lastSeen: timestamp("last_seen").notNull(),
  visits30d: integer("visits_30d").notNull().default(0),
  visits90d: integer("visits_90d").notNull().default(0),
  totalVisits: integer("total_visits").notNull().default(0),
  medianDurationMinutes: real("median_duration_minutes"),
  meanDurationMinutes: real("mean_duration_minutes"),
  durationStddev: real("duration_stddev"),
  commonArrivalTimeBuckets: jsonb("common_arrival_time_buckets").$type<{
    buckets: Array<{ hour: number; count: number; percentage: number }>;
    mostCommonHour: number;
    variance: number;
  }>(),
  behaviourClassification: text("behaviour_classification").$type<BehaviourClassification>().default("UNKNOWN"),
  riskFlag: text("risk_flag").$type<DriverRiskFlag>().default("NONE"),
  riskScore: real("risk_score").notNull().default(0), // 0-100 scale
  riskFactors: jsonb("risk_factors").$type<{
    factors: Array<{ name: string; weight: number; description: string }>;
    totalWeight: number;
  }>(),
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  siteVrmUnique: uniqueIndex("driver_profiles_site_vrm_unique").on(table.siteId, table.vrm),
}));

export const insertDriverProfileSchema = createInsertSchema(driverProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastCalculatedAt: true,
});

export type InsertDriverProfile = z.infer<typeof insertDriverProfileSchema>;
export type DriverProfile = typeof driverProfiles.$inferSelect;

export const driverProfilesRelations = relations(driverProfiles, ({ one }) => ({
  site: one(parkingSites, {
    fields: [driverProfiles.siteId],
    references: [parkingSites.id],
  }),
}));

// ==================== PCN RECOMMENDATIONS ====================
export type RecommendationSource = "SYSTEM" | "USER";
export type RecommendationAction = "HOLD_PCN" | "PROCEED_PCN" | "REVIEW_REQUIRED" | "AUTO_DISMISS";

export const pcnRecommendations = pgTable("pcn_recommendations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => parkingSessions.id).notNull(),
  flagId: integer("flag_id").references(() => sessionFlags.id),
  siteId: integer("site_id").references(() => parkingSites.id).notNull(),
  vrm: varchar("vrm", { length: 20 }).notNull(),
  action: text("action").$type<RecommendationAction>().notNull(),
  previousAction: text("previous_action").$type<RecommendationAction>(),
  source: text("source").$type<RecommendationSource>().notNull().default("SYSTEM"),
  createdBy: varchar("created_by").references(() => users.id),
  reason: text("reason").notNull(),
  reasonPlain: text("reason_plain").notNull(),
  evidenceJson: jsonb("evidence_json").$type<{
    weatherConditions?: string;
    weatherAlerts?: string[];
    localEvents?: Array<{ name: string; type: string; distance?: string }>;
    driverProfile?: {
      classification: string;
      riskScore: number;
      riskFlag: string;
    };
    sessionDetails?: {
      entryAt: string;
      exitAt?: string;
      durationMinutes?: number;
      maxStayMinutes?: number;
    };
    siteContext?: string[];
    overrideReason?: string;
  }>(),
  confidence: real("confidence").notNull().default(0.5),
  isOverride: boolean("is_override").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPcnRecommendationSchema = createInsertSchema(pcnRecommendations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPcnRecommendation = z.infer<typeof insertPcnRecommendationSchema>;
export type PcnRecommendation = typeof pcnRecommendations.$inferSelect;

export const pcnRecommendationsRelations = relations(pcnRecommendations, ({ one }) => ({
  session: one(parkingSessions, {
    fields: [pcnRecommendations.sessionId],
    references: [parkingSessions.id],
  }),
  flag: one(sessionFlags, {
    fields: [pcnRecommendations.flagId],
    references: [sessionFlags.id],
  }),
  site: one(parkingSites, {
    fields: [pcnRecommendations.siteId],
    references: [parkingSites.id],
  }),
  creator: one(users, {
    fields: [pcnRecommendations.createdBy],
    references: [users.id],
  }),
}));
