import DigestFetch from "digest-fetch";
import { parseStringPromise } from "xml2js";
import net from "net";
import { db } from "./db";
import { cameras } from "@shared/schema";
import { eq } from "drizzle-orm";

interface CameraCredentials {
  id: number;
  name: string;
  ipAddress: string;
  username: string;
  password: string;
}

interface HealthCheckResult {
  online: boolean;
  message: string;
  method: "isapi_status" | "isapi_snapshot" | "rtsp_socket" | "failed";
}

async function checkIsapiStatus(camera: CameraCredentials): Promise<HealthCheckResult> {
  const client = new DigestFetch(camera.username, camera.password);
  const url = `http://${camera.ipAddress}/ISAPI/System/status`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await client.fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 401) {
      return { online: false, message: "Authentication failed - check credentials", method: "failed" };
    }

    if (!response.ok) {
      return { online: false, message: `ISAPI status check failed: ${response.status}`, method: "failed" };
    }

    const xmlText = await response.text();
    const parsed = await parseStringPromise(xmlText, { explicitArray: false });

    const statusCode = parsed?.DeviceStatus?.statusCode || 
                       parsed?.ResponseStatus?.statusCode ||
                       parsed?.responseStatus?.statusCode;

    if (statusCode === "OK" || statusCode === "1" || response.ok) {
      return { online: true, message: "ISAPI system status OK", method: "isapi_status" };
    }

    return { online: false, message: `Unexpected status: ${statusCode}`, method: "failed" };
  } catch (error: any) {
    if (error.name === "AbortError") {
      return { online: false, message: "Connection timeout", method: "failed" };
    }
    return { online: false, message: error.message || "ISAPI status check failed", method: "failed" };
  }
}

async function checkIsapiSnapshot(camera: CameraCredentials): Promise<HealthCheckResult> {
  const client = new DigestFetch(camera.username, camera.password);
  const url = `http://${camera.ipAddress}/ISAPI/Streaming/channels/101/picture`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await client.fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 401) {
      return { online: false, message: "Authentication failed", method: "failed" };
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("image/jpeg") || contentType.includes("image/png")) {
      return { online: true, message: "Snapshot capture successful", method: "isapi_snapshot" };
    }

    if (response.ok) {
      return { online: true, message: "ISAPI endpoint responding", method: "isapi_snapshot" };
    }

    return { online: false, message: `Snapshot failed: ${response.status}`, method: "failed" };
  } catch (error: any) {
    if (error.name === "AbortError") {
      return { online: false, message: "Snapshot timeout", method: "failed" };
    }
    return { online: false, message: error.message || "Snapshot check failed", method: "failed" };
  }
}

async function checkRtspSocket(camera: CameraCredentials): Promise<HealthCheckResult> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const port = 554;

    socket.setTimeout(3000);

    socket.on("connect", () => {
      socket.destroy();
      resolve({ online: true, message: "RTSP port reachable", method: "rtsp_socket" });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ online: false, message: "RTSP connection timeout", method: "failed" });
    });

    socket.on("error", (err) => {
      socket.destroy();
      resolve({ online: false, message: `RTSP error: ${err.message}`, method: "failed" });
    });

    socket.connect(port, camera.ipAddress);
  });
}

export async function checkCameraHealth(camera: CameraCredentials): Promise<HealthCheckResult> {
  let result = await checkIsapiStatus(camera);
  if (result.online) return result;

  result = await checkIsapiSnapshot(camera);
  if (result.online) return result;

  result = await checkRtspSocket(camera);
  return result;
}

async function updateCameraStatus(cameraId: number, online: boolean, message: string): Promise<void> {
  const now = new Date();
  const updateData: Record<string, any> = {
    status: online ? "online" : "offline",
    statusMessage: message,
    lastCheckedAt: now,
  };

  if (online) {
    updateData.lastOnlineAt = now;
  }

  await db.update(cameras).set(updateData).where(eq(cameras.id, cameraId));
}

async function runHealthChecks(): Promise<void> {
  try {
    const allCameras = await db.select().from(cameras).where(eq(cameras.isActive, true));

    for (const camera of allCameras) {
      try {
        await db.update(cameras).set({ 
          status: "checking",
          lastCheckedAt: new Date(),
        }).where(eq(cameras.id, camera.id));

        const result = await checkCameraHealth({
          id: camera.id,
          name: camera.name,
          ipAddress: camera.ipAddress,
          username: camera.username,
          password: camera.password,
        });

        await updateCameraStatus(camera.id, result.online, result.message);

        console.log(`[Camera Health] ${camera.name}: ${result.online ? "ONLINE" : "OFFLINE"} (${result.method})`);
      } catch (error: any) {
        const errorMessage = error.message || "Health check error";
        console.error(`[Camera Health] Error checking ${camera.name}:`, errorMessage);
        await updateCameraStatus(camera.id, false, errorMessage);
      }
    }
  } catch (error: any) {
    console.error("[Camera Health] Failed to run health checks:", error.message || error);
  }
}

let healthCheckInterval: NodeJS.Timeout | null = null;

export function startCameraHealthService(intervalMs: number = 30000): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  console.log(`[Camera Health] Starting health check service (interval: ${intervalMs / 1000}s)`);

  runHealthChecks();

  healthCheckInterval = setInterval(runHealthChecks, intervalMs);
}

export function stopCameraHealthService(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    console.log("[Camera Health] Health check service stopped");
  }
}

export async function checkSingleCamera(cameraId: number): Promise<HealthCheckResult> {
  const [camera] = await db.select().from(cameras).where(eq(cameras.id, cameraId));

  if (!camera) {
    return { online: false, message: "Camera not found", method: "failed" };
  }

  try {
    await db.update(cameras).set({ 
      status: "checking",
      lastCheckedAt: new Date(),
    }).where(eq(cameras.id, cameraId));

    const result = await checkCameraHealth({
      id: camera.id,
      name: camera.name,
      ipAddress: camera.ipAddress,
      username: camera.username,
      password: camera.password,
    });

    await updateCameraStatus(cameraId, result.online, result.message);

    return result;
  } catch (error: any) {
    const errorMessage = error.message || "Health check failed unexpectedly";
    await updateCameraStatus(cameraId, false, errorMessage);
    console.error(`[Camera Health] Error checking camera ${camera.name}:`, errorMessage);
    return { online: false, message: errorMessage, method: "failed" };
  }
}
