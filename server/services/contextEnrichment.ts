import { db } from "../db";
import { enrichmentRuns, siteNotes, siteSurroundings, parkingSessions, sitePolicies, siteRules } from "@shared/schema";
import { eq, and, gte, lte, sql, isNotNull } from "drizzle-orm";
import type { EnrichmentRun, InsertEnrichmentRun, ParkingSession } from "@shared/schema";

interface SessionWithOverstay extends ParkingSession {
  isOverstay: boolean;
  overstayMinutes: number;
}

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
  category: string;
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

export interface InventoryHit {
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

export interface EnrichmentResult {
  weatherSummary: WeatherSummary | null;
  localEventsSummary: LocalEventsSummary | null;
  siteInventoryHits: InventoryHit[];
  anomalySummary: AnomalySummary;
}

export interface WeatherProvider {
  getSummary(siteId: number, from: Date, to: Date): Promise<WeatherSummary | null>;
}

export interface EventProvider {
  getEvents(siteId: number, from: Date, to: Date): Promise<LocalEventsSummary | null>;
}

export interface InventoryProvider {
  getNotes(siteId: number): Promise<InventoryHit[]>;
}

export class MockWeatherProvider implements WeatherProvider {
  private scenarios: WeatherSummary[] = [
    {
      provider: "MockWeatherProvider",
      conditions: "clear",
      temperature: 18,
      precipitation: "none",
      windSpeed: "light",
      alerts: [],
    },
    {
      provider: "MockWeatherProvider",
      conditions: "heavy_rain",
      temperature: 12,
      precipitation: "heavy",
      windSpeed: "moderate",
      alerts: ["WEATHER_WARNING: Heavy rain expected"],
    },
    {
      provider: "MockWeatherProvider",
      conditions: "snow",
      temperature: -2,
      precipitation: "snow",
      windSpeed: "moderate",
      alerts: ["WEATHER_WARNING: Snow and ice on roads", "ROAD_HAZARD: Reduced visibility"],
    },
    {
      provider: "MockWeatherProvider",
      conditions: "fog",
      temperature: 8,
      precipitation: "none",
      windSpeed: "calm",
      alerts: ["WEATHER_WARNING: Dense fog advisory"],
    },
  ];

  async getSummary(siteId: number, from: Date, to: Date): Promise<WeatherSummary | null> {
    const dayOfWeek = from.getDay();
    const hour = from.getHours();
    
    if (hour >= 6 && hour <= 9 && (dayOfWeek === 0 || dayOfWeek === 6)) {
      return this.scenarios[2];
    }
    if (hour >= 16 && hour <= 19) {
      return this.scenarios[1];
    }
    if (hour >= 5 && hour <= 8) {
      return this.scenarios[3];
    }
    
    return this.scenarios[0];
  }
}

export class MockEventProvider implements EventProvider {
  private eventTemplates: LocalEvent[] = [
    {
      name: "Premier League Match",
      type: "sports",
      category: "SPORTS_MATCH",
      startTime: "15:00",
      endTime: "17:30",
      expectedAttendance: 35000,
      distance: "0.5km",
    },
    {
      name: "Concert at Arena",
      type: "entertainment",
      category: "LARGE_EVENT",
      startTime: "19:00",
      endTime: "23:00",
      expectedAttendance: 15000,
      distance: "1km",
    },
    {
      name: "Road Works A1",
      type: "infrastructure",
      category: "ROAD_CLOSURE",
      startTime: "00:00",
      endTime: "23:59",
      distance: "0.2km",
    },
    {
      name: "Local Market Day",
      type: "community",
      category: "LOCAL_EVENT",
      startTime: "09:00",
      endTime: "16:00",
      expectedAttendance: 500,
      distance: "0.3km",
    },
    {
      name: "University Open Day",
      type: "education",
      category: "EDUCATION_EVENT",
      startTime: "10:00",
      endTime: "15:00",
      expectedAttendance: 2000,
      distance: "0.8km",
    },
  ];

