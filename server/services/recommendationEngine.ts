import { db } from "../db";
import { pcnRecommendations, parkingSessions, sessionFlags, siteRules } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { 
  PcnRecommendation, 
  InsertPcnRecommendation, 
  RecommendationAction, 
  RecommendationSource,
  ParkingSession,
  SessionFlag,
  DriverProfile
} from "@shared/schema";
import { contextEnrichmentService, type EnrichmentResult } from "./contextEnrichment";
import { siteEventPolicyService, type PolicyEvaluationResult } from "./siteEventPolicy";
import { driverProfilingService } from "./driverProfiling";
import { spikeDetectionService, type SpikeDetectionResult } from "./spikeDetection";

export interface RecommendationInput {
  sessionId: number;
  siteId: number;
  vrm: string;
  entryAt?: Date;
  exitAt?: Date;
  durationMinutes?: number;
  flagId?: number;
  enrichmentResult?: EnrichmentResult;
  driverProfile?: DriverProfile | null;
  spikeResult?: SpikeDetectionResult;
  policyResult?: PolicyEvaluationResult;
}

export interface RecommendationOutput {
  action: RecommendationAction;
  confidence: number;
  reason: string;
  reasonPlain: string;
  evidenceJson: {
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
    policyApplied?: string;
    spikeDetected?: boolean;
  };
}

export class RecommendationEngineService {
  async generateRecommendation(
    input: RecommendationInput,
    createdBy?: string
  ): Promise<PcnRecommendation> {
    const [rule] = await db.select().from(siteRules)
      .where(eq(siteRules.siteId, input.siteId))
      .limit(1);
    
    const maxStayMinutes = rule?.maxStayMinutes || 120;
    const isOverstay = (input.durationMinutes || 0) > maxStayMinutes;

    if (!isOverstay) {
      return this.createRecommendation({
        sessionId: input.sessionId,
        siteId: input.siteId,
        vrm: input.vrm,
        flagId: input.flagId,
        action: "AUTO_DISMISS",
        source: "SYSTEM",
        reason: "NO_OVERSTAY",
        reasonPlain: "No overstay detected - vehicle departed within allowed time",
        confidence: 1.0,
        evidenceJson: {
          sessionDetails: {
            entryAt: input.entryAt?.toISOString() || "",
            exitAt: input.exitAt?.toISOString(),
            durationMinutes: input.durationMinutes,
            maxStayMinutes,
          },
        },
        createdBy,
      });
    }

    let enrichmentResult = input.enrichmentResult;
    if (!enrichmentResult) {
      const windowStart = input.entryAt || new Date();
      const windowEnd = input.exitAt || new Date();
      const enrichmentRun = await contextEnrichmentService.runContextEnrichment(
        input.siteId,
        windowStart,
        windowEnd,
        createdBy
      );
      enrichmentResult = enrichmentRun.results as EnrichmentResult;
    }

    let policyResult = input.policyResult;
    if (!policyResult && enrichmentResult) {
      policyResult = await siteEventPolicyService.evaluatePolicy(input.siteId, enrichmentResult);
    }

    let driverProfile = input.driverProfile;
    if (driverProfile === undefined) {
      driverProfile = await driverProfilingService.getProfile(input.siteId, input.vrm);
    }

    const recommendation = this.calculateRecommendation(
      isOverstay,
      input.durationMinutes || 0,
      maxStayMinutes,
      enrichmentResult,
      policyResult,
      driverProfile,
      input.spikeResult
    );

    return this.createRecommendation({
      sessionId: input.sessionId,
      siteId: input.siteId,
      vrm: input.vrm,
      flagId: input.flagId,
      action: recommendation.action,
      source: "SYSTEM",
      reason: recommendation.reason,
      reasonPlain: recommendation.reasonPlain,
      confidence: recommendation.confidence,
      evidenceJson: {
        ...recommendation.evidenceJson,
        sessionDetails: {
          entryAt: input.entryAt?.toISOString() || "",
          exitAt: input.exitAt?.toISOString(),
          durationMinutes: input.durationMinutes,
          maxStayMinutes,
        },
      },
      createdBy,
    });
  }

