import sharp from "sharp";
import Tesseract from "tesseract.js";
import path from "path";
import fs from "fs";

export type TimestampRegion = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-right";

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
}

const TIMESTAMP_PATTERNS = [
  {
    regex: /(\d{2})-(\d{2})-(\d{4})\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2}):(\d{2})/i,
    format: "DD-MM-YYYY Day HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{2})\/(\d{2})\/(\d{4})\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2}):(\d{2})/i,
    format: "DD/MM/YYYY Day HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "DD-MM-YYYY HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "DD/MM/YYYY HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "YYYY-MM-DD HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "YYYY/MM/DD HH:MM:SS",
    hasSeconds: true,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/,
    format: "DD-MM-YYYY HH:MM",
    hasSeconds: false,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), 0
    ),
  },
  {
    regex: /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/,
    format: "DD/MM/YYYY HH:MM",
    hasSeconds: false,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), 0
    ),
  },
  {
    regex: /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/,
    format: "YYYY-MM-DD HH:MM",
    hasSeconds: false,
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), 0
    ),
  },
];

const OCR_REJECTION_THRESHOLD = 80;
const REVIEW_REQUIRED_THRESHOLD = 85;

function isValidDate(date: Date): boolean {
  if (isNaN(date.getTime())) return false;
  const year = date.getFullYear();
  return year >= 2020 && year <= 2030;
}

function normalizeToStandardFormat(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

interface RegionConfig {
  name: TimestampRegion;
  extract: (width: number, height: number) => { left: number; top: number; width: number; height: number };
}

const REGIONS: RegionConfig[] = [
  {
    name: "top-left",
    extract: (w, h) => ({ left: 0, top: 0, width: Math.round(w * 0.5), height: Math.round(h * 0.15) }),
  },
  {
    name: "top-center",
    extract: (w, h) => ({ left: Math.round(w * 0.25), top: 0, width: Math.round(w * 0.5), height: Math.round(h * 0.15) }),
  },
  {
    name: "top-right",
    extract: (w, h) => ({ left: Math.round(w * 0.5), top: 0, width: Math.round(w * 0.5), height: Math.round(h * 0.15) }),
  },
  {
    name: "bottom-left",
    extract: (w, h) => ({ left: 0, top: Math.round(h * 0.85), width: Math.round(w * 0.5), height: Math.round(h * 0.15) }),
  },
  {
    name: "bottom-right",
    extract: (w, h) => ({ left: Math.round(w * 0.5), top: Math.round(h * 0.85), width: Math.round(w * 0.5), height: Math.round(h * 0.15) }),
  },
];

async function extractRegion(
  imagePath: string, 
  region: RegionConfig
): Promise<{ buffer: Buffer; region: TimestampRegion }[]> {
  const fullPath = path.join(process.cwd(), imagePath.startsWith("/") ? imagePath.slice(1) : imagePath);
  const metadata = await sharp(fullPath).metadata();
  const width = metadata.width || 1920;
  const height = metadata.height || 1080;
  
  const bounds = region.extract(width, height);
  
  const preprocessedBuffers: { buffer: Buffer; region: TimestampRegion }[] = [];
  
  const standard = await sharp(fullPath)
    .extract(bounds)
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .toBuffer();
  preprocessedBuffers.push({ buffer: standard, region: region.name });
  
  const highContrast = await sharp(fullPath)
    .extract(bounds)
    .greyscale()
    .normalize()
    .linear(1.5, -20)
    .sharpen({ sigma: 2 })
    .toBuffer();
  preprocessedBuffers.push({ buffer: highContrast, region: region.name });
  
  const inverted = await sharp(fullPath)
    .extract(bounds)
    .greyscale()
    .negate()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .toBuffer();
  preprocessedBuffers.push({ buffer: inverted, region: region.name });
  
  const scaled = await sharp(fullPath)
    .extract(bounds)
    .resize({ width: bounds.width * 2 })
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .toBuffer();
  preprocessedBuffers.push({ buffer: scaled, region: region.name });
  
  return preprocessedBuffers;
}

function parseTimestampFromText(text: string): { 
  timestamp: string; 
  parsedDate: Date; 
  format: string;
  hasSeconds: boolean;
} | null {
  const cleanedText = text.replace(/\s+/g, " ").trim();
  
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
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789-/: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });
    tesseractWorker = worker;
    console.log("[OCR] Tesseract worker initialized");
    return worker;
  } finally {
    workerInitializing = false;
  }
}

interface CandidateTimestamp {
  timestamp: string;
  parsedDate: Date;
  format: string;
  hasSeconds: boolean;
  confidence: number;
  rawOcrText: string;
  region: TimestampRegion;
}

