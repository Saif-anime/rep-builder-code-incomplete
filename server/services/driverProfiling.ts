import { db } from "../db";
import { driverProfiles, parkingSessions, siteRules } from "@shared/schema";
import { eq, and, gte, lte, isNotNull, sql, desc } from "drizzle-orm";
import type { DriverProfile, InsertDriverProfile, BehaviourClassification, DriverRiskFlag } from "@shared/schema";

export interface ProfileAnalytics {
  vrm: string;
  siteId: number;
  totalVisits: number;
  visits30d: number;
  visits90d: number;
  medianDurationMinutes: number;
  meanDurationMinutes: number;
  durationStddev: number;
  commonArrivalBuckets: Array<{ hour: number; count: number; percentage: number }>;
  mostCommonHour: number;
  arrivalVariance: number;
  classification: BehaviourClassification;
  riskFlag: DriverRiskFlag;
  riskScore: number;
  riskFactors: Array<{ name: string; weight: number; description: string }>;
}

export class DriverProfilingService {
  async getProfile(siteId: number, vrm: string): Promise<DriverProfile | null> {
    const normalizedVrm = this.normalizeVrm(vrm);
    const [profile] = await db.select().from(driverProfiles)
      .where(and(
        eq(driverProfiles.siteId, siteId),
        eq(driverProfiles.vrm, normalizedVrm)
      ))
      .limit(1);
    return profile || null;
  }