  private calculateRecommendation(
    isOverstay: boolean,
    durationMinutes: number,
    maxStayMinutes: number,
    enrichmentResult?: EnrichmentResult,
    policyResult?: PolicyEvaluationResult,
    driverProfile?: DriverProfile | null,
    spikeResult?: SpikeDetectionResult
  ): RecommendationOutput {
    const evidenceJson: RecommendationOutput["evidenceJson"] = {};
    const siteContext: string[] = [];
    let confidence = 0.5;
    let action: RecommendationAction = "REVIEW_REQUIRED";
    let reason = "MANUAL_REVIEW";
    let reasonPlain = "Manual review required - insufficient data for automated decision";

    if (enrichmentResult?.weatherSummary) {
      evidenceJson.weatherConditions = enrichmentResult.weatherSummary.conditions;
      evidenceJson.weatherAlerts = enrichmentResult.weatherSummary.alerts;
    }

    if (enrichmentResult?.localEventsSummary?.events?.length) {
      evidenceJson.localEvents = enrichmentResult.localEventsSummary.events.map(e => ({
        name: e.name,
        type: e.type,
        distance: e.distance,
      }));
    }

    if (driverProfile) {
      evidenceJson.driverProfile = {
        classification: driverProfile.behaviourClassification || "UNKNOWN",
        riskScore: driverProfile.riskScore,
        riskFlag: driverProfile.riskFlag || "NONE",
      };

      if (driverProfile.riskFlag === "FIRST_VISIT_GRACE") {
        siteContext.push("First-time visitor - consider grace period");
      }
      if (driverProfile.riskFlag === "POSSIBLE_COMMUTER_MISUSE") {
        siteContext.push("Pattern suggests potential commuter misuse");
      }
      if (driverProfile.riskFlag === "LIKELY_FAIR_USER") {
        siteContext.push("Historical behaviour suggests fair user");
      }
    }

    if (spikeResult) {
      evidenceJson.spikeDetected = spikeResult.isSpike;
      if (spikeResult.isSpike) {
        siteContext.push(`Overstay spike detected (${spikeResult.multiplier}x baseline)`);
      }
    }

    if (policyResult) {
      evidenceJson.policyApplied = policyResult.explanation;
      siteContext.push(policyResult.explanation);

      if (policyResult.recommendation === "HOLD_PCN") {
        action = "HOLD_PCN";
        reason = "POLICY_HOLD";
        reasonPlain = policyResult.explanation;
        confidence = policyResult.confidence;
        evidenceJson.siteContext = siteContext;
        return { action, confidence, reason, reasonPlain, evidenceJson };
      }

      if (policyResult.recommendation === "PROCEED_PCN") {
        if (driverProfile?.riskFlag === "FIRST_VISIT_GRACE") {
          action = "REVIEW_REQUIRED";
          reason = "FIRST_VISIT_REVIEW";
          reasonPlain = "First-time visitor with overstay during known event. Human review recommended.";
          confidence = 0.6;
        } else if (driverProfile?.riskFlag === "POSSIBLE_COMMUTER_MISUSE") {
          action = "PROCEED_PCN";
          reason = "COMMUTER_PATTERN_VIOLATION";
          reasonPlain = "Overstay detected with commuter usage pattern. Enforcement recommended.";
          confidence = 0.85;
        } else {
          action = "PROCEED_PCN";
          reason = "STANDARD_VIOLATION";
          reasonPlain = policyResult.explanation;
          confidence = policyResult.confidence;
        }
        evidenceJson.siteContext = siteContext;
        return { action, confidence, reason, reasonPlain, evidenceJson };
      }
    }

    if (driverProfile?.riskFlag === "FIRST_VISIT_GRACE") {
      action = "REVIEW_REQUIRED";
      reason = "FIRST_VISIT_MINOR_OVERSTAY";
      reasonPlain = "First-time visitor with minor overstay. Consider grace period.";
      confidence = 0.7;
    } else if (driverProfile?.riskFlag === "LIKELY_FAIR_USER") {
      const overstayAmount = durationMinutes - maxStayMinutes;
      if (overstayAmount <= 15) {
        action = "REVIEW_REQUIRED";
        reason = "FAIR_USER_MINOR_OVERSTAY";
        reasonPlain = "Historically fair user with minor overstay. Review recommended.";
        confidence = 0.65;
      } else {
        action = "PROCEED_PCN";
        reason = "SIGNIFICANT_OVERSTAY";
        reasonPlain = `Vehicle overstayed by ${overstayAmount} minutes despite fair usage history.`;
        confidence = 0.75;
      }
    } else if (driverProfile?.riskFlag === "POSSIBLE_COMMUTER_MISUSE") {
      action = "PROCEED_PCN";
      reason = "COMMUTER_MISUSE_DETECTED";
      reasonPlain = "Pattern suggests commuter misuse of parking facility. Enforcement recommended.";
      confidence = 0.85;
    } else if (isOverstay) {
      const overstayAmount = durationMinutes - maxStayMinutes;
      if (overstayAmount <= 10) {
        action = "REVIEW_REQUIRED";
        reason = "MINOR_OVERSTAY";
        reasonPlain = `Minor overstay of ${overstayAmount} minutes. Human review recommended.`;
        confidence = 0.6;
      } else if (overstayAmount <= 30) {
        action = "PROCEED_PCN";
        reason = "MODERATE_OVERSTAY";
        reasonPlain = `Moderate overstay of ${overstayAmount} minutes beyond ${maxStayMinutes} minute limit.`;
        confidence = 0.75;
      } else {
        action = "PROCEED_PCN";
        reason = "SIGNIFICANT_OVERSTAY";
        reasonPlain = `Significant overstay of ${overstayAmount} minutes. Clear violation.`;
        confidence = 0.90;
      }
    }

    evidenceJson.siteContext = siteContext;
    return { action, confidence, reason, reasonPlain, evidenceJson };
  }