  async getEvents(siteId: number, from: Date, to: Date): Promise<LocalEventsSummary | null> {
    const dayOfWeek = from.getDay();
    const hour = from.getHours();
    const events: LocalEvent[] = [];

    if (dayOfWeek === 6 && hour >= 12 && hour <= 18) {
      events.push({
        ...this.eventTemplates[0],
        startTime: from.toISOString(),
        endTime: new Date(from.getTime() + 2.5 * 60 * 60 * 1000).toISOString(),
      });
    }

    if (dayOfWeek === 5 && hour >= 18) {
      events.push({
        ...this.eventTemplates[1],
        startTime: from.toISOString(),
        endTime: new Date(from.getTime() + 4 * 60 * 60 * 1000).toISOString(),
      });
    }

    if (dayOfWeek === 1 || dayOfWeek === 2) {
      events.push(this.eventTemplates[2]);
    }

    if (dayOfWeek === 0 && hour >= 8 && hour <= 17) {
      events.push(this.eventTemplates[3]);
    }

    if (dayOfWeek === 3 && hour >= 9 && hour <= 16) {
      events.push(this.eventTemplates[4]);
    }

    return {
      provider: "MockEventProvider",
      events,
      rawData: { queriedAt: new Date().toISOString() },
    };
  }
}

export class MockInventoryProvider implements InventoryProvider {
  async getNotes(siteId: number): Promise<InventoryHit[]> {
    const hits: InventoryHit[] = [];

    const notes = await db.select().from(siteNotes)
      .where(and(eq(siteNotes.siteId, siteId), eq(siteNotes.isActive, true)));

    if (notes.length > 0) {
      const relevantNotes = notes.map(n => n.content);
      const matchedTags = notes.flatMap(n => n.tags || []);
      
      hits.push({
        source: "site_notes",
        matchedTags: Array.from(new Set(matchedTags)),
        relevantNotes,
        ruleMatches: [],
      });
    }

    const surroundings = await db.select().from(siteSurroundings)
      .where(eq(siteSurroundings.siteId, siteId));

    if (surroundings.length > 0 && surroundings[0].nearbyPlaces) {
      const places = surroundings[0].nearbyPlaces;
      const placeTypes: string[] = [];
      
      if (places.shops?.length) placeTypes.push("retail_nearby");
      if (places.offices?.length) placeTypes.push("business_district");
      if (places.venues?.length) placeTypes.push("event_venue_nearby");

      if (placeTypes.length > 0) {
        hits.push({
          source: "site_surroundings",
          matchedTags: placeTypes,
          relevantNotes: [],
          ruleMatches: placeTypes.includes("event_venue_nearby") 
            ? ["May experience surge during events"] 
            : [],
        });
      }
    }

    return hits;
  }
}

export class ContextEnrichmentService {
  private weatherProvider: WeatherProvider;
  private eventProvider: EventProvider;
  private inventoryProvider: InventoryProvider;

  constructor(
    weatherProvider?: WeatherProvider,
    eventProvider?: EventProvider,
    inventoryProvider?: InventoryProvider
  ) {
    this.weatherProvider = weatherProvider || new MockWeatherProvider();
    this.eventProvider = eventProvider || new MockEventProvider();
    this.inventoryProvider = inventoryProvider || new MockInventoryProvider();
  }

  async runContextEnrichment(
    siteId: number,
    windowStart: Date,
    windowEnd: Date,
    createdBy?: string
  ): Promise<EnrichmentRun> {
    const [weatherSummary, localEventsSummary, siteInventoryHits] = await Promise.all([
      this.weatherProvider.getSummary(siteId, windowStart, windowEnd),
      this.eventProvider.getEvents(siteId, windowStart, windowEnd),
      this.inventoryProvider.getNotes(siteId),
    ]);

    const anomalySummary = await this.calculateAnomalySummary(siteId, windowStart, windowEnd);

    const results: EnrichmentResult = {
      weatherSummary,
      localEventsSummary,
      siteInventoryHits,
      anomalySummary,
    };

    const insertData: InsertEnrichmentRun = {
      siteId,
      windowStart,
      windowEnd,
      createdBy,
      status: "completed",
      results,
    };

    const [run] = await db.insert(enrichmentRuns).values(insertData).returning();
    
    return run;
  }

