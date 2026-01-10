import { db } from "../db";
import { sessionFlags, parkingSessions, siteRules, enrichmentRuns } from "@shared/schema";
import { eq, and, gte, lte, isNotNull, sql, desc } from "drizzle-orm";
import type { InsertSessionFlag, SessionFlag } from "@shared/schema";
import { contextEnrichmentService } from "./contextEnrichment";

export type SpikeSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SpikeThresholds {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

const DEFAULT_THRESHOLDS: SpikeThresholds = {
  low: 1.5,
  medium: 2.0,
  high: 3.0,
  critical: 5.0,
};

export interface SpikeDetectionResult {
  isSpike: boolean;
  severity: SpikeSeverity;
  currentRate: number;
  baselineRate: number;
  multiplier: number;
  affectedSessions: number;
  recommendation: string;
  reason: string;
  enrichmentTriggered: boolean;
  enrichmentRunId?: number;
}

export class SpikeDetectionService {
  private thresholds: SpikeThresholds;

  constructor(thresholds?: Partial<SpikeThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  async detectSpike(
    siteId: number,
    windowStart: Date,
    windowEnd: Date,
    createdBy?: string
  ): Promise<SpikeDetectionResult> {
    const [rule] = await db.select().from(siteRules)
      .where(eq(siteRules.siteId, siteId))
      .limit(1);

    const maxStayMinutes = rule?.maxStayMinutes || 120;
    const baselineWindowDays = rule?.baselineWindowDays || 28;
    const configuredThreshold = rule?.spikeThresholdMultiplier || this.thresholds.low;

    const sessions = await db.select().from(parkingSessions)
      .where(and(
        eq(parkingSessions.siteId, siteId),
        isNotNull(parkingSessions.entryAt),
        gte(parkingSessions.entryAt, windowStart),
        lte(parkingSessions.entryAt, windowEnd)
      ));

    const overstays = sessions.filter(s => (s.durationMinutes || 0) > maxStayMinutes);
    const currentRate = sessions.length > 0 ? overstays.length / sessions.length : 0;

    const baselineRate = await this.calculateBaselineRate(
      siteId, 
      windowStart, 
      maxStayMinutes, 
      baselineWindowDays
    );

    const multiplier = baselineRate > 0 ? currentRate / baselineRate : 0;
    const isSpike = baselineRate > 0 && multiplier >= configuredThreshold;
    const severity = this.calculateSeverity(multiplier);

    let recommendation = "PROCEED_PCN";
    let reason = "No spike detected - normal overstay rate";
    let enrichmentTriggered = false;
    let enrichmentRunId: number | undefined;

    if (isSpike) {
      const enrichmentRun = await contextEnrichmentService.runContextEnrichment(
        siteId,
        windowStart,
        windowEnd,
        createdBy
      );
      enrichmentRunId = enrichmentRun.id;
      enrichmentTriggered = true;

      const hasWeatherDisruption = enrichmentRun.results?.weatherSummary?.alerts?.some(
        alert => alert.toLowerCase().includes("warning") || 
                 alert.toLowerCase().includes("hazard")
      );
      
      const hasRoadClosure = enrichmentRun.results?.localEventsSummary?.events.some(
        event => event.type === "infrastructure" || event.type.toLowerCase().includes("closure")
      );

      if (hasWeatherDisruption || hasRoadClosure) {
        recommendation = "HOLD_PCN";
        reason = hasWeatherDisruption 
          ? `Weather disruption detected: ${enrichmentRun.results?.weatherSummary?.conditions}`
          : `Road closure detected: ${enrichmentRun.results?.localEventsSummary?.events.find(e => e.type === "infrastructure")?.name}`;

        await this.createDisruptionFlag(
          siteId,
          overstays,
          severity,
          reason,
          recommendation,
          enrichmentRunId,
          enrichmentRun.results
        );
      } else {
        recommendation = "REVIEW_REQUIRED";
        reason = `Overstay spike detected (${multiplier.toFixed(1)}x baseline) without identified disruption`;
      }
    }

    return {
      isSpike,
      severity,
      currentRate: Math.round(currentRate * 100) / 100,
      baselineRate: Math.round(baselineRate * 100) / 100,
      multiplier: Math.round(multiplier * 100) / 100,
      affectedSessions: overstays.length,
      recommendation,
      reason,
      enrichmentTriggered,
      enrichmentRunId,
    };
  }

  private calculateSeverity(multiplier: number): SpikeSeverity {
    if (multiplier >= this.thresholds.critical) return "CRITICAL";
    if (multiplier >= this.thresholds.high) return "HIGH";
    if (multiplier >= this.thresholds.medium) return "MEDIUM";
    return "LOW";
  }

  private async calculateBaselineRate(
    siteId: number,
    referenceDate: Date,
    maxStayMinutes: number,
    lookbackDays: number
  ): Promise<number> {
    const dayOfWeek = referenceDate.getDay();
    const hour = referenceDate.getHours();

    const startDate = new Date(referenceDate);
    startDate.setDate(startDate.getDate() - lookbackDays);

    const historicalSessions = await db.select().from(parkingSessions)
      .where(and(
        eq(parkingSessions.siteId, siteId),
        isNotNull(parkingSessions.entryAt),
        gte(parkingSessions.entryAt, startDate),
        lte(parkingSessions.entryAt, referenceDate)
      ));

    const matchingSessions = historicalSessions.filter(s => {
      if (!s.entryAt) return false;
      const entryDate = new Date(s.entryAt);
      return entryDate.getDay() === dayOfWeek && 
             Math.abs(entryDate.getHours() - hour) <= 2;
    });

    if (matchingSessions.length < 10) {
      return 0;
    }

    const overstays = matchingSessions.filter(s => (s.durationMinutes || 0) > maxStayMinutes);
    return overstays.length / matchingSessions.length;
  }

  private async createDisruptionFlag(
    siteId: number,
    affectedSessions: Array<{ id: number; vrm: string }>,
    severity: SpikeSeverity,
    reason: string,
    recommendation: string,
    enrichmentRunId: number,
    enrichmentResults: any
  ): Promise<void> {
    for (const session of affectedSessions) {
      const flagData: InsertSessionFlag = {
        sessionId: session.id,
        siteId,
        enrichmentRunId,
        flagType: "POSSIBLE_DISRUPTION",
        severity: severity.toLowerCase(),
        reason,
        recommendation,
        status: "OPEN",
        evidence: {
          weatherConditions: enrichmentResults?.weatherSummary?.conditions,
          weatherAlerts: enrichmentResults?.weatherSummary?.alerts,
          localEvents: enrichmentResults?.localEventsSummary?.events.map((e: any) => ({
            name: e.name,
            type: e.type,
            distance: e.distance,
          })),
          overstayRate: enrichmentResults?.anomalySummary?.overstayRate,
          baselineRate: enrichmentResults?.anomalySummary?.baselineOverstayRate,
          spikeMultiplier: enrichmentResults?.anomalySummary?.spikeMultiplier,
        },
      };

      await db.insert(sessionFlags).values(flagData);
    }
  }

  async getOpenFlags(siteId: number): Promise<SessionFlag[]> {
    return db.select().from(sessionFlags)
      .where(and(
        eq(sessionFlags.siteId, siteId),
        eq(sessionFlags.status, "OPEN")
      ))
      .orderBy(desc(sessionFlags.createdAt));
  }

  async resolveFlag(
    flagId: number,
    resolvedBy: string,
    resolutionNotes: string
  ): Promise<SessionFlag | null> {
    const [updated] = await db.update(sessionFlags)
      .set({
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy,
        resolutionNotes,
        updatedAt: new Date(),
      })
      .where(eq(sessionFlags.id, flagId))
      .returning();

    return updated || null;
  }

  async dismissFlag(
    flagId: number,
    resolvedBy: string,
    resolutionNotes: string
  ): Promise<SessionFlag | null> {
    const [updated] = await db.update(sessionFlags)
      .set({
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedBy,
        resolutionNotes,
        updatedAt: new Date(),
      })
      .where(eq(sessionFlags.id, flagId))
      .returning();

    return updated || null;
  }
}

export const spikeDetectionService = new SpikeDetectionService();
