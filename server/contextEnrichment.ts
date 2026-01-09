import { storage } from "./storage";
import type { ParkingSession, SiteNote, InsertSessionFlag, SiteRule } from "@shared/schema";

export interface WeatherSummary {
  provider: string;
  conditions: string;
  temperature?: number;
  precipitation?: string;
  windSpeed?: string;
  alerts?: string[];
  rawData?: any;
}

export interface LocalEvent {
  name: string;
  type: string;
  startTime?: string;
  endTime?: string;
  expectedAttendance?: number;
  distance?: string;
}

export interface LocalEventsSummary {
  provider: string;
  events: LocalEvent[];
  rawData?: any;
}

export interface SiteInventoryHit {
  source: string;
  matchedTags: string[];
  relevantNotes: string[];
  ruleMatches: string[];
}

export interface AnomalySummary {
  totalSessions: number;
  overstayCount: number;
  overstayRate: number;
  averageOverstayMinutes: number;
  peakOverstayHour?: number;
  isSpike: boolean;
  spikeMultiplier?: number;
  baselineOverstayRate?: number;
}

export interface EnrichmentResults {
  weatherSummary: WeatherSummary | null;
  localEventsSummary: LocalEventsSummary | null;
  siteInventoryHits: SiteInventoryHit[];
  anomalySummary: AnomalySummary;
}

export interface WeatherProvider {
  name: string;
  getWeather(lat: number, lon: number, date: Date): Promise<WeatherSummary | null>;
}

export interface EventsProvider {
  name: string;
  getEvents(lat: number, lon: number, startDate: Date, endDate: Date): Promise<LocalEventsSummary | null>;
}

class MockWeatherProvider implements WeatherProvider {
  name = "mock";

  async getWeather(lat: number, lon: number, date: Date): Promise<WeatherSummary | null> {
    const conditions = ["Clear", "Cloudy", "Rain", "Snow", "Fog", "Storm"];
    const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
    const temperature = Math.floor(Math.random() * 30) - 5;
    
    const isBadWeather = ["Rain", "Snow", "Storm", "Fog"].includes(randomCondition);
    
    return {
      provider: this.name,
      conditions: randomCondition,
      temperature,
      precipitation: isBadWeather ? `${Math.floor(Math.random() * 20)}mm` : "0mm",
      windSpeed: `${Math.floor(Math.random() * 40)}mph`,
      alerts: isBadWeather ? [`${randomCondition} warning in effect`] : [],
      rawData: {
        lat,
        lon,
        date: date.toISOString(),
        generated: true,
      },
    };
  }
}

class MockEventsProvider implements EventsProvider {
  name = "mock";

  async getEvents(lat: number, lon: number, startDate: Date, endDate: Date): Promise<LocalEventsSummary | null> {
    const eventTypes = ["Sports", "Concert", "Festival", "Market", "Parade", "Conference"];
    const eventNames = [
      "Local Football Match",
      "Community Market Day",
      "Annual Festival",
      "Charity Run",
      "School Event",
      "Business Conference",
    ];
    
    const numEvents = Math.floor(Math.random() * 3);
    const events: LocalEvent[] = [];
    
    for (let i = 0; i < numEvents; i++) {
      events.push({
        name: eventNames[Math.floor(Math.random() * eventNames.length)],
        type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        expectedAttendance: Math.floor(Math.random() * 5000) + 100,
        distance: `${(Math.random() * 2).toFixed(1)}km`,
      });
    }
    
    return {
      provider: this.name,
      events,
      rawData: {
        lat,
        lon,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        generated: true,
      },
    };
  }
}

let weatherProvider: WeatherProvider = new MockWeatherProvider();
let eventsProvider: EventsProvider = new MockEventsProvider();

export function setWeatherProvider(provider: WeatherProvider): void {
  weatherProvider = provider;
}

export function setEventsProvider(provider: EventsProvider): void {
  eventsProvider = provider;
}

export function getWeatherProvider(): WeatherProvider {
  return weatherProvider;
}

export function getEventsProvider(): EventsProvider {
  return eventsProvider;
}