  private async calculateAnomalySummary(
    siteId: number,
    windowStart: Date,
    windowEnd: Date
  ): Promise<AnomalySummary> {
    const sessions = await db.select().from(parkingSessions)
      .where(and(
        eq(parkingSessions.siteId, siteId),
        isNotNull(parkingSessions.entryAt),
        gte(parkingSessions.entryAt, windowStart),
        lte(parkingSessions.entryAt, windowEnd)
      ));

    const [rule] = await db.select().from(siteRules)
      .where(eq(siteRules.siteId, siteId))
      .limit(1);
    
    const maxStayMinutes = rule?.maxStayMinutes || 120;

    const sessionsWithOverstay: SessionWithOverstay[] = sessions.map(s => ({
      ...s,
      isOverstay: (s.durationMinutes || 0) > maxStayMinutes,
      overstayMinutes: Math.max(0, (s.durationMinutes || 0) - maxStayMinutes),
    }));

    const totalSessions = sessionsWithOverstay.length;
    const overstays = sessionsWithOverstay.filter(s => s.isOverstay);
    const overstayCount = overstays.length;
    const overstayRate = totalSessions > 0 ? overstayCount / totalSessions : 0;

    const avgOverstay = overstays.length > 0
      ? overstays.reduce((sum, s) => sum + s.overstayMinutes, 0) / overstays.length
      : 0;

    const hourCounts: Record<number, number> = {};
    overstays.forEach(s => {
      if (s.entryAt) {
        const hour = new Date(s.entryAt).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
    });
    
    const peakHour = Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)[0];

    const baselineData = await this.getBaselineRate(siteId, windowStart, maxStayMinutes);
    const isSpike = baselineData.baselineRate > 0 && 
      overstayRate > baselineData.baselineRate * baselineData.threshold;
    
    const spikeMultiplier = baselineData.baselineRate > 0 
      ? overstayRate / baselineData.baselineRate 
      : undefined;

    return {
      totalSessions,
      overstayCount,
      overstayRate: Math.round(overstayRate * 100) / 100,
      averageOverstayMinutes: Math.round(avgOverstay),
      peakOverstayHour: peakHour ? parseInt(peakHour[0]) : undefined,
      isSpike,
      spikeMultiplier: spikeMultiplier ? Math.round(spikeMultiplier * 100) / 100 : undefined,
      baselineOverstayRate: baselineData.baselineRate,
    };
  }

  private async getBaselineRate(
    siteId: number,
    referenceDate: Date,
    maxStayMinutes: number
  ): Promise<{ baselineRate: number; threshold: number }> {
    const dayOfWeek = referenceDate.getDay();
    const hour = referenceDate.getHours();

    const lookbackDays = 28;
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
      return { baselineRate: 0, threshold: 1.5 };
    }

    const overstays = matchingSessions.filter(s => (s.durationMinutes || 0) > maxStayMinutes);
    const baselineRate = overstays.length / matchingSessions.length;

    const [rule] = await db.select().from(siteRules)
      .where(eq(siteRules.siteId, siteId))
      .limit(1);

    const threshold = rule?.spikeThresholdMultiplier || 1.5;

    return { 
      baselineRate: Math.round(baselineRate * 100) / 100, 
      threshold 
    };
  }

  async getEnrichmentRun(id: number): Promise<EnrichmentRun | null> {
    const [run] = await db.select().from(enrichmentRuns)
      .where(eq(enrichmentRuns.id, id));
    return run || null;
  }

  async getEnrichmentRunsBySite(
    siteId: number,
    limit: number = 10
  ): Promise<EnrichmentRun[]> {
    return db.select().from(enrichmentRuns)
      .where(eq(enrichmentRuns.siteId, siteId))
      .orderBy(sql`${enrichmentRuns.createdAt} DESC`)
      .limit(limit);
  }
}

export const contextEnrichmentService = new ContextEnrichmentService();
