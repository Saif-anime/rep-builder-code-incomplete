import { storage } from "./storage";
import type { ParkingSession, SiteNote } from "@shared/schema";

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
    const validNotes = notes.filter((n: SiteNote) => {
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
      
      if (surroundings.freeTextSummary) {
        descriptions.push(surroundings.freeTextSummary);
        const lowerSummary = surroundings.freeTextSummary.toLowerCase();
        if (lowerSummary.includes("school")) tags.push("school_nearby");
        if (lowerSummary.includes("hospital")) tags.push("hospital_nearby");
        if (lowerSummary.includes("station")) tags.push("transport_hub");
      }
      
      if (surroundings.nearbyPlaces) {
        const places = surroundings.nearbyPlaces;
        if (places.shops && places.shops.length > 0) {
          tags.push("shops_nearby");
          places.shops.forEach(s => descriptions.push(`Shop: ${s.name}`));
        }
        if (places.offices && places.offices.length > 0) {
          tags.push("offices_nearby");
          places.offices.forEach(o => descriptions.push(`Office: ${o.name}`));
        }
        if (places.venues && places.venues.length > 0) {
          tags.push("venues_nearby");
          places.venues.forEach(v => descriptions.push(`Venue: ${v.name}`));
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
  windowEnd: Date
): Promise<AnomalySummary> {
  try {
    const sessions = await storage.getSessionsBySite(siteId, windowStart, windowEnd);
    
    const windowSessions = sessions.filter((s: ParkingSession) => {
      const entryTime = s.entryAt ? new Date(s.entryAt) : null;
      if (!entryTime) return false;
      return entryTime >= windowStart && entryTime <= windowEnd;
    });
    
    const totalSessions = windowSessions.length;
    let overstayCount = 0;
    let totalOverstayMinutes = 0;
    const hourCounts: Record<number, number> = {};
    
    const baselineOverstayRate = 0.15;
    
    for (const session of windowSessions) {
      if (session.durationMinutes && session.durationMinutes > 120) {
        overstayCount++;
        totalOverstayMinutes += session.durationMinutes - 120;
        
        if (session.entryAt) {
          const hour = new Date(session.entryAt).getHours();
          hourCounts[hour] = (hourCounts[hour] || 0) + 1;
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
    
    const isSpike = overstayRate > baselineOverstayRate * 1.5;
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

export async function runEnrichment(
  siteId: number,
  windowStart: Date,
  windowEnd: Date,
  userId?: string
): Promise<EnrichmentResults> {
  console.log(`[Enrichment] Starting enrichment for site ${siteId} from ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);
  
  const site = await storage.getParkingSite(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }
  
  const lat = 52.4862;
  const lon = -1.8904;
  
  const midpoint = new Date((windowStart.getTime() + windowEnd.getTime()) / 2);
  
  const [weatherSummary, localEventsSummary, siteInventoryHits, anomalySummary] = await Promise.all([
    weatherProvider.getWeather(lat, lon, midpoint).catch(e => {
      console.error("[Enrichment] Weather provider error:", e);
      return null;
    }),
    eventsProvider.getEvents(lat, lon, windowStart, windowEnd).catch(e => {
      console.error("[Enrichment] Events provider error:", e);
      return null;
    }),
    getSiteInventoryHits(siteId, windowStart, windowEnd),
    getAnomalySummary(siteId, windowStart, windowEnd),
  ]);
  
  console.log(`[Enrichment] Completed enrichment for site ${siteId}`);
  console.log(`  - Weather: ${weatherSummary?.conditions || "N/A"}`);
  console.log(`  - Events: ${localEventsSummary?.events.length || 0} events found`);
  console.log(`  - Inventory hits: ${siteInventoryHits.length} sources`);
  console.log(`  - Anomaly: ${anomalySummary.overstayCount}/${anomalySummary.totalSessions} overstays (${(anomalySummary.overstayRate * 100).toFixed(1)}%)`);
  
  return {
    weatherSummary,
    localEventsSummary,
    siteInventoryHits,
    anomalySummary,
  };
}
