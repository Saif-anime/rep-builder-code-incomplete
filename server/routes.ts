import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { storage } from "./storage";
import { 
  authenticateToken, 
  requireRole, 
  hashPassword, 
  verifyPassword, 
  generateToken,
  createDefaultAdmin,
  type AuthRequest 
} from "./auth";
import { 
  analyzeEvidence, 
  generatePCN, 
  generateAppealSummary, 
  validateUKNumberPlate 
} from "./ai-analysis";
import { checkSingleCamera } from "./camera-health";
import { analyzeEvidenceById, retryFailedAnalysis } from "./evidence-worker";
import { runEnrichment } from "./contextEnrichment";
import { getDriverProfileWithFreshCalculation, recomputeDriverProfiles } from "./driverProfiling";
import { processPdf, parsePdfToSignageData } from "./pdfProcessor";
import { analyzeImageWithVision, analyzeMultipleImages, mergeVisionResults } from "./visionAnalysis";
import { insertUserSchema, insertCameraSchema, insertBaySchema, insertSiteRuleSchema, insertSitePolicySchema, insertSiteNoteSchema, insertSiteSurroundingsSchema, insertSignageInspectionSchema, insertSignagePhotoSchema, insertEnforcementCaseSchema, insertCaseEvidenceSchema } from "@shared/schema";

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedExtensions = /^(jpeg|jpg|png|mp4|avi)$/i;
    const allowedMimetypes = /^(image\/jpeg|image\/png|video\/mp4|video\/x-msvideo|video\/avi)$/;
    const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
    const extValid = allowedExtensions.test(ext);
    const mimeValid = allowedMimetypes.test(file.mimetype);
    if (extValid || mimeValid) {
      cb(null, true);
    } else {
      cb(new Error("Only images (JPG, PNG) and videos (MP4, AVI) are allowed"));
    }
  },
});

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for PDFs
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pdf" || file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

function calculateFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

