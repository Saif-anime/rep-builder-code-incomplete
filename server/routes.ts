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
import { insertUserSchema, insertCameraSchema, insertBaySchema } from "@shared/schema";

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
    const allowedTypes = /jpeg|jpg|png|gif|mp4|webm|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Only images and videos are allowed"));
    }
  },
});

function calculateFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
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
      const cameras = await storage.getAllCameras();
      // Don't expose passwords
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

      const { violationType, bayId, notes } = req.body;
      const evidenceIds: number[] = [];
      const parkingEventIds: number[] = [];
      let aiSummary: string | null = null;
      let violationsDetected = false;
      
      const parsedBayId = bayId && bayId !== "" ? parseInt(bayId) : null;

      for (const file of files) {
        const hash = calculateFileHash(file.path);
        const isImage = file.mimetype.startsWith("image/");

        const ev = await storage.createEvidence({
          type: "manual",
          uploadedBy: req.user!.id,
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

  // ==================== SITES ====================
  app.get("/api/sites", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const sitesList = await storage.getAllSites();
      res.json(sitesList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sites" });
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

  // Serve uploaded files
  app.use("/uploads", (req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    next();
  });

  return httpServer;
}