async function getSiteInventoryHits(
  siteId: number,
  windowStart: Date,
  windowEnd: Date
): Promise<SiteInventoryHit[]> {
  const hits: SiteInventoryHit[] = [];
  
  try {
    const rules = await storage.getSiteRules(siteId);
    if (rules) {
      const ruleMatches: string[] = [];
      const tags: string[] = [];
      
      if (rules.enforcementMode) {
        ruleMatches.push(`Enforcement mode: ${rules.enforcementMode}`);
        tags.push(rules.enforcementMode);
      }
      if (rules.maxStayMinutes) {
        ruleMatches.push(`Max stay: ${rules.maxStayMinutes} minutes`);
      }
      if (rules.graceEntryMinutes) {
        ruleMatches.push(`Grace entry: ${rules.graceEntryMinutes} minutes`);
      }
      if (rules.graceExitMinutes) {
        ruleMatches.push(`Grace exit: ${rules.graceExitMinutes} minutes`);
      }
      
      if (ruleMatches.length > 0) {
        hits.push({
          source: "site_rules",
          matchedTags: tags,
          relevantNotes: [],
          ruleMatches,
        });
      }
    }
  } catch (e) {
    console.error("[Enrichment] Error fetching site rules:", e);
  }
  
  try {
    const notes = await storage.getSiteNotes(siteId);
    if (!notes || !Array.isArray(notes)) {
      console.warn("[Enrichment] No notes returned or invalid format");
    }
    const validNotes = (notes || []).filter((n: SiteNote) => {
      if (!n.validFrom && !n.validTo) return true;
      if (n.validFrom && new Date(n.validFrom) > windowEnd) return false;
      if (n.validTo && new Date(n.validTo) < windowStart) return false;
      return true;
    });
    
    if (validNotes.length > 0) {
      const tags: string[] = [];
      const noteTexts: string[] = [];
      
      for (const note of validNotes) {
        noteTexts.push(note.content);
        const lowerNote = note.content.toLowerCase();
        if (lowerNote.includes("event")) tags.push("event");
        if (lowerNote.includes("busy")) tags.push("busy");
        if (lowerNote.includes("closed")) tags.push("closure");
        if (lowerNote.includes("construction")) tags.push("construction");
        if (lowerNote.includes("holiday")) tags.push("holiday");
      }
      
      hits.push({
        source: "site_notes",
        matchedTags: Array.from(new Set(tags)),
        relevantNotes: noteTexts,
        ruleMatches: [],
      });
    }
  } catch (e) {
    console.error("[Enrichment] Error fetching site notes:", e);
  }
  
  try {
    const surroundings = await storage.getSiteSurroundings(siteId);
    if (surroundings) {
      const tags: string[] = [];
      const descriptions: string[] = [];
      
      if (surroundings.freeTextSummary && typeof surroundings.freeTextSummary === "string") {
        descriptions.push(surroundings.freeTextSummary);
        const lowerSummary = surroundings.freeTextSummary.toLowerCase();
        if (lowerSummary.includes("school")) tags.push("school_nearby");
        if (lowerSummary.includes("hospital")) tags.push("hospital_nearby");
        if (lowerSummary.includes("station")) tags.push("transport_hub");
      }
      
      if (surroundings.nearbyPlaces && typeof surroundings.nearbyPlaces === "object") {
        const places = surroundings.nearbyPlaces as Record<string, unknown>;
        if (Array.isArray(places.shops) && places.shops.length > 0) {
          tags.push("shops_nearby");
          for (const s of places.shops) {
            if (s && typeof s === "object" && "name" in s && typeof s.name === "string") {
              descriptions.push(`Shop: ${s.name}`);
            }
          }
        }
        if (Array.isArray(places.offices) && places.offices.length > 0) {
          tags.push("offices_nearby");
          for (const o of places.offices) {
            if (o && typeof o === "object" && "name" in o && typeof o.name === "string") {
              descriptions.push(`Office: ${o.name}`);
            }
          }
        }
        if (Array.isArray(places.venues) && places.venues.length > 0) {
          tags.push("venues_nearby");
          for (const v of places.venues) {
            if (v && typeof v === "object" && "name" in v && typeof v.name === "string") {
              descriptions.push(`Venue: ${v.name}`);
            }
          }
        }
      }
      
      if (descriptions.length > 0 || tags.length > 0) {
        hits.push({
          source: "site_surroundings",
          matchedTags: Array.from(new Set(tags)),
          relevantNotes: descriptions,
          ruleMatches: [],
        });
      }
    }
  } catch (e) {
    console.error("[Enrichment] Error fetching site surroundings:", e);
  }
  
  return hits;
}