function calculateComplianceScores(inspection: any): {
  overallComplianceScore: number;
  entranceScore: number;
  tcScore: number;
  baySignageScore: number;
  generalScore: number;
  appealRiskScore: number;
  nightVisibilityRisk: number;
} {
  const boolToScore = (val: boolean | null | undefined): number => val === true ? 100 : val === false ? 0 : 50;
  const conditionToScore = (val: string | null | undefined): number => {
    if (val === "good") return 100;
    if (val === "damaged") return 50;
    if (val === "missing") return 0;
    return 50;
  };

  const entranceFields = [
    boolToScore(inspection.entranceSignagePresent),
    boolToScore(inspection.entranceClearlyVisible),
    boolToScore(inspection.entranceCorrectWording),
    boolToScore(inspection.entranceHeightCompliant),
    conditionToScore(inspection.entranceCondition),
  ];
  const entranceScore = entranceFields.reduce((a, b) => a + b, 0) / entranceFields.length;

  const tcFields = [
    boolToScore(inspection.tcTariffVisible),
    boolToScore(inspection.tcFontReadable),
    boolToScore(inspection.tcLanguageCorrect),
    boolToScore(inspection.tcLightingPresent),
  ];
  const tcScore = tcFields.reduce((a, b) => a + b, 0) / tcFields.length;

  const bayFields = [
    boolToScore(inspection.disabledSignPresent),
    boolToScore(inspection.disabledMarkingsVisible),
    boolToScore(inspection.disabledUprightSign),
    boolToScore(inspection.disabledWordingCorrect),
    boolToScore(inspection.evSignPresent),
    boolToScore(inspection.evMarkingsVisible),
    boolToScore(inspection.evUprightSign),
    boolToScore(inspection.evWordingCorrect),
    boolToScore(inspection.parentChildSignPresent),
    boolToScore(inspection.parentChildMarkingsVisible),
    boolToScore(inspection.parentChildUprightSign),
    boolToScore(inspection.parentChildWordingCorrect),
  ];
  const baySignageScore = bayFields.reduce((a, b) => a + b, 0) / bayFields.length;

  const generalFields = [
    boolToScore(inspection.bpaIpcCompliant),
    boolToScore(!inspection.conflictingSignagePresent),
    boolToScore(!inspection.obstructionsPresent),
    boolToScore(!inspection.weatherDamage),
    boolToScore(!inspection.graffitiPresent),
  ];
  const generalScore = generalFields.reduce((a, b) => a + b, 0) / generalFields.length;

  const overallComplianceScore = (entranceScore * 0.3 + tcScore * 0.25 + baySignageScore * 0.25 + generalScore * 0.2);

  const appealRiskFactors = [
    !inspection.entranceSignagePresent ? 30 : 0,
    !inspection.entranceClearlyVisible ? 20 : 0,
    !inspection.tcTariffVisible ? 25 : 0,
    !inspection.bpaIpcCompliant ? 30 : 0,
    inspection.conflictingSignagePresent ? 25 : 0,
    inspection.entranceCondition === "missing" ? 30 : inspection.entranceCondition === "damaged" ? 15 : 0,
  ];
  const appealRiskScore = Math.min(100, appealRiskFactors.reduce((a, b) => a + b, 0));

  const nightVisibilityFactors = [
    !inspection.entranceLightingNight ? 40 : 0,
    !inspection.tcLightingPresent ? 30 : 0,
    !inspection.entranceLightingDay ? 10 : 0,
  ];
  const nightVisibilityRisk = Math.min(100, nightVisibilityFactors.reduce((a, b) => a + b, 0));

  return {
    overallComplianceScore: Math.round(overallComplianceScore * 10) / 10,
    entranceScore: Math.round(entranceScore * 10) / 10,
    tcScore: Math.round(tcScore * 10) / 10,
    baySignageScore: Math.round(baySignageScore * 10) / 10,
    generalScore: Math.round(generalScore * 10) / 10,
    appealRiskScore: Math.round(appealRiskScore * 10) / 10,
    nightVisibilityRisk: Math.round(nightVisibilityRisk * 10) / 10,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize default admin
  await createDefaultAdmin();

  // ==================== AUTH ROUTES ====================
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const validPassword = await verifyPassword(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (!user.isActive) {
        return res.status(403).json({ error: "Account is disabled" });
      }

      // Update last login
      await storage.updateUser(user.id, { lastLogin: new Date() } as any);

      const token = generateToken(user);
      const { password: _, ...userWithoutPassword } = user;

      await storage.createAuditLog({
        userId: user.id,
        action: "login",
        entityType: "user",
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.json({ token, user: userWithoutPassword });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // ==================== DASHBOARD ====================
  app.get("/api/dashboard/stats", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ error: "Failed to load dashboard stats" });
    }
  });

  // ==================== USERS ====================
  app.get("/api/users", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const usersWithoutPasswords = users.map(({ password, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.post("/api/users", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid user data", details: parsed.error });
      }

      const hashedPassword = await hashPassword(parsed.data.password);
      const user = await storage.createUser({
        ...parsed.data,
        password: hashedPassword,
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "user",
        entityId: user.id,
        details: { username: user.username, role: user.role },
      });

      const { password, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  app.patch("/api/users/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      if (updates.password) {
        updates.password = await hashPassword(updates.password);
      }

      const user = await storage.updateUser(id, updates);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "user",
        entityId: id,
      });

      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      
      if (id === req.user!.id) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      await storage.deleteUser(id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "user",
        entityId: id,
      });

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // ==================== CAMERAS ====================
  app.get("/api/cameras", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { siteId } = req.query;
      let cameras = await storage.getAllCameras();
      
      if (siteId && siteId !== "all") {
        const siteIdStr = String(siteId);
        cameras = cameras.filter(c => c.siteId === siteIdStr);
      }
      
      const sanitized = cameras.map(({ password, ...c }) => c);
      res.json(sanitized);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cameras" });
    }
  });

  app.post("/api/cameras", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertCameraSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid camera data" });
      }

      const camera = await storage.createCamera(parsed.data);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "camera",
        entityId: camera.id.toString(),
        details: { name: camera.name, location: camera.location },
      });

      const { password, ...cameraWithoutPassword } = camera;
      res.status(201).json(cameraWithoutPassword);
    } catch (error) {
      res.status(500).json({ error: "Failed to create camera" });
    }
  });

  app.delete("/api/cameras/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCamera(id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "camera",
        entityId: id.toString(),
      });

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete camera" });
    }
  });

  app.post("/api/cameras/:id/check", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      const camera = await storage.getCamera(id);
      if (!camera) {
        return res.status(404).json({ error: "Camera not found" });
      }

      const result = await checkSingleCamera(id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "view",
        entityType: "camera",
        entityId: id.toString(),
        details: { action: "health_check", result: result.online ? "online" : "offline", message: result.message },
      });

      const updatedCamera = await storage.getCamera(id);

      res.json({
        online: result.online,
        message: result.message,
        method: result.method,
        camera: updatedCamera ? { 
          status: updatedCamera.status, 
          statusMessage: updatedCamera.statusMessage,
          lastCheckedAt: updatedCamera.lastCheckedAt,
          lastOnlineAt: updatedCamera.lastOnlineAt,
        } : null,
      });
    } catch (error) {
      console.error("Camera health check error:", error);
      res.status(500).json({ error: "Failed to check camera health" });
    }
  });

  // ==================== BAYS ====================
  app.get("/api/bays", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const bays = await storage.getAllBays();
      res.json(bays);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bays" });
    }
  });

  app.post("/api/bays", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertBaySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid bay data" });
      }

      const bay = await storage.createBay(parsed.data);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "bay",
        entityId: bay.id.toString(),
        details: { name: bay.name, type: bay.type },
      });

      res.status(201).json(bay);
    } catch (error) {
      res.status(500).json({ error: "Failed to create bay" });
    }
  });

  app.delete("/api/bays/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBay(id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "bay",
        entityId: id.toString(),
      });

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete bay" });
    }
  });

  // ==================== EVIDENCE ====================
  app.get("/api/evidence", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { type, status } = req.query;
      const evidence = await storage.getAllEvidence(
        type as string | undefined,
        status as string | undefined
      );
      res.json(evidence);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch evidence" });
    }
  });

  app.get("/api/evidence/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const ev = await storage.getEvidence(id);
      if (!ev) {
        return res.status(404).json({ error: "Evidence not found" });
      }
      res.json(ev);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch evidence" });
    }
  });

  app.post("/api/evidence/upload", authenticateToken, (req: AuthRequest, res: Response, next) => {
    upload.array("files", 10)(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large. Maximum size is 50MB." });
        }
        if (err.message === "Only images and videos are allowed") {
          return res.status(415).json({ error: "Unsupported file type. Only images and videos allowed." });
        }
        return res.status(400).json({ error: err.message || "File upload error" });
      }
      next();
    });
  }, async (req: AuthRequest, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const { violationType, bayId, notes, siteId, cameraId } = req.body;
      const evidenceIds: number[] = [];
      const parkingEventIds: number[] = [];
      let aiSummary: string | null = null;
      let violationsDetected = false;
      
      const parsedBayId = bayId && bayId !== "" ? parseInt(bayId) : null;
      const parsedSiteId = siteId && siteId !== "" ? parseInt(siteId) : null;
      const parsedCameraId = cameraId && cameraId !== "" ? parseInt(cameraId) : null;

      for (const file of files) {
        const hash = calculateFileHash(file.path);
        const isImage = file.mimetype.startsWith("image/");

        const ev = await storage.createEvidence({
          type: "manual",
          uploadedBy: req.user!.id,
          siteId: parsedSiteId,
          cameraId: parsedCameraId,
          bayId: parsedBayId,
          imagePath: isImage ? `/uploads/${file.filename}` : null,
          videoPath: !isImage ? `/uploads/${file.filename}` : null,
          thumbnailPath: isImage ? `/uploads/${file.filename}` : null,
          timestamp: new Date(),
          sha256Hash: hash,
          notes,
          status: "pending",
          metadata: {
            format: file.mimetype,
            fileSize: file.size,
          },
        });

        evidenceIds.push(ev.id);

        await storage.createAuditLog({
          userId: req.user!.id,
          action: "create",
          entityType: "evidence",
          entityId: ev.id.toString(),
          details: { type: "manual", violationType, filename: file.originalname },
        });

        if (violationType) {
          const parkingEvent = await storage.createParkingEvent({
            evidenceId: ev.id,
            bayId: parsedBayId,
            violationType,
            isViolation: true,
            status: "pending",
          });
          parkingEventIds.push(parkingEvent.id);

          if (isImage) {
            try {
              const fetchedBay = parsedBayId ? await storage.getBay(parsedBayId) : null;
              const bayData = fetchedBay ?? null;
              const analysisResult = await analyzeEvidence(ev, bayData, [], violationType);
              
              if (analysisResult) {
                await storage.updateParkingEvent(parkingEvent.id, {
                  aiConfidence: analysisResult.confidence,
                  aiExplanation: analysisResult.explanation,
                  status: "analyzed",
                });
                
                if (!aiSummary) {
                  aiSummary = analysisResult.explanation;
                }
                violationsDetected = analysisResult.isViolation || violationsDetected;
              }
            } catch (aiError) {
              console.error("AI analysis error (non-blocking):", aiError);
            }
          }
        }
      }

      res.status(201).json({
        success: true,
        evidenceIds,
        parkingEventIds,
        aiSummary,
        violationsDetected,
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to upload evidence" });
    }
  });

  app.post("/api/evidence/:id/analyze", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const ev = await storage.getEvidence(id);
      if (!ev) {
        return res.status(404).json({ error: "Evidence not found" });
      }

      const success = await analyzeEvidenceById(id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "evidence",
        entityId: id.toString(),
        details: { action: "trigger_analysis" },
      });

      const updatedEvidence = await storage.getEvidence(id);
      res.json({ success, evidence: updatedEvidence });
    } catch (error) {
      console.error("Analysis trigger error:", error);
      res.status(500).json({ error: "Failed to trigger analysis" });
    }
  });

  app.post("/api/evidence/:id/retry", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const ev = await storage.getEvidence(id);
      if (!ev) {
        return res.status(404).json({ error: "Evidence not found" });
      }

      if (ev.status !== "failed") {
        return res.status(400).json({ error: "Can only retry failed analysis" });
      }

      const success = await retryFailedAnalysis(id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "evidence",
        entityId: id.toString(),
        details: { action: "retry_analysis" },
      });

      const updatedEvidence = await storage.getEvidence(id);
      res.json({ success, evidence: updatedEvidence });
    } catch (error) {
      console.error("Retry analysis error:", error);
      res.status(500).json({ error: "Failed to retry analysis" });
    }
  });

  // ==================== PARKING EVENTS ====================
  app.get("/api/parking-events", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { status } = req.query;
      const events = await storage.getAllParkingEvents(status as string | undefined);
      
      // Enrich with plate data
      const enriched = await Promise.all(
        events.map(async (event) => {
          let plateText = null;
          if (event.numberPlateId) {
            const plate = await storage.getNumberPlate(event.numberPlateId);
            plateText = plate?.plateText;
          }
          return { ...event, plateText };
        })
      );
      
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch parking events" });
    }
  });

  app.get("/api/parking-events/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const event = await storage.getParkingEvent(id);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      let plateText = null;
      if (event.numberPlateId) {
        const plate = await storage.getNumberPlate(event.numberPlateId);
        plateText = plate?.plateText;
      }

      res.json({ ...event, plateText });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch parking event" });
    }
  });

  app.post("/api/parking-events/:id/analyze", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const event = await storage.getParkingEvent(id);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      const evidenceData = await storage.getEvidence(event.evidenceId);
      if (!evidenceData) {
        return res.status(404).json({ error: "Evidence not found" });
      }

      const bayData = event.bayId ? (await storage.getBay(event.bayId)) ?? null : null;
      const detections = await storage.getDetectionsByEvidence(event.evidenceId);
      const plateData = event.numberPlateId ? (await storage.getNumberPlate(event.numberPlateId)) ?? null : null;

      const analysis = await analyzeEvidence(evidenceData, bayData, detections, plateData);

      const updated = await storage.updateParkingEvent(id, {
        isViolation: analysis.isViolation,
        violationType: analysis.violationType,
        aiConfidence: analysis.confidence,
        aiExplanation: analysis.explanation,
        aiReasoning: analysis.reasoning,
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "parking_event",
        entityId: id.toString(),
        details: { action: "ai_analysis", confidence: analysis.confidence },
      });

      res.json(updated);
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: "Failed to analyze event" });
    }
  });

  app.post("/api/parking-events/:id/confirm", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateParkingEvent(id, {
        status: "confirmed",
        isViolation: true,
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "approve",
        entityType: "parking_event",
        entityId: id.toString(),
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to confirm event" });
    }
  });

  app.post("/api/parking-events/:id/dismiss", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateParkingEvent(id, {
        status: "dismissed",
        isViolation: false,
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "reject",
        entityType: "parking_event",
        entityId: id.toString(),
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to dismiss event" });
    }
  });

  app.post("/api/parking-events/:id/generate-pcn", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const event = await storage.getParkingEvent(id);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.status !== "confirmed") {
        return res.status(400).json({ error: "Event must be confirmed before generating PCN" });
      }

      let plateText = "UNKNOWN";
      if (event.numberPlateId) {
        const plate = await storage.getNumberPlate(event.numberPlateId);
        plateText = plate?.plateText || "UNKNOWN";
      }

      const bayData = event.bayId ? (await storage.getBay(event.bayId)) ?? null : null;
      const bayType = bayData?.type || "standard";

      const pcnDetails = await generatePCN(event, plateText, bayType);

      const updated = await storage.updateParkingEvent(id, {
        pcnNumber: pcnDetails.pcnNumber,
        pcnAmount: pcnDetails.amount,
        pcnIssuedAt: new Date(),
        aiExplanation: pcnDetails.explanation,
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "pcn",
        entityId: pcnDetails.pcnNumber,
        details: { eventId: id, amount: pcnDetails.amount },
      });

      res.json(updated);
    } catch (error) {
      console.error("PCN generation error:", error);
      res.status(500).json({ error: "Failed to generate PCN" });
    }
  });

  // ==================== NUMBER PLATES ====================
  app.get("/api/number-plates", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { validity } = req.query;
      let plates = await storage.getAllNumberPlates();
      
      if (validity === "valid") {
        plates = plates.filter((p) => p.isValidUkFormat);
      } else if (validity === "invalid") {
        plates = plates.filter((p) => !p.isValidUkFormat);
      }
      
      res.json(plates);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch number plates" });
    }
  });

  // ==================== SITES (legacy) ====================
  app.get("/api/sites", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const sitesList = await storage.getAllSites();
      res.json(sitesList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sites" });
    }
  });

  // ==================== PARKING SITES ====================
  app.get("/api/parking-sites", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const parkingSitesList = await storage.getAllParkingSites();
      res.json(parkingSitesList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch parking sites" });
    }
  });

  app.get("/api/parking-sites/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const site = await storage.getParkingSite(id);
      if (!site) {
        return res.status(404).json({ error: "Parking site not found" });
      }
      res.json(site);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch parking site" });
    }
  });

  app.post("/api/parking-sites", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const site = await storage.createParkingSite(req.body);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "parking_site",
        entityId: site.id.toString(),
        details: { siteName: site.siteName },
      });

      res.status(201).json(site);
    } catch (error) {
      console.error("Create parking site error:", error);
      res.status(500).json({ error: "Failed to create parking site" });
    }
  });

  app.put("/api/parking-sites/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const site = await storage.updateParkingSite(id, req.body);
      if (!site) {
        return res.status(404).json({ error: "Parking site not found" });
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "parking_site",
        entityId: id.toString(),
        details: { siteName: site.siteName },
      });

      res.json(site);
    } catch (error) {
      res.status(500).json({ error: "Failed to update parking site" });
    }
  });

  app.delete("/api/parking-sites/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const site = await storage.getParkingSite(id);
      if (!site) {
        return res.status(404).json({ error: "Parking site not found" });
      }

      await storage.deleteParkingSite(id);

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "parking_site",
        entityId: id.toString(),
        details: { siteName: site.siteName },
      });

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete parking site" });
    }
  });

  app.post("/api/parking-sites/import-json", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      let importedSites = req.body.sites || req.body;
      
      if (!Array.isArray(importedSites)) {
        return res.status(400).json({ error: "Invalid JSON format. Expected an array of sites or { sites: [...] }." });
      }

      const errors: string[] = [];
      const parsedSites: any[] = [];
      let skipped = 0;

      for (let i = 0; i < importedSites.length; i++) {
        const site = importedSites[i];
        const siteName = site.Name || site.siteName;
        
        if (!siteName || typeof siteName !== "string" || siteName.trim() === "") {
          errors.push(`Row ${i + 1}: Missing or invalid site name`);
          skipped++;
          continue;
        }

        parsedSites.push({
          siteName: siteName.trim(),
          locationCode: site["Location Code"] || site.locationCode || null,
          addressLine1: site["Address Line 1"] || site.addressLine1 || null,
          addressLine2: site["Address Line 2"] || site.addressLine2 || null,
          addressLine3: site["Address Line 3"] || site.addressLine3 || null,
          addressLine4: site["Address Line 4"] || site.addressLine4 || null,
          city: site["Town/City"] || site.city || null,
          postcode: site.Postcode || site.postcode || null,
          regulations: site.Regulations || site.regulations || null,
          enforcer: site.Enforcer || site.enforcer || null,
          totalBays: parseInt(site.bays?.total || site.totalBays) || 0,
          disabledBays: parseInt(site.bays?.disabled || site.disabledBays) || 0,
          evBays: parseInt(site.bays?.ev || site.evBays) || 0,
          parentChildBays: parseInt(site.bays?.parentChild || site.parentChildBays) || 0,
        });
      }

      if (parsedSites.length === 0) {
        return res.status(400).json({ 
          error: "No valid sites to import", 
          skipped, 
          errors: errors.slice(0, 10) 
        });
      }

      const created = await storage.importParkingSites(parsedSites);

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "parking_site",
        entityId: "bulk_import",
        details: { count: created.length, skipped },
      });

      res.status(201).json({ 
        success: true, 
        imported: created.length,
        skipped,
        errors: errors.slice(0, 10),
      });
    } catch (error: any) {
      console.error("Import parking sites error:", error);
      if (error.message?.includes("Entity Too Large")) {
        return res.status(413).json({ error: "File too large. Maximum size is 20MB." });
      }
      res.status(500).json({ error: "Import failed. Please check your JSON format." });
    }
  });

  // ==================== ANPR EVENTS ====================
  app.post("/api/anpr/events", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { anprService } = await import("./anpr-service");
      const { z } = await import("zod");

      const anprEventInputSchema = z.object({
        siteId: z.number().int().positive("Site ID must be a positive integer"),
        cameraId: z.number().int().positive("Camera ID must be a positive integer"),
        vrm: z.string().min(2, "VRM must be at least 2 characters").max(20, "VRM too long"),
        eventType: z.enum(["ENTRY", "EXIT"]),
        confidence: z.number().min(0).max(100).optional().default(95),
        occurredAt: z.string().or(z.date()).transform(val => new Date(val)),
      });

      const validateAndParse = async (data: unknown) => {
        const parsed = anprEventInputSchema.parse(data);
        
        const site = await storage.getParkingSite(parsed.siteId);
        if (!site) {
          throw new Error(`Site with ID ${parsed.siteId} not found`);
        }
        
        const camera = await storage.getCamera(parsed.cameraId);
        if (!camera) {
          throw new Error(`Camera with ID ${parsed.cameraId} not found`);
        }

        return {
          ...parsed,
          vrm: parsed.vrm.toUpperCase().replace(/\s+/g, ""),
        };
      };

      if (Array.isArray(req.body)) {
        if (req.body.length === 0) {
          return res.status(400).json({ error: "Empty event array" });
        }
        if (req.body.length > 1000) {
          return res.status(400).json({ error: "Maximum 1000 events per batch" });
        }

        const events = [];
        for (const e of req.body) {
          const parsed = await validateAndParse(e);
          events.push(parsed);
        }
        
        const results = await anprService.processBatchEvents(events);
        
        await storage.createAuditLog({
          userId: req.user!.id,
          action: "create",
          entityType: "anpr_event",
          entityId: "batch",
          details: { count: results.length },
        });

        res.status(201).json({
          success: true,
          processed: results.length,
          results: results.map(r => ({
            eventId: r.event.id,
            sessionId: r.session?.id,
            action: r.action,
            orphanReason: r.orphanReason,
          })),
        });
      } else {
        const parsed = await validateAndParse(req.body);

        const result = await anprService.processEvent(parsed);
        
        await storage.createAuditLog({
          userId: req.user!.id,
          action: "create",
          entityType: "anpr_event",
          entityId: result.event.id.toString(),
          details: { 
            vrm: result.event.vrm,
            eventType: result.event.eventType,
            sessionAction: result.action,
          },
        });

        res.status(201).json({
          success: true,
          event: result.event,
          session: result.session,
          action: result.action,
          orphanReason: result.orphanReason,
        });
      }
    } catch (error: any) {
      console.error("ANPR event error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid event data", details: error.errors });
      }
      if (error.message?.includes("not found")) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to process ANPR event" });
    }
  });

  app.get("/api/parking-sessions/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      const session = await storage.getParkingSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch session" });
    }
  });

  app.get("/api/sites/:id/sessions", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }

      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      const { from, to, limit = "100", offset = "0", status } = req.query;
      const fromDate = from ? new Date(from as string) : undefined;
      const toDate = to ? new Date(to as string) : undefined;
      const limitNum = Math.min(Math.max(1, parseInt(limit as string) || 100), 1000);
      const offsetNum = Math.max(0, parseInt(offset as string) || 0);
      const statusFilter = status as string | undefined;

      const sessions = await storage.getSessionsBySite(siteId, fromDate, toDate);
      
      const filteredSessions = statusFilter 
        ? sessions.filter(s => s.status === statusFilter.toUpperCase())
        : sessions;
      
      const paginatedSessions = filteredSessions.slice(offsetNum, offsetNum + limitNum);

      res.json({
        sessions: paginatedSessions,
        total: filteredSessions.length,
        limit: limitNum,
        offset: offsetNum,
      });
    } catch (error) {
      console.error("Get sessions error:", error);
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  // ==================== SITE RULES ====================
  app.get("/api/sites/:id/rules", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const rules = await storage.getSiteRules(siteId);
      res.json(rules || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch site rules" });
    }
  });

  app.post("/api/sites/:id/rules", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }
      const existing = await storage.getSiteRules(siteId);
      if (existing) {
        return res.status(409).json({ error: "Rules already exist for this site. Use PATCH to update." });
      }
      const parsed = insertSiteRuleSchema.safeParse({ ...req.body, siteId });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const rules = await storage.createSiteRules(parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "site_rules",
        entityId: String(rules.id),
        details: req.body,
      });
      res.status(201).json(rules);
    } catch (error) {
      res.status(500).json({ error: "Failed to create site rules" });
    }
  });

  app.patch("/api/sites/:id/rules", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const existing = await storage.getSiteRules(siteId);
      if (!existing) {
        return res.status(404).json({ error: "Rules not found for this site" });
      }
      const parsed = insertSiteRuleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const rules = await storage.updateSiteRules(existing.id, parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "site_rules",
        entityId: String(existing.id),
        details: req.body,
      });
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: "Failed to update site rules" });
    }
  });

  app.delete("/api/sites/:id/rules", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const existing = await storage.getSiteRules(siteId);
      if (!existing) {
        return res.status(404).json({ error: "Rules not found for this site" });
      }
      await storage.deleteSiteRules(existing.id);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "site_rules",
        entityId: String(existing.id),
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete site rules" });
    }
  });

  // ==================== SITE POLICIES ====================
  app.get("/api/sites/:id/policy", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const policy = await storage.getSitePolicy(siteId);
      res.json(policy || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch site policy" });
    }
  });

  app.post("/api/sites/:id/policy", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }
      const existing = await storage.getSitePolicy(siteId);
      if (existing) {
        return res.status(409).json({ error: "Policy already exists for this site. Use PATCH to update." });
      }
      const policyData = {
        ...req.body,
        siteId,
      };
      const parsed = insertSitePolicySchema.safeParse(policyData);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const policy = await storage.createSitePolicy(parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "site_policy",
        entityId: String(policy.id),
        details: req.body,
      });
      res.status(201).json(policy);
    } catch (error) {
      res.status(500).json({ error: "Failed to create site policy" });
    }
  });

  app.patch("/api/sites/:id/policy", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const existing = await storage.getSitePolicy(siteId);
      if (!existing) {
        return res.status(404).json({ error: "Policy not found for this site" });
      }
      const partialSchema = insertSitePolicySchema.partial();
      const parsed = partialSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const policy = await storage.updateSitePolicy(existing.id, parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "site_policy",
        entityId: String(existing.id),
        details: req.body,
      });
      res.json(policy);
    } catch (error) {
      res.status(500).json({ error: "Failed to update site policy" });
    }
  });

  app.delete("/api/sites/:id/policy", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const existing = await storage.getSitePolicy(siteId);
      if (!existing) {
        return res.status(404).json({ error: "Policy not found for this site" });
      }
      await storage.deleteSitePolicy(existing.id);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "site_policy",
        entityId: String(existing.id),
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete site policy" });
    }
  });

  // ==================== DRIVER PROFILES ====================
  app.get("/api/sites/:id/drivers/:vrm/profile", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      const vrm = req.params.vrm;
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      if (!vrm || vrm.trim().length === 0) {
        return res.status(400).json({ error: "VRM is required" });
      }
      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }
      const profile = await getDriverProfileWithFreshCalculation(siteId, vrm);
      if (!profile) {
        return res.status(404).json({ error: "No visit history found for this vehicle at this site" });
      }
      res.json(profile);
    } catch (error) {
      console.error("[API] Error fetching driver profile:", error);
      res.status(500).json({ error: "Failed to fetch driver profile" });
    }
  });

  app.get("/api/sites/:id/drivers", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const profiles = await storage.getDriverProfilesBySite(siteId);
      res.json(profiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver profiles" });
    }
  });

  app.post("/api/sites/:id/drivers/recompute", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      const fromParam = req.query.from as string | undefined;
      const toParam = req.query.to as string | undefined;
      
      const from = fromParam ? new Date(fromParam) : undefined;
      const to = toParam ? new Date(toParam) : undefined;

      if (fromParam && isNaN(from!.getTime())) {
        return res.status(400).json({ error: "Invalid 'from' date format" });
      }
      if (toParam && isNaN(to!.getTime())) {
        return res.status(400).json({ error: "Invalid 'to' date format" });
      }

      const result = await recomputeDriverProfiles(siteId, from, to);

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "recompute",
        entityType: "driver_profiles",
        entityId: String(siteId),
        details: { processed: result.processed, from: from?.toISOString(), to: to?.toISOString() },
      });

      res.json({
        message: `Recomputed ${result.processed} driver profiles`,
        processed: result.processed,
        siteId,
        from: from?.toISOString(),
        to: to?.toISOString(),
      });
    } catch (error) {
      console.error("[API] Error recomputing driver profiles:", error);
      res.status(500).json({ error: "Failed to recompute driver profiles" });
    }
  });

  // ==================== SITE NOTES ====================
  app.get("/api/sites/:id/notes", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const notes = await storage.getSiteNotes(siteId);
      res.json(notes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch site notes" });
    }
  });

  app.post("/api/sites/:id/notes", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }
      const noteData = {
        ...req.body,
        siteId,
        createdBy: req.user!.id,
        validFrom: req.body.validFrom ? new Date(req.body.validFrom) : new Date(),
        validTo: req.body.validTo ? new Date(req.body.validTo) : null,
      };
      const parsed = insertSiteNoteSchema.safeParse(noteData);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const note = await storage.createSiteNote(parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "site_note",
        entityId: String(note.id),
        details: { content: note.content, tags: note.tags },
      });
      res.status(201).json(note);
    } catch (error) {
      res.status(500).json({ error: "Failed to create site note" });
    }
  });

  app.patch("/api/notes/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const noteId = parseInt(req.params.id);
      if (isNaN(noteId)) {
        return res.status(400).json({ error: "Invalid note ID" });
      }
      const existing = await storage.getSiteNote(noteId);
      if (!existing) {
        return res.status(404).json({ error: "Note not found" });
      }
      const updateData = { ...req.body };
      if (updateData.validFrom) updateData.validFrom = new Date(updateData.validFrom);
      if (updateData.validTo) updateData.validTo = new Date(updateData.validTo);
      const parsed = insertSiteNoteSchema.partial().safeParse(updateData);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const note = await storage.updateSiteNote(noteId, parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "site_note",
        entityId: String(noteId),
        details: req.body,
      });
      res.json(note);
    } catch (error) {
      res.status(500).json({ error: "Failed to update site note" });
    }
  });

  app.delete("/api/notes/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const noteId = parseInt(req.params.id);
      if (isNaN(noteId)) {
        return res.status(400).json({ error: "Invalid note ID" });
      }
      const existing = await storage.getSiteNote(noteId);
      if (!existing) {
        return res.status(404).json({ error: "Note not found" });
      }
      await storage.deleteSiteNote(noteId);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "site_note",
        entityId: String(noteId),
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete site note" });
    }
  });

  // ==================== SITE SURROUNDINGS ====================
  app.get("/api/sites/:id/surroundings", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const surroundings = await storage.getSiteSurroundings(siteId);
      res.json(surroundings || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch site surroundings" });
    }
  });

  app.post("/api/sites/:id/surroundings", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }
      const existing = await storage.getSiteSurroundings(siteId);
      if (existing) {
        return res.status(409).json({ error: "Surroundings already exist for this site. Use PATCH to update." });
      }
      const parsed = insertSiteSurroundingsSchema.safeParse({ ...req.body, siteId });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const surroundings = await storage.createSiteSurroundings(parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "site_surroundings",
        entityId: String(surroundings.id),
        details: req.body,
      });
      res.status(201).json(surroundings);
    } catch (error) {
      res.status(500).json({ error: "Failed to create site surroundings" });
    }
  });

  app.patch("/api/sites/:id/surroundings", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const existing = await storage.getSiteSurroundings(siteId);
      if (!existing) {
        return res.status(404).json({ error: "Surroundings not found for this site" });
      }
      const parsed = insertSiteSurroundingsSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const surroundings = await storage.updateSiteSurroundings(existing.id, parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "site_surroundings",
        entityId: String(existing.id),
        details: req.body,
      });
      res.json(surroundings);
    } catch (error) {
      res.status(500).json({ error: "Failed to update site surroundings" });
    }
  });

  app.delete("/api/sites/:id/surroundings", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const existing = await storage.getSiteSurroundings(siteId);
      if (!existing) {
        return res.status(404).json({ error: "Surroundings not found for this site" });
      }
      await storage.deleteSiteSurroundings(existing.id);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "site_surroundings",
        entityId: String(existing.id),
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete site surroundings" });
    }
  });

  // ==================== SITE CONTEXT ====================
  app.get("/api/sites/:id/context", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const { at } = req.query;
      const atTime = at ? new Date(at as string) : new Date();
      if (isNaN(atTime.getTime())) {
        return res.status(400).json({ error: "Invalid 'at' time parameter" });
      }
      const context = await storage.getSiteContext(siteId, atTime);
      if (!context.site) {
        return res.status(404).json({ error: "Site not found" });
      }
      res.json(context);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch site context" });
    }
  });

  // ==================== CONTEXT ENRICHMENT ====================
  app.post("/api/sites/:id/enrichment/run", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }

      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      const { windowStart, windowEnd } = req.body;
      if (!windowStart || !windowEnd) {
        return res.status(400).json({ error: "windowStart and windowEnd are required" });
      }

      const startDate = new Date(windowStart);
      const endDate = new Date(windowEnd);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }

      if (startDate >= endDate) {
        return res.status(400).json({ error: "windowStart must be before windowEnd" });
      }

      const enrichmentRun = await storage.createEnrichmentRun({
        siteId,
        windowStart: startDate,
        windowEnd: endDate,
        createdBy: req.user?.id || null,
        status: "running",
        results: null,
      });

      try {
        const results = await runEnrichment(siteId, startDate, endDate, req.user?.id, undefined, enrichmentRun.id);
        
        const updatedRun = await storage.updateEnrichmentRun(enrichmentRun.id, {
          status: "completed",
          results: {
            weatherSummary: results.weatherSummary,
            localEventsSummary: results.localEventsSummary,
            siteInventoryHits: results.siteInventoryHits,
            anomalySummary: results.anomalySummary,
          },
        });

        res.json({
          ...updatedRun,
          flaggingResult: results.flaggingResult,
        });
      } catch (enrichmentError) {
        console.error("[Enrichment] Run failed:", enrichmentError);
        
        await storage.updateEnrichmentRun(enrichmentRun.id, {
          status: "failed",
        });

        return res.status(500).json({ error: "Enrichment run failed", details: String(enrichmentError) });
      }
    } catch (error) {
      console.error("[Enrichment] Endpoint error:", error);
      res.status(500).json({ error: "Failed to run enrichment" });
    }
  });

  app.get("/api/sites/:id/enrichment/runs", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }

      const runs = await storage.getEnrichmentRunsBySite(siteId);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch enrichment runs" });
    }
  });

  app.get("/api/enrichment/runs/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid run ID" });
      }

      const run = await storage.getEnrichmentRun(id);
      if (!run) {
        return res.status(404).json({ error: "Enrichment run not found" });
      }
      res.json(run);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch enrichment run" });
    }
  });

  // ==================== SESSION FLAGS ====================
  app.get("/api/sites/:id/flags", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }

      const { from, to, status } = req.query;
      const fromDate = from ? new Date(from as string) : undefined;
      const toDate = to ? new Date(to as string) : undefined;

      const flags = await storage.getSessionFlagsBySite(siteId, fromDate, toDate);
      
      if (status) {
        const filteredFlags = flags.filter(f => f.status === status);
        return res.json(filteredFlags);
      }
      
      res.json(flags);
    } catch (error) {
      console.error("[Flags] Error fetching flags:", error);
      res.status(500).json({ error: "Failed to fetch session flags" });
    }
  });

  app.get("/api/sessions/:id/flags", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.id);
      if (isNaN(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }

      const flags = await storage.getSessionFlagsBySession(sessionId);
      res.json(flags);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch session flags" });
    }
  });

  app.get("/api/flags/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid flag ID" });
      }

      const flag = await storage.getSessionFlag(id);
      if (!flag) {
        return res.status(404).json({ error: "Flag not found" });
      }
      res.json(flag);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch flag" });
    }
  });

  app.post("/api/flags/:id/resolve", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid flag ID" });
      }

      const { notes } = req.body;
      const resolved = await storage.resolveSessionFlag(id, req.user!.id, notes);
      if (!resolved) {
        return res.status(404).json({ error: "Flag not found" });
      }
      res.json(resolved);
    } catch (error) {
      res.status(500).json({ error: "Failed to resolve flag" });
    }
  });

  app.post("/api/flags/:id/dismiss", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid flag ID" });
      }

      const { notes } = req.body;
      const dismissed = await storage.dismissSessionFlag(id, req.user!.id, notes);
      if (!dismissed) {
        return res.status(404).json({ error: "Flag not found" });
      }
      res.json(dismissed);
    } catch (error) {
      res.status(500).json({ error: "Failed to dismiss flag" });
    }
  });

  // ==================== PCN RECOMMENDATIONS ====================
  app.post("/api/flags/:id/override", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const flagId = parseInt(req.params.id);
      if (isNaN(flagId)) {
        return res.status(400).json({ error: "Invalid flag ID" });
      }

      const flag = await storage.getSessionFlag(flagId);
      if (!flag) {
        return res.status(404).json({ error: "Flag not found" });
      }

      const { action, reason } = req.body;
      if (!action || !["HOLD_PCN", "PROCEED_PCN", "REVIEW_REQUIRED", "AUTO_DISMISS"].includes(action)) {
        return res.status(400).json({ error: "Invalid action. Must be HOLD_PCN, PROCEED_PCN, REVIEW_REQUIRED, or AUTO_DISMISS" });
      }
      if (!reason || reason.trim().length === 0) {
        return res.status(400).json({ error: "Override reason is required" });
      }

      const session = await storage.getParkingSession(flag.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const recommendation = await storage.createPcnRecommendation({
        sessionId: flag.sessionId,
        flagId: flag.id,
        siteId: flag.siteId,
        vrm: session.vrm || "UNKNOWN",
        action,
        previousAction: (flag.recommendation as "HOLD_PCN" | "PROCEED_PCN" | "REVIEW_REQUIRED" | "AUTO_DISMISS" | null) || undefined,
        source: "USER",
        createdBy: req.user!.id,
        reason: reason.trim(),
        reasonPlain: `Manual override by ${req.user!.fullName || req.user!.username}: ${reason.trim()}`,
        evidenceJson: {
          ...flag.evidence,
          overrideReason: reason.trim(),
          sessionDetails: {
            entryAt: session.entryAt?.toISOString() || "",
            exitAt: session.exitAt?.toISOString(),
            durationMinutes: session.durationMinutes || undefined,
          },
        },
        confidence: 1.0,
        isOverride: true,
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "override",
        entityType: "pcn_recommendation",
        entityId: String(recommendation.id),
        details: { flagId, previousAction: flag.recommendation, newAction: action, reason },
      });

      res.status(201).json(recommendation);
    } catch (error) {
      console.error("[API] Error creating override:", error);
      res.status(500).json({ error: "Failed to create override" });
    }
  });

  app.get("/api/sessions/:id/recommendations", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.id);
      if (isNaN(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      const recommendations = await storage.getPcnRecommendationsBySession(sessionId);
      res.json(recommendations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch recommendations" });
    }
  });

  // ==================== SIGNAGE INSPECTIONS ====================
  app.get("/api/sites/:id/signage-inspections", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const inspections = await storage.getSignageInspectionsBySite(siteId);
      res.json(inspections);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch signage inspections" });
    }
  });

  app.get("/api/signage-inspections/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid inspection ID" });
      }
      const inspection = await storage.getSignageInspection(id);
      if (!inspection) {
        return res.status(404).json({ error: "Inspection not found" });
      }
      const photos = await storage.getSignagePhotosByInspection(id);
      res.json({ ...inspection, photos });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch signage inspection" });
    }
  });

  app.post("/api/sites/:id/signage-inspections", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ error: "Invalid site ID" });
      }
      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }
      const inspectionData = {
        ...req.body,
        siteId,
        inspectorId: req.user!.id,
        inspectorName: req.body.inspectorName || req.user!.fullName || req.user!.username,
        inspectionDate: req.body.inspectionDate ? new Date(req.body.inspectionDate) : new Date(),
        siteCode: req.body.siteCode || site.locationCode,
        siteAddress: req.body.siteAddress || [site.addressLine1, site.city, site.postcode].filter(Boolean).join(", "),
      };
      const parsed = insertSignageInspectionSchema.safeParse(inspectionData);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const inspection = await storage.createSignageInspection(parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "signage_inspection",
        entityId: String(inspection.id),
        details: { siteId, inspectionDate: inspection.inspectionDate },
      });
      res.status(201).json(inspection);
    } catch (error) {
      res.status(500).json({ error: "Failed to create signage inspection" });
    }
  });

  app.patch("/api/signage-inspections/:id", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid inspection ID" });
      }
      const existing = await storage.getSignageInspection(id);
      if (!existing) {
        return res.status(404).json({ error: "Inspection not found" });
      }
      if (existing.status !== "draft") {
        return res.status(400).json({ error: "Cannot modify a submitted inspection" });
      }
      const updateData = { ...req.body };
      if (updateData.inspectionDate) updateData.inspectionDate = new Date(updateData.inspectionDate);
      const parsed = insertSignageInspectionSchema.partial().safeParse(updateData);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }
      const inspection = await storage.updateSignageInspection(id, parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "signage_inspection",
        entityId: String(id),
        details: req.body,
      });
      res.json(inspection);
    } catch (error) {
      res.status(500).json({ error: "Failed to update signage inspection" });
    }
  });

  app.post("/api/signage-inspections/:id/submit", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid inspection ID" });
      }
      const existing = await storage.getSignageInspection(id);
      if (!existing) {
        return res.status(404).json({ error: "Inspection not found" });
      }
      if (existing.status !== "draft") {
        return res.status(400).json({ error: "Inspection already submitted" });
      }
      const photos = await storage.getSignagePhotosByInspection(id);
      const entrancePhotos = photos.filter(p => p.section === "entrance");
      if (entrancePhotos.length === 0) {
        return res.status(400).json({ error: "Entrance signage photo is required before submission" });
      }
      const scores = calculateComplianceScores(existing);
      await storage.updateSignageInspection(id, scores);
      const inspection = await storage.submitSignageInspection(id);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "submit",
        entityType: "signage_inspection",
        entityId: String(id),
        details: { scores },
      });
      res.json(inspection);
    } catch (error) {
      res.status(500).json({ error: "Failed to submit signage inspection" });
    }
  });

  app.post("/api/signage-inspections/:id/approve", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid inspection ID" });
      }
      const existing = await storage.getSignageInspection(id);
      if (!existing) {
        return res.status(404).json({ error: "Inspection not found" });
      }
      if (existing.status !== "submitted") {
        return res.status(400).json({ error: "Only submitted inspections can be approved" });
      }
      const inspection = await storage.approveSignageInspection(id, req.user!.id);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "approve",
        entityType: "signage_inspection",
        entityId: String(id),
      });
      res.json(inspection);
    } catch (error) {
      res.status(500).json({ error: "Failed to approve signage inspection" });
    }
  });

  app.post("/api/signage-inspections/:id/reject", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid inspection ID" });
      }
      const existing = await storage.getSignageInspection(id);
      if (!existing) {
        return res.status(404).json({ error: "Inspection not found" });
      }
      if (existing.status !== "submitted") {
        return res.status(400).json({ error: "Only submitted inspections can be rejected" });
      }
      const inspection = await storage.rejectSignageInspection(id);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "reject",
        entityType: "signage_inspection",
        entityId: String(id),
      });
      res.json(inspection);
    } catch (error) {
      res.status(500).json({ error: "Failed to reject signage inspection" });
    }
  });

  app.delete("/api/signage-inspections/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid inspection ID" });
      }
      const existing = await storage.getSignageInspection(id);
      if (!existing) {
        return res.status(404).json({ error: "Inspection not found" });
      }
      await storage.deleteSignageInspection(id);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "signage_inspection",
        entityId: String(id),
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete signage inspection" });
    }
  });

  // Signage Photos
  app.post("/api/signage-inspections/:id/photos", authenticateToken, requireRole("admin", "operator"), upload.single("photo"), async (req: AuthRequest, res: Response) => {
    try {
      const inspectionId = parseInt(req.params.id);
      if (isNaN(inspectionId)) {
        return res.status(400).json({ error: "Invalid inspection ID" });
      }
      const inspection = await storage.getSignageInspection(inspectionId);
      if (!inspection) {
        return res.status(404).json({ error: "Inspection not found" });
      }
      if (inspection.status !== "draft") {
        return res.status(400).json({ error: "Cannot add photos to a submitted inspection" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No photo file provided" });
      }
      const { section, caption } = req.body;
      if (!section) {
        return res.status(400).json({ error: "Section is required" });
      }
      const validSections = ["entrance", "tc", "disabled", "ev", "parent_child", "general"];
      if (!validSections.includes(section)) {
        return res.status(400).json({ error: `Invalid section. Must be one of: ${validSections.join(", ")}` });
      }
      const photoPath = `/uploads/${req.file.filename}`;
      const sha256Hash = calculateFileHash(req.file.path);
      const photo = await storage.createSignagePhoto({
        inspectionId,
        section,
        photoPath,
        caption: caption || null,
        sha256Hash,
        uploadedBy: req.user!.id,
        metadata: {
          fileSize: req.file.size,
          format: req.file.mimetype,
        },
      });
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "upload",
        entityType: "signage_photo",
        entityId: String(photo.id),
        details: { inspectionId, section },
      });
      res.status(201).json(photo);
    } catch (error) {
      res.status(500).json({ error: "Failed to upload signage photo" });
    }
  });

  app.delete("/api/signage-photos/:id", authenticateToken, requireRole("admin", "operator"), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid photo ID" });
      }
      const photo = await storage.getSignagePhoto(id);
      if (!photo) {
        return res.status(404).json({ error: "Photo not found" });
      }
      const inspection = await storage.getSignageInspection(photo.inspectionId);
      if (inspection && inspection.status !== "draft") {
        return res.status(400).json({ error: "Cannot delete photos from a submitted inspection" });
      }
      if (photo.photoPath) {
        const filePath = path.join(process.cwd(), photo.photoPath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      await storage.deleteSignagePhoto(id);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete",
        entityType: "signage_photo",
        entityId: String(id),
      });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete signage photo" });
    }
  });

  // PDF Upload for Signage Inspections
  app.post("/api/sites/:id/signage-inspections/upload-pdf", authenticateToken, requireRole("admin", "operator"), pdfUpload.single("pdf"), async (req: AuthRequest, res: Response) => {
    try {
      const siteId = parseInt(req.params.id);
      if (isNaN(siteId)) {
        return res.status(400).json({ success: false, message: "Invalid site ID" });
      }
      const site = await storage.getParkingSite(siteId);
      if (!site) {
        return res.status(404).json({ success: false, message: "Site not found" });
      }
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ success: false, message: "No PDF file provided" });
      }
      
      console.log("[PDF Upload] File received:", req.file.originalname, "size:", req.file.size, "mimetype:", req.file.mimetype);
      
      const pdfResult = await processPdf(req.file.buffer, req.file.originalname);
      console.log("[PDF Upload] Process result - success:", pdfResult.success, "source:", pdfResult.source, "text length:", pdfResult.extractedText.length);
      
      if (!pdfResult.success) {
        return res.status(422).json({ 
          success: false, 
          message: pdfResult.error || "Failed to process PDF",
          source: pdfResult.source
        });
      }
      
      const { extractedData, flatData } = parsePdfToSignageData(pdfResult.extractedText);
      const inspectionData = {
        ...flatData,
        siteId,
        inspectorId: req.user!.id,
        inspectorName: flatData.inspectorName || req.user!.fullName || req.user!.username,
        inspectionDate: flatData.inspectionDate ? new Date(flatData.inspectionDate) : new Date(),
        siteCode: flatData.siteCode || site.locationCode,
        siteAddress: flatData.siteAddress || [site.addressLine1, site.city, site.postcode].filter(Boolean).join(", "),
      };
      const parsed = insertSignageInspectionSchema.safeParse(inspectionData);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Failed to parse PDF data", details: parsed.error.errors, extractedData });
      }
      const inspection = await storage.createSignageInspection(parsed.data);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "signage_inspection",
        entityId: String(inspection.id),
        details: { siteId, source: pdfResult.source === "ocr" ? "pdf_ocr" : "pdf_text", extractedFields: Object.keys(flatData) },
      });
      console.log("[PDF Upload] Inspection created:", inspection.id, "source:", pdfResult.source);
      res.status(201).json({ 
        success: true, 
        source: pdfResult.source,
        inspection, 
        extractedData, 
        flatData, 
        rawText: pdfResult.extractedText.substring(0, 2000), 
        pdfFileName: req.file.originalname,
        pageCount: pdfResult.pageCount
      });
    } catch (error: any) {
      console.error("[PDF Upload] Unexpected error:", error.message, error.stack);
      res.status(500).json({ success: false, message: "Server error processing PDF" });
    }
  });

  // Parse PDF without creating inspection (preview mode)
  app.post("/api/signage-inspections/parse-pdf", authenticateToken, requireRole("admin", "operator"), pdfUpload.single("pdf"), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ success: false, message: "No PDF file provided" });
      }
      
      console.log("[PDF Parse] File received:", req.file.originalname, "size:", req.file.size, "mimetype:", req.file.mimetype);
      
      const pdfResult = await processPdf(req.file.buffer, req.file.originalname);
      console.log("[PDF Parse] Process result - success:", pdfResult.success, "source:", pdfResult.source, "text length:", pdfResult.extractedText.length);
      
      if (!pdfResult.success) {
        return res.status(422).json({ 
          success: false, 
          message: pdfResult.error || "Failed to process PDF",
          source: pdfResult.source
        });
      }
      
      const { extractedData, flatData } = parsePdfToSignageData(pdfResult.extractedText);
      res.json({ 
        success: true,
        source: pdfResult.source,
        pdfFileName: req.file.originalname,
        extractedData,
        flatData,
        extractedText: pdfResult.extractedText, 
        pageCount: pdfResult.pageCount 
      });
    } catch (error: any) {
      console.error("[PDF Parse] Unexpected error:", error.message, error.stack);
      res.status(500).json({ success: false, message: "Server error processing PDF" });
    }
  });

  // ==================== AI SETTINGS ====================
  app.get("/api/settings/ai", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const settings = await storage.getAiSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch AI settings" });
    }
  });

  app.patch("/api/settings/ai", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      await storage.updateAiSettings(req.body);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update",
        entityType: "ai_settings",
        details: req.body,
      });

      const settings = await storage.getAiSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to update AI settings" });
    }
  });

  // ==================== VISION GPT ANALYSIS ====================
  app.post("/api/evidence/:id/vision-analyze", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const evidenceId = parseInt(req.params.id);
      const evidenceItem = await storage.getEvidence(evidenceId);
      
      if (!evidenceItem) {
        return res.status(404).json({ error: "Evidence not found" });
      }
      
      if (!evidenceItem.imagePath) {
        return res.status(400).json({ error: "No image available for analysis" });
      }
      
      const site = evidenceItem.siteId ? await storage.getParkingSite(evidenceItem.siteId) : null;
      
      const result = await analyzeImageWithVision({
        imagePath: evidenceItem.imagePath,
        siteName: site?.siteName || undefined,
        timestamp: evidenceItem.timestamp?.toISOString(),
      });
      
      if (result.success && result.result) {
        await storage.updateEvidence(evidenceId, {
          notes: evidenceItem.notes ? `${evidenceItem.notes}\n[Vision Analysis]: ${result.result.confidenceNotes}` : `[Vision Analysis]: ${result.result.confidenceNotes}`,
        });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("[Vision] Error:", error.message);
      res.status(500).json({ error: "Failed to analyze image with Vision GPT" });
    }
  });

  // ==================== ENFORCEMENT CASES ====================
  app.get("/api/cases", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { siteId, status, limit = "50", offset = "0" } = req.query;
      const cases = await storage.getCases({
        siteId: siteId ? parseInt(siteId as string) : undefined,
        status: status as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      });
      res.json(cases);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch cases" });
    }
  });

  app.get("/api/cases/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        return res.status(404).json({ error: "Case not found" });
      }
      res.json(caseData);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch case" });
    }
  });

  app.post("/api/cases", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertEnforcementCaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid case data", details: parsed.error.errors });
      }
      
      const newCase = await storage.createCase({
        ...parsed.data,
        createdBy: req.user!.id,
      });
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "enforcement_case",
        entityId: newCase.id,
        details: { siteId: newCase.siteId },
      });
      
      res.status(201).json(newCase);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to create case" });
    }
  });

  app.post("/api/cases/:id/evidence", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { evidenceIds, source = "manual" } = req.body;
      
      if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
        return res.status(400).json({ error: "evidenceIds array required" });
      }
      
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        return res.status(404).json({ error: "Case not found" });
      }
      
      for (const evidenceId of evidenceIds) {
        await storage.addEvidenceToCase({
          caseId: req.params.id,
          evidenceId,
          source,
        });
      }
      
      await storage.updateCaseEvidenceCount(req.params.id);
      
      const updatedCase = await storage.getCaseById(req.params.id);
      res.json(updatedCase);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to add evidence to case" });
    }
  });

  app.get("/api/cases/:id/evidence", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const evidenceItems = await storage.getCaseEvidence(req.params.id);
      res.json(evidenceItems);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch case evidence" });
    }
  });

  // Case-level multi-file upload - uploads all files directly to a case
  app.post("/api/cases/:id/upload", authenticateToken, (req: AuthRequest, res: Response, next) => {
    upload.array("files", 20)(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large. Maximum size is 50MB." });
        }
        if (err.message === "Only images and videos are allowed") {
          return res.status(415).json({ error: "Unsupported file type. Only images and videos allowed." });
        }
        return res.status(400).json({ error: err.message || "File upload error" });
      }
      next();
    });
  }, async (req: AuthRequest, res: Response) => {
    try {
      const caseId = req.params.id;
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }
      
      const caseData = await storage.getCaseById(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "Case not found" });
      }
      
      const { capturedAt } = req.body;
      const capturedTimestamp = capturedAt ? new Date(capturedAt) : new Date();
      const evidenceIds: number[] = [];
      
      // Process all files and link them to the case
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const hash = calculateFileHash(file.path);
        const isImage = file.mimetype.startsWith("image/");
        
        // Create evidence record
        const ev = await storage.createEvidence({
          type: "manual",
          uploadedBy: req.user!.id,
          siteId: caseData.siteId,
          imagePath: isImage ? `/uploads/${file.filename}` : null,
          videoPath: !isImage ? `/uploads/${file.filename}` : null,
          thumbnailPath: isImage ? `/uploads/${file.filename}` : null,
          timestamp: new Date(capturedTimestamp.getTime() + (i * 1000)), // Offset slightly for ordering
          sha256Hash: hash,
          notes: `Case ${caseId} - File ${i + 1} of ${files.length}`,
          status: "pending",
          metadata: {
            format: file.mimetype,
            fileSize: file.size,
          },
        });
        
        evidenceIds.push(ev.id);
        
        // Link evidence to case
        await storage.addEvidenceToCase({
          caseId,
          evidenceId: ev.id,
          source: "manual",
        });
        
        await storage.createAuditLog({
          userId: req.user!.id,
          action: "upload",
          entityType: "case_evidence",
          entityId: ev.id.toString(),
          details: { caseId, filename: file.originalname, fileIndex: i + 1, totalFiles: files.length },
        });
      }
      
      // Update case evidence count
      await storage.updateCaseEvidenceCount(caseId);
      
      const updatedCase = await storage.getCaseById(caseId);
      const caseEvidenceItems = await storage.getCaseEvidence(caseId);
      
      res.status(201).json({
        success: true,
        case: updatedCase,
        evidenceIds,
        evidenceCount: caseEvidenceItems.length,
        message: `Successfully uploaded ${files.length} file(s) to case`,
      });
    } catch (error: any) {
      console.error("[Case Upload] Error:", error.message);
      res.status(500).json({ error: "Failed to upload files to case" });
    }
  });

  // Create case with files in one operation
  app.post("/api/cases/upload", authenticateToken, (req: AuthRequest, res: Response, next) => {
    upload.array("files", 20)(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large. Maximum size is 50MB." });
        }
        if (err.message === "Only images and videos are allowed") {
          return res.status(415).json({ error: "Unsupported file type. Only images and videos allowed." });
        }
        return res.status(400).json({ error: err.message || "File upload error" });
      }
      next();
    });
  }, async (req: AuthRequest, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }
      
      const { siteId, vrm, capturedAt } = req.body;
      const parsedSiteId = siteId ? parseInt(siteId) : null;
      const capturedTimestamp = capturedAt ? new Date(capturedAt) : new Date();
      
      // Create the case first
      const newCase = await storage.createCase({
        siteId: parsedSiteId,
        vrm: vrm || null,
        createdBy: req.user!.id,
        status: "pending",
      });
      
      const evidenceIds: number[] = [];
      
      // Process all files and link them to the case
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const hash = calculateFileHash(file.path);
        const isImage = file.mimetype.startsWith("image/");
        
        // Create evidence record
        const ev = await storage.createEvidence({
          type: "manual",
          uploadedBy: req.user!.id,
          siteId: parsedSiteId,
          imagePath: isImage ? `/uploads/${file.filename}` : null,
          videoPath: !isImage ? `/uploads/${file.filename}` : null,
          thumbnailPath: isImage ? `/uploads/${file.filename}` : null,
          timestamp: new Date(capturedTimestamp.getTime() + (i * 1000)),
          sha256Hash: hash,
          notes: `Case ${newCase.id} - File ${i + 1} of ${files.length}`,
          status: "pending",
          metadata: {
            format: file.mimetype,
            fileSize: file.size,
          },
        });
        
        evidenceIds.push(ev.id);
        
        // Link evidence to case
        await storage.addEvidenceToCase({
          caseId: newCase.id,
          evidenceId: ev.id,
          source: "manual",
        });
      }
      
      // Update case evidence count
      await storage.updateCaseEvidenceCount(newCase.id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create",
        entityType: "enforcement_case",
        entityId: newCase.id,
        details: { siteId: parsedSiteId, vrm, filesUploaded: files.length },
      });
      
      const updatedCase = await storage.getCaseById(newCase.id);
      
      res.status(201).json({
        success: true,
        case: updatedCase,
        evidenceIds,
        message: `Successfully created case with ${files.length} file(s)`,
      });
    } catch (error: any) {
      console.error("[Create Case Upload] Error:", error.message);
      res.status(500).json({ error: "Failed to create case with uploads" });
    }
  });

  app.post("/api/cases/:id/analyze", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        return res.status(404).json({ error: "Case not found" });
      }
      
      await storage.updateCaseStatus(req.params.id, "analysing");
      
      const evidenceItems = await storage.getCaseEvidence(req.params.id);
      if (evidenceItems.length === 0) {
        await storage.updateCaseStatus(req.params.id, "pending");
        return res.status(400).json({ error: "No evidence in case to analyze" });
      }
      
      const site = caseData.siteId ? await storage.getParkingSite(caseData.siteId) : null;
      
      const imageEvidence = evidenceItems.filter((e: any) => e.evidence?.imagePath);
      const visionInputs = imageEvidence.map((e: any) => ({
        imagePath: e.evidence.imagePath,
        siteName: site?.siteName,
        caseId: caseData.id,
        timestamp: e.evidence.timestamp?.toISOString(),
      }));
      
      const visionResults = await analyzeMultipleImages(visionInputs);
      const successfulResults = visionResults
        .filter(r => r.success && r.result)
        .map(r => r.result!);
      
      const mergedVision = mergeVisionResults(successfulResults);
      
      let violation = null;
      let confidenceScore = 0.5;
      let recommendation = "Review";
      let riskAssessment = "Medium";
      
      if (mergedVision) {
        if (mergedVision.bayTypeVisible === "disabled" && !mergedVision.disabledBadgeVisible) {
          violation = { type: "DISABLED BAY", detected: true, confidence: 0.8, explanation: "Vehicle in disabled bay without visible blue badge" };
          recommendation = "Issue PCN";
          riskAssessment = "Low";
          confidenceScore = 0.8;
        } else if (mergedVision.bayTypeVisible === "ev" && !mergedVision.evIndicators) {
          violation = { type: "EV BAY", detected: true, confidence: 0.75, explanation: "Non-EV vehicle in EV charging bay" };
          recommendation = "Issue PCN";
          riskAssessment = "Low";
          confidenceScore = 0.75;
        } else if (mergedVision.bayTypeVisible === "parent-child" && !mergedVision.humansDetected.child) {
          violation = { type: "PARENT & CHILD", detected: true, confidence: 0.7, explanation: "No child detected in parent-child bay" };
          recommendation = "Review";
          riskAssessment = "Medium";
          confidenceScore = 0.7;
        } else {
          recommendation = "No Action";
          riskAssessment = "Low";
          confidenceScore = 0.6;
        }
      }
      
      const timestamps = evidenceItems
        .map((e: any) => e.evidence?.timestamp)
        .filter(Boolean)
        .sort((a: Date, b: Date) => a.getTime() - b.getTime());
      
      // Calculate time window with gap detection
      let timeWindow = null;
      if (timestamps.length > 0) {
        const firstSeen = timestamps[0].toISOString();
        const lastSeen = timestamps[timestamps.length - 1].toISOString();
        const durationMinutes = Math.round((timestamps[timestamps.length - 1].getTime() - timestamps[0].getTime()) / 60000);
        
        // Detect gaps > 5 minutes between consecutive evidence
        const gaps: string[] = [];
        const conflicts: string[] = [];
        for (let i = 1; i < timestamps.length; i++) {
          const gap = (timestamps[i].getTime() - timestamps[i - 1].getTime()) / 60000;
          if (gap > 5) {
            gaps.push(`${gap.toFixed(1)} minute gap between evidence ${i} and ${i + 1}`);
          }
        }
        
        timeWindow = { firstSeen, lastSeen, durationMinutes, gaps, conflicts };
      }
      
      const timelineSummary = timestamps.length > 0
        ? `Evidence spans from ${timestamps[0].toISOString()} to ${timestamps[timestamps.length - 1].toISOString()}`
        : "No timestamp data available";
      
      // Build merged detections from vision results
      const mergedDetections = {
        vehicles: [] as Array<{ type: string; confidence: number; evidenceId: number }>,
        persons: [] as Array<{ type: string; confidence: number; evidenceId: number }>,
        bayMarkings: [] as Array<{ type: string; confidence: number; evidenceId: number }>,
      };
      
      // Track successful and failed evidence items
      const supportingEvidenceIds: number[] = [];
      const partialFailures: Array<{ evidenceId: number; error: string }> = [];
      
      visionResults.forEach((result, index) => {
        const evidenceId = imageEvidence[index]?.evidence?.id;
        if (result.success && result.result && evidenceId) {
          supportingEvidenceIds.push(evidenceId);
          if (result.result.vehicleDetected) {
            mergedDetections.vehicles.push({
              type: result.result.vehicleType,
              confidence: 0.9,
              evidenceId,
            });
          }
          if (result.result.humansDetected.adult || result.result.humansDetected.child) {
            mergedDetections.persons.push({
              type: result.result.humansDetected.child ? "child" : "adult",
              confidence: 0.85,
              evidenceId,
            });
          }
          if (result.result.bayTypeVisible) {
            mergedDetections.bayMarkings.push({
              type: result.result.bayTypeVisible,
              confidence: 0.8,
              evidenceId,
            });
          }
        } else if (evidenceId) {
          partialFailures.push({
            evidenceId,
            error: result.error || "Analysis failed",
          });
        }
      });
      
      const analysis = await storage.createCaseAnalysis({
        caseId: caseData.id,
        summary: `Analysis of ${evidenceItems.length} evidence items for ${site?.siteName || "Unknown Site"}`,
        vehicleDetails: mergedVision ? {
          detected: mergedVision.vehicleDetected,
          type: mergedVision.vehicleType,
          plate: mergedVision.numberPlateDetected || null,
          evIndicators: mergedVision.evIndicators,
        } : null,
        bayType: mergedVision?.bayTypeVisible || null,
        signageFindings: mergedVision ? {
          visible: mergedVision.signageVisible,
          compliant: true,
          notes: mergedVision.confidenceNotes,
        } : null,
        humanDetection: mergedVision ? {
          adult: mergedVision.humansDetected.adult,
          child: mergedVision.humansDetected.child,
          disabledBadgeVisible: mergedVision.disabledBadgeVisible,
        } : null,
        violations: violation ? [violation] : [],
        confidenceScore,
        riskAssessment,
        recommendation,
        timelineSummary,
        timeWindow,
        mergedDetections,
        modelVersions: { visionGPT: "gpt-4o" },
        supportingEvidenceIds,
        partialFailures: partialFailures.length > 0 ? partialFailures : null,
      });
      
      await storage.updateCaseStatus(req.params.id, "complete");
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "analyze",
        entityType: "enforcement_case",
        entityId: caseData.id,
        details: { recommendation, evidenceCount: evidenceItems.length },
      });
      
      res.json({
        case: await storage.getCaseById(req.params.id),
        analysis,
      });
    } catch (error: any) {
      console.error("[Case Analysis] Error:", error.message);
      await storage.updateCaseStatus(req.params.id, "pending");
      res.status(500).json({ error: "Failed to analyze case" });
    }
  });

  app.get("/api/cases/:id/analysis", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const analysis = await storage.getCaseAnalysis(req.params.id);
      if (!analysis) {
        return res.status(404).json({ error: "No analysis found for this case" });
      }
      res.json(analysis);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch case analysis" });
    }
  });

  // Serve uploaded files
  app.use("/uploads", (req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    next();
  });

  return httpServer;
}
