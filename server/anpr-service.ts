import { storage } from "./storage";
import type { AnprEvent, InsertAnprEvent, ParkingSession, InsertParkingSession } from "@shared/schema";

export interface PairingResult {
  event: AnprEvent;
  session?: ParkingSession;
  action: "created_session" | "closed_session" | "created_orphan" | "updated_orphan";
  orphanReason?: string;
}

export interface AnprServiceConfig {
  matchingWindowHours: number;
}

const DEFAULT_CONFIG: AnprServiceConfig = {
  matchingWindowHours: 24,
};

export class AnprService {
  private config: AnprServiceConfig;

  constructor(config: Partial<AnprServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async processEvent(eventData: InsertAnprEvent): Promise<PairingResult> {
    const normalizedVrm = eventData.vrm.toUpperCase().replace(/\s+/g, "");
    const event = await storage.createAnprEvent({
      ...eventData,
      vrm: normalizedVrm,
    });

    if (event.eventType === "ENTRY") {
      return this.handleEntry(event);
    } else {
      return this.handleExit(event);
    }
  }

  private async handleEntry(event: AnprEvent): Promise<PairingResult> {
    const existingOpenSession = await storage.getOpenSessionByVrmAndSite(event.vrm, event.siteId);

    if (existingOpenSession) {
      const orphanSession = await storage.createParkingSession({
        siteId: event.siteId,
        vrm: event.vrm,
        entryEventId: event.id,
        entryAt: event.occurredAt,
        status: "ORPHAN",
        derivedFrom: {
          orphanReason: "DOUBLE_ENTRY",
          matchingWindowHours: this.config.matchingWindowHours,
          pairedAt: new Date().toISOString(),
          notes: `Vehicle entered while already having an open session (session #${existingOpenSession.id})`,
        },
      });

      return {
        event,
        session: orphanSession,
        action: "created_orphan",
        orphanReason: "DOUBLE_ENTRY",
      };
    }

    const session = await storage.createParkingSession({
      siteId: event.siteId,
      vrm: event.vrm,
      entryEventId: event.id,
      entryAt: event.occurredAt,
      status: "OPEN",
      derivedFrom: {
        matchingWindowHours: this.config.matchingWindowHours,
        pairedAt: new Date().toISOString(),
      },
    });

    return {
      event,
      session,
      action: "created_session",
    };
  }

  private async handleExit(event: AnprEvent): Promise<PairingResult> {
    const matchingEntry = await storage.getUnmatchedEntryForExit(
      event.vrm,
      event.siteId,
      event.occurredAt,
      this.config.matchingWindowHours
    );

    if (!matchingEntry) {
      const orphanSession = await storage.createParkingSession({
        siteId: event.siteId,
        vrm: event.vrm,
        exitEventId: event.id,
        exitAt: event.occurredAt,
        status: "ORPHAN",
        derivedFrom: {
          orphanReason: "MISSING_ENTRY",
          matchingWindowHours: this.config.matchingWindowHours,
          pairedAt: new Date().toISOString(),
          notes: `No matching entry found within ${this.config.matchingWindowHours}h window`,
        },
      });

      return {
        event,
        session: orphanSession,
        action: "created_orphan",
        orphanReason: "MISSING_ENTRY",
      };
    }

    const openSession = await storage.getOpenSessionByVrmAndSite(event.vrm, event.siteId);

    if (openSession && openSession.entryEventId === matchingEntry.id) {
      const entryTime = openSession.entryAt!;
      const exitTime = event.occurredAt;
      const durationMs = exitTime.getTime() - entryTime.getTime();
      const durationMinutes = Math.round(durationMs / (1000 * 60));

      const closedSession = await storage.updateParkingSession(openSession.id, {
        exitEventId: event.id,
        exitAt: exitTime,
        durationMinutes,
        status: "CLOSED",
        derivedFrom: {
          ...openSession.derivedFrom,
          pairedAt: new Date().toISOString(),
          notes: `Session closed after ${durationMinutes} minutes`,
        },
      });

      return {
        event,
        session: closedSession!,
        action: "closed_session",
      };
    }

    const entryTime = matchingEntry.occurredAt;
    const exitTime = event.occurredAt;
    const durationMs = exitTime.getTime() - entryTime.getTime();
    const durationMinutes = Math.round(durationMs / (1000 * 60));

    const closedSession = await storage.createParkingSession({
      siteId: event.siteId,
      vrm: event.vrm,
      entryEventId: matchingEntry.id,
      exitEventId: event.id,
      entryAt: entryTime,
      exitAt: exitTime,
      durationMinutes,
      status: "CLOSED",
      derivedFrom: {
        matchingWindowHours: this.config.matchingWindowHours,
        pairedAt: new Date().toISOString(),
        notes: `Paired exit with entry from ${entryTime.toISOString()}`,
      },
    });

    return {
      event,
      session: closedSession,
      action: "closed_session",
    };
  }

  async processBatchEvents(events: InsertAnprEvent[]): Promise<PairingResult[]> {
    const sortedEvents = [...events].sort((a, b) => {
      const timeA = new Date(a.occurredAt).getTime();
      const timeB = new Date(b.occurredAt).getTime();
      return timeA - timeB;
    });

    const results: PairingResult[] = [];
    for (const event of sortedEvents) {
      const result = await this.processEvent(event);
      results.push(result);
    }
    return results;
  }

  async getSessionsForSite(siteId: number, from?: Date, to?: Date): Promise<ParkingSession[]> {
    return storage.getSessionsBySite(siteId, from, to);
  }
}

export const anprService = new AnprService();
