interface DVLAVehicleResponse {
  registrationNumber: string;
  make?: string;
  model?: string;
  colour?: string;
  fuelType?: string;
  taxStatus?: string;
  taxDueDate?: string;
  motStatus?: string;
  motExpiryDate?: string;
  engineCapacity?: number;
  co2Emissions?: number;
  yearOfManufacture?: number;
  monthOfFirstRegistration?: string;
  dateOfLastV5CIssued?: string;
  typeApproval?: string;
  wheelplan?: string;
  revenueWeight?: number;
  euroStatus?: string;
  realDrivingEmissions?: string;
  markedForExport?: boolean;
}

interface DVLALookupResult {
  success: boolean;
  data?: DVLAVehicleResponse;
  error?: string;
  errorCode?: string;
}

const DVLA_API_URL = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";

function getDVLAApiKey(): string {
  const key = process.env.DVLA_API_KEY;
  if (!key) {
    console.warn("[DVLA] API key not configured - DVLA lookups will fail");
    return "";
  }
  return key;
}

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const MAX_REQUESTS_PER_CASE = 3;
const RATE_LIMIT_WINDOW_MS = 60000;

function checkRateLimit(caseId: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(caseId);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(caseId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (record.count >= MAX_REQUESTS_PER_CASE) {
    console.log(`[DVLA] Rate limit exceeded for case ${caseId}`);
    return false;
  }
  
  record.count++;
  return true;
}

export function normalizeRegistration(plate: string): string {
  if (!plate) return "";
  return plate
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function validateUKRegistration(plate: string): boolean {
  const normalized = normalizeRegistration(plate);
  if (normalized.length < 2 || normalized.length > 8) return false;
  
  const patterns = [
    /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/,
    /^[A-Z][0-9]{1,3}[A-Z]{3}$/,
    /^[A-Z]{3}[0-9]{1,3}[A-Z]$/,
    /^[0-9]{1,4}[A-Z]{1,3}$/,
    /^[A-Z]{1,3}[0-9]{1,4}$/,
    /^[A-Z]{1,2}[0-9]{1,4}$/,
  ];
  
  return patterns.some(pattern => pattern.test(normalized));
}

async function makeAPICall(registrationNumber: string): Promise<DVLALookupResult> {
  const apiKey = getDVLAApiKey();
  if (!apiKey) {
    return { success: false, error: "DVLA API key not configured", errorCode: "NO_API_KEY" };
  }

  try {
    const response = await fetch(DVLA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ registrationNumber }),
    });

    if (response.status === 200) {
      const data = await response.json() as DVLAVehicleResponse;
      return { success: true, data };
    }

    if (response.status === 404) {
      return { success: false, error: "Vehicle not found in DVLA database", errorCode: "NOT_FOUND" };
    }

    if (response.status === 400) {
      return { success: false, error: "Invalid registration format", errorCode: "INVALID_FORMAT" };
    }

    if (response.status === 429) {
      return { success: false, error: "DVLA API rate limit exceeded", errorCode: "RATE_LIMITED" };
    }

    if (response.status === 500 || response.status === 503) {
      return { success: false, error: "DVLA service temporarily unavailable", errorCode: "SERVICE_ERROR" };
    }

    return { success: false, error: `DVLA API error: ${response.status}`, errorCode: "UNKNOWN_ERROR" };
  } catch (error: any) {
    console.error("[DVLA] API call failed:", error.message);
    return { success: false, error: `Network error: ${error.message}`, errorCode: "NETWORK_ERROR" };
  }
}

export async function lookupVehicle(
  registrationNumber: string,
  caseId: string
): Promise<DVLALookupResult> {
  const normalized = normalizeRegistration(registrationNumber);
  
  if (!normalized) {
    return { success: false, error: "Empty registration number", errorCode: "EMPTY_INPUT" };
  }

  if (!validateUKRegistration(normalized)) {
    console.log(`[DVLA] Invalid UK registration format: ${normalized}`);
    return { success: false, error: "Invalid UK registration format", errorCode: "INVALID_FORMAT" };
  }

  if (!checkRateLimit(caseId)) {
    return { success: false, error: "Rate limit exceeded for this case", errorCode: "CASE_RATE_LIMIT" };
  }

  console.log(`[DVLA] Looking up vehicle: ${normalized} for case ${caseId}`);

  let result = await makeAPICall(normalized);
  
  if (!result.success && result.errorCode === "SERVICE_ERROR") {
    console.log("[DVLA] Retrying after service error...");
    await new Promise(resolve => setTimeout(resolve, 1000));
    result = await makeAPICall(normalized);
  }

  if (result.success) {
    console.log(`[DVLA] Vehicle found: ${result.data?.make} ${result.data?.model} (${result.data?.colour})`);
  } else {
    console.log(`[DVLA] Lookup failed: ${result.error}`);
  }

  return result;
}

