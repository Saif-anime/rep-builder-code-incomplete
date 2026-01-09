import { AnprService } from "../anpr-service";
import type { InsertAnprEvent } from "../../shared/schema";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log("🧪 Running ANPR Pairing Tests...\n");
  const service = new AnprService({ matchingWindowHours: 24 });
  
  const baseTime = new Date("2025-01-09T10:00:00Z");
  const testId = Date.now().toString().slice(-6);
  
  let testsPassed = 0;
  let testsFailed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      testsPassed++;
    } catch (error: any) {
      console.log(`❌ ${name}: ${error.message}`);
      testsFailed++;
    }
  }

  await test("1. Simple ENTRY creates OPEN session", async () => {
    const vrm = `T1${testId}`;
    const event: InsertAnprEvent = {
      siteId: 1,
      cameraId: 1,
      vrm,
      eventType: "ENTRY",
      confidence: 95,
      occurredAt: baseTime,
    };
    const result = await service.processEvent(event);
    assert(result.action === "created_session", `Expected created_session, got ${result.action}`);
    assert(result.session?.status === "OPEN", `Expected OPEN session, got ${result.session?.status}`);
    assert(result.session?.vrm === vrm, "VRM should be normalized");
    console.log(`   Session ID: ${result.session?.id}, Status: ${result.session?.status}`);
  });

  await test("2. EXIT without matching ENTRY creates ORPHAN with MISSING_ENTRY reason", async () => {
    const vrm = `T2${testId}`;
    const event: InsertAnprEvent = {
      siteId: 1,
      cameraId: 1,
      vrm,
      eventType: "EXIT",
      confidence: 90,
      occurredAt: baseTime,
    };
    const result = await service.processEvent(event);
    assert(result.action === "created_orphan", `Expected created_orphan, got ${result.action}`);
    assert(result.orphanReason === "MISSING_ENTRY", `Expected MISSING_ENTRY, got ${result.orphanReason}`);
    assert(result.session?.status === "ORPHAN", `Expected ORPHAN session`);
    console.log(`   Orphan Reason: ${result.orphanReason}`);
  });

  await test("3. VRM normalization (whitespace removal, uppercase)", async () => {
    const rawVrm = `  t3 ${testId}  `;
    const normalizedVrm = `T3${testId}`;
    const event: InsertAnprEvent = {
      siteId: 1,
      cameraId: 1,
      vrm: rawVrm,
      eventType: "ENTRY",
      confidence: 95,
      occurredAt: new Date(baseTime.getTime() + 1000),
    };
    const result = await service.processEvent(event);
    assert(result.event.vrm === normalizedVrm, `Expected normalized VRM ${normalizedVrm}, got ${result.event.vrm}`);
    console.log(`   Original: "${rawVrm}" -> Normalized: "${result.event.vrm}"`);
  });

  await test("4. ENTRY then EXIT pairs correctly to CLOSED session", async () => {
    const entryVrm = `T4${testId}`;
    const entryTime = new Date(baseTime.getTime() + 10000);
    const exitTime = new Date(entryTime.getTime() + 3600000);

    const entryResult = await service.processEvent({
      siteId: 1,
      cameraId: 1,
      vrm: entryVrm,
      eventType: "ENTRY",
      confidence: 95,
      occurredAt: entryTime,
    });
    assert(entryResult.session?.status === "OPEN", "Entry should create OPEN session");

    const exitResult = await service.processEvent({
      siteId: 1,
      cameraId: 1,
      vrm: entryVrm,
      eventType: "EXIT",
      confidence: 92,
      occurredAt: exitTime,
    });
    assert(exitResult.action === "closed_session", `Expected closed_session, got ${exitResult.action}`);
    assert(exitResult.session?.status === "CLOSED", "Session should be CLOSED");
    assert(exitResult.session?.durationMinutes === 60, `Expected 60 min duration, got ${exitResult.session?.durationMinutes}`);
    console.log(`   Duration: ${exitResult.session?.durationMinutes} minutes`);
  });

  await test("5. DOUBLE_ENTRY creates ORPHAN session", async () => {
    const doubleVrm = `T5${testId}`;
    const firstEntry = new Date(baseTime.getTime() + 100000);
    const secondEntry = new Date(firstEntry.getTime() + 1800000);

    const first = await service.processEvent({
      siteId: 1,
      cameraId: 1,
      vrm: doubleVrm,
      eventType: "ENTRY",
      confidence: 95,
      occurredAt: firstEntry,
    });
    assert(first.session?.status === "OPEN", "First entry creates OPEN session");

    const second = await service.processEvent({
      siteId: 1,
      cameraId: 1,
      vrm: doubleVrm,
      eventType: "ENTRY",
      confidence: 93,
      occurredAt: secondEntry,
    });
    assert(second.action === "created_orphan", `Expected created_orphan, got ${second.action}`);
    assert(second.orphanReason === "DOUBLE_ENTRY", `Expected DOUBLE_ENTRY, got ${second.orphanReason}`);
    console.log(`   Double entry detected for VRM ${doubleVrm}`);
  });

  await test("6. Multiple entries for same VRM at same site create orphans except first", async () => {
    const multiVrm = `T6${testId}`;
    const time = new Date(baseTime.getTime() + 200000);

    const firstEntry = await service.processEvent({
      siteId: 1,
      cameraId: 1,
      vrm: multiVrm,
      eventType: "ENTRY",
      confidence: 95,
      occurredAt: time,
    });
    assert(firstEntry.session?.status === "OPEN", "First entry creates OPEN session");

    const secondEntry = await service.processEvent({
      siteId: 1,
      cameraId: 1,
      vrm: multiVrm,
      eventType: "ENTRY",
      confidence: 94,
      occurredAt: new Date(time.getTime() + 60000),
    });
    assert(secondEntry.action === "created_orphan", "Second entry should create orphan");
    assert(secondEntry.orphanReason === "DOUBLE_ENTRY", "Should be DOUBLE_ENTRY reason");
    console.log(`   First Session: ${firstEntry.session?.id} (OPEN), Second: ${secondEntry.session?.id} (ORPHAN)`);
  });

  await test("7. Batch events processed in chronological order", async () => {
    const batchVrm = `T7${testId}`;
    const events: InsertAnprEvent[] = [
      { siteId: 1, cameraId: 1, vrm: batchVrm, eventType: "EXIT", confidence: 90, occurredAt: new Date("2025-01-09T12:00:00Z") },
      { siteId: 1, cameraId: 1, vrm: batchVrm, eventType: "ENTRY", confidence: 95, occurredAt: new Date("2025-01-09T11:00:00Z") },
    ];

    const results = await service.processBatchEvents(events);
    assert(results.length === 2, "Should process 2 events");
    assert(results[0].event.eventType === "ENTRY", "First processed should be ENTRY (earlier timestamp)");
    assert(results[1].event.eventType === "EXIT", "Second processed should be EXIT");
    assert(results[1].action === "closed_session", "EXIT should close the session from ENTRY");
    console.log(`   Events processed in order: ENTRY @ 11:00, EXIT @ 12:00`);
  });

  await test("8. Exit outside matching window creates ORPHAN", async () => {
    const windowService = new AnprService({ matchingWindowHours: 1 });
    const windowVrm = `T8${testId}`;
    const entryTime = new Date("2025-01-09T08:00:00Z");
    const exitTime = new Date("2025-01-09T15:00:00Z");

    await windowService.processEvent({
      siteId: 1,
      cameraId: 1,
      vrm: windowVrm,
      eventType: "ENTRY",
      confidence: 95,
      occurredAt: entryTime,
    });

    const exitResult = await windowService.processEvent({
      siteId: 1,
      cameraId: 1,
      vrm: windowVrm,
      eventType: "EXIT",
      confidence: 92,
      occurredAt: exitTime,
    });
    
    assert(exitResult.action === "created_orphan", "Exit 7 hours after entry with 1h window should create orphan");
    assert(exitResult.orphanReason === "MISSING_ENTRY", "Reason should be MISSING_ENTRY (no match in window)");
    console.log(`   Entry: 08:00, Exit: 15:00, Window: 1h -> ORPHAN`);
  });

  console.log("\n" + "=".repeat(50));
  console.log(`Tests completed: ${testsPassed} passed, ${testsFailed} failed`);
  
  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
