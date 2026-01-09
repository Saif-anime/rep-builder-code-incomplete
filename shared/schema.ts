import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, serial, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ==================== USERS ====================
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("operator"), // admin, operator, enforcement_officer
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastLogin: timestamp("last_login"),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  lastLogin: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ==================== CAMERAS ====================
export const cameras = pgTable("cameras", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  ipAddress: text("ip_address").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  rtspUrl: text("rtsp_url"),
  isapiUrl: text("isapi_url"),
  isActive: boolean("is_active").notNull().default(true),
  status: text("status").notNull().default("offline"), // online, offline, checking
  statusMessage: text("status_message"),
  siteId: text("site_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSnapshot: timestamp("last_snapshot"),
  lastCheckedAt: timestamp("last_checked_at"),
  lastOnlineAt: timestamp("last_online_at"),
});

export const insertCameraSchema = createInsertSchema(cameras).omit({
  id: true,
  createdAt: true,
  lastSnapshot: true,
  lastCheckedAt: true,
  lastOnlineAt: true,
  statusMessage: true,
});

export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type Camera = typeof cameras.$inferSelect;

// ==================== BAYS ====================
export const bays = pgTable("bays", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // disabled, ev, parent_child, standard, loading, permit
  cameraId: integer("camera_id").references(() => cameras.id),
  location: text("location"),
  rules: jsonb("rules").$type<{
    requiresBlueBadge?: boolean;
    requiresChild?: boolean;
    requiresEvCharging?: boolean;
    maxDuration?: number;
    permitRequired?: boolean;
  }>(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBaySchema = createInsertSchema(bays).omit({
  id: true,
  createdAt: true,
});

export type InsertBay = z.infer<typeof insertBaySchema>;
export type Bay = typeof bays.$inferSelect;

// ==================== EVIDENCE ====================
export const evidence = pgTable("evidence", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // camera, manual
  cameraId: integer("camera_id").references(() => cameras.id),
  bayId: integer("bay_id").references(() => bays.id),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  imagePath: text("image_path"),
  videoPath: text("video_path"),
  thumbnailPath: text("thumbnail_path"),
  timestamp: timestamp("timestamp").notNull(),
  sha256Hash: text("sha256_hash"),
  metadata: jsonb("metadata").$type<{
    width?: number;
    height?: number;
    format?: string;
    duration?: number;
    fileSize?: number;
  }>(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // pending, reviewed, approved, rejected
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEvidenceSchema = createInsertSchema(evidence).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
});

export type InsertEvidence = z.infer<typeof insertEvidenceSchema>;
export type Evidence = typeof evidence.$inferSelect;

// ==================== DETECTIONS ====================
export const detections = pgTable("detections", {
  id: serial("id").primaryKey(),
  evidenceId: integer("evidence_id").references(() => evidence.id).notNull(),
  objectType: text("object_type").notNull(), // person, child, car, van, truck, bus, motorcycle, wheelchair, ev
  confidence: real("confidence").notNull(),
  boundingBox: jsonb("bounding_box").$type<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>(),
  attributes: jsonb("attributes").$type<{
    isElderly?: boolean;
    hasWheelchair?: boolean;
    hasBlueBadge?: boolean;
    isCharging?: boolean;
    hasChild?: boolean;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDetectionSchema = createInsertSchema(detections).omit({
  id: true,
  createdAt: true,
});

export type InsertDetection = z.infer<typeof insertDetectionSchema>;
export type Detection = typeof detections.$inferSelect;

// ==================== PARKING EVENTS ====================
export const parkingEvents = pgTable("parking_events", {
  id: serial("id").primaryKey(),
  evidenceId: integer("evidence_id").references(() => evidence.id).notNull(),
  bayId: integer("bay_id").references(() => bays.id),
  numberPlateId: integer("number_plate_id").references(() => numberPlates.id),
  violationType: text("violation_type"), // disabled_bay, ev_bay, parent_child, overstay, no_permit
  isViolation: boolean("is_violation").notNull().default(false),
  aiConfidence: real("ai_confidence"),
  aiExplanation: text("ai_explanation"),
  aiReasoning: jsonb("ai_reasoning").$type<{
    factors: string[];
    uncertainties: string[];
    recommendation: string;
  }>(),
  status: text("status").notNull().default("pending"), // pending, confirmed, dismissed, appealed
  pcnNumber: text("pcn_number"),
  pcnIssuedAt: timestamp("pcn_issued_at"),
  pcnAmount: real("pcn_amount"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertParkingEventSchema = createInsertSchema(parkingEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  pcnIssuedAt: true,
});

export type InsertParkingEvent = z.infer<typeof insertParkingEventSchema>;
export type ParkingEvent = typeof parkingEvents.$inferSelect;

// ==================== NUMBER PLATES ====================
export const numberPlates = pgTable("number_plates", {
  id: serial("id").primaryKey(),
  evidenceId: integer("evidence_id").references(() => evidence.id).notNull(),
  plateText: text("plate_text").notNull(),
  plateImage: text("plate_image"),
  confidence: real("confidence").notNull(),
  isValidUkFormat: boolean("is_valid_uk_format").notNull().default(false),
  boundingBox: jsonb("bounding_box").$type<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNumberPlateSchema = createInsertSchema(numberPlates).omit({
  id: true,
  createdAt: true,
});

export type InsertNumberPlate = z.infer<typeof insertNumberPlateSchema>;
export type NumberPlate = typeof numberPlates.$inferSelect;

// ==================== AUDIT LOGS ====================
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  action: text("action").notNull(), // create, update, delete, view, login, logout, approve, reject
  entityType: text("entity_type").notNull(), // evidence, parking_event, user, camera, bay
  entityId: text("entity_id"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// ==================== SITES ====================
export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  postcode: text("postcode"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSiteSchema = createInsertSchema(sites).omit({
  id: true,
  createdAt: true,
});

export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Site = typeof sites.$inferSelect;

// ==================== AI SETTINGS ====================
export const aiSettings = pgTable("ai_settings", {
  id: serial("id").primaryKey(),
  settingKey: text("setting_key").notNull().unique(),
  settingValue: jsonb("setting_value").$type<unknown>(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAiSettingSchema = createInsertSchema(aiSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertAiSetting = z.infer<typeof insertAiSettingSchema>;
export type AiSetting = typeof aiSettings.$inferSelect;

// ==================== RELATIONS ====================
export const usersRelations = relations(users, ({ many }) => ({
  evidence: many(evidence),
  auditLogs: many(auditLogs),
}));

export const camerasRelations = relations(cameras, ({ many }) => ({
  bays: many(bays),
  evidence: many(evidence),
}));

export const baysRelations = relations(bays, ({ one, many }) => ({
  camera: one(cameras, {
    fields: [bays.cameraId],
    references: [cameras.id],
  }),
  evidence: many(evidence),
  parkingEvents: many(parkingEvents),
}));

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
  camera: one(cameras, {
    fields: [evidence.cameraId],
    references: [cameras.id],
  }),
  bay: one(bays, {
    fields: [evidence.bayId],
    references: [bays.id],
  }),
  uploader: one(users, {
    fields: [evidence.uploadedBy],
    references: [users.id],
  }),
  reviewer: one(users, {
    fields: [evidence.reviewedBy],
    references: [users.id],
  }),
  detections: many(detections),
  parkingEvents: many(parkingEvents),
  numberPlates: many(numberPlates),
}));

export const detectionsRelations = relations(detections, ({ one }) => ({
  evidence: one(evidence, {
    fields: [detections.evidenceId],
    references: [evidence.id],
  }),
}));

export const parkingEventsRelations = relations(parkingEvents, ({ one }) => ({
  evidence: one(evidence, {
    fields: [parkingEvents.evidenceId],
    references: [evidence.id],
  }),
  bay: one(bays, {
    fields: [parkingEvents.bayId],
    references: [bays.id],
  }),
  numberPlate: one(numberPlates, {
    fields: [parkingEvents.numberPlateId],
    references: [numberPlates.id],
  }),
}));

export const numberPlatesRelations = relations(numberPlates, ({ one, many }) => ({
  evidence: one(evidence, {
    fields: [numberPlates.evidenceId],
    references: [evidence.id],
  }),
  parkingEvents: many(parkingEvents),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

// ==================== CONVERSATIONS (for AI chat) ====================
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
