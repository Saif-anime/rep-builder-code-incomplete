import {
  users, cameras, bays, evidence, detections, parkingEvents, numberPlates, auditLogs, sites, aiSettings, parkingSites,
  anprEvents, parkingSessions, siteRules, sitePolicies, siteNotes, siteSurroundings, signageInspections, signagePhotos, enrichmentRuns, sessionFlags, driverProfiles, pcnRecommendations,
  enforcementCases, caseEvidence, caseAnalysis, evidenceBundles, caseVehicles,
  caseAnalysisSteps, pcns, casePipelineResults,
  type User, type InsertUser, type Camera, type InsertCamera, type Bay, type InsertBay,
  type Evidence, type InsertEvidence, type Detection, type InsertDetection,
  type ParkingEvent, type InsertParkingEvent, type NumberPlate, type InsertNumberPlate,
  type AuditLog, type InsertAuditLog, type Site, type InsertSite, type AiSetting, type InsertAiSetting,
  type ParkingSite, type InsertParkingSite,
  type AnprEvent, type InsertAnprEvent, type ParkingSession, type InsertParkingSession,
  type SiteRule, type InsertSiteRule, type SitePolicy, type InsertSitePolicy, type SiteNote, type InsertSiteNote,
  type SiteSurroundings, type InsertSiteSurroundings,
  type SignageInspection, type InsertSignageInspection, type SignagePhoto, type InsertSignagePhoto,
  type EnrichmentRun, type InsertEnrichmentRun,
  type SessionFlag, type InsertSessionFlag,
  type DriverProfile, type InsertDriverProfile,
  type PcnRecommendation, type InsertPcnRecommendation,
  type EnforcementCase, type InsertEnforcementCase, type CaseEvidence, type InsertCaseEvidence, type CaseAnalysis, type InsertCaseAnalysis,
  type EvidenceBundle, type InsertEvidenceBundle,
  type CaseVehicle, type InsertCaseVehicle,
  type CaseAnalysisStep, type InsertCaseAnalysisStep,
  type Pcn, type InsertPcn,
  type CasePipelineResults, type InsertCasePipelineResults
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, gte, lte, isNull } from "drizzle-orm";

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

  // Sites (legacy)
  getAllSites(): Promise<Site[]>;
  createSite(site: InsertSite): Promise<Site>;

  // Parking Sites (new)
  getParkingSite(id: number): Promise<ParkingSite | undefined>;
  getAllParkingSites(): Promise<ParkingSite[]>;
  createParkingSite(site: InsertParkingSite): Promise<ParkingSite>;
  updateParkingSite(id: number, site: Partial<InsertParkingSite>): Promise<ParkingSite | undefined>;
  deleteParkingSite(id: number): Promise<void>;
  importParkingSites(sites: InsertParkingSite[]): Promise<ParkingSite[]>;

  // AI Settings
  getAiSettings(): Promise<Record<string, unknown>>;
  updateAiSettings(settings: Record<string, unknown>): Promise<void>;

  // ANPR Events
  createAnprEvent(event: InsertAnprEvent): Promise<AnprEvent>;
  getAnprEvent(id: number): Promise<AnprEvent | undefined>;
  getAnprEventsByVrmAndSite(vrm: string, siteId: number, from?: Date, to?: Date): Promise<AnprEvent[]>;
  getUnmatchedEntryForExit(vrm: string, siteId: number, exitTime: Date, windowHours: number): Promise<AnprEvent | undefined>;

  // Parking Sessions
  createParkingSession(session: InsertParkingSession): Promise<ParkingSession>;
  updateParkingSession(id: number, session: Partial<InsertParkingSession>): Promise<ParkingSession | undefined>;
  getParkingSession(id: number): Promise<ParkingSession | undefined>;
  getSessionsBySite(siteId: number, from?: Date, to?: Date): Promise<ParkingSession[]>;
  getOpenSessionByVrmAndSite(vrm: string, siteId: number): Promise<ParkingSession | undefined>;

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

  // Site Rules
  getSiteRules(siteId: number): Promise<SiteRule | undefined>;
  createSiteRules(rules: InsertSiteRule): Promise<SiteRule>;
  updateSiteRules(id: number, rules: Partial<InsertSiteRule>): Promise<SiteRule | undefined>;
  deleteSiteRules(id: number): Promise<void>;

  // Site Policies
  getSitePolicy(siteId: number): Promise<SitePolicy | undefined>;
  createSitePolicy(policy: InsertSitePolicy): Promise<SitePolicy>;
  updateSitePolicy(id: number, policy: Partial<InsertSitePolicy>): Promise<SitePolicy | undefined>;
  deleteSitePolicy(id: number): Promise<void>;

  // Site Notes
  getSiteNote(id: number): Promise<SiteNote | undefined>;
  getSiteNotes(siteId: number): Promise<SiteNote[]>;
  getSiteNotesValidAt(siteId: number, atTime: Date): Promise<SiteNote[]>;
  createSiteNote(note: InsertSiteNote): Promise<SiteNote>;
  updateSiteNote(id: number, note: Partial<InsertSiteNote>): Promise<SiteNote | undefined>;
  deleteSiteNote(id: number): Promise<void>;

  // Site Surroundings
  getSiteSurroundings(siteId: number): Promise<SiteSurroundings | undefined>;
  createSiteSurroundings(surroundings: InsertSiteSurroundings): Promise<SiteSurroundings>;
  updateSiteSurroundings(id: number, surroundings: Partial<InsertSiteSurroundings>): Promise<SiteSurroundings | undefined>;
  deleteSiteSurroundings(id: number): Promise<void>;

  // Compiled Site Context
  getSiteContext(siteId: number, atTime: Date): Promise<{
    site: ParkingSite | undefined;
    rules: SiteRule | undefined;
    notes: SiteNote[];
    surroundings: SiteSurroundings | undefined;
  }>;

  // Signage Inspections
  getSignageInspection(id: number): Promise<SignageInspection | undefined>;
  getSignageInspectionsBySite(siteId: number): Promise<SignageInspection[]>;
  getLatestSignageInspection(siteId: number): Promise<SignageInspection | undefined>;
  createSignageInspection(inspection: InsertSignageInspection): Promise<SignageInspection>;
  updateSignageInspection(id: number, inspection: Partial<InsertSignageInspection>): Promise<SignageInspection | undefined>;
  deleteSignageInspection(id: number): Promise<void>;
  submitSignageInspection(id: number): Promise<SignageInspection | undefined>;
  approveSignageInspection(id: number, approverId: string): Promise<SignageInspection | undefined>;
  rejectSignageInspection(id: number): Promise<SignageInspection | undefined>;

  // Signage Photos
  getSignagePhoto(id: number): Promise<SignagePhoto | undefined>;
  getSignagePhotosByInspection(inspectionId: number): Promise<SignagePhoto[]>;
  getSignagePhotosBySection(inspectionId: number, section: string): Promise<SignagePhoto[]>;
  createSignagePhoto(photo: InsertSignagePhoto): Promise<SignagePhoto>;
  deleteSignagePhoto(id: number): Promise<void>;

  // Enrichment Runs
  createEnrichmentRun(run: InsertEnrichmentRun): Promise<EnrichmentRun>;
  getEnrichmentRun(id: number): Promise<EnrichmentRun | undefined>;
  getEnrichmentRunsBySite(siteId: number): Promise<EnrichmentRun[]>;
  updateEnrichmentRun(id: number, run: Partial<InsertEnrichmentRun>): Promise<EnrichmentRun | undefined>;

  // Session Flags
  createSessionFlag(flag: InsertSessionFlag): Promise<SessionFlag>;
  createSessionFlags(flags: InsertSessionFlag[]): Promise<SessionFlag[]>;
  getSessionFlag(id: number): Promise<SessionFlag | undefined>;
  getSessionFlagsBySite(siteId: number, from?: Date, to?: Date): Promise<SessionFlag[]>;
  getSessionFlagsBySession(sessionId: number): Promise<SessionFlag[]>;
  updateSessionFlag(id: number, flag: Partial<InsertSessionFlag>): Promise<SessionFlag | undefined>;
  resolveSessionFlag(id: number, userId: string, notes?: string): Promise<SessionFlag | undefined>;
  dismissSessionFlag(id: number, userId: string, notes?: string): Promise<SessionFlag | undefined>;

  // PCN Recommendations
  createPcnRecommendation(recommendation: InsertPcnRecommendation): Promise<PcnRecommendation>;
  getPcnRecommendation(id: number): Promise<PcnRecommendation | undefined>;
  getPcnRecommendationsBySession(sessionId: number): Promise<PcnRecommendation[]>;
  getPcnRecommendationsByFlag(flagId: number): Promise<PcnRecommendation[]>;
  getLatestPcnRecommendationForSession(sessionId: number): Promise<PcnRecommendation | undefined>;

  // Driver Profiles
  getDriverProfile(siteId: number, vrm: string): Promise<DriverProfile | undefined>;
  getDriverProfilesBySite(siteId: number): Promise<DriverProfile[]>;
  createDriverProfile(profile: InsertDriverProfile): Promise<DriverProfile>;
  updateDriverProfile(id: number, profile: Partial<InsertDriverProfile>): Promise<DriverProfile | undefined>;
  upsertDriverProfile(profile: InsertDriverProfile): Promise<DriverProfile>;
  deleteDriverProfile(id: number): Promise<void>;
  getDriverSessionHistory(siteId: number, vrm: string, from?: Date, to?: Date): Promise<ParkingSession[]>;

  // Case Analysis Pipeline Steps
  createAnalysisStep(step: InsertCaseAnalysisStep): Promise<CaseAnalysisStep>;
  getAnalysisStepsByCase(caseId: string): Promise<CaseAnalysisStep[]>;
  updateAnalysisStep(id: number, update: Partial<CaseAnalysisStep>): Promise<CaseAnalysisStep | undefined>;
  deleteAnalysisStepsByCase(caseId: string): Promise<void>;

  // PCN Management
  createPcn(pcn: InsertPcn): Promise<Pcn>;
  getPcn(id: number): Promise<Pcn | undefined>;
  getPcnByNumber(pcnNumber: string): Promise<Pcn | undefined>;
  getPcnsByCase(caseId: string): Promise<Pcn[]>;
  getPcnsBySite(siteId: number, options?: { status?: string; limit?: number }): Promise<Pcn[]>;
  updatePcn(id: number, update: Partial<Pcn>): Promise<Pcn | undefined>;
  issuePcn(id: number, issuedBy: string): Promise<Pcn | undefined>;
  generatePcnNumber(siteId: number): Promise<string>;

  // Case Pipeline Results
  createCasePipelineResults(results: InsertCasePipelineResults): Promise<CasePipelineResults>;
  getCasePipelineResults(caseId: string): Promise<CasePipelineResults | undefined>;
  updateCasePipelineResults(caseId: string, update: Partial<CasePipelineResults>): Promise<CasePipelineResults | undefined>;
  getCompletedAnalysisBySite(siteId: number, options?: { action?: string; limit?: number }): Promise<Array<{
    caseId: string;
    caseReference: string;
    siteName: string;
    siteId: number;
    vrm: string | null;
    evidenceCount: number;
    analysisTimestamp: Date;
    pipelineResults: CasePipelineResults;
  }>>;
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

  // Parking Sites
  async getParkingSite(id: number): Promise<ParkingSite | undefined> {
    const [site] = await db.select().from(parkingSites).where(eq(parkingSites.id, id));
    return site || undefined;
  }

  async getAllParkingSites(): Promise<ParkingSite[]> {
    return db.select().from(parkingSites).orderBy(desc(parkingSites.createdAt));
  }

  async createParkingSite(insertSite: InsertParkingSite): Promise<ParkingSite> {
    const [site] = await db.insert(parkingSites).values(insertSite).returning();
    return site;
  }

  async updateParkingSite(id: number, siteData: Partial<InsertParkingSite>): Promise<ParkingSite | undefined> {
    const [site] = await db.update(parkingSites).set(siteData).where(eq(parkingSites.id, id)).returning();
    return site || undefined;
  }

  async deleteParkingSite(id: number): Promise<void> {
    await db.delete(parkingSites).where(eq(parkingSites.id, id));
  }

  async importParkingSites(sitesToImport: InsertParkingSite[]): Promise<ParkingSite[]> {
    if (sitesToImport.length === 0) return [];
    const imported = await db.insert(parkingSites).values(sitesToImport).returning();
    return imported;
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
    const [siteCount] = await db.select({ count: sql<number>`count(*)` }).from(parkingSites);

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

  // ANPR Events
  async createAnprEvent(event: InsertAnprEvent): Promise<AnprEvent> {
    const [created] = await db.insert(anprEvents).values(event).returning();
    return created;
  }

  async getAnprEvent(id: number): Promise<AnprEvent | undefined> {
    const [event] = await db.select().from(anprEvents).where(eq(anprEvents.id, id));
    return event || undefined;
  }

  async getAnprEventsByVrmAndSite(vrm: string, siteId: number, from?: Date, to?: Date): Promise<AnprEvent[]> {
    const conditions = [
      eq(anprEvents.vrm, vrm.toUpperCase()),
      eq(anprEvents.siteId, siteId),
    ];
    if (from) conditions.push(gte(anprEvents.occurredAt, from));
    if (to) conditions.push(lte(anprEvents.occurredAt, to));
    
    return db.select().from(anprEvents).where(and(...conditions)).orderBy(desc(anprEvents.occurredAt));
  }

  async getUnmatchedEntryForExit(vrm: string, siteId: number, exitTime: Date, windowHours: number): Promise<AnprEvent | undefined> {
    const windowStart = new Date(exitTime.getTime() - windowHours * 60 * 60 * 1000);
    const normalizedVrm = vrm.toUpperCase();
    
    const [entry] = await db
      .select()
      .from(anprEvents)
      .where(and(
        eq(anprEvents.vrm, normalizedVrm),
        eq(anprEvents.siteId, siteId),
        eq(anprEvents.eventType, "ENTRY"),
        gte(anprEvents.occurredAt, windowStart),
        lte(anprEvents.occurredAt, exitTime),
        sql`${anprEvents.id} NOT IN (
          SELECT entry_event_id FROM parking_sessions 
          WHERE entry_event_id IS NOT NULL 
          AND (status = 'CLOSED' OR exit_event_id IS NOT NULL)
          AND vrm = ${normalizedVrm} 
          AND site_id = ${siteId}
        )`
      ))
      .orderBy(desc(anprEvents.occurredAt))
      .limit(1);
    
    return entry || undefined;
  }

  // Parking Sessions
  async createParkingSession(session: InsertParkingSession): Promise<ParkingSession> {
    const [created] = await db.insert(parkingSessions).values(session).returning();
    return created;
  }

  async updateParkingSession(id: number, session: Partial<InsertParkingSession>): Promise<ParkingSession | undefined> {
    const [updated] = await db
      .update(parkingSessions)
      .set({ ...session, updatedAt: new Date() })
      .where(eq(parkingSessions.id, id))
      .returning();
    return updated || undefined;
  }

  async getParkingSession(id: number): Promise<ParkingSession | undefined> {
    const [session] = await db.select().from(parkingSessions).where(eq(parkingSessions.id, id));
    return session || undefined;
  }

  async getSessionsBySite(siteId: number, from?: Date, to?: Date): Promise<ParkingSession[]> {
    const conditions = [eq(parkingSessions.siteId, siteId)];
    if (from) {
      conditions.push(sql`(${parkingSessions.entryAt} >= ${from} OR ${parkingSessions.exitAt} >= ${from})`);
    }
    if (to) {
      conditions.push(sql`(${parkingSessions.entryAt} <= ${to} OR ${parkingSessions.exitAt} <= ${to})`);
    }
    
    return db.select().from(parkingSessions).where(and(...conditions)).orderBy(desc(parkingSessions.createdAt));
  }

  async getOpenSessionByVrmAndSite(vrm: string, siteId: number): Promise<ParkingSession | undefined> {
    const [session] = await db
      .select()
      .from(parkingSessions)
      .where(and(
        eq(parkingSessions.vrm, vrm.toUpperCase()),
        eq(parkingSessions.siteId, siteId),
        eq(parkingSessions.status, "OPEN")
      ))
      .orderBy(desc(parkingSessions.entryAt))
      .limit(1);
    return session || undefined;
  }

  // Site Rules
  async getSiteRules(siteId: number): Promise<SiteRule | undefined> {
    const [rules] = await db
      .select()
      .from(siteRules)
      .where(and(eq(siteRules.siteId, siteId), eq(siteRules.isActive, true)));
    return rules || undefined;
  }

  async createSiteRules(rules: InsertSiteRule): Promise<SiteRule> {
    const [created] = await db.insert(siteRules).values(rules).returning();
    return created;
  }

  async updateSiteRules(id: number, rules: Partial<InsertSiteRule>): Promise<SiteRule | undefined> {
    const [updated] = await db
      .update(siteRules)
      .set({ ...rules, updatedAt: new Date() })
      .where(eq(siteRules.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteSiteRules(id: number): Promise<void> {
    await db.delete(siteRules).where(eq(siteRules.id, id));
  }

  // Site Policies
  async getSitePolicy(siteId: number): Promise<SitePolicy | undefined> {
    const [policy] = await db
      .select()
      .from(sitePolicies)
      .where(and(eq(sitePolicies.siteId, siteId), eq(sitePolicies.isActive, true)));
    return policy || undefined;
  }

  async createSitePolicy(policy: InsertSitePolicy): Promise<SitePolicy> {
    const [created] = await db.insert(sitePolicies).values(policy).returning();
    return created;
  }

  async updateSitePolicy(id: number, policy: Partial<InsertSitePolicy>): Promise<SitePolicy | undefined> {
    const [updated] = await db
      .update(sitePolicies)
      .set({ ...policy, updatedAt: new Date() })
      .where(eq(sitePolicies.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteSitePolicy(id: number): Promise<void> {
    await db.delete(sitePolicies).where(eq(sitePolicies.id, id));
  }

  // Site Notes
  async getSiteNote(id: number): Promise<SiteNote | undefined> {
    const [note] = await db.select().from(siteNotes).where(eq(siteNotes.id, id));
    return note || undefined;
  }

  async getSiteNotes(siteId: number): Promise<SiteNote[]> {
    return db
      .select()
      .from(siteNotes)
      .where(and(eq(siteNotes.siteId, siteId), eq(siteNotes.isActive, true)))
      .orderBy(desc(siteNotes.createdAt));
  }

  async getSiteNotesValidAt(siteId: number, atTime: Date): Promise<SiteNote[]> {
    return db
      .select()
      .from(siteNotes)
      .where(and(
        eq(siteNotes.siteId, siteId),
        eq(siteNotes.isActive, true),
        lte(siteNotes.validFrom, atTime),
        sql`(${siteNotes.validTo} IS NULL OR ${siteNotes.validTo} >= ${atTime})`
      ))
      .orderBy(desc(siteNotes.createdAt));
  }

  async createSiteNote(note: InsertSiteNote): Promise<SiteNote> {
    const [created] = await db.insert(siteNotes).values(note).returning();
    return created;
  }

  async updateSiteNote(id: number, note: Partial<InsertSiteNote>): Promise<SiteNote | undefined> {
    const [updated] = await db
      .update(siteNotes)
      .set({ ...note, updatedAt: new Date() })
      .where(eq(siteNotes.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteSiteNote(id: number): Promise<void> {
    await db.delete(siteNotes).where(eq(siteNotes.id, id));
  }

  // Site Surroundings
  async getSiteSurroundings(siteId: number): Promise<SiteSurroundings | undefined> {
    const [surroundings] = await db
      .select()
      .from(siteSurroundings)
      .where(eq(siteSurroundings.siteId, siteId));
    return surroundings || undefined;
  }

  async createSiteSurroundings(surroundings: InsertSiteSurroundings): Promise<SiteSurroundings> {
    const [created] = await db.insert(siteSurroundings).values(surroundings).returning();
    return created;
  }

  async updateSiteSurroundings(id: number, surroundings: Partial<InsertSiteSurroundings>): Promise<SiteSurroundings | undefined> {
    const [updated] = await db
      .update(siteSurroundings)
      .set({ ...surroundings, updatedAt: new Date() })
      .where(eq(siteSurroundings.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteSiteSurroundings(id: number): Promise<void> {
    await db.delete(siteSurroundings).where(eq(siteSurroundings.id, id));
  }

  // Compiled Site Context
  async getSiteContext(siteId: number, atTime: Date): Promise<{
    site: ParkingSite | undefined;
    rules: SiteRule | undefined;
    notes: SiteNote[];
    surroundings: SiteSurroundings | undefined;
  }> {
    const [site, rules, notes, surroundings] = await Promise.all([
      this.getParkingSite(siteId),
      this.getSiteRules(siteId),
      this.getSiteNotesValidAt(siteId, atTime),
      this.getSiteSurroundings(siteId),
    ]);

    return { site, rules, notes, surroundings };
  }

  // Signage Inspections
  async getSignageInspection(id: number): Promise<SignageInspection | undefined> {
    const [inspection] = await db.select().from(signageInspections).where(eq(signageInspections.id, id));
    return inspection || undefined;
  }

  async getSignageInspectionsBySite(siteId: number): Promise<SignageInspection[]> {
    return db
      .select()
      .from(signageInspections)
      .where(eq(signageInspections.siteId, siteId))
      .orderBy(desc(signageInspections.inspectionDate));
  }

  async getLatestSignageInspection(siteId: number): Promise<SignageInspection | undefined> {
    const [inspection] = await db
      .select()
      .from(signageInspections)
      .where(and(
        eq(signageInspections.siteId, siteId),
        eq(signageInspections.status, "submitted")
      ))
      .orderBy(desc(signageInspections.inspectionDate))
      .limit(1);
    return inspection || undefined;
  }

  async createSignageInspection(inspection: InsertSignageInspection): Promise<SignageInspection> {
    const [created] = await db.insert(signageInspections).values(inspection).returning();
    return created;
  }

  async updateSignageInspection(id: number, inspection: Partial<InsertSignageInspection>): Promise<SignageInspection | undefined> {
    const [updated] = await db
      .update(signageInspections)
      .set({ ...inspection, updatedAt: new Date() })
      .where(eq(signageInspections.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteSignageInspection(id: number): Promise<void> {
    await db.delete(signageInspections).where(eq(signageInspections.id, id));
  }

  async submitSignageInspection(id: number): Promise<SignageInspection | undefined> {
    const [updated] = await db
      .update(signageInspections)
      .set({ 
        status: "submitted", 
        submittedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(signageInspections.id, id))
      .returning();
    return updated || undefined;
  }

  async approveSignageInspection(id: number, approverId: string): Promise<SignageInspection | undefined> {
    const [updated] = await db
      .update(signageInspections)
      .set({ 
        status: "approved", 
        approvedBy: approverId,
        approvedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(signageInspections.id, id))
      .returning();
    return updated || undefined;
  }

  async rejectSignageInspection(id: number): Promise<SignageInspection | undefined> {
    const [updated] = await db
      .update(signageInspections)
      .set({ 
        status: "rejected",
        updatedAt: new Date() 
      })
      .where(eq(signageInspections.id, id))
      .returning();
    return updated || undefined;
  }

  // Signage Photos
  async getSignagePhoto(id: number): Promise<SignagePhoto | undefined> {
    const [photo] = await db.select().from(signagePhotos).where(eq(signagePhotos.id, id));
    return photo || undefined;
  }

  async getSignagePhotosByInspection(inspectionId: number): Promise<SignagePhoto[]> {
    return db
      .select()
      .from(signagePhotos)
      .where(eq(signagePhotos.inspectionId, inspectionId))
      .orderBy(signagePhotos.section, signagePhotos.createdAt);
  }

  async getSignagePhotosBySection(inspectionId: number, section: string): Promise<SignagePhoto[]> {
    return db
      .select()
      .from(signagePhotos)
      .where(and(
        eq(signagePhotos.inspectionId, inspectionId),
        eq(signagePhotos.section, section)
      ))
      .orderBy(signagePhotos.createdAt);
  }

  async createSignagePhoto(photo: InsertSignagePhoto): Promise<SignagePhoto> {
    const [created] = await db.insert(signagePhotos).values(photo).returning();
    return created;
  }

  async deleteSignagePhoto(id: number): Promise<void> {
    await db.delete(signagePhotos).where(eq(signagePhotos.id, id));
  }

  // Enrichment Runs
  async createEnrichmentRun(run: InsertEnrichmentRun): Promise<EnrichmentRun> {
    const [created] = await db.insert(enrichmentRuns).values(run).returning();
    return created;
  }

  async getEnrichmentRun(id: number): Promise<EnrichmentRun | undefined> {
    const [run] = await db.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, id));
    return run || undefined;
  }

  async getEnrichmentRunsBySite(siteId: number): Promise<EnrichmentRun[]> {
    return db.select().from(enrichmentRuns)
      .where(eq(enrichmentRuns.siteId, siteId))
      .orderBy(desc(enrichmentRuns.createdAt));
  }

  async updateEnrichmentRun(id: number, run: Partial<InsertEnrichmentRun>): Promise<EnrichmentRun | undefined> {
    const [updated] = await db.update(enrichmentRuns)
      .set(run)
      .where(eq(enrichmentRuns.id, id))
      .returning();
    return updated || undefined;
  }

  // Session Flags
  async createSessionFlag(flag: InsertSessionFlag): Promise<SessionFlag> {
    const [created] = await db.insert(sessionFlags).values(flag).returning();
    return created;
  }

  async createSessionFlags(flags: InsertSessionFlag[]): Promise<SessionFlag[]> {
    if (flags.length === 0) return [];
    const created = await db.insert(sessionFlags).values(flags).returning();
    return created;
  }

  async getSessionFlag(id: number): Promise<SessionFlag | undefined> {
    const [flag] = await db.select().from(sessionFlags).where(eq(sessionFlags.id, id));
    return flag || undefined;
  }

  async getSessionFlagsBySite(siteId: number, from?: Date, to?: Date): Promise<SessionFlag[]> {
    const conditions = [eq(sessionFlags.siteId, siteId)];
    if (from) {
      conditions.push(gte(sessionFlags.createdAt, from));
    }
    if (to) {
      conditions.push(lte(sessionFlags.createdAt, to));
    }
    return db.select().from(sessionFlags)
      .where(and(...conditions))
      .orderBy(desc(sessionFlags.createdAt));
  }

  async getSessionFlagsBySession(sessionId: number): Promise<SessionFlag[]> {
    return db.select().from(sessionFlags)
      .where(eq(sessionFlags.sessionId, sessionId))
      .orderBy(desc(sessionFlags.createdAt));
  }

  async updateSessionFlag(id: number, flag: Partial<InsertSessionFlag>): Promise<SessionFlag | undefined> {
    const [updated] = await db.update(sessionFlags)
      .set({ ...flag, updatedAt: new Date() })
      .where(eq(sessionFlags.id, id))
      .returning();
    return updated || undefined;
  }

  async resolveSessionFlag(id: number, userId: string, notes?: string): Promise<SessionFlag | undefined> {
    const [resolved] = await db.update(sessionFlags)
      .set({
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: userId,
        resolutionNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(sessionFlags.id, id))
      .returning();
    return resolved || undefined;
  }

  async dismissSessionFlag(id: number, userId: string, notes?: string): Promise<SessionFlag | undefined> {
    const [dismissed] = await db.update(sessionFlags)
      .set({
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedBy: userId,
        resolutionNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(sessionFlags.id, id))
      .returning();
    return dismissed || undefined;
  }

  // PCN Recommendations
  async createPcnRecommendation(recommendation: InsertPcnRecommendation): Promise<PcnRecommendation> {
    const [created] = await db.insert(pcnRecommendations).values(recommendation).returning();
    return created;
  }

  async getPcnRecommendation(id: number): Promise<PcnRecommendation | undefined> {
    const [rec] = await db.select().from(pcnRecommendations).where(eq(pcnRecommendations.id, id));
    return rec || undefined;
  }

  async getPcnRecommendationsBySession(sessionId: number): Promise<PcnRecommendation[]> {
    return db.select().from(pcnRecommendations)
      .where(eq(pcnRecommendations.sessionId, sessionId))
      .orderBy(desc(pcnRecommendations.createdAt));
  }

  async getPcnRecommendationsByFlag(flagId: number): Promise<PcnRecommendation[]> {
    return db.select().from(pcnRecommendations)
      .where(eq(pcnRecommendations.flagId, flagId))
      .orderBy(desc(pcnRecommendations.createdAt));
  }

  async getLatestPcnRecommendationForSession(sessionId: number): Promise<PcnRecommendation | undefined> {
    const [latest] = await db.select().from(pcnRecommendations)
      .where(eq(pcnRecommendations.sessionId, sessionId))
      .orderBy(desc(pcnRecommendations.createdAt))
      .limit(1);
    return latest || undefined;
  }

  // Driver Profiles
  async getDriverProfile(siteId: number, vrm: string): Promise<DriverProfile | undefined> {
    const normalizedVrm = vrm.toUpperCase().replace(/\s+/g, "");
    const [profile] = await db.select().from(driverProfiles)
      .where(and(
        eq(driverProfiles.siteId, siteId),
        eq(driverProfiles.vrm, normalizedVrm)
      ));
    return profile || undefined;
  }

  async getDriverProfilesBySite(siteId: number): Promise<DriverProfile[]> {
    return db.select().from(driverProfiles)
      .where(eq(driverProfiles.siteId, siteId))
      .orderBy(desc(driverProfiles.riskScore));
  }

  async createDriverProfile(profile: InsertDriverProfile): Promise<DriverProfile> {
    const [created] = await db.insert(driverProfiles).values(profile).returning();
    return created;
  }

  async updateDriverProfile(id: number, profile: Partial<InsertDriverProfile>): Promise<DriverProfile | undefined> {
    const [updated] = await db.update(driverProfiles)
      .set({ ...profile, updatedAt: new Date(), lastCalculatedAt: new Date() })
      .where(eq(driverProfiles.id, id))
      .returning();
    return updated || undefined;
  }

  async upsertDriverProfile(profile: InsertDriverProfile): Promise<DriverProfile> {
    const normalizedVrm = profile.vrm.toUpperCase().replace(/\s+/g, "");
    const existing = await this.getDriverProfile(profile.siteId, normalizedVrm);
    
    if (existing) {
      const updated = await this.updateDriverProfile(existing.id, {
        ...profile,
        vrm: normalizedVrm,
      });
      return updated!;
    } else {
      return this.createDriverProfile({
        ...profile,
        vrm: normalizedVrm,
      });
    }
  }

  async deleteDriverProfile(id: number): Promise<void> {
    await db.delete(driverProfiles).where(eq(driverProfiles.id, id));
  }

  async getDriverSessionHistory(siteId: number, vrm: string, from?: Date, to?: Date): Promise<ParkingSession[]> {
    const normalizedVrm = vrm.toUpperCase().replace(/\s+/g, "");
    const conditions = [
      eq(parkingSessions.siteId, siteId),
      eq(parkingSessions.vrm, normalizedVrm),
    ];
    if (from) {
      conditions.push(gte(parkingSessions.entryAt, from));
    }
    if (to) {
      conditions.push(lte(parkingSessions.entryAt, to));
    }
    return db.select().from(parkingSessions)
      .where(and(...conditions))
      .orderBy(desc(parkingSessions.entryAt));
  }

  // Enforcement Cases
  async getCases(options: { siteId?: number; status?: string; limit?: number; offset?: number }): Promise<EnforcementCase[]> {
    const conditions = [];
    if (options.siteId) {
      conditions.push(eq(enforcementCases.siteId, options.siteId));
    }
    if (options.status) {
      conditions.push(eq(enforcementCases.status, options.status));
    }
    const query = db.select().from(enforcementCases)
      .orderBy(desc(enforcementCases.createdAt))
      .limit(options.limit || 50)
      .offset(options.offset || 0);
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getCaseById(id: string): Promise<EnforcementCase | undefined> {
    const [caseData] = await db.select().from(enforcementCases).where(eq(enforcementCases.id, id));
    return caseData || undefined;
  }

  async createCase(insertCase: InsertEnforcementCase): Promise<EnforcementCase> {
    const [created] = await db.insert(enforcementCases).values(insertCase).returning();
    return created;
  }

  async updateCaseStatus(id: string, status: string): Promise<EnforcementCase | undefined> {
    const [updated] = await db.update(enforcementCases)
      .set({ status, updatedAt: new Date() })
      .where(eq(enforcementCases.id, id))
      .returning();
    return updated || undefined;
  }

  async updateCaseEvidenceCount(id: string): Promise<void> {
    const evidenceItems = await db.select().from(caseEvidence).where(eq(caseEvidence.caseId, id));
    await db.update(enforcementCases)
      .set({ evidenceCount: evidenceItems.length, updatedAt: new Date() })
      .where(eq(enforcementCases.id, id));
  }

  async addEvidenceToCase(insertCaseEvidence: InsertCaseEvidence): Promise<CaseEvidence> {
    const [created] = await db.insert(caseEvidence).values(insertCaseEvidence).returning();
    return created;
  }

  async getCaseEvidence(caseId: string): Promise<Array<CaseEvidence & { evidence?: Evidence }>> {
    const items = await db.select().from(caseEvidence).where(eq(caseEvidence.caseId, caseId));
    const result = [];
    for (const item of items) {
      const [ev] = await db.select().from(evidence).where(eq(evidence.id, item.evidenceId));
      result.push({ ...item, evidence: ev });
    }
    return result;
  }

  async createCaseAnalysis(insertAnalysis: InsertCaseAnalysis): Promise<CaseAnalysis> {
    const existing = await this.getCaseAnalysis(insertAnalysis.caseId);
    if (existing) {
      const [updated] = await db.update(caseAnalysis)
        .set({ ...insertAnalysis, generatedAt: new Date() })
        .where(eq(caseAnalysis.caseId, insertAnalysis.caseId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(caseAnalysis).values(insertAnalysis).returning();
    return created;
  }

  async getCaseAnalysis(caseId: string): Promise<CaseAnalysis | undefined> {
    const [analysis] = await db.select().from(caseAnalysis).where(eq(caseAnalysis.caseId, caseId));
    return analysis || undefined;
  }

  async createEvidenceBundle(insertBundle: InsertEvidenceBundle): Promise<EvidenceBundle> {
    const [created] = await db.insert(evidenceBundles).values(insertBundle).returning();
    return created;
  }

  async getEvidenceBundle(id: number): Promise<EvidenceBundle | undefined> {
    const [bundle] = await db.select().from(evidenceBundles).where(eq(evidenceBundles.id, id));
    return bundle || undefined;
  }

  async getEvidenceBundlesByCase(caseId: string): Promise<EvidenceBundle[]> {
    return await db.select().from(evidenceBundles)
      .where(eq(evidenceBundles.caseId, caseId))
      .orderBy(desc(evidenceBundles.createdAt));
  }

  async updateEvidenceBundle(id: number, update: Partial<EvidenceBundle>): Promise<EvidenceBundle | undefined> {
    const [updated] = await db.update(evidenceBundles)
      .set(update)
      .where(eq(evidenceBundles.id, id))
      .returning();
    return updated || undefined;
  }

  async getEvidenceByBundle(bundleId: number): Promise<Evidence[]> {
    return await db.select().from(evidence)
      .where(eq(evidence.bundleId, bundleId))
      .orderBy(evidence.timestamp);
  }

  async updateEvidenceBundleFileCount(bundleId: number): Promise<void> {
    const files = await this.getEvidenceByBundle(bundleId);
    await db.update(evidenceBundles)
      .set({ fileCount: files.length })
      .where(eq(evidenceBundles.id, bundleId));
  }

  async createCaseVehicle(insertVehicle: InsertCaseVehicle): Promise<number> {
    const [created] = await db.insert(caseVehicles).values(insertVehicle).returning();
    return created.id;
  }

  async getCaseVehicle(id: number): Promise<CaseVehicle | undefined> {
    const [vehicle] = await db.select().from(caseVehicles).where(eq(caseVehicles.id, id));
    return vehicle || undefined;
  }

  async getCaseVehiclesByCase(caseId: string): Promise<CaseVehicle[]> {
    return await db.select().from(caseVehicles)
      .where(eq(caseVehicles.caseId, caseId))
      .orderBy(desc(caseVehicles.createdAt));
  }

  async getCaseVehicleByPlate(caseId: string, registrationNumber: string): Promise<CaseVehicle | undefined> {
    const [vehicle] = await db.select().from(caseVehicles)
      .where(and(
        eq(caseVehicles.caseId, caseId),
        eq(caseVehicles.registrationNumber, registrationNumber)
      ));
    return vehicle || undefined;
  }

  async updateCaseVehicle(id: number, update: Partial<CaseVehicle>): Promise<CaseVehicle | undefined> {
    const [updated] = await db.update(caseVehicles)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(caseVehicles.id, id))
      .returning();
    return updated || undefined;
  }

  async updateCaseVehicleVerified(id: number): Promise<void> {
    await db.update(caseVehicles)
      .set({ verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(caseVehicles.id, id));
  }

  async deleteCaseVehicle(id: number): Promise<void> {
    await db.delete(caseVehicles).where(eq(caseVehicles.id, id));
  }

  // Case Analysis Pipeline Steps
  async createAnalysisStep(step: InsertCaseAnalysisStep): Promise<CaseAnalysisStep> {
    const [created] = await db.insert(caseAnalysisSteps).values(step).returning();
    return created;
  }

  async getAnalysisStepsByCase(caseId: string): Promise<CaseAnalysisStep[]> {
    return await db.select().from(caseAnalysisSteps)
      .where(eq(caseAnalysisSteps.caseId, caseId))
      .orderBy(caseAnalysisSteps.stepOrder);
  }

  async updateAnalysisStep(id: number, update: Partial<CaseAnalysisStep>): Promise<CaseAnalysisStep | undefined> {
    const [updated] = await db.update(caseAnalysisSteps)
      .set(update)
      .where(eq(caseAnalysisSteps.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteAnalysisStepsByCase(caseId: string): Promise<void> {
    await db.delete(caseAnalysisSteps).where(eq(caseAnalysisSteps.caseId, caseId));
  }

  // PCN Management
  async createPcn(pcn: InsertPcn): Promise<Pcn> {
    const [created] = await db.insert(pcns).values(pcn).returning();
    return created;
  }

  async getPcn(id: number): Promise<Pcn | undefined> {
    const [pcn] = await db.select().from(pcns).where(eq(pcns.id, id));
    return pcn || undefined;
  }

  async getPcnByNumber(pcnNumber: string): Promise<Pcn | undefined> {
    const [pcn] = await db.select().from(pcns).where(eq(pcns.pcnNumber, pcnNumber));
    return pcn || undefined;
  }

  async getPcnsByCase(caseId: string): Promise<Pcn[]> {
    return await db.select().from(pcns)
      .where(eq(pcns.caseId, caseId))
      .orderBy(desc(pcns.createdAt));
  }

  async getPcnsBySite(siteId: number, options?: { status?: string; limit?: number }): Promise<Pcn[]> {
    const conditions = [eq(pcns.siteId, siteId)];
    if (options?.status) {
      conditions.push(eq(pcns.status, options.status));
    }
    return await db.select().from(pcns)
      .where(and(...conditions))
      .orderBy(desc(pcns.createdAt))
      .limit(options?.limit || 100);
  }

  async updatePcn(id: number, update: Partial<Pcn>): Promise<Pcn | undefined> {
    const [updated] = await db.update(pcns)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(pcns.id, id))
      .returning();
    return updated || undefined;
  }

  async issuePcn(id: number, issuedBy: string): Promise<Pcn | undefined> {
    const [updated] = await db.update(pcns)
      .set({ 
        status: "issued", 
        issuedBy, 
        issuedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(pcns.id, id))
      .returning();
    return updated || undefined;
  }

  async generatePcnNumber(siteId: number): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const count = await db.select({ count: sql<number>`count(*)` })
      .from(pcns)
      .where(and(
        eq(pcns.siteId, siteId),
        gte(pcns.createdAt, new Date(today.setHours(0, 0, 0, 0)))
      ));
    const sequence = (count[0]?.count || 0) + 1;
    return `PCN-${siteId}-${dateStr}-${String(sequence).padStart(4, "0")}`;
  }

  // Case Pipeline Results
  async createCasePipelineResults(results: InsertCasePipelineResults): Promise<CasePipelineResults> {
    const existing = await this.getCasePipelineResults(results.caseId);
    if (existing) {
      const [updated] = await db.update(casePipelineResults)
        .set({ ...results, updatedAt: new Date() })
        .where(eq(casePipelineResults.caseId, results.caseId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(casePipelineResults).values(results).returning();
    return created;
  }

  async getCasePipelineResults(caseId: string): Promise<CasePipelineResults | undefined> {
    const [results] = await db.select().from(casePipelineResults)
      .where(eq(casePipelineResults.caseId, caseId));
    return results || undefined;
  }

  async updateCasePipelineResults(caseId: string, update: Partial<CasePipelineResults>): Promise<CasePipelineResults | undefined> {
    const [updated] = await db.update(casePipelineResults)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(casePipelineResults.caseId, caseId))
      .returning();
    return updated || undefined;
  }

  async getCompletedAnalysisBySite(siteId: number, options?: { action?: string; limit?: number }): Promise<Array<{
    caseId: string;
    caseReference: string;
    siteName: string;
    siteId: number;
    vrm: string | null;
    evidenceCount: number;
    analysisTimestamp: Date;
    pipelineResults: CasePipelineResults;
  }>> {
    const results = await db.select({
      caseId: enforcementCases.id,
      caseReference: enforcementCases.caseReference,
      siteId: enforcementCases.siteId,
      vrm: enforcementCases.vrm,
      evidenceCount: enforcementCases.evidenceCount,
      siteName: parkingSites.siteName,
      pipelineResults: casePipelineResults,
    })
    .from(casePipelineResults)
    .innerJoin(enforcementCases, eq(casePipelineResults.caseId, enforcementCases.id))
    .innerJoin(parkingSites, eq(enforcementCases.siteId, parkingSites.id))
    .where(and(
      eq(enforcementCases.siteId, siteId),
      eq(casePipelineResults.pipelineStatus, "completed")
    ))
    .orderBy(desc(casePipelineResults.updatedAt))
    .limit(options?.limit || 50);

    // Filter by action if specified
    let filtered = results;
    if (options?.action && options.action !== "all") {
      filtered = results.filter(r => {
        const decision = r.pipelineResults.decisionEngine as any;
        return decision?.status === options.action;
      });
    }

    return filtered.map(r => ({
      caseId: r.caseId,
      caseReference: r.caseReference,
      siteName: r.siteName,
      siteId: r.siteId,
      vrm: r.vrm,
      evidenceCount: r.evidenceCount || 0,
      analysisTimestamp: r.pipelineResults.updatedAt || r.pipelineResults.createdAt,
      pipelineResults: r.pipelineResults,
    }));
  }
}

export const storage = new DatabaseStorage();