export async function lookupAndStorePlate(
  caseId: string,
  plateReadings: Array<{ reading: string; confidence: number; evidenceId?: number; bundleId?: number }>,
  sourceEvidenceIds: number[],
  sourceBundleIds: number[],
  storage: any
): Promise<{ success: boolean; vehicleId?: number; error?: string }> {
  if (!plateReadings.length) {
    return { success: false, error: "No plate readings provided" };
  }

  const normalizedReadings = plateReadings.map(r => ({
    ...r,
    normalized: normalizeRegistration(r.reading),
  }));

  const readingCounts: Record<string, number> = {};
  for (const r of normalizedReadings) {
    if (r.normalized) {
      readingCounts[r.normalized] = (readingCounts[r.normalized] || 0) + 1;
    }
  }

  const sortedReadings = Object.entries(readingCounts).sort((a, b) => b[1] - a[1]);
  
  if (sortedReadings.length === 0) {
    return { success: false, error: "No valid plate readings after normalization" };
  }

  const hasConflict = sortedReadings.length > 1 && sortedReadings[0][1] === sortedReadings[1][1];
  const primaryPlate = sortedReadings[0][0];
  const bestReading = normalizedReadings.find(r => r.normalized === primaryPlate);
  const confidence = bestReading?.confidence ?? 0.5;

  const existingVehicle = await storage.getCaseVehicleByPlate(caseId, primaryPlate);
  if (existingVehicle) {
    console.log(`[DVLA] Vehicle ${primaryPlate} already exists for case ${caseId}`);
    return { success: true, vehicleId: existingVehicle.id };
  }

  if (hasConflict) {
    const conflictDetails = sortedReadings.map(([plate, count]) => `${plate}: ${count} readings`).join(", ");
    console.log(`[DVLA] Conflict detected for case ${caseId}: ${conflictDetails}`);
    
    const vehicleId = await storage.createCaseVehicle({
      caseId,
      registrationNumber: primaryPlate,
      confidenceScore: confidence,
      sourceEvidenceIds,
      sourceBundleIds,
      detectionMethod: "vision_gpt",
      plateReadings,
      conflictDetected: true,
      conflictDetails: `Multiple plates detected with equal frequency: ${conflictDetails}`,
      dvlaVerified: false,
    });
    
    return { success: false, vehicleId, error: "Conflicting plate readings - manual review required" };
  }

  const dvlaResult = await lookupVehicle(primaryPlate, caseId);

  const vehicleId = await storage.createCaseVehicle({
    caseId,
    registrationNumber: primaryPlate,
    make: dvlaResult.data?.make,
    model: dvlaResult.data?.model,
    colour: dvlaResult.data?.colour,
    fuelType: dvlaResult.data?.fuelType,
    taxStatus: dvlaResult.data?.taxStatus,
    taxDueDate: dvlaResult.data?.taxDueDate,
    motStatus: dvlaResult.data?.motStatus,
    motExpiryDate: dvlaResult.data?.motExpiryDate,
    engineCapacity: dvlaResult.data?.engineCapacity,
    co2Emissions: dvlaResult.data?.co2Emissions,
    yearOfManufacture: dvlaResult.data?.yearOfManufacture,
    firstRegistrationDate: dvlaResult.data?.monthOfFirstRegistration,
    wheelplan: dvlaResult.data?.wheelplan,
    revenueWeight: dvlaResult.data?.revenueWeight,
    euroStatus: dvlaResult.data?.euroStatus,
    markedForExport: dvlaResult.data?.markedForExport,
    confidenceScore: confidence,
    sourceEvidenceIds,
    sourceBundleIds,
    detectionMethod: "vision_gpt",
    plateReadings,
    conflictDetected: false,
    dvlaVerified: dvlaResult.success,
    dvlaLookupError: dvlaResult.error,
  });

  if (dvlaResult.success) {
    await storage.updateCaseVehicleVerified(vehicleId);
  }

  return { 
    success: dvlaResult.success, 
    vehicleId,
    error: dvlaResult.error 
  };
}
