import sharp from "sharp";
import Tesseract from "tesseract.js";
import path from "path";
import fs from "fs";

export interface TimestampExtractionResult {
  success: boolean;
  timestamp: string | null;
  parsedDate: Date | null;
  confidence: number;
  rawOcrText: string;
  format: string | null;
}

const TIMESTAMP_PATTERNS = [
  {
    regex: /(\d{2})-(\d{2})-(\d{4})\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2}):(\d{2})/i,
    format: "DD-MM-YYYY Day HH:MM:SS",
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{2})\/(\d{2})\/(\d{4})\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}):(\d{2}):(\d{2})/i,
    format: "DD/MM/YYYY Day HH:MM:SS",
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "DD-MM-YYYY HH:MM:SS",
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "DD/MM/YYYY HH:MM:SS",
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "YYYY-MM-DD HH:MM:SS",
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/,
    format: "YYYY/MM/DD HH:MM:SS",
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
      parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
    ),
  },
  {
    regex: /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/,
    format: "DD-MM-YYYY HH:MM",
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), 0
    ),
  },
  {
    regex: /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/,
    format: "DD/MM/YYYY HH:MM",
    parse: (m: RegExpMatchArray) => new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4]), parseInt(m[5]), 0
    ),
  },
];

function isValidDate(date: Date): boolean {
  if (isNaN(date.getTime())) return false;
  const year = date.getFullYear();
  return year >= 2020 && year <= 2030;
}

async function cropTopRegion(imagePath: string): Promise<Buffer> {
  const fullPath = path.join(process.cwd(), imagePath.startsWith("/") ? imagePath.slice(1) : imagePath);
  const metadata = await sharp(fullPath).metadata();
  const width = metadata.width || 1920;
  const height = metadata.height || 1080;
  const cropHeight = Math.round(height * 0.15);
  
  return sharp(fullPath)
    .extract({ left: 0, top: 0, width: width, height: cropHeight })
    .greyscale()
    .normalize()
    .sharpen()
    .toBuffer();
}

async function preprocessForOcr(imagePath: string): Promise<Buffer[]> {
  const fullPath = path.join(process.cwd(), imagePath.startsWith("/") ? imagePath.slice(1) : imagePath);
  const metadata = await sharp(fullPath).metadata();
  const width = metadata.width || 1920;
  const height = metadata.height || 1080;
  const cropHeight = Math.round(height * 0.15);
  
  const preprocessedBuffers: Buffer[] = [];
  
  const standard = await sharp(fullPath)
    .extract({ left: 0, top: 0, width: width, height: cropHeight })
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .toBuffer();
  preprocessedBuffers.push(standard);
  
  const highContrast = await sharp(fullPath)
    .extract({ left: 0, top: 0, width: width, height: cropHeight })
    .greyscale()
    .normalize()
    .linear(1.5, -20)
    .sharpen({ sigma: 2 })
    .toBuffer();
  preprocessedBuffers.push(highContrast);
  
  const inverted = await sharp(fullPath)
    .extract({ left: 0, top: 0, width: width, height: cropHeight })
    .greyscale()
    .negate()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .toBuffer();
  preprocessedBuffers.push(inverted);
  
  const scaled = await sharp(fullPath)
    .extract({ left: 0, top: 0, width: width, height: cropHeight })
    .resize({ width: width * 2 })
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .toBuffer();
  preprocessedBuffers.push(scaled);
  
  return preprocessedBuffers;
}

function parseTimestampFromText(text: string): { timestamp: string; parsedDate: Date; format: string } | null {
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

export async function extractTimestampFromImage(imagePath: string): Promise<TimestampExtractionResult> {
  console.log("[OCR] Extracting timestamp from:", imagePath);
  
  const fullPath = path.join(process.cwd(), imagePath.startsWith("/") ? imagePath.slice(1) : imagePath);
  if (!fs.existsSync(fullPath)) {
    console.error("[OCR] Image not found:", fullPath);
    return {
      success: false,
      timestamp: null,
      parsedDate: null,
      confidence: 0,
      rawOcrText: "",
      format: null,
    };
  }
  
  try {
    const preprocessedBuffers = await preprocessForOcr(imagePath);
    const worker = await getWorker();
    
    let bestResult: TimestampExtractionResult = {
      success: false,
      timestamp: null,
      parsedDate: null,
      confidence: 0,
      rawOcrText: "",
      format: null,
    };
    
    let allRawTexts: string[] = [];
    
    for (let i = 0; i < preprocessedBuffers.length; i++) {
      const buffer = preprocessedBuffers[i];
      
      try {
        const { data } = await worker.recognize(buffer);
        const ocrText = data.text;
        allRawTexts.push(ocrText);
        
        console.log(`[OCR] Pass ${i + 1} raw text: "${ocrText.trim()}"`);
        
        const parsed = parseTimestampFromText(ocrText);
        if (parsed) {
          const confidence = data.confidence / 100;
          if (confidence > bestResult.confidence) {
            bestResult = {
              success: true,
              timestamp: parsed.timestamp,
              parsedDate: parsed.parsedDate,
              confidence: confidence,
              rawOcrText: ocrText.trim(),
              format: parsed.format,
            };
            console.log(`[OCR] Found timestamp: ${parsed.timestamp} (confidence: ${(confidence * 100).toFixed(1)}%)`);
          }
        }
      } catch (ocrError: any) {
        console.error(`[OCR] Pass ${i + 1} failed:`, ocrError.message);
      }
    }
    
    if (!bestResult.success) {
      bestResult.rawOcrText = allRawTexts.join(" | ");
      console.log("[OCR] No timestamp found in any preprocessing pass");
    }
    
    return bestResult;
  } catch (error: any) {
    console.error("[OCR] Extraction failed:", error.message);
    return {
      success: false,
      timestamp: null,
      parsedDate: null,
      confidence: 0,
      rawOcrText: "",
      format: null,
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
