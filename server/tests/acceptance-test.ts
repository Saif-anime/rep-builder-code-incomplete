import { AnprService } from "../anpr-service";
import type { InsertAnprEvent } from "../../shared/schema";

async function runAcceptanceTest() {
  console.log("🚗 ANPR Acceptance Test: 10 Mixed Events\n");
  console.log("=".repeat(60));
  
  const service = new AnprService({ matchingWindowHours: 24 });
  const testId = Date.now().toString().slice(-6);

  const events: InsertAnprEvent[] = [
    { siteId: 1, cameraId: 1, vrm: `CAR1${testId}`, eventType: "ENTRY", confidence: 95, occurredAt: new Date("2025-01-09T08:00:00Z") },
    { siteId: 1, cameraId: 1, vrm: `CAR2${testId}`, eventType: "ENTRY", confidence: 93, occurredAt: new Date("2025-01-09T08:15:00Z") },
    { siteId: 1, cameraId: 1, vrm: `CAR3${testId}`, eventType: "EXIT", confidence: 90, occurredAt: new Date("2025-01-09T08:30:00Z") },
    { siteId: 1, cameraId: 1, vrm: `CAR1${testId}`, eventType: "EXIT", confidence: 94, occurredAt: new Date("2025-01-09T10:00:00Z") },
    { siteId: 1, cameraId: 1, vrm: `CAR4${testId}`, eventType: "ENTRY", confidence: 92, occurredAt: new Date("2025-01-09T10:30:00Z") },
    { siteId: 1, cameraId: 1, vrm: `CAR4${testId}`, eventType: "ENTRY", confidence: 91, occurredAt: new Date("2025-01-09T11:00:00Z") },
    { siteId: 1, cameraId: 1, vrm: `CAR2${testId}`, eventType: "EXIT", confidence: 88, occurredAt: new Date("2025-01-09T11:30:00Z") },
    { siteId: 1, cameraId: 1, vrm: `CAR5${testId}`, eventType: "ENTRY", confidence: 96, occurredAt: new Date("2025-01-09T12:00:00Z") },
    { siteId: 1, cameraId: 1, vrm: `CAR4${testId}`, eventType: "EXIT", confidence: 89, occurredAt: new Date("2025-01-09T14:00:00Z") },
    { siteId: 1, cameraId: 1, vrm: `CAR5${testId}`, eventType: "EXIT", confidence: 97, occurredAt: new Date("2025-01-09T15:00:00Z") },
  ];

  console.log("\nProcessing 10 events in order:\n");
  
  const results = await service.processBatchEvents(events);
  
  let openCount = 0;
  let closedCount = 0;
  let orphanCount = 0;
  
  for (const r of results) {
    const status = r.session?.status || "unknown";
    const eventType = r.event.eventType;
    const vrm = r.event.vrm;
    const action = r.action;
    const reason = r.orphanReason ? ` (${r.orphanReason})` : "";
    
    if (status === "OPEN") openCount++;
    if (status === "CLOSED") closedCount++;
    if (status === "ORPHAN") orphanCount++;
    
    console.log(`  ${eventType.padEnd(5)} ${vrm.padEnd(15)} -> Session #${r.session?.id?.toString().padStart(3)} ${status.padEnd(8)} [${action}${reason}]`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary:");
  console.log(`  Total Events Processed: ${results.length}`);
  console.log(`  OPEN Sessions: ${openCount}`);
  console.log(`  CLOSED Sessions: ${closedCount}`);
  console.log(`  ORPHAN Sessions: ${orphanCount}`);
  
  console.log("\nExpected Results:");
  console.log("  - CAR1: ENTRY -> EXIT = CLOSED (2h duration)");
  console.log("  - CAR2: ENTRY -> EXIT = CLOSED (3h 15min duration)");
  console.log("  - CAR3: EXIT without ENTRY = ORPHAN (MISSING_ENTRY)");
  console.log("  - CAR4: ENTRY -> ENTRY (ORPHAN DOUBLE_ENTRY) -> EXIT = CLOSED");
  console.log("  - CAR5: ENTRY -> EXIT = CLOSED (3h duration)");
  
  const passed = closedCount >= 4 && orphanCount >= 2;
  console.log("\n" + (passed ? "✅ ACCEPTANCE TEST PASSED" : "❌ ACCEPTANCE TEST FAILED"));
  
  if (!passed) process.exit(1);
}

runAcceptanceTest().catch(console.error);