  async recomputeProfile(
    siteId: number,
    vrm: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<DriverProfile> {
    const normalizedVrm = this.normalizeVrm(vrm);
    const analytics = await this.analyzeDriverBehaviour(siteId, normalizedVrm, windowStart, windowEnd);

    const existing = await this.getProfile(siteId, normalizedVrm);

    const profileData = {
      siteId,
      vrm: normalizedVrm,
      firstSeen: analytics.firstSeen,
      lastSeen: analytics.lastSeen,
      visits30d: analytics.visits30d,
      visits90d: analytics.visits90d,
      totalVisits: analytics.totalVisits,
      medianDurationMinutes: analytics.medianDurationMinutes,
      meanDurationMinutes: analytics.meanDurationMinutes,
      durationStddev: analytics.durationStddev,
      commonArrivalTimeBuckets: {
        buckets: analytics.commonArrivalBuckets,
        mostCommonHour: analytics.mostCommonHour,
        variance: analytics.arrivalVariance,
      },
      behaviourClassification: analytics.classification,
      riskFlag: analytics.riskFlag,
      riskScore: analytics.riskScore,
      riskFactors: {
        factors: analytics.riskFactors,
        totalWeight: analytics.riskFactors.reduce((sum, f) => sum + f.weight, 0),
      },
    };

    if (existing) {
      const [updated] = await db.update(driverProfiles)
        .set({
          ...profileData,
          lastCalculatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(driverProfiles.id, existing.id))
        .returning();
      return updated;
    }

    const insertData = {
      siteId: profileData.siteId,
      vrm: profileData.vrm,
      firstSeen: profileData.firstSeen,
      lastSeen: profileData.lastSeen,
      visits30d: profileData.visits30d,
      visits90d: profileData.visits90d,
      totalVisits: profileData.totalVisits,
      medianDurationMinutes: profileData.medianDurationMinutes,
      meanDurationMinutes: profileData.meanDurationMinutes,
      durationStddev: profileData.durationStddev,
      commonArrivalTimeBuckets: profileData.commonArrivalTimeBuckets,
      behaviourClassification: profileData.behaviourClassification as BehaviourClassification,
      riskFlag: profileData.riskFlag as DriverRiskFlag,
      riskScore: profileData.riskScore,
      riskFactors: profileData.riskFactors,
    };

    const [created] = await db.insert(driverProfiles)
      .values([insertData])
      .returning();
    return created;
  }

  async recomputeSiteProfiles(
    siteId: number,
    windowStart: Date,
    windowEnd: Date
  ): Promise<{ processed: number; profiles: DriverProfile[] }> {
    const sessions = await db.select().from(parkingSessions)
      .where(and(
        eq(parkingSessions.siteId, siteId),
        isNotNull(parkingSessions.entryAt),
        gte(parkingSessions.entryAt, windowStart),
        lte(parkingSessions.entryAt, windowEnd)
      ));

    const uniqueVrms = Array.from(new Set(sessions.map(s => this.normalizeVrm(s.vrm))));
    const profiles: DriverProfile[] = [];

    for (const vrm of uniqueVrms) {
      const profile = await this.recomputeProfile(siteId, vrm, windowStart, windowEnd);
      profiles.push(profile);
    }

    return { processed: profiles.length, profiles };
  }

  private async analyzeDriverBehaviour(
    siteId: number,
    vrm: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<ProfileAnalytics & { firstSeen: Date; lastSeen: Date }> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const allSessions = await db.select().from(parkingSessions)
      .where(and(
        eq(parkingSessions.siteId, siteId),
        eq(parkingSessions.vrm, vrm),
        isNotNull(parkingSessions.entryAt)
      ))
      .orderBy(parkingSessions.entryAt);

    if (allSessions.length === 0) {
      return this.getEmptyAnalytics(siteId, vrm);
    }

    const sessions30d = allSessions.filter(s => 
      s.entryAt && new Date(s.entryAt) >= thirtyDaysAgo
    );
    const sessions90d = allSessions.filter(s => 
      s.entryAt && new Date(s.entryAt) >= ninetyDaysAgo
    );

    const durations = allSessions
      .map(s => s.durationMinutes)
      .filter((d): d is number => d !== null && d > 0);

    const sortedDurations = [...durations].sort((a, b) => a - b);
    const median = sortedDurations.length > 0 
      ? sortedDurations[Math.floor(sortedDurations.length / 2)] 
      : 0;
    const mean = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;
    const variance = durations.length > 0
      ? durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / durations.length
      : 0;
    const stddev = Math.sqrt(variance);

    const hourCounts: Record<number, number> = {};
    allSessions.forEach(s => {
      if (s.entryAt) {
        const hour = new Date(s.entryAt).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
    });

    const totalVisits = allSessions.length;
    const buckets = Object.entries(hourCounts)
      .map(([hour, count]) => ({
        hour: parseInt(hour),
        count,
        percentage: Math.round((count / totalVisits) * 100),
      }))
      .sort((a, b) => b.count - a.count);

    const mostCommonHour = buckets.length > 0 ? buckets[0].hour : 12;
    
    const hourValues = Object.values(hourCounts);
    const hourMean = hourValues.reduce((a, b) => a + b, 0) / hourValues.length;
    const arrivalVariance = hourValues.length > 0
      ? hourValues.reduce((sum, v) => sum + Math.pow(v - hourMean, 2), 0) / hourValues.length
      : 0;

    const [rule] = await db.select().from(siteRules)
      .where(eq(siteRules.siteId, siteId))
      .limit(1);
    const maxStayMinutes = rule?.maxStayMinutes || 120;

    const classification = this.classifyBehaviour(
      sessions30d.length,
      sessions90d.length,
      totalVisits,
      mean,
      stddev,
      arrivalVariance,
      maxStayMinutes
    );

    const { riskFlag, riskScore, riskFactors } = this.calculateRisk(
      classification,
      sessions30d.length,
      totalVisits,
      mean,
      maxStayMinutes,
      allSessions
    );

    return {
      vrm,
      siteId,
      totalVisits,
      visits30d: sessions30d.length,
      visits90d: sessions90d.length,
      medianDurationMinutes: Math.round(median),
      meanDurationMinutes: Math.round(mean),
      durationStddev: Math.round(stddev * 10) / 10,
      commonArrivalBuckets: buckets.slice(0, 5),
      mostCommonHour,
      arrivalVariance: Math.round(arrivalVariance * 10) / 10,
      classification,
      riskFlag,
      riskScore,
      riskFactors,
      firstSeen: allSessions[0].entryAt || new Date(),
      lastSeen: allSessions[allSessions.length - 1].entryAt || new Date(),
    };
  }

  private classifyBehaviour(
    visits30d: number,
    visits90d: number,
    totalVisits: number,
    meanDuration: number,
    durationStddev: number,
    arrivalVariance: number,
    maxStayMinutes: number
  ): BehaviourClassification {
    if (totalVisits === 1) {
      return "FIRST_TIME_LATE";
    }

    const isFrequent = visits30d >= 10;
    const isLowVariance = durationStddev < 15;
    const isShortStay = meanDuration < maxStayMinutes * 0.3;
    const isConsistentArrival = arrivalVariance < 5;

    if (isFrequent && isLowVariance && isShortStay && isConsistentArrival) {
      return "COMMUTER_PATTERN";
    }

    if (visits30d <= 3 && visits90d <= 8) {
      return "OCCASIONAL_PATRON";
    }

    if (visits30d >= 4) {
      return "REGULAR_PATRON";
    }

    return "UNKNOWN";
  }

  private calculateRisk(
    classification: BehaviourClassification,
    visits30d: number,
    totalVisits: number,
    meanDuration: number,
    maxStayMinutes: number,
    sessions: Array<{ durationMinutes: number | null }>
  ): { riskFlag: DriverRiskFlag; riskScore: number; riskFactors: Array<{ name: string; weight: number; description: string }> } {
    const riskFactors: Array<{ name: string; weight: number; description: string }> = [];
    let riskScore = 0;

    if (classification === "COMMUTER_PATTERN") {
      riskFactors.push({
        name: "commuter_pattern",
        weight: 40,
        description: "Consistent short stays at regular times suggests commuter usage",
      });
      riskScore += 40;
    }

    if (classification === "FIRST_TIME_LATE") {
      riskFactors.push({
        name: "first_visit_grace",
        weight: -20,
        description: "First-time visitor may not be familiar with time limits",
      });
      riskScore -= 20;
    }

    if (visits30d >= 15) {
      riskFactors.push({
        name: "very_frequent_visits",
        weight: 20,
        description: "Very high visit frequency in last 30 days",
      });
      riskScore += 20;
    }

    if (meanDuration < maxStayMinutes * 0.2) {
      riskFactors.push({
        name: "very_short_stays",
        weight: 15,
        description: "Average stay is less than 20% of max allowed time",
      });
      riskScore += 15;
    }

    const overstayCount = sessions.filter(s => (s.durationMinutes || 0) > maxStayMinutes).length;
    const overstayRate = totalVisits > 0 ? overstayCount / totalVisits : 0;
    
    if (overstayRate > 0.3) {
      riskFactors.push({
        name: "high_overstay_rate",
        weight: 25,
        description: "More than 30% of visits resulted in overstays",
      });
      riskScore += 25;
    } else if (overstayRate < 0.05 && totalVisits > 5) {
      riskFactors.push({
        name: "low_overstay_rate",
        weight: -15,
        description: "Less than 5% overstay rate with multiple visits",
      });
      riskScore -= 15;
    }

    riskScore = Math.max(0, Math.min(100, riskScore));

    let riskFlag: DriverRiskFlag = "NONE";
    if (classification === "COMMUTER_PATTERN" && riskScore >= 40) {
      riskFlag = "POSSIBLE_COMMUTER_MISUSE";
    } else if (classification === "FIRST_TIME_LATE") {
      riskFlag = "FIRST_VISIT_GRACE";
    } else if (riskScore <= 20 && totalVisits >= 3) {
      riskFlag = "LIKELY_FAIR_USER";
    }

    return { riskFlag, riskScore, riskFactors };
  }

  private getEmptyAnalytics(siteId: number, vrm: string): ProfileAnalytics & { firstSeen: Date; lastSeen: Date } {
    const now = new Date();
    return {
      vrm,
      siteId,
      totalVisits: 0,
      visits30d: 0,
      visits90d: 0,
      medianDurationMinutes: 0,
      meanDurationMinutes: 0,
      durationStddev: 0,
      commonArrivalBuckets: [],
      mostCommonHour: 12,
      arrivalVariance: 0,
      classification: "UNKNOWN",
      riskFlag: "NONE",
      riskScore: 0,
      riskFactors: [],
      firstSeen: now,
      lastSeen: now,
    };
  }

  private normalizeVrm(vrm: string): string {
    return vrm.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  }
}

export const driverProfilingService = new DriverProfilingService();