  private async createRecommendation(params: {
    sessionId: number;
    siteId: number;
    vrm: string;
    flagId?: number;
    action: RecommendationAction;
    source: RecommendationSource;
    reason: string;
    reasonPlain: string;
    confidence: number;
    evidenceJson: any;
    createdBy?: string;
  }): Promise<PcnRecommendation> {
    const [recommendation] = await db.insert(pcnRecommendations)
      .values([{
        sessionId: params.sessionId,
        siteId: params.siteId,
        vrm: params.vrm,
        flagId: params.flagId || null,
        action: params.action as RecommendationAction,
        source: params.source as RecommendationSource,
        reason: params.reason,
        reasonPlain: params.reasonPlain,
        confidence: params.confidence,
        evidenceJson: params.evidenceJson,
        createdBy: params.createdBy || null,
        isOverride: false,
      }])
      .returning();

    return recommendation;
  }

  async overrideRecommendation(
    recommendationId: number,
    newAction: RecommendationAction,
    overrideReason: string,
    userId: string
  ): Promise<PcnRecommendation> {
    const [existing] = await db.select().from(pcnRecommendations)
      .where(eq(pcnRecommendations.id, recommendationId))
      .limit(1);

    if (!existing) {
      throw new Error("Recommendation not found");
    }

    const [override] = await db.insert(pcnRecommendations)
      .values([{
        sessionId: existing.sessionId,
        siteId: existing.siteId,
        vrm: existing.vrm,
        flagId: existing.flagId,
        action: newAction as RecommendationAction,
        previousAction: existing.action as RecommendationAction,
        source: "USER" as RecommendationSource,
        reason: "USER_OVERRIDE",
        reasonPlain: overrideReason,
        confidence: 1.0,
        evidenceJson: {
          ...existing.evidenceJson,
          overrideReason,
        },
        createdBy: userId,
        isOverride: true,
      }])
      .returning();

    return override;
  }

  async getRecommendation(id: number): Promise<PcnRecommendation | null> {
    const [recommendation] = await db.select().from(pcnRecommendations)
      .where(eq(pcnRecommendations.id, id))
      .limit(1);
    return recommendation || null;
  }

  async getRecommendationsBySession(sessionId: number): Promise<PcnRecommendation[]> {
    return db.select().from(pcnRecommendations)
      .where(eq(pcnRecommendations.sessionId, sessionId))
      .orderBy(desc(pcnRecommendations.createdAt));
  }

  async getRecommendationsBySite(
    siteId: number,
    filters?: {
      action?: RecommendationAction;
      source?: RecommendationSource;
      limit?: number;
    }
  ): Promise<PcnRecommendation[]> {
    const conditions = [eq(pcnRecommendations.siteId, siteId)];

    if (filters?.action) {
      conditions.push(eq(pcnRecommendations.action, filters.action));
    }

    if (filters?.source) {
      conditions.push(eq(pcnRecommendations.source, filters.source));
    }

    return db.select().from(pcnRecommendations)
      .where(and(...conditions))
      .orderBy(desc(pcnRecommendations.createdAt))
      .limit(filters?.limit || 50);
  }

  async getLatestRecommendationForSession(sessionId: number): Promise<PcnRecommendation | null> {
    const [recommendation] = await db.select().from(pcnRecommendations)
      .where(eq(pcnRecommendations.sessionId, sessionId))
      .orderBy(desc(pcnRecommendations.createdAt))
      .limit(1);
    return recommendation || null;
  }
}

export const recommendationEngineService = new RecommendationEngineService();
