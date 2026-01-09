import { storage } from "./storage";
import type { ParkingSession, SiteNote, InsertSessionFlag, SiteRule, SitePolicy } from "@shared/schema";

export interface WeatherSummary {
  provider: string;
  conditions: string;
  temperature?: number;
  precipitation?: string;
  windSpeed?: string;
  alerts?: string[];
  rawData?: any;
}

export type EventCategory = 
  | "SPORTS_MATCH"
  | "CONCERT"
  | "FESTIVAL"
  | "MARKET"
  | "PARADE"
  | "CONFERENCE"
  | "ROAD_CLOSURE"
  | "CONSTRUCTION"
  | "EMERGENCY"
  | "OTHER";

export interface LocalEvent {
  name: string;
  type: string;
  category: EventCategory;
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

const EVENT_TEMPLATES: Array<{ name: string; type: string; category: EventCategory }> = [
  { name: "Local Football Match", type: "Sports", category: "SPORTS_MATCH" },
  { name: "Premier League Game", type: "Sports", category: "SPORTS_MATCH" },
  { name: "Rugby Championship", type: "Sports", category: "SPORTS_MATCH" },
  { name: "Community Market Day", type: "Market", category: "MARKET" },
  { name: "Annual Festival", type: "Festival", category: "FESTIVAL" },
  { name: "Music Concert", type: "Concert", category: "CONCERT" },
  { name: "Christmas Parade", type: "Parade", category: "PARADE" },
  { name: "Business Conference", type: "Conference", category: "CONFERENCE" },
  { name: "Road Resurfacing", type: "Roadwork", category: "ROAD_CLOSURE" },
  { name: "Main Street Closure", type: "Roadwork", category: "ROAD_CLOSURE" },
  { name: "Emergency Road Repair", type: "Emergency", category: "EMERGENCY" },
  { name: "Construction Works", type: "Construction", category: "CONSTRUCTION" },
];

class MockEventsProvider implements EventsProvider {
  name = "mock";

