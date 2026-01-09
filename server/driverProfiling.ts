import { storage } from "./storage";
import type { 
  ParkingSession, 
  InsertDriverProfile, 
  DriverProfile,
  BehaviourClassification,
  DriverRiskFlag
} from "@shared/schema";

interface SessionStats {
  totalVisits: number;
  visits30d: number;
  visits90d: number;
  firstSeen: Date;
  lastSeen: Date;
  durations: number[];
  arrivalHours: number[];
}

interface ArrivalTimeBucket {
  hour: number;
  count: number;
  percentage: number;
}

interface ArrivalTimeAnalysis {
  buckets: ArrivalTimeBucket[];
  mostCommonHour: number;
  variance: number;
}

interface RiskFactor {
  name: string;
  weight: number;
  description: string;
}

interface ClassificationResult {
  classification: BehaviourClassification;
  riskFlag: DriverRiskFlag;
  riskScore: number;
  riskFactors: RiskFactor[];
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = calculateMean(values);
  const squareDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(calculateMean(squareDiffs));
}

function analyzeArrivalTimes(arrivalHours: number[]): ArrivalTimeAnalysis {
  if (arrivalHours.length === 0) {
    return { buckets: [], mostCommonHour: 0, variance: 0 };
  }

  const hourCounts: Record<number, number> = {};
  for (const hour of arrivalHours) {
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }

  const total = arrivalHours.length;
  const buckets: ArrivalTimeBucket[] = Object.entries(hourCounts)
    .map(([hour, count]) => ({
      hour: parseInt(hour),
      count,
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const mostCommonHour = buckets.length > 0 ? buckets[0].hour : 0;
  const variance = calculateStdDev(arrivalHours);

  return { buckets, mostCommonHour, variance };
}

function classifyBehaviour(
  stats: SessionStats,
  medianDuration: number,
  durationStdDev: number,
  arrivalAnalysis: ArrivalTimeAnalysis,
  siteMaxStayMinutes: number = 120
): ClassificationResult {
  const riskFactors: RiskFactor[] = [];
  let riskScore = 0;

  const isFirstVisit = stats.totalVisits === 1;
  const isFrequent = stats.visits30d >= 15;
  const isVeryFrequent = stats.visits30d >= 20;
  const isOccasional = stats.visits30d <= 2 && stats.visits90d <= 6;
  const isShortStay = medianDuration <= 30;
  const isVeryShortStay = medianDuration <= 20;
  const isLowVariance = durationStdDev <= 10;
  const isConsistentArrivalTime = arrivalAnalysis.variance <= 2;
  const hasOverstays = stats.durations.some(d => d > siteMaxStayMinutes);
  const overStayCount = stats.durations.filter(d => d > siteMaxStayMinutes).length;
  const overStayRate = stats.totalVisits > 0 ? overStayCount / stats.totalVisits : 0;

  if (isFirstVisit) {
    if (hasOverstays) {
      riskFactors.push({
        name: "FIRST_VISIT_OVERSTAY",
        weight: 10,
        description: "First visit with slight overstay - benefit of doubt applies",
      });
      riskScore += 10;
      return {
        classification: "FIRST_TIME_LATE",
        riskFlag: "FIRST_VISIT_GRACE",
        riskScore: Math.min(riskScore, 100),
        riskFactors,
      };
    }
    return {
      classification: "UNKNOWN",
      riskFlag: "NONE",
      riskScore: 0,
      riskFactors: [],
    };
  }

  if (isVeryFrequent && isVeryShortStay && isLowVariance && isConsistentArrivalTime) {
    riskFactors.push({
      name: "DAILY_SHORT_STAY",
      weight: 40,
      description: `Daily ~${Math.round(medianDuration)}min stays suggest commuter drop-off`,
    });
    riskFactors.push({
      name: "CONSISTENT_ARRIVAL",
      weight: 30,
      description: `Arrives consistently around ${arrivalAnalysis.mostCommonHour}:00 (variance: ${arrivalAnalysis.variance.toFixed(1)}h)`,
    });
    riskFactors.push({
      name: "LOW_DURATION_VARIANCE",
      weight: 20,
      description: `Duration variance only ${durationStdDev.toFixed(1)} minutes`,
    });
    riskScore = 90;

    return {
      classification: "COMMUTER_PATTERN",
      riskFlag: "POSSIBLE_COMMUTER_MISUSE",
      riskScore,
      riskFactors,
    };
  }

  if (isFrequent && isShortStay && isLowVariance) {
    riskFactors.push({
      name: "FREQUENT_SHORT_STAY",
      weight: 35,
      description: `${stats.visits30d} visits/month with ${Math.round(medianDuration)}min median stay`,
    });
    if (isConsistentArrivalTime) {
      riskFactors.push({
        name: "CONSISTENT_ARRIVAL",
        weight: 25,
        description: `Consistent arrival around ${arrivalAnalysis.mostCommonHour}:00`,
      });
    }
    riskScore = 70;

    return {
      classification: "COMMUTER_PATTERN",
      riskFlag: "POSSIBLE_COMMUTER_MISUSE",
      riskScore,
      riskFactors,
    };
  }

  if (isOccasional && medianDuration >= 60 && medianDuration <= 180) {
    riskFactors.push({
      name: "OCCASIONAL_MODERATE_STAY",
      weight: -30,
      description: `Occasional visitor (${stats.visits30d}/month) with ${Math.round(medianDuration)}min typical stay`,
    });

    if (hasOverstays && overStayRate <= 0.2) {
      riskFactors.push({
        name: "RARE_OVERSTAY",
        weight: 5,
        description: `Only ${Math.round(overStayRate * 100)}% of visits exceeded time limit`,
      });
      riskScore = 15;
    } else {
      riskScore = 5;
    }

    return {
      classification: "OCCASIONAL_PATRON",
      riskFlag: "LIKELY_FAIR_USER",
      riskScore,
      riskFactors,
    };
  }

  if (stats.visits30d >= 5 && stats.visits30d < 15 && medianDuration >= 30 && medianDuration <= 180) {
    riskFactors.push({
      name: "REGULAR_VISITS",
      weight: 0,
      description: `Regular visitor pattern: ${stats.visits30d} visits/month, ${Math.round(medianDuration)}min avg stay`,
    });
    riskScore = 20;

    return {
      classification: "REGULAR_PATRON",
      riskFlag: "LIKELY_FAIR_USER",
      riskScore,
      riskFactors,
    };
  }

  return {
    classification: "UNKNOWN",
    riskFlag: "NONE",
    riskScore: Math.min(riskScore, 100),
    riskFactors,
  };
}

export async function calculateDriverProfile(
  siteId: number,
  vrm: string,
  asOfDate: Date = new Date()
): Promise<InsertDriverProfile> {
  const normalizedVrm = vrm.toUpperCase().replace(/\s+/g, "");

  const now = asOfDate;
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const allSessions = await storage.getDriverSessionHistory(siteId, normalizedVrm);
  const sessions30d = allSessions.filter(s => s.entryAt && new Date(s.entryAt) >= thirtyDaysAgo);
  const sessions90d = allSessions.filter(s => s.entryAt && new Date(s.entryAt) >= ninetyDaysAgo);

  if (allSessions.length === 0) {
    return {
      siteId,
      vrm: normalizedVrm,
      firstSeen: now,
      lastSeen: now,
      visits30d: 0,
      visits90d: 0,
      totalVisits: 0,
      medianDurationMinutes: null,
      meanDurationMinutes: null,
      durationStddev: null,
      commonArrivalTimeBuckets: null,
      behaviourClassification: "UNKNOWN",
      riskFlag: "NONE",
      riskScore: 0,
      riskFactors: null,
    };
  }

  const closedSessions = allSessions.filter(s => s.status === "CLOSED" && s.durationMinutes !== null);
  const durations = closedSessions.map(s => s.durationMinutes as number);
  const arrivalHours = allSessions
    .filter(s => s.entryAt)
    .map(s => new Date(s.entryAt!).getHours());

  const sortedByEntry = allSessions
    .filter(s => s.entryAt)
    .sort((a, b) => new Date(a.entryAt!).getTime() - new Date(b.entryAt!).getTime());

  const firstSeen = sortedByEntry.length > 0 ? new Date(sortedByEntry[0].entryAt!) : now;
  const lastSeen = sortedByEntry.length > 0 ? new Date(sortedByEntry[sortedByEntry.length - 1].entryAt!) : now;

  const stats: SessionStats = {
    totalVisits: allSessions.length,
    visits30d: sessions30d.length,
    visits90d: sessions90d.length,
    firstSeen,
    lastSeen,
    durations,
    arrivalHours,
  };

  const medianDuration = calculateMedian(durations);
  const meanDuration = calculateMean(durations);
  const durationStdDev = calculateStdDev(durations);
  const arrivalAnalysis = analyzeArrivalTimes(arrivalHours);

  const rules = await storage.getSiteRules(siteId);
  const maxStayMinutes = rules?.maxStayMinutes || 120;

  const { classification, riskFlag, riskScore, riskFactors } = classifyBehaviour(
    stats,
    medianDuration,
    durationStdDev,
    arrivalAnalysis,
    maxStayMinutes
  );

  return {
    siteId,
    vrm: normalizedVrm,
    firstSeen,
    lastSeen,
    visits30d: stats.visits30d,
    visits90d: stats.visits90d,
    totalVisits: stats.totalVisits,
    medianDurationMinutes: durations.length > 0 ? Math.round(medianDuration * 10) / 10 : null,
    meanDurationMinutes: durations.length > 0 ? Math.round(meanDuration * 10) / 10 : null,
    durationStddev: durations.length > 0 ? Math.round(durationStdDev * 10) / 10 : null,
    commonArrivalTimeBuckets: arrivalAnalysis.buckets.length > 0 ? arrivalAnalysis : null,
    behaviourClassification: classification,
    riskFlag,
    riskScore,
    riskFactors: riskFactors.length > 0 ? { factors: riskFactors, totalWeight: riskScore } : null,
  };
}

export async function recomputeDriverProfiles(
  siteId: number,
  fromDate?: Date,
  toDate?: Date
): Promise<{ processed: number; profiles: DriverProfile[] }> {
  const from = fromDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const to = toDate || new Date();

  const sessions = await storage.getSessionsBySite(siteId, from, to);

  const uniqueVrms = new Set<string>();
  for (const session of sessions) {
    if (session.vrm) {
      uniqueVrms.add(session.vrm.toUpperCase().replace(/\s+/g, ""));
    }
  }

  const vrmArray = Array.from(uniqueVrms);
  console.log(`[DriverProfiling] Found ${vrmArray.length} unique VRMs to profile for site ${siteId}`);

  const profiles: DriverProfile[] = [];
  for (const vrm of vrmArray) {
    try {
      const profileData = await calculateDriverProfile(siteId, vrm, to);
      const profile = await storage.upsertDriverProfile(profileData);
      profiles.push(profile);
    } catch (error) {
      console.error(`[DriverProfiling] Error profiling VRM ${vrm}:`, error);
    }
  }

  console.log(`[DriverProfiling] Completed profiling ${profiles.length} drivers for site ${siteId}`);

  return { processed: profiles.length, profiles };
}

export async function getDriverProfileWithFreshCalculation(
  siteId: number,
  vrm: string
): Promise<DriverProfile | null> {
  const profileData = await calculateDriverProfile(siteId, vrm);

  if (profileData.totalVisits === 0) {
    return null;
  }

  const profile = await storage.upsertDriverProfile(profileData);
  return profile;
}