export async function extractTimestampFromImage(imagePath: string): Promise<TimestampExtractionResult> {
  console.log("[OCR] Extracting timestamp from:", imagePath);
  
  const fullPath = path.join(process.cwd(), imagePath.startsWith("/") ? imagePath.slice(1) : imagePath);
  if (!fs.existsSync(fullPath)) {
    console.error("[OCR] Image not found:", fullPath);
    return {
      success: false,
      timestamp: "NO_VALID_TIMESTAMP",
      normalizedTimestamp: null,
      parsedDate: null,
      confidence: 0,
      rawOcrText: "",
      format: null,
      ocrEngine: "Tesseract",
      timestampRegion: null,
      source: "IMAGE_OVERLAY",
      reviewRequired: true,
      notes: "Image file not found",
    };
  }
  
  try {
    const worker = await getWorker();
    const candidates: CandidateTimestamp[] = [];
    let allRawTexts: string[] = [];
    
    for (const regionConfig of REGIONS) {
      console.log(`[OCR] Scanning region: ${regionConfig.name}`);
      
      try {
        const regionBuffers = await extractRegion(imagePath, regionConfig);
        
        for (let i = 0; i < regionBuffers.length; i++) {
          const { buffer, region } = regionBuffers[i];
          
          try {
            const { data } = await worker.recognize(buffer);
            const ocrText = data.text;
            const ocrConfidence = data.confidence;
            allRawTexts.push(`[${region}] ${ocrText.trim()}`);
            
            console.log(`[OCR] ${region} pass ${i + 1}: "${ocrText.trim()}" (conf: ${ocrConfidence.toFixed(1)}%)`);
            
            const parsed = parseTimestampFromText(ocrText);
            if (parsed) {
              candidates.push({
                timestamp: parsed.timestamp,
                parsedDate: parsed.parsedDate,
                format: parsed.format,
                hasSeconds: parsed.hasSeconds,
                confidence: ocrConfidence,
                rawOcrText: ocrText.trim(),
                region: region,
              });
              console.log(`[OCR] Candidate found: ${parsed.timestamp} (${region}, ${ocrConfidence.toFixed(1)}%)`);
            }
          } catch (ocrError: any) {
            console.error(`[OCR] ${region} pass ${i + 1} failed:`, ocrError.message);
          }
        }
      } catch (regionError: any) {
        console.error(`[OCR] Region ${regionConfig.name} extraction failed:`, regionError.message);
      }
    }
    
    if (candidates.length === 0) {
      console.log("[OCR] NO_VALID_TIMESTAMP - No timestamp candidates found in any region");
      return {
        success: false,
        timestamp: "NO_VALID_TIMESTAMP",
        normalizedTimestamp: null,
        parsedDate: null,
        confidence: 0,
        rawOcrText: allRawTexts.join(" | "),
        format: null,
        ocrEngine: "Tesseract",
        timestampRegion: null,
        source: "IMAGE_OVERLAY",
        reviewRequired: true,
        notes: "No readable timestamp found in any image region",
      };
    }
    
    candidates.sort((a, b) => {
      if (a.confidence >= OCR_REJECTION_THRESHOLD && b.confidence < OCR_REJECTION_THRESHOLD) return -1;
      if (b.confidence >= OCR_REJECTION_THRESHOLD && a.confidence < OCR_REJECTION_THRESHOLD) return 1;
      if (a.hasSeconds && !b.hasSeconds) return -1;
      if (b.hasSeconds && !a.hasSeconds) return 1;
      return b.confidence - a.confidence;
    });
    
    const bestCandidate = candidates[0];
    
    if (bestCandidate.confidence < OCR_REJECTION_THRESHOLD) {
      console.log(`[OCR] NO_VALID_TIMESTAMP - Best candidate confidence ${bestCandidate.confidence.toFixed(1)}% below ${OCR_REJECTION_THRESHOLD}% threshold`);
      return {
        success: false,
        timestamp: "NO_VALID_TIMESTAMP",
        normalizedTimestamp: null,
        parsedDate: null,
        confidence: bestCandidate.confidence,
        rawOcrText: bestCandidate.rawOcrText,
        format: bestCandidate.format,
        ocrEngine: "Tesseract",
        timestampRegion: bestCandidate.region,
        source: "IMAGE_OVERLAY",
        reviewRequired: true,
        notes: `OCR confidence ${bestCandidate.confidence.toFixed(1)}% below ${OCR_REJECTION_THRESHOLD}% rejection threshold`,
      };
    }
    
    const reviewRequired = bestCandidate.confidence < REVIEW_REQUIRED_THRESHOLD;
    const notes = reviewRequired 
      ? `OCR confidence ${bestCandidate.confidence.toFixed(1)}% below ${REVIEW_REQUIRED_THRESHOLD}% threshold - manual review recommended`
      : null;
    
    const normalizedTimestamp = normalizeToStandardFormat(bestCandidate.parsedDate);
    
    console.log(`[OCR] SUCCESS: ${bestCandidate.timestamp} -> ${normalizedTimestamp} (${bestCandidate.region}, ${bestCandidate.confidence.toFixed(1)}%, review: ${reviewRequired})`);
    
    return {
      success: true,
      timestamp: bestCandidate.timestamp,
      normalizedTimestamp: normalizedTimestamp,
      parsedDate: bestCandidate.parsedDate,
      confidence: bestCandidate.confidence,
      rawOcrText: bestCandidate.rawOcrText,
      format: bestCandidate.format,
      ocrEngine: "Tesseract",
      timestampRegion: bestCandidate.region,
      source: "IMAGE_OVERLAY",
      reviewRequired: reviewRequired,
      notes: notes,
    };
  } catch (error: any) {
    console.error("[OCR] Extraction failed:", error.message);
    return {
      success: false,
      timestamp: "NO_VALID_TIMESTAMP",
      normalizedTimestamp: null,
      parsedDate: null,
      confidence: 0,
      rawOcrText: "",
      format: null,
      ocrEngine: "Tesseract",
      timestampRegion: null,
      source: "IMAGE_OVERLAY",
      reviewRequired: true,
      notes: `OCR extraction failed: ${error.message}`,
    };
  }
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