async function getAnomalySummary(
  siteId: number,
  windowStart: Date,
  windowEnd: Date,
  rules: SiteRule | null
): Promise<AnomalySummary> {
  try {
    const sessions = await storage.getSessionsBySite(siteId, windowStart, windowEnd);
    
    if (!sessions || !Array.isArray(sessions)) {
      console.warn("[Enrichment] No sessions returned or invalid format");
      return {
        totalSessions: 0,
        overstayCount: 0,
        overstayRate: 0,
        averageOverstayMinutes: 0,
        isSpike: false,
      };
    }
    
    const windowSessions = sessions.filter((s: ParkingSession) => {
      const entryTime = s.entryAt ? new Date(s.entryAt) : null;
      if (!entryTime) return false;
      return entryTime >= windowStart && entryTime <= windowEnd;
    });
    
    const totalSessions = windowSessions.length;
    let overstayCount = 0;
    let totalOverstayMinutes = 0;
    const hourCounts: Record<number, number> = {};
    
    const baselineWindowDays = rules?.baselineWindowDays || 28;
    const spikeThresholdMultiplier = rules?.spikeThresholdMultiplier || 1.5;
    
    const baseline = await calculateBaselineOverstayRate(siteId, windowStart, baselineWindowDays);
    const baselineOverstayRate = baseline.rate;
    
    console.log(`[Enrichment] Baseline overstay rate: ${(baselineOverstayRate * 100).toFixed(1)}% (from ${baseline.sampleSize} sessions)`);
    
    for (const session of windowSessions) {
      const duration = typeof session.durationMinutes === "number" ? session.durationMinutes : 0;
      if (duration > 120) {
        overstayCount++;
        totalOverstayMinutes += duration - 120;
        
        if (session.entryAt) {
          try {
            const entryDate = new Date(session.entryAt);
            if (!isNaN(entryDate.getTime())) {
              const hour = entryDate.getHours();
              hourCounts[hour] = (hourCounts[hour] || 0) + 1;
            }
          } catch {
            // Skip invalid entry timestamps
          }
        }
      }
    }
    
    const overstayRate = totalSessions > 0 ? overstayCount / totalSessions : 0;
    const averageOverstayMinutes = overstayCount > 0 ? totalOverstayMinutes / overstayCount : 0;
    
    let peakOverstayHour: number | undefined;
    let maxHourCount = 0;
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count > maxHourCount) {
        maxHourCount = count;
        peakOverstayHour = parseInt(hour);
      }
    }
    
    const isSpike = overstayRate > baselineOverstayRate * spikeThresholdMultiplier;
    const spikeMultiplier = baselineOverstayRate > 0 ? overstayRate / baselineOverstayRate : 1;
    
    return {
      totalSessions,
      overstayCount,
      overstayRate: Math.round(overstayRate * 100) / 100,
      averageOverstayMinutes: Math.round(averageOverstayMinutes),
      peakOverstayHour,
      isSpike,
      spikeMultiplier: Math.round(spikeMultiplier * 100) / 100,
      baselineOverstayRate,
    };
  } catch (e) {
    console.error("[Enrichment] Error calculating anomaly summary:", e);
    return {
      totalSessions: 0,
      overstayCount: 0,
      overstayRate: 0,
      averageOverstayMinutes: 0,
      isSpike: false,
    };
  }
}

export interface EnrichmentOptions {
  weatherProvider?: WeatherProvider;
  eventsProvider?: EventsProvider;
  skipFlagging?: boolean;
}

export interface FlaggingResult {
  flagsCreated: number;
  sessionsAffected: number;
  flagType: string;
  recommendation: string;
}

async function calculateBaselineOverstayRate(
  siteId: number,
  referenceDate: Date,
  windowDays: number = 28
): Promise<{ rate: number; sampleSize: number }> {
  const dayOfWeek = referenceDate.getDay();
  const hour = referenceDate.getHours();
  
  const comparableRates: number[] = [];
  let totalSampleSize = 0;
  
  for (let weeksBack = 1; weeksBack <= Math.ceil(windowDays / 7); weeksBack++) {
    const targetDate = new Date(referenceDate);
    targetDate.setDate(targetDate.getDate() - (weeksBack * 7));
    
    const windowStart = new Date(targetDate);
    windowStart.setHours(hour, 0, 0, 0);
    const windowEnd = new Date(targetDate);
    windowEnd.setHours(hour + 2, 0, 0, 0);
    
    try {
      const sessions = await storage.getSessionsBySite(siteId, windowStart, windowEnd);
      if (sessions && sessions.length >= 5) {
        const overstays = sessions.filter(s => {
          const duration = typeof s.durationMinutes === "number" ? s.durationMinutes : 0;
          return duration > 120;
        });
        const rate = overstays.length / sessions.length;
        comparableRates.push(rate);
        totalSampleSize += sessions.length;
      }
    } catch (e) {
      console.warn(`[Baseline] Could not fetch data for ${targetDate.toISOString()}:`, e);
    }
  }
  
  if (comparableRates.length === 0) {
    return { rate: 0.15, sampleSize: 0 };
  }
  
  const avgRate = comparableRates.reduce((a, b) => a + b, 0) / comparableRates.length;
  return { rate: avgRate, sampleSize: totalSampleSize };
}

