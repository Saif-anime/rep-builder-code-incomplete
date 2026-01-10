import { spawn } from "child_process";
import path from "path";

export interface YoloDetection {
  class: string;
  class_id: number;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface YoloResult {
  success: boolean;
  vehicles: YoloDetection[];
  persons: YoloDetection[];
  all_detections: YoloDetection[];
  model?: string;
  error?: string;
}

let yoloAvailable: boolean | null = null;
let lastCheck: number = 0;
const RECHECK_INTERVAL = 60000; // Re-check every 60 seconds if unavailable

async function runPythonScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "server", "yolo_inference.py");
    const python = spawn("python3", [scriptPath, ...args]);
    
    let stdout = "";
    let stderr = "";
    
    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    
    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    python.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Python script failed: ${stderr || stdout}`));
      }
    });
    
    python.on("error", (err) => {
      reject(err);
    });
    
    setTimeout(() => {
      python.kill();
      reject(new Error("YOLOv8 inference timeout"));
    }, 30000);
  });
}

export async function isYoloAvailable(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached result if available and not stale
  if (yoloAvailable !== null) {
    // If available, always return true
    if (yoloAvailable === true) {
      return true;
    }
    // If unavailable, re-check periodically in case model was added
    if (now - lastCheck < RECHECK_INTERVAL) {
      return false;
    }
  }
  
  lastCheck = now;
  
  try {
    const result = await runPythonScript(["--check"]);
    const parsed = JSON.parse(result);
    yoloAvailable = parsed.available === true;
    console.log(`[YOLO] Model availability: ${yoloAvailable ? "AVAILABLE" : "NOT AVAILABLE"}`);
    return yoloAvailable;
  } catch (error: any) {
    console.log(`[YOLO] Check failed: ${error.message}`);
    yoloAvailable = false;
    return false;
  }
}

export async function runYoloDetection(imagePath: string): Promise<YoloResult> {
  const available = await isYoloAvailable();
  
  if (!available) {
    return {
      success: false,
      error: "YOLOv8 model not available. Please add yolov8n.onnx to server/models/",
      vehicles: [],
      persons: [],
      all_detections: [],
    };
  }
  
  try {
    const fullPath = path.join(process.cwd(), imagePath.startsWith("/") ? imagePath.slice(1) : imagePath);
    const result = await runPythonScript([fullPath]);
    const parsed = JSON.parse(result) as YoloResult;
    
    console.log(`[YOLO] Detection complete: ${parsed.vehicles?.length || 0} vehicles, ${parsed.persons?.length || 0} persons`);
    
    return parsed;
  } catch (error: any) {
    console.error(`[YOLO] Detection failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      vehicles: [],
      persons: [],
      all_detections: [],
    };
  }
}

export function mapYoloToVehicleType(detections: YoloDetection[]): "car" | "van" | "motorcycle" | "unknown" {
  const vehicleMap: Record<string, "car" | "van" | "motorcycle"> = {
    car: "car",
    truck: "van",
    bus: "van",
    motorcycle: "motorcycle",
  };
  
  const bestVehicle = detections.sort((a, b) => b.confidence - a.confidence)[0];
  if (bestVehicle && vehicleMap[bestVehicle.class]) {
    return vehicleMap[bestVehicle.class];
  }
  return "unknown";
}

export function hasPersonsDetected(detections: YoloDetection[]): { adult: boolean; child: boolean } {
  const personCount = detections.filter(d => d.class === "person").length;
  return {
    adult: personCount > 0,
    child: false,
  };
}
