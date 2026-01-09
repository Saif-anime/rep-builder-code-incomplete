import {
  users, cameras, bays, evidence, detections, parkingEvents, numberPlates, auditLogs, sites, aiSettings,
  type User, type InsertUser, type Camera, type InsertCamera, type Bay, type InsertBay,
  type Evidence, type InsertEvidence, type Detection, type InsertDetection,
  type ParkingEvent, type InsertParkingEvent, type NumberPlate, type InsertNumberPlate,
  type AuditLog, type InsertAuditLog, type Site, type InsertSite, type AiSetting, type InsertAiSetting
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;
  getAllUsers(): Promise<User[]>;

  // Cameras
  getCamera(id: number): Promise<Camera | undefined>;
  getAllCameras(): Promise<Camera[]>;
  createCamera(camera: InsertCamera): Promise<Camera>;
  updateCamera(id: number, camera: Partial<InsertCamera>): Promise<Camera | undefined>;
  deleteCamera(id: number): Promise<void>;

  // Bays
  getBay(id: number): Promise<Bay | undefined>;
  getAllBays(): Promise<Bay[]>;
  createBay(bay: InsertBay): Promise<Bay>;
  updateBay(id: number, bay: Partial<InsertBay>): Promise<Bay | undefined>;
  deleteBay(id: number): Promise<void>;

  // Evidence
  getEvidence(id: number): Promise<Evidence | undefined>;
  getAllEvidence(type?: string, status?: string): Promise<Evidence[]>;
  createEvidence(evidence: InsertEvidence): Promise<Evidence>;
  updateEvidence(id: number, evidence: Partial<InsertEvidence>): Promise<Evidence | undefined>;
  deleteEvidence(id: number): Promise<void>;

  // Detections
  getDetection(id: number): Promise<Detection | undefined>;
  getDetectionsByEvidence(evidenceId: number): Promise<Detection[]>;
  createDetection(detection: InsertDetection): Promise<Detection>;

  // Parking Events
  getParkingEvent(id: number): Promise<ParkingEvent | undefined>;
  getAllParkingEvents(status?: string): Promise<ParkingEvent[]>;
  createParkingEvent(event: InsertParkingEvent): Promise<ParkingEvent>;
  updateParkingEvent(id: number, event: Partial<InsertParkingEvent> & { pcnIssuedAt?: Date }): Promise<ParkingEvent | undefined>;

  // Number Plates
  getNumberPlate(id: number): Promise<NumberPlate | undefined>;
  getAllNumberPlates(): Promise<NumberPlate[]>;
  createNumberPlate(plate: InsertNumberPlate): Promise<NumberPlate>;

  // Audit Logs
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getRecentAuditLogs(limit?: number): Promise<AuditLog[]>;

  // Sites
  getAllSites(): Promise<Site[]>;
  createSite(site: InsertSite): Promise<Site>;

  // AI Settings
  getAiSettings(): Promise<Record<string, unknown>>;
  updateAiSettings(settings: Record<string, unknown>): Promise<void>;

  // Dashboard Stats
  getDashboardStats(): Promise<{
    pendingReview: number;
    totalViolations: number;
    processedToday: number;
    activeCameras: number;
    totalSites: number;
    storageUsed: string;
    recentEvents: Array<{
      id: number;
      violationType: string;
      plateText: string;
      timestamp: string;
      confidence: number;
      status: string;
    }>;
    recentActivity: Array<{
      id: number;
      action: string;
      entityType: string;
      entityId: string;
      userName: string;
      timestamp: string;
      details?: string;
    }>;
  }>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, userData: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users).set(userData).where(eq(users.id, id)).returning();
    return user || undefined;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  // Cameras
  async getCamera(id: number): Promise<Camera | undefined> {
    const [camera] = await db.select().from(cameras).where(eq(cameras.id, id));
    return camera || undefined;
  }

  async getAllCameras(): Promise<Camera[]> {
    return db.select().from(cameras).orderBy(desc(cameras.createdAt));
  }

  async createCamera(insertCamera: InsertCamera): Promise<Camera> {
    const rtspUrl = `rtsp://${insertCamera.username}:${insertCamera.password}@${insertCamera.ipAddress}/Streaming/Channels/101`;
    const isapiUrl = `http://${insertCamera.ipAddress}/ISAPI/Streaming/channels/101/picture`;
    const [camera] = await db.insert(cameras).values({
      ...insertCamera,
      rtspUrl,
      isapiUrl,
    }).returning();
    return camera;
  }

  async updateCamera(id: number, cameraData: Partial<InsertCamera>): Promise<Camera | undefined> {
    const [camera] = await db.update(cameras).set(cameraData).where(eq(cameras.id, id)).returning();
    return camera || undefined;
  }

  async deleteCamera(id: number): Promise<void> {
    await db.delete(cameras).where(eq(cameras.id, id));
  }

  // Bays
  async getBay(id: number): Promise<Bay | undefined> {
    const [bay] = await db.select().from(bays).where(eq(bays.id, id));
    return bay || undefined;
  }

  async getAllBays(): Promise<Bay[]> {
    return db.select().from(bays).orderBy(bays.name);
  }

  async createBay(insertBay: InsertBay): Promise<Bay> {
    const [bay] = await db.insert(bays).values(insertBay).returning();
    return bay;
  }

  async updateBay(id: number, bayData: Partial<InsertBay>): Promise<Bay | undefined> {
    const [bay] = await db.update(bays).set(bayData).where(eq(bays.id, id)).returning();
    return bay || undefined;
  }

  async deleteBay(id: number): Promise<void> {
    await db.delete(bays).where(eq(bays.id, id));
  }

  // Evidence
  async getEvidence(id: number): Promise<Evidence | undefined> {
    const [ev] = await db.select().from(evidence).where(eq(evidence.id, id));
    return ev || undefined;
  }

  async getAllEvidence(type?: string, status?: string): Promise<Evidence[]> {
    const conditions = [];
    
    if (type && type !== "all") {
      conditions.push(eq(evidence.type, type));
    }
    if (status && status !== "all") {
      conditions.push(eq(evidence.status, status));
    }
    
    if (conditions.length > 0) {
      return db.select().from(evidence).where(and(...conditions)).orderBy(desc(evidence.createdAt));
    }
    return db.select().from(evidence).orderBy(desc(evidence.createdAt));
  }

  async createEvidence(insertEvidence: InsertEvidence): Promise<Evidence> {
    const [ev] = await db.insert(evidence).values(insertEvidence).returning();
    return ev;
  }

  async updateEvidence(id: number, evidenceData: Partial<InsertEvidence>): Promise<Evidence | undefined> {
    const [ev] = await db.update(evidence).set(evidenceData).where(eq(evidence.id, id)).returning();
    return ev || undefined;
  }

  async deleteEvidence(id: number): Promise<void> {
    await db.delete(evidence).where(eq(evidence.id, id));
  }

  // Detections
  async getDetection(id: number): Promise<Detection | undefined> {
    const [detection] = await db.select().from(detections).where(eq(detections.id, id));
    return detection || undefined;
  }

  async getDetectionsByEvidence(evidenceId: number): Promise<Detection[]> {
    return db.select().from(detections).where(eq(detections.evidenceId, evidenceId));
  }

  async createDetection(insertDetection: InsertDetection): Promise<Detection> {
    const [detection] = await db.insert(detections).values(insertDetection).returning();
    return detection;
  }

  // Parking Events
  async getParkingEvent(id: number): Promise<ParkingEvent | undefined> {
    const [event] = await db.select().from(parkingEvents).where(eq(parkingEvents.id, id));
    return event || undefined;
  }

  async getAllParkingEvents(status?: string): Promise<ParkingEvent[]> {
    if (status && status !== "all") {
      return db.select().from(parkingEvents).where(eq(parkingEvents.status, status)).orderBy(desc(parkingEvents.createdAt));
    }
    return db.select().from(parkingEvents).orderBy(desc(parkingEvents.createdAt));
  }

  async createParkingEvent(insertEvent: InsertParkingEvent): Promise<ParkingEvent> {
    const [event] = await db.insert(parkingEvents).values(insertEvent).returning();
    return event;
  }

  async updateParkingEvent(id: number, eventData: Partial<InsertParkingEvent> & { pcnIssuedAt?: Date }): Promise<ParkingEvent | undefined> {
    const [event] = await db.update(parkingEvents).set({
      ...eventData,
      updatedAt: new Date(),
    }).where(eq(parkingEvents.id, id)).returning();
    return event || undefined;
  }

  // Number Plates
  async getNumberPlate(id: number): Promise<NumberPlate | undefined> {
    const [plate] = await db.select().from(numberPlates).where(eq(numberPlates.id, id));
    return plate || undefined;
  }

  async getAllNumberPlates(): Promise<NumberPlate[]> {
    return db.select().from(numberPlates).orderBy(desc(numberPlates.createdAt));
  }

  async createNumberPlate(insertPlate: InsertNumberPlate): Promise<NumberPlate> {
    const [plate] = await db.insert(numberPlates).values(insertPlate).returning();
    return plate;
  }

  // Audit Logs
  async createAuditLog(insertLog: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(insertLog).returning();
    return log;
  }

  async getRecentAuditLogs(limit = 10): Promise<AuditLog[]> {
    return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  // Sites
  async getAllSites(): Promise<Site[]> {
    return db.select().from(sites).orderBy(sites.name);
  }

  async createSite(insertSite: InsertSite): Promise<Site> {
    const [site] = await db.insert(sites).values(insertSite).returning();
    return site;
  }

  // AI Settings
  async getAiSettings(): Promise<Record<string, unknown>> {
    const settings = await db.select().from(aiSettings);
    const result: Record<string, unknown> = {
      detectionThreshold: 0.7,
      anprThreshold: 0.8,
      autoAnalyze: true,
      autoPcn: false,
    };
    for (const s of settings) {
      result[s.settingKey] = s.settingValue;
    }
    return result;
  }

  async updateAiSettings(newSettings: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(newSettings)) {
      await db.insert(aiSettings)
        .values({ settingKey: key, settingValue: value })
        .onConflictDoUpdate({
          target: aiSettings.settingKey,
          set: { settingValue: value, updatedAt: new Date() },
        });
    }
  }

  // Dashboard Stats
  async getDashboardStats() {
    const [pendingCount] = await db.select({ count: sql<number>`count(*)` }).from(evidence).where(eq(evidence.status, "pending"));
    const [violationCount] = await db.select({ count: sql<number>`count(*)` }).from(parkingEvents).where(eq(parkingEvents.isViolation, true));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [processedCount] = await db.select({ count: sql<number>`count(*)` }).from(evidence).where(sql`${evidence.createdAt} >= ${today}`);
    const [activeCount] = await db.select({ count: sql<number>`count(*)` }).from(cameras).where(eq(cameras.status, "online"));
    const [siteCount] = await db.select({ count: sql<number>`count(*)` }).from(sites);

    const recentEvents = await db.select({
      id: parkingEvents.id,
      violationType: parkingEvents.violationType,
      timestamp: parkingEvents.createdAt,
      confidence: parkingEvents.aiConfidence,
      status: parkingEvents.status,
      numberPlateId: parkingEvents.numberPlateId,
    }).from(parkingEvents).orderBy(desc(parkingEvents.createdAt)).limit(5);

    const eventsWithPlates = await Promise.all(
      recentEvents.map(async (e) => {
        let plateText = "N/A";
        if (e.numberPlateId) {
          const plate = await this.getNumberPlate(e.numberPlateId);
          plateText = plate?.plateText || "N/A";
        }
        return {
          id: e.id,
          violationType: e.violationType || "unknown",
          plateText,
          timestamp: e.timestamp.toISOString(),
          confidence: e.confidence || 0,
          status: e.status,
        };
      })
    );

    const logs = await this.getRecentAuditLogs(6);
    const recentActivity = await Promise.all(
      logs.map(async (log) => {
        let userName = "System";
        if (log.userId) {
          const user = await this.getUser(log.userId);
          userName = user?.fullName || "Unknown";
        }
        return {
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId || "",
          userName,
          timestamp: log.createdAt.toISOString(),
          details: log.details ? JSON.stringify(log.details) : undefined,
        };
      })
    );

    return {
      pendingReview: Number(pendingCount?.count || 0),
      totalViolations: Number(violationCount?.count || 0),
      processedToday: Number(processedCount?.count || 0),
      activeCameras: Number(activeCount?.count || 0),
      totalSites: Number(siteCount?.count || 0),
      storageUsed: "1.2 GB",
      recentEvents: eventsWithPlates,
      recentActivity,
    };
  }
}

export const storage = new DatabaseStorage();