function determineFlagType(
  weather: WeatherSummary | null,
  events: LocalEventsSummary | null,
  inventoryHits: SiteInventoryHit[]
): { flagType: string; severity: string; reasons: string[] } {
  const reasons: string[] = [];
  let severity = "medium";
  let flagType = "POSSIBLE_DISRUPTION";
  
  const hasBadWeather = weather && 
    ["Rain", "Snow", "Storm", "Fog"].some(c => weather.conditions.includes(c));
  const hasWeatherAlerts = weather?.alerts && weather.alerts.length > 0;
  
  if (hasBadWeather || hasWeatherAlerts) {
    flagType = "WEATHER_DISRUPTION";
    severity = hasWeatherAlerts ? "high" : "medium";
    reasons.push(`Weather: ${weather?.conditions}`);
    if (hasWeatherAlerts) {
      reasons.push(...weather!.alerts!.map(a => `Alert: ${a}`));
    }
  }
  
  const hasEvents = events?.events && events.events.length > 0;
  if (hasEvents) {
    const largeEvent = events!.events.find(e => (e.expectedAttendance || 0) > 1000);
    if (largeEvent) {
      flagType = "EVENT_DISRUPTION";
      severity = "high";
      reasons.push(`Large event: ${largeEvent.name} (${largeEvent.expectedAttendance} expected)`);
    } else {
      if (flagType === "POSSIBLE_DISRUPTION") flagType = "EVENT_DISRUPTION";
      reasons.push(...events!.events.map(e => `Event: ${e.name}`));
    }
  }
  
  const hasConstructionNote = inventoryHits.some(h =>
    h.matchedTags.includes("construction") || h.relevantNotes.some(n => n.toLowerCase().includes("construction"))
  );
  if (hasConstructionNote) {
    reasons.push("Construction activity noted");
  }
  
  const hasClosureNote = inventoryHits.some(h =>
    h.matchedTags.includes("closure") || h.relevantNotes.some(n => n.toLowerCase().includes("closed"))
  );
  if (hasClosureNote) {
    reasons.push("Partial closure noted");
  }
  
  if (reasons.length === 0) {
    reasons.push("Unexplained overstay spike detected");
  }
  
  return { flagType, severity, reasons };
}

function determineRecommendation(
  rules: SiteRule | null,
  flagType: string,
  weather: WeatherSummary | null,
  events: LocalEventsSummary | null
): string {
  if (!rules) {
    return "REVIEW_REQUIRED";
  }
  
  const policy = rules.spikeOverridePolicy || "hold_on_disruption";
  
  if (policy === "always_enforce") {
    return "REVIEW_REQUIRED";
  }
  
  if (policy === "review_required") {
    return "REVIEW_REQUIRED";
  }
  
  if (flagType === "WEATHER_DISRUPTION" && rules.enforceOnWeather) {
    return "REVIEW_REQUIRED";
  }
  
  if (flagType === "EVENT_DISRUPTION" && rules.enforceOnEvents) {
    return "REVIEW_REQUIRED";
  }
  
  return "HOLD_PCN";
}