  async getEvents(lat: number, lon: number, startDate: Date, endDate: Date): Promise<LocalEventsSummary | null> {
    const numEvents = Math.floor(Math.random() * 3);
    const events: LocalEvent[] = [];
    
    const shuffled = [...EVENT_TEMPLATES].sort(() => Math.random() - 0.5);
    
    for (let i = 0; i < numEvents && i < shuffled.length; i++) {
      const template = shuffled[i];
      events.push({
        name: template.name,
        type: template.type,
        category: template.category,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        expectedAttendance: template.category === "SPORTS_MATCH" ? 
          Math.floor(Math.random() * 30000) + 5000 : 
          Math.floor(Math.random() * 2000) + 100,
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

interface DecisionContext {
  flagType: string;
  severity: string;
  reasons: string[];
  eventCategories: EventCategory[];
  hasWeatherDisruption: boolean;
  hasRoadClosure: boolean;
  explanation: string;
}

function analyzeDisruptionContext(
  weather: WeatherSummary | null,
  events: LocalEventsSummary | null,
  inventoryHits: SiteInventoryHit[]
): DecisionContext {
  const reasons: string[] = [];
  let severity = "medium";
  let flagType = "POSSIBLE_DISRUPTION";
  const eventCategories: EventCategory[] = [];
  let hasWeatherDisruption = false;
  let hasRoadClosure = false;
  
  const hasBadWeather = weather && 
    ["Rain", "Snow", "Storm", "Fog"].some(c => weather.conditions.includes(c));
  const hasWeatherAlerts = weather?.alerts && weather.alerts.length > 0;
  
  if (hasBadWeather || hasWeatherAlerts) {
    flagType = "WEATHER_DISRUPTION";
    hasWeatherDisruption = true;
    severity = hasWeatherAlerts ? "high" : "medium";
    reasons.push(`Weather: ${weather?.conditions}`);
    if (hasWeatherAlerts) {
      reasons.push(...weather!.alerts!.map(a => `Alert: ${a}`));
    }
  }
  
  const hasEvents = events?.events && events.events.length > 0;
  if (hasEvents) {
    for (const event of events!.events) {
      eventCategories.push(event.category);
      
      if (event.category === "ROAD_CLOSURE" || event.category === "CONSTRUCTION") {
        hasRoadClosure = true;
        reasons.push(`Road disruption: ${event.name}`);
      } else if (event.category === "SPORTS_MATCH") {
        reasons.push(`Sports event: ${event.name} (${event.expectedAttendance || "unknown"} expected)`);
        if (flagType !== "WEATHER_DISRUPTION") {
          flagType = "PREDICTABLE_DEMAND";
        }
      } else {
        reasons.push(`Event: ${event.name} (${event.category})`);
        if (flagType === "POSSIBLE_DISRUPTION") {
          flagType = "EVENT_DISRUPTION";
        }
      }
      
      if ((event.expectedAttendance || 0) > 5000) {
        severity = "high";
      }
    }
  }
  
  const hasConstructionNote = inventoryHits.some(h =>
    h.matchedTags.includes("construction") || h.relevantNotes.some(n => n.toLowerCase().includes("construction"))
  );
  if (hasConstructionNote) {
    hasRoadClosure = true;
    reasons.push("Construction activity noted");
  }
  
  const hasClosureNote = inventoryHits.some(h =>
    h.matchedTags.includes("closure") || h.relevantNotes.some(n => n.toLowerCase().includes("closed"))
  );
  if (hasClosureNote) {
    hasRoadClosure = true;
    reasons.push("Partial closure noted");
  }
  
  if (reasons.length === 0) {
    reasons.push("Unexplained overstay spike detected");
  }
  
  const explanation = buildExplanation(flagType, reasons, hasWeatherDisruption, hasRoadClosure, eventCategories);
  
  return { flagType, severity, reasons, eventCategories, hasWeatherDisruption, hasRoadClosure, explanation };
}

function buildExplanation(
  flagType: string,
  reasons: string[],
  hasWeatherDisruption: boolean,
  hasRoadClosure: boolean,
  eventCategories: EventCategory[]
): string {
  const parts: string[] = [];
  
  if (hasWeatherDisruption) {
    parts.push("Adverse weather conditions detected which may have caused parking delays.");
  }
  
  if (hasRoadClosure) {
    parts.push("Road closures or construction activity may have restricted access.");
  }
  
  if (eventCategories.includes("SPORTS_MATCH")) {
    parts.push("A sports event was scheduled nearby, creating predictable high demand. This is expected and enforcement should proceed normally.");
  }
  
  if (eventCategories.includes("FESTIVAL") || eventCategories.includes("CONCERT")) {
    parts.push("A major entertainment event was scheduled, which may explain increased parking duration.");
  }
  
  if (parts.length === 0) {
    parts.push(`Overstay spike detected. Contributing factors: ${reasons.join("; ")}`);
  }
  
  return parts.join(" ");
}

function determineRecommendation(
  rules: SiteRule | null,
  policy: SitePolicy | null,
  context: DecisionContext
): { recommendation: string; decisionExplanation: string } {
  const { flagType, eventCategories, hasWeatherDisruption, hasRoadClosure, explanation } = context;
  
  const enforceCategories = policy?.eventCategoriesEnforce || [];
  const graceCategories = policy?.eventCategoriesGrace || ["ROAD_CLOSURE", "CONSTRUCTION", "EMERGENCY"];
  const weatherPolicy = policy?.weatherPolicy || "hold";
  const defaultEventPolicy = policy?.defaultEventPolicy || "hold";
  
  let recommendation = "REVIEW_REQUIRED";
  let decisionExplanation = explanation;
  
  if (hasWeatherDisruption) {
    if (weatherPolicy === "hold") {
      recommendation = "HOLD_PCN";
      decisionExplanation += " DECISION: Hold PCN due to weather conditions - this is a legitimate disruption.";
    } else if (weatherPolicy === "enforce") {
      recommendation = "PROCEED_PCN";
      decisionExplanation += " DECISION: Weather policy set to enforce - proceed with PCN issuance.";
    } else {
      recommendation = "REVIEW_REQUIRED";
      decisionExplanation += " DECISION: Manual review required for weather-related spike.";
    }
    return { recommendation, decisionExplanation };
  }
  
  if (hasRoadClosure) {
    recommendation = "HOLD_PCN";
    decisionExplanation += " DECISION: Hold PCN due to road closure/construction - this is a legitimate disruption.";
    return { recommendation, decisionExplanation };
  }
  
  const hasEnforceCategory = eventCategories.some(cat => 
    enforceCategories.includes(cat) || cat === "SPORTS_MATCH"
  );
  
  if (hasEnforceCategory) {
    recommendation = "PROCEED_PCN";
    const matchedCategory = eventCategories.find(cat => enforceCategories.includes(cat) || cat === "SPORTS_MATCH");
    decisionExplanation += ` DECISION: Proceed with PCN issuance - ${matchedCategory} is predictable demand, not a legitimate disruption. Enforcement should continue.`;
    return { recommendation, decisionExplanation };
  }
  
  const hasGraceCategory = eventCategories.some(cat => graceCategories.includes(cat));
  
  if (hasGraceCategory) {
    recommendation = "HOLD_PCN";
    decisionExplanation += " DECISION: Hold PCN - event category is configured for grace period.";
    return { recommendation, decisionExplanation };
  }
  
  if (defaultEventPolicy === "hold") {
    recommendation = "HOLD_PCN";
    decisionExplanation += " DECISION: Hold PCN - default event policy is to hold.";
  } else if (defaultEventPolicy === "enforce") {
    recommendation = "PROCEED_PCN";
    decisionExplanation += " DECISION: Proceed with PCN - default event policy is to enforce.";
  } else {
    recommendation = "REVIEW_REQUIRED";
    decisionExplanation += " DECISION: Manual review required per default policy.";
  }
  
  return { recommendation, decisionExplanation };
}

export interface FlaggingResultExtended extends FlaggingResult {
  decisionExplanation: string;
  eventCategories: EventCategory[];
}

async function createSessionFlags(
  siteId: number,
  windowStart: Date,
  windowEnd: Date,
  enrichmentRunId: number,
  results: EnrichmentResults,
  rules: SiteRule | null,
  policy: SitePolicy | null
): Promise<FlaggingResultExtended> {
  if (!results.anomalySummary.isSpike) {
    return { 
      flagsCreated: 0, 
      sessionsAffected: 0, 
      flagType: "NONE", 
      recommendation: "N/A",
      decisionExplanation: "No spike detected - normal enforcement applies.",
      eventCategories: [],
    };
  }
  
  const context = analyzeDisruptionContext(
    results.weatherSummary,
    results.localEventsSummary,
    results.siteInventoryHits
  );
  
  const { recommendation, decisionExplanation } = determineRecommendation(
    rules,
    policy,
    context
  );
  
  try {
    const sessions = await storage.getSessionsBySite(siteId, windowStart, windowEnd);
    const overstaySessions = sessions.filter(s => {
      const duration = typeof s.durationMinutes === "number" ? s.durationMinutes : 0;
      return duration > 120;
    });
    
    if (overstaySessions.length === 0) {
      return { 
        flagsCreated: 0, 
        sessionsAffected: 0, 
        flagType: context.flagType, 
        recommendation,
        decisionExplanation,
        eventCategories: context.eventCategories,
      };
    }
    
    const flags: InsertSessionFlag[] = overstaySessions.map(session => ({
      sessionId: session.id,
      siteId,
      enrichmentRunId,
      flagType: context.flagType,
      severity: context.severity,
      reason: `${context.reasons.join("; ")} | ${decisionExplanation}`,
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
      flagType: context.flagType,
      recommendation,
      decisionExplanation,
      eventCategories: context.eventCategories,
    };
  } catch (e) {
    console.error("[Flagging] Error creating session flags:", e);
    return { 
      flagsCreated: 0, 
      sessionsAffected: 0, 
      flagType: context.flagType, 
      recommendation,
      decisionExplanation,
      eventCategories: context.eventCategories,
    };
  }
}

export interface EnrichmentResultsWithFlagging extends EnrichmentResults {
  flaggingResult?: FlaggingResultExtended;
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
  
  const [rules, policy] = await Promise.all([
    storage.getSiteRules(siteId),
    storage.getSitePolicy(siteId),
  ]);
  
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
  
  const anomalySummary = await getAnomalySummary(siteId, windowStart, windowEnd, rules || null);
  
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
  
  let flaggingResult: FlaggingResultExtended | undefined;
  
  if (!options?.skipFlagging && enrichmentRunId && anomalySummary.isSpike) {
    flaggingResult = await createSessionFlags(
      siteId,
      windowStart,
      windowEnd,
      enrichmentRunId,
      results,
      rules || null,
      policy || null
    );
    console.log(`[Enrichment] Flagging result: ${flaggingResult.flagsCreated} flags created, recommendation: ${flaggingResult.recommendation}`);
    console.log(`[Enrichment] Decision: ${flaggingResult.decisionExplanation}`);
  }
  
  return {
    ...results,
    flaggingResult,
  };
}
