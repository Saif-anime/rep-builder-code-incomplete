import sharp from "sharp";
import Tesseract from "tesseract.js";
import path from "path";
import fs from "fs";

/**
 * Hikvision-Optimized Timestamp Extraction Module
 * 
 * This module is specifically designed for extracting timestamps from Hikvision CCTV
 * camera overlay images used in parking enforcement systems.
 * 
 * Key Features:
 * - Targeted cropping of Hikvision overlay regions (bottom-left/bottom-right)
 * - Advanced image preprocessing (grayscale, contrast enhancement, thresholding)
 * - Strict character whitelist for timestamp OCR (0-9 : / -)
 * - 80% confidence threshold for legal enforcement reliability
 * - Regex validation for standard timestamp formats
 * - Structured output with detailed failure reasons
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type TimestampRegion = "bottom-left" | "bottom-right" | "top-left" | "top-right";

export type TimestampStatus = "TIMESTAMP_OK" | "NO_VALID_TIMESTAMP";

export type TimestampFailureReason = 
  | "LOW_OCR_CONFIDENCE" 
  | "FORMAT_NOT_MATCHED" 
  | "NOT_DETECTED"
  | "IMAGE_FILE_NOT_FOUND"
  | "OCR_EXTRACTION_ERROR"
  | null;

export interface HikvisionTimestampResult {
  status: TimestampStatus;
  reason: TimestampFailureReason;
  timestamp?: string;
  normalizedTimestamp?: string;
  parsedDate?: Date;
  confidence?: number;
  ocr_text?: string;
  format?: string;
  region?: TimestampRegion;
  reviewRequired: boolean;
  debugInfo?: {
    allCandidates: CandidateTimestamp[];
    rawTexts: string[];
    preprocessingApplied: string[];
  };
}

// Legacy interface for backward compatibility
export interface TimestampExtractionResult {
  success: boolean;
  timestamp: string | null;
  normalizedTimestamp: string | null;
  parsedDate: Date | null;
  confidence: number;
  rawOcrText: string;
  format: string | null;
  ocrEngine: "Tesseract";
  timestampRegion: TimestampRegion | null;
  source: "IMAGE_OVERLAY";
  reviewRequired: boolean;
  notes: string | null;
  failureReason: string | null;
}

interface CandidateTimestamp {
  timestamp: string;
  parsedDate: Date;
  format: string;
  hasSeconds: boolean;
  confidence: number;
  rawOcrText: string;
  region: TimestampRegion;
  charConfidences: number[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Strict 80% confidence threshold for legal enforcement
const OCR_CONFIDENCE_THRESHOLD = 80;

// Hikvision cameras typically place timestamps in bottom corners
// Priority order: bottom-left, bottom-right (most common for Hikvision)
const HIKVISION_PRIORITY_REGIONS: TimestampRegion[] = [
  "bottom-left",
  "bottom-right",
  "top-left",
  "top-right",
];

// Strict character whitelist for timestamp OCR
// Only digits and common separators - NO letters allowed
const TIMESTAMP_CHAR_WHITELIST = "0123456789-/:. ";

// Timestamp format validation patterns (DD/MM/YYYY HH:MM:SS and variants)
const TIMESTAMP_PATTERNS = [
  // DD-MM-YYYY HH:MM:SS (with optional day abbreviation - stripped before matching)
  {
    regex: /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "DD-MM-YYYY HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  // DD/MM/YYYY HH:MM:SS
  {
    regex: /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "DD/MM/YYYY HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  // DD-MM-YY HH:MM:SS (2-digit year)
  {
    regex: /(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "DD-MM-YY HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => {
      const year = parseInt(m[3]);
      const fullYear = year < 70 ? 2000 + year : 1900 + year;
      return new Date(fullYear, parseInt(m[2]) - 1, parseInt(m[1]),
        parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
      );
    },
  },
  // DD/MM/YY HH:MM:SS (2-digit year)
  {
    regex: /(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "DD/MM/YY HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => {
      const year = parseInt(m[3]);
      const fullYear = year < 70 ? 2000 + year : 1900 + year;
      return new Date(fullYear, parseInt(m[2]) - 1, parseInt(m[1]),
        parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
      );
    },
  },
  // YYYY-MM-DD HH:MM:SS (ISO format)
  {
    regex: /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "YYYY-MM-DD HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  // DD-MM-YYYY HH:MM (no seconds)
  {
    regex: /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/,
    format: "DD-MM-YYYY HH:MM",
    hasSeconds: false,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), 0
    ),
  },
  // DD/MM/YYYY HH:MM (no seconds)
  {
    regex: /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/,
    format: "DD/MM/YYYY HH:MM",
    hasSeconds: false,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), 0
    ),
  },
];

// ============================================================================
// REGION EXTRACTION
// ============================================================================

interface RegionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function getRegionBounds(region: TimestampRegion, imageWidth: number, imageHeight: number): RegionBounds {
  // Hikvision overlay is typically in a narrow strip at the bottom
  // Using 40% width and 12% height for focused extraction
  const overlayWidth = Math.round(imageWidth * 0.45);
  const overlayHeight = Math.round(imageHeight * 0.12);
  
  switch (region) {
    case "bottom-left":
      return {
        left: 0,
        top: imageHeight - overlayHeight,
        width: overlayWidth,
        height: overlayHeight,
      };
    case "bottom-right":
      return {
        left: imageWidth - overlayWidth,
        top: imageHeight - overlayHeight,
        width: overlayWidth,
        height: overlayHeight,
      };
    case "top-left":
      return {
        left: 0,
        top: 0,
        width: overlayWidth,
        height: overlayHeight,
      };
    case "top-right":
      return {
        left: imageWidth - overlayWidth,
        top: 0,
        width: overlayWidth,
        height: overlayHeight,
      };
  }
}

// ============================================================================
// IMAGE PREPROCESSING
// ============================================================================

interface PreprocessedImage {
  buffer: Buffer;
  method: string;
}

async function preprocessForOCR(
  imagePath: string,
  bounds: RegionBounds
): Promise<PreprocessedImage[]> {
  const results: PreprocessedImage[] = [];
  
  // Method 1: Grayscale + High Contrast + Sharpen
  // Best for clear white text on dark backgrounds
  try {
    const highContrast = await sharp(imagePath)
      .extract(bounds)
      .resize({ width: bounds.width * 3 }) // 3x upscale for better OCR
      .greyscale()
      .normalize() // Histogram equalization equivalent
      .linear(1.8, -40) // Increase contrast
      .sharpen({ sigma: 2 })
      .modulate({ brightness: 1.2 })
      .toBuffer();
    results.push({ buffer: highContrast, method: "high_contrast" });
  } catch (e) {
    console.error("[OCR Preprocess] high_contrast failed:", e);
  }
  
  // Method 2: Inverted (for dark text on light backgrounds)
  try {
    const inverted = await sharp(imagePath)
      .extract(bounds)
      .resize({ width: bounds.width * 3 })
      .greyscale()
      .negate()
      .normalize()
      .linear(1.5, -20)
      .sharpen({ sigma: 1.5 })
      .toBuffer();
    results.push({ buffer: inverted, method: "inverted" });
  } catch (e) {
    console.error("[OCR Preprocess] inverted failed:", e);
  }
  
  // Method 3: Binary threshold simulation (high contrast B&W)
  // Simulates OTSU thresholding using sharp's threshold
  try {
    const binary = await sharp(imagePath)
      .extract(bounds)
      .resize({ width: bounds.width * 3 })
      .greyscale()
      .normalize()
      .threshold(128) // Binary threshold
      .toBuffer();
    results.push({ buffer: binary, method: "binary_threshold" });
  } catch (e) {
    console.error("[OCR Preprocess] binary_threshold failed:", e);
  }
  
  // Method 4: Inverted binary threshold
  try {
    const invertedBinary = await sharp(imagePath)
      .extract(bounds)
      .resize({ width: bounds.width * 3 })
      .greyscale()
      .negate()
      .normalize()
      .threshold(128)
      .toBuffer();
    results.push({ buffer: invertedBinary, method: "inverted_binary" });
  } catch (e) {
    console.error("[OCR Preprocess] inverted_binary failed:", e);
  }
  
  // Method 5: Gaussian blur for noise reduction + contrast
  try {
    const denoised = await sharp(imagePath)
      .extract(bounds)
      .resize({ width: bounds.width * 3 })
      .greyscale()
      .blur(0.5) // Light Gaussian blur for noise reduction
      .normalize()
      .linear(1.6, -30)
      .sharpen({ sigma: 2.5 })
      .toBuffer();
    results.push({ buffer: denoised, method: "denoised_contrast" });
  } catch (e) {
    console.error("[OCR Preprocess] denoised_contrast failed:", e);
  }
  
  return results;
}

// ============================================================================
// OCR ENGINE
// ============================================================================

let tesseractWorker: Tesseract.Worker | null = null;
let workerInitializing = false;

async function getWorker(): Promise<Tesseract.Worker> {
  if (tesseractWorker) return tesseractWorker;
  
  if (workerInitializing) {
    while (!tesseractWorker) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return tesseractWorker;
  }
  
  workerInitializing = true;
  
  try {
    const worker = await Tesseract.createWorker("eng");
    // Strict whitelist: only digits and separators
    await worker.setParameters({
      tessedit_char_whitelist: TIMESTAMP_CHAR_WHITELIST,
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });
    tesseractWorker = worker;
    console.log("[OCR] Tesseract worker initialized with strict timestamp whitelist");
    return worker;
  } finally {
    workerInitializing = false;
  }
}

// ============================================================================
// TIMESTAMP PARSING & VALIDATION
// ============================================================================

function cleanOcrText(text: string): string {
  // Remove any non-whitelist characters that might have slipped through
  // Keep only digits, separators, and spaces
  return text
    .replace(/[^0-9\-\/:\s.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidDate(date: Date): boolean {
  if (isNaN(date.getTime())) return false;
  const year = date.getFullYear();
  // Reasonable year range for CCTV footage
  return year >= 2000 && year <= 2100;
}

function parseTimestampFromText(text: string): {
  timestamp: string;
  parsedDate: Date;
  format: string;
  hasSeconds: boolean;
} | null {
  const cleanedText = cleanOcrText(text);
  
  for (const pattern of TIMESTAMP_PATTERNS) {
    const match = cleanedText.match(pattern.regex);
    if (match) {
      const parsed = pattern.parse(match);
      if (isValidDate(parsed)) {
        return {
          timestamp: match[0],
          parsedDate: parsed,
          format: pattern.format,
          hasSeconds: pattern.hasSeconds,
        };
      }
    }
  }
  
  return null;
}

function normalizeToStandardFormat(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

function calculateAverageCharConfidence(words: Tesseract.Word[] | undefined | null): number[] {
  const confidences: number[] = [];
  if (!words || !Array.isArray(words)) {
    return confidences;
  }
  for (const word of words) {
    if (word && word.symbols && Array.isArray(word.symbols)) {
      for (const symbol of word.symbols) {
        if (symbol && typeof symbol.confidence === 'number') {
          confidences.push(symbol.confidence);
        }
      }
    }
  }
  return confidences;
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

export async function extractHikvisionTimestamp(imagePath: string): Promise<HikvisionTimestampResult> {
  console.log("[OCR Hikvision] Starting timestamp extraction from:", imagePath);
  
  const fullPath = path.join(process.cwd(), imagePath.startsWith("/") ? imagePath.slice(1) : imagePath);
  
  if (!fs.existsSync(fullPath)) {
    console.error("[OCR Hikvision] Image not found:", fullPath);
    return {
      status: "NO_VALID_TIMESTAMP",
      reason: "IMAGE_FILE_NOT_FOUND",
      reviewRequired: true,
    };
  }
  
  try {
    const metadata = await sharp(fullPath).metadata();
    const imageWidth = metadata.width || 1920;
    const imageHeight = metadata.height || 1080;
    
    const worker = await getWorker();
    const candidates: CandidateTimestamp[] = [];
    const rawTexts: string[] = [];
    const preprocessingApplied: string[] = [];
    
    // Process priority regions (Hikvision typically uses bottom corners)
    for (const region of HIKVISION_PRIORITY_REGIONS) {
      console.log(`[OCR Hikvision] Processing region: ${region}`);
      
      const bounds = getRegionBounds(region, imageWidth, imageHeight);
      
      try {
        const preprocessedImages = await preprocessForOCR(fullPath, bounds);
        
        for (const { buffer, method } of preprocessedImages) {
          try {
            const { data } = await worker.recognize(buffer);
            const ocrText = data.text;
            const ocrConfidence = data.confidence;
            
            rawTexts.push(`[${region}/${method}] ${ocrText.trim()} (${ocrConfidence.toFixed(1)}%)`);
            preprocessingApplied.push(`${region}/${method}`);
            
            console.log(`[OCR Hikvision] ${region}/${method}: "${ocrText.trim()}" (conf: ${ocrConfidence.toFixed(1)}%)`);
            
            // Parse FIRST before any other processing
            const parsed = parseTimestampFromText(ocrText);
            if (parsed) {
              // Calculate per-character confidence (safe - won't throw)
              const charConfidences = calculateAverageCharConfidence(data.words);
              
              candidates.push({
                timestamp: parsed.timestamp,
                parsedDate: parsed.parsedDate,
                format: parsed.format,
                hasSeconds: parsed.hasSeconds,
                confidence: ocrConfidence,
                rawOcrText: ocrText.trim(),
                region: region,
                charConfidences: charConfidences,
              });
              console.log(`[OCR Hikvision] CANDIDATE: ${parsed.timestamp} from ${region}/${method} (${ocrConfidence.toFixed(1)}%)`);
            }
          } catch (ocrError: any) {
            console.error(`[OCR Hikvision] ${region}/${method} OCR failed:`, ocrError.message);
          }
        }
      } catch (regionError: any) {
        console.error(`[OCR Hikvision] Region ${region} extraction failed:`, regionError.message);
      }
    }
    
    // No candidates found
    if (candidates.length === 0) {
      console.log("[OCR Hikvision] NO_VALID_TIMESTAMP - No timestamp patterns detected in any region");
      return {
        status: "NO_VALID_TIMESTAMP",
        reason: "NOT_DETECTED",
        reviewRequired: true,
        debugInfo: {
          allCandidates: [],
          rawTexts: rawTexts,
          preprocessingApplied: preprocessingApplied,
        },
      };
    }
    
    // Sort candidates: prefer high confidence + seconds + bottom regions
    candidates.sort((a, b) => {
      // First priority: above threshold
      const aAboveThreshold = a.confidence >= OCR_CONFIDENCE_THRESHOLD;
      const bAboveThreshold = b.confidence >= OCR_CONFIDENCE_THRESHOLD;
      if (aAboveThreshold && !bAboveThreshold) return -1;
      if (bAboveThreshold && !aAboveThreshold) return 1;
      
      // Second priority: has seconds
      if (a.hasSeconds && !b.hasSeconds) return -1;
      if (b.hasSeconds && !a.hasSeconds) return 1;
      
      // Third priority: bottom regions (Hikvision standard)
      const aIsBottom = a.region.startsWith("bottom");
      const bIsBottom = b.region.startsWith("bottom");
      if (aIsBottom && !bIsBottom) return -1;
      if (bIsBottom && !aIsBottom) return 1;
      
      // Final: highest confidence
      return b.confidence - a.confidence;
    });
    
    const bestCandidate = candidates[0];
    
    // STRICT: Reject if below 80% confidence threshold
    if (bestCandidate.confidence < OCR_CONFIDENCE_THRESHOLD) {
      console.log(`[OCR Hikvision] REJECTED - Confidence ${bestCandidate.confidence.toFixed(1)}% < ${OCR_CONFIDENCE_THRESHOLD}% threshold`);
      return {
        status: "NO_VALID_TIMESTAMP",
        reason: "LOW_OCR_CONFIDENCE",
        timestamp: bestCandidate.timestamp,
        confidence: bestCandidate.confidence,
        ocr_text: bestCandidate.rawOcrText,
        format: bestCandidate.format,
        region: bestCandidate.region,
        reviewRequired: true,
        debugInfo: {
          allCandidates: candidates,
          rawTexts: rawTexts,
          preprocessingApplied: preprocessingApplied,
        },
      };
    }
    
    // SUCCESS: Valid timestamp with sufficient confidence
    const normalizedTimestamp = normalizeToStandardFormat(bestCandidate.parsedDate);
    
    console.log(`[OCR Hikvision] SUCCESS: ${bestCandidate.timestamp} -> ${normalizedTimestamp} (${bestCandidate.region}, ${bestCandidate.confidence.toFixed(1)}%)`);
    
    return {
      status: "TIMESTAMP_OK",
      reason: null,
      timestamp: bestCandidate.timestamp,
      normalizedTimestamp: normalizedTimestamp,
      parsedDate: bestCandidate.parsedDate,
      confidence: bestCandidate.confidence,
      ocr_text: bestCandidate.rawOcrText,
      format: bestCandidate.format,
      region: bestCandidate.region,
      reviewRequired: false,
      debugInfo: {
        allCandidates: candidates,
        rawTexts: rawTexts,
        preprocessingApplied: preprocessingApplied,
      },
    };
    
  } catch (error: any) {
    console.error("[OCR Hikvision] Extraction error:", error.message);
    return {
      status: "NO_VALID_TIMESTAMP",
      reason: "OCR_EXTRACTION_ERROR",
      reviewRequired: true,
    };
  }
}

// ============================================================================
// LEGACY COMPATIBILITY WRAPPER
// ============================================================================

export async function extractTimestampFromImage(imagePath: string): Promise<TimestampExtractionResult> {
  const result = await extractHikvisionTimestamp(imagePath);
  
  // Convert new format to legacy format
  return {
    success: result.status === "TIMESTAMP_OK",
    timestamp: result.timestamp || "NO_VALID_TIMESTAMP",
    normalizedTimestamp: result.normalizedTimestamp || null,
    parsedDate: result.parsedDate || null,
    confidence: result.confidence || 0,
    rawOcrText: result.ocr_text || "",
    format: result.format || null,
    ocrEngine: "Tesseract",
    timestampRegion: result.region || null,
    source: "IMAGE_OVERLAY",
    reviewRequired: result.reviewRequired,
    notes: result.reason ? `Rejection reason: ${result.reason}` : null,
    failureReason: result.reason || null,
  };
}

export async function extractTimestampsFromMultipleImages(
  imagePaths: string[]
): Promise<Map<string, TimestampExtractionResult>> {
  const results = new Map<string, TimestampExtractionResult>();
  
  for (const imagePath of imagePaths) {
    const result = await extractTimestampFromImage(imagePath);
    results.set(imagePath, result);
  }
  
  return results;
}