async function createSessionFlags(
  siteId: number,
  windowStart: Date,
  windowEnd: Date,
  enrichmentRunId: number,
  results: EnrichmentResults,
  rules: SiteRule | null
): Promise<FlaggingResult> {
  if (!results.anomalySummary.isSpike) {
    return { flagsCreated: 0, sessionsAffected: 0, flagType: "NONE", recommendation: "N/A" };
  }
  
  const { flagType, severity, reasons } = determineFlagType(
    results.weatherSummary,
    results.localEventsSummary,
    results.siteInventoryHits
  );
  
  const recommendation = determineRecommendation(
    rules,
    flagType,
    results.weatherSummary,
    results.localEventsSummary
  );
  
  try {
    const sessions = await storage.getSessionsBySite(siteId, windowStart, windowEnd);
    const overstaySessions = sessions.filter(s => {
      const duration = typeof s.durationMinutes === "number" ? s.durationMinutes : 0;
      return duration > 120;
    });
    
    if (overstaySessions.length === 0) {
      return { flagsCreated: 0, sessionsAffected: 0, flagType, recommendation };
    }
    
    const flags: InsertSessionFlag[] = overstaySessions.map(session => ({
      sessionId: session.id,
      siteId,
      enrichmentRunId,
      flagType,
      severity,
      reason: reasons.join("; "),
      recommendation,
      evidence: {
        weatherConditions: results.weatherSummary?.conditions,
        weatherAlerts: results.weatherSummary?.alerts,
        localEvents: results.localEventsSummary?.events.map(e => ({
          name: e.name,
          type: e.type,
          distance: e.distance,
        })),
        overstayRate: results.anomalySummary.overstayRate,
        baselineRate: results.anomalySummary.baselineOverstayRate,
        spikeMultiplier: results.anomalySummary.spikeMultiplier,
        siteInventoryHits: results.siteInventoryHits.flatMap(h => h.matchedTags),
      },
      status: "OPEN",
    }));
    
    const createdFlags = await storage.createSessionFlags(flags);
    
    console.log(`[Flagging] Created ${createdFlags.length} flags for site ${siteId}, recommendation: ${recommendation}`);
    
    return {
      flagsCreated: createdFlags.length,
      sessionsAffected: overstaySessions.length,
      flagType,
      recommendation,
    };
  } catch (e) {
    console.error("[Flagging] Error creating session flags:", e);
    return { flagsCreated: 0, sessionsAffected: 0, flagType, recommendation };
  }
}

export interface EnrichmentResultsWithFlagging extends EnrichmentResults {
  flaggingResult?: FlaggingResult;
}

export async function runEnrichment(
  siteId: number,
  windowStart: Date,
  windowEnd: Date,
  userId?: string,
  options?: EnrichmentOptions,
  enrichmentRunId?: number
): Promise<EnrichmentResultsWithFlagging> {
  console.log(`[Enrichment] Starting enrichment for site ${siteId} from ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);
  
  const site = await storage.getParkingSite(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }
  
  const rules = await storage.getSiteRules(siteId);
  
  const activeWeatherProvider = options?.weatherProvider || weatherProvider;
  const activeEventsProvider = options?.eventsProvider || eventsProvider;
  
  const lat = 52.4862;
  const lon = -1.8904;
  
  const midpoint = new Date((windowStart.getTime() + windowEnd.getTime()) / 2);
  
  const [weatherSummary, localEventsSummary, siteInventoryHits] = await Promise.all([
    activeWeatherProvider.getWeather(lat, lon, midpoint).catch(e => {
      console.error("[Enrichment] Weather provider error:", e);
      return null;
    }),
    activeEventsProvider.getEvents(lat, lon, windowStart, windowEnd).catch(e => {
      console.error("[Enrichment] Events provider error:", e);
      return null;
    }),
    getSiteInventoryHits(siteId, windowStart, windowEnd),
  ]);
  
  const anomalySummary = await getAnomalySummary(siteId, windowStart, windowEnd, rules);
  
  console.log(`[Enrichment] Completed enrichment for site ${siteId}`);
  console.log(`  - Weather: ${weatherSummary?.conditions || "N/A"}`);
  console.log(`  - Events: ${localEventsSummary?.events.length || 0} events found`);
  console.log(`  - Inventory hits: ${siteInventoryHits.length} sources`);
  console.log(`  - Anomaly: ${anomalySummary.overstayCount}/${anomalySummary.totalSessions} overstays (${(anomalySummary.overstayRate * 100).toFixed(1)}%)`);
  console.log(`  - Spike detected: ${anomalySummary.isSpike}`);
  
  const results: EnrichmentResults = {
    weatherSummary,
    localEventsSummary,
    siteInventoryHits,
    anomalySummary,
  };
  
  let flaggingResult: FlaggingResult | undefined;
  
  if (!options?.skipFlagging && enrichmentRunId && anomalySummary.isSpike) {
    flaggingResult = await createSessionFlags(
      siteId,
      windowStart,
      windowEnd,
      enrichmentRunId,
      results,
      rules
    );
    console.log(`[Enrichment] Flagging result: ${flaggingResult.flagsCreated} flags created, recommendation: ${flaggingResult.recommendation}`);
  }
  
  return {
    ...results,
    flaggingResult,
  };
}
