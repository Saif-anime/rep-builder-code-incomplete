import Tesseract from "tesseract.js";
import { createCanvas } from "canvas";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Lazy-loaded modules
let pdfParseLoaded: ((buffer: Buffer) => Promise<any>) | null = null;
let pdfjsLoaded: any = null;

function loadPdfParse(): ((buffer: Buffer) => Promise<any>) | null {
  if (pdfParseLoaded) return pdfParseLoaded;
  try {
    const mod = require("pdf-parse");
    pdfParseLoaded = mod;
    console.log("[PDF] pdf-parse loaded successfully");
    return pdfParseLoaded;
  } catch (e: any) {
    console.error("[PDF] Failed to load pdf-parse:", e.message);
    return null;
  }
}

async function loadPdfjs(): Promise<any> {
  if (pdfjsLoaded) return pdfjsLoaded;
  try {
    // Use legacy build without worker
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Explicitly disable workers
    (pdfjs as any).GlobalWorkerOptions.workerSrc = false;
    pdfjsLoaded = pdfjs;
    console.log("[PDF] pdfjs-dist loaded successfully");
    return pdfjsLoaded;
  } catch (e: any) {
    console.error("[PDF] Failed to load pdfjs-dist:", e.message);
    return null;
  }
}

const MIN_TEXT_LENGTH = 50;

export interface PdfProcessResult {
  success: boolean;
  source: "text" | "ocr" | "none";
  pdfName: string;
  extractedText: string;
  pageCount: number;
  error?: string;
}

export interface ExtractedSections {
  siteInformation?: Record<string, any>;
  entranceSignage?: Record<string, any>;
  termsAndConditions?: Record<string, any>;
  baySignage?: Record<string, any>;
  generalSignage?: Record<string, any>;
  declaration?: Record<string, any>;
}

async function extractTextFromPdf(buffer: Buffer): Promise<{ text: string; pages: number }> {
  // Try pdf-parse first (synchronous require, most reliable)
  try {
    const parser = loadPdfParse();
    if (parser) {
      const data = await parser(buffer);
      console.log("[PDF Text] Extracted text length:", data.text?.length || 0, "pages:", data.numpages);
      if (data.text && data.text.trim().length > 0) {
        return { text: data.text || "", pages: data.numpages };
      }
    }
  } catch (error: any) {
    console.log("[PDF Text] pdf-parse failed:", error.message);
  }
  
  // Fallback to pdfjs-dist
  console.log("[PDF Text] Trying pdfjs-dist...");
  try {
    const pdfjs = await loadPdfjs();
    if (!pdfjs) {
      console.error("[PDF Text] pdfjs-dist not available");
      return { text: "", pages: 0 };
    }
    
    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({ 
      data: uint8Array, 
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      verbosity: 0,
    });
    const doc = await loadingTask.promise;
    
    let fullText = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      fullText += pageText + "\n";
    }
    console.log("[PDF Text] pdfjs-dist extracted text length:", fullText.length);
    return { text: fullText, pages: doc.numPages };
  } catch (pdfjsError: any) {
    console.error("[PDF Text] pdfjs-dist failed:", pdfjsError.message);
    return { text: "", pages: 0 };
  }
}

async function extractTextWithOcr(buffer: Buffer): Promise<{ text: string; pages: number }> {
  console.log("[PDF OCR] Starting OCR extraction...");
  
  try {
    // Test canvas availability
    let testCanvas: any;
    try {
      testCanvas = createCanvas(100, 100);
    } catch (canvasError: any) {
      console.error("[PDF OCR] Canvas unavailable (native dependencies missing):", canvasError.message);
      return { text: "", pages: 0 };
    }
    
    const pdfjs = await loadPdfjs();
    if (!pdfjs) {
      console.error("[PDF OCR] pdfjs-dist not available for OCR");
      return { text: "", pages: 0 };
    }
    
    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({ 
      data: uint8Array, 
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      verbosity: 0,
    });
    const doc = await loadingTask.promise;
    const numPages = doc.numPages;
    console.log("[PDF OCR] Document has", numPages, "pages");
    
    let fullText = "";
    const maxPages = Math.min(numPages, 10);
    
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log("[PDF OCR] Processing page", pageNum, "of", maxPages);
      
      try {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        
        const pageCanvas = createCanvas(viewport.width, viewport.height);
        const context = pageCanvas.getContext("2d");
        
        await (page.render({
          canvasContext: context as any,
          viewport: viewport,
        } as any)).promise;
        
        const imageBuffer = pageCanvas.toBuffer("image/png");
        
        const { data } = await Tesseract.recognize(imageBuffer, "eng", {
          logger: (m) => {
            if (m.status === "recognizing text") {
              console.log("[PDF OCR] Page", pageNum, "progress:", Math.round(m.progress * 100) + "%");
            }
          },
        });
        
        fullText += data.text + "\n";
        console.log("[PDF OCR] Page", pageNum, "extracted", data.text.length, "chars");
      } catch (pageError: any) {
        console.error("[PDF OCR] Error processing page", pageNum, ":", pageError.message);
      }
    }
    
    console.log("[PDF OCR] Total extracted text length:", fullText.length);
    return { text: fullText, pages: numPages };
  } catch (error: any) {
    console.error("[PDF OCR] OCR extraction failed:", error.message);
    return { text: "", pages: 0 };
  }
}

export async function processPdf(buffer: Buffer, fileName: string): Promise<PdfProcessResult> {
  console.log("[PDF Processor] Processing file:", fileName, "size:", buffer.length);
  
  if (!buffer || buffer.length === 0) {
    return {
      success: false,
      source: "none",
      pdfName: fileName,
      extractedText: "",
      pageCount: 0,
      error: "Empty or missing file buffer",
    };
  }
  
  const pdfHeader = buffer.slice(0, 5).toString();
  if (!pdfHeader.startsWith("%PDF")) {
    console.log("[PDF Processor] Invalid PDF header:", pdfHeader);
    return {
      success: false,
      source: "none",
      pdfName: fileName,
      extractedText: "",
      pageCount: 0,
      error: "File is not a valid PDF (invalid header)",
    };
  }
  
  const textResult = await extractTextFromPdf(buffer);
  
  if (textResult.text.trim().length >= MIN_TEXT_LENGTH) {
    console.log("[PDF Processor] Text extraction successful");
    return {
      success: true,
      source: "text",
      pdfName: fileName,
      extractedText: textResult.text,
      pageCount: textResult.pages,
    };
  }
  
  console.log("[PDF Processor] Text extraction insufficient (<", MIN_TEXT_LENGTH, "chars), trying OCR...");
  
  const ocrResult = await extractTextWithOcr(buffer);
  
  if (ocrResult.text.trim().length > 0) {
    console.log("[PDF Processor] OCR extraction successful");
    return {
      success: true,
      source: "ocr",
      pdfName: fileName,
      extractedText: ocrResult.text,
      pageCount: ocrResult.pages,
    };
  }
  
  console.log("[PDF Processor] Both text and OCR extraction failed to produce text");
  return {
    success: false,
    source: "none",
    pdfName: fileName,
    extractedText: "",
    pageCount: textResult.pages || ocrResult.pages,
    error: "Could not extract any text from PDF (text extraction and OCR both failed)",
  };
}

export function parsePdfToSignageData(text: string): { extractedData: ExtractedSections; flatData: Record<string, any> } {
  const flatData: Record<string, any> = {};
  const extractedData: ExtractedSections = {};
  
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  const patterns: Record<string, RegExp> = {
    inspectorName: /(?:inspector(?:\s*name)?|surveyor|auditor|signed\s*by|officer)[\s:]+([A-Za-z\s\-'.]+)/i,
    inspectionDate: /(?:date|inspection\s*date|survey\s*date)[\s:]+(\d{1,2}[\s\/\-\.]\d{1,2}[\s\/\-\.]\d{2,4}|\d{4}[\s\/\-\.]\d{1,2}[\s\/\-\.]\d{1,2})/i,
    siteCode: /(?:site\s*(?:code|ref|id)|location\s*code|ref(?:erence)?(?:\s*no)?\.?)[\s:]+([A-Za-z0-9\-_]+)/i,
    siteAddress: /(?:site\s*)?address[\s:]+([A-Za-z0-9\s,.\-']+)/i,
    siteName: /(?:site\s*name|location\s*name|car\s*park\s*name)[\s:]+([A-Za-z0-9\s\-'.&]+)/i,
  };
  
  const boolPatterns: Record<string, RegExp[]> = {
    entranceSignagePresent: [/entrance\s*(?:signage|sign)\s*(?:present|visible|exists?)/i, /signage\s*at\s*entrance/i],
    entranceClearlyVisible: [/entrance\s*(?:clearly\s*)?visible/i, /clear(?:ly)?\s*visible\s*entrance/i],
    entranceCorrectWording: [/entrance\s*(?:correct\s*)?wording/i, /wording\s*correct.*entrance/i],
    entranceHeightCompliant: [/entrance\s*height\s*compliant/i, /height.*compliant.*entrance/i],
    entranceLightingDay: [/(?:day(?:time)?|daylight)\s*lighting.*entrance/i, /entrance.*lighting.*day/i],
    entranceLightingNight: [/(?:night(?:time)?|evening)\s*lighting.*entrance/i, /entrance.*lighting.*night/i],
    tcTariffVisible: [/tariff\s*(?:clearly\s*)?visible/i, /visible\s*tariff/i],
    tcFontReadable: [/font\s*(?:size\s*)?readable/i, /readable\s*font/i],
    tcLanguageCorrect: [/language\s*correct/i, /correct\s*language/i],
    tcLightingPresent: [/(?:t&?c|terms).*lighting/i, /lighting.*(?:t&?c|terms)/i],
    tcDistanceReadable: [/(?:readable|legible)\s*(?:from\s*)?\d+\s*(?:m|meters?|ft|feet)/i, /distance\s*readable/i],
    disabledSignPresent: [/disabled\s*(?:bay\s*)?sign(?:age)?\s*present/i],
    disabledMarkingsVisible: [/disabled\s*(?:bay\s*)?markings?\s*visible/i],
    disabledUprightSign: [/disabled\s*upright\s*sign/i],
    disabledWordingCorrect: [/disabled\s*(?:bay\s*)?wording\s*correct/i],
    evSignPresent: [/(?:ev|electric\s*vehicle)\s*(?:bay\s*)?sign(?:age)?\s*present/i],
    evMarkingsVisible: [/(?:ev|electric\s*vehicle)\s*(?:bay\s*)?markings?\s*visible/i],
    evUprightSign: [/(?:ev|electric)\s*upright\s*sign/i],
    evWordingCorrect: [/(?:ev|electric\s*vehicle)\s*(?:bay\s*)?wording\s*correct/i],
    parentChildSignPresent: [/parent\s*(?:&|and)\s*child\s*(?:bay\s*)?sign(?:age)?\s*present/i],
    parentChildMarkingsVisible: [/parent\s*(?:&|and)\s*child\s*(?:bay\s*)?markings?\s*visible/i],
    parentChildUprightSign: [/parent\s*(?:&|and)\s*child\s*upright\s*sign/i],
    parentChildWordingCorrect: [/parent\s*(?:&|and)\s*child\s*(?:bay\s*)?wording\s*correct/i],
    bpaIpcCompliant: [/(?:bpa|ipc)\s*compliant/i, /compliant.*(?:bpa|ipc)/i],
    conflictingSignagePresent: [/conflicting\s*signage/i, /signage\s*conflicts?/i],
    obstructionsPresent: [/obstructions?\s*(?:present|found|noted)/i],
    weatherDamage: [/weather\s*damage/i, /damage.*weather/i],
    graffitiPresent: [/graffiti\s*(?:present|found|noted)/i],
  };
  
  for (const [key, pattern] of Object.entries(patterns)) {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match && match[1]) {
        flatData[key] = match[1].trim();
        break;
      }
    }
  }
  
  const fullText = text.toLowerCase();
  for (const [key, regexList] of Object.entries(boolPatterns)) {
    for (const regex of regexList) {
      if (regex.test(fullText)) {
        const yesMatch = fullText.match(new RegExp(regex.source + "[^\\n]*(?:yes|✓|✔|present|visible|compliant|correct)", "i"));
        const noMatch = fullText.match(new RegExp(regex.source + "[^\\n]*(?:no|✗|✘|absent|missing|not\\s*present|n\\/a)", "i"));
        
        if (yesMatch) {
          flatData[key] = true;
        } else if (noMatch) {
          flatData[key] = false;
        } else {
          flatData[key] = true;
        }
        break;
      }
    }
  }
  
  const notesMatch = text.match(/(?:notes?|comments?|observations?)[\s:]+([^\n]+(?:\n[^\n]+)*)/i);
  if (notesMatch) {
    flatData.generalNotes = notesMatch[1].trim().slice(0, 500);
  }
  
  const conditionMatch = text.match(/(?:condition|state|status)[\s:]+([A-Za-z\s]+)/i);
  if (conditionMatch) {
    const cond = conditionMatch[1].toLowerCase().trim();
    if (cond.includes("good") || cond.includes("excellent")) {
      flatData.entranceCondition = "good";
    } else if (cond.includes("fair") || cond.includes("acceptable")) {
      flatData.entranceCondition = "fair";
    } else if (cond.includes("poor") || cond.includes("bad") || cond.includes("damaged")) {
      flatData.entranceCondition = "poor";
    }
  }
  
  if (flatData.inspectorName || flatData.inspectionDate || flatData.siteCode || flatData.siteAddress || flatData.siteName) {
    extractedData.siteInformation = {};
    if (flatData.inspectorName) extractedData.siteInformation.inspectorName = flatData.inspectorName;
    if (flatData.inspectionDate) extractedData.siteInformation.inspectionDate = flatData.inspectionDate;
    if (flatData.siteCode) extractedData.siteInformation.siteCode = flatData.siteCode;
    if (flatData.siteAddress) extractedData.siteInformation.siteAddress = flatData.siteAddress;
    if (flatData.siteName) extractedData.siteInformation.siteName = flatData.siteName;
  }
  
  const entranceFields = ["entranceSignagePresent", "entranceClearlyVisible", "entranceCorrectWording", 
    "entranceHeightCompliant", "entranceLightingDay", "entranceLightingNight", "entranceCondition"];
  const entranceData: Record<string, any> = {};
  for (const field of entranceFields) {
    if (flatData[field] !== undefined) {
      const key = field.replace("entrance", "").replace(/^[A-Z]/, c => c.toLowerCase());
      entranceData[key === "" ? "signagePresent" : key] = flatData[field];
    }
  }
  if (Object.keys(entranceData).length > 0) extractedData.entranceSignage = entranceData;
  
  const tcFields = ["tcTariffVisible", "tcFontReadable", "tcLanguageCorrect", "tcLightingPresent", "tcDistanceReadable"];
  const tcData: Record<string, any> = {};
  for (const field of tcFields) {
    if (flatData[field] !== undefined) {
      const key = field.replace("tc", "").replace(/^[A-Z]/, c => c.toLowerCase());
      tcData[key] = flatData[field];
    }
  }
  if (Object.keys(tcData).length > 0) extractedData.termsAndConditions = tcData;
  
  const bayFields = ["disabledSignPresent", "disabledMarkingsVisible", "disabledUprightSign", "disabledWordingCorrect",
    "evSignPresent", "evMarkingsVisible", "evUprightSign", "evWordingCorrect",
    "parentChildSignPresent", "parentChildMarkingsVisible", "parentChildUprightSign", "parentChildWordingCorrect"];
  const bayData: Record<string, any> = {};
  for (const field of bayFields) {
    if (flatData[field] !== undefined) {
      bayData[field] = flatData[field];
    }
  }
  if (Object.keys(bayData).length > 0) extractedData.baySignage = bayData;
  
  const generalFields = ["bpaIpcCompliant", "conflictingSignagePresent", "obstructionsPresent", 
    "weatherDamage", "graffitiPresent", "generalNotes"];
  const generalData: Record<string, any> = {};
  for (const field of generalFields) {
    if (flatData[field] !== undefined) {
      generalData[field === "generalNotes" ? "notes" : field] = flatData[field];
    }
  }
  if (Object.keys(generalData).length > 0) extractedData.generalSignage = generalData;
  
  if (flatData.inspectorName || flatData.inspectionDate) {
    extractedData.declaration = {};
    if (flatData.inspectorName) extractedData.declaration.signedBy = flatData.inspectorName;
    if (flatData.inspectionDate) extractedData.declaration.date = flatData.inspectionDate;
  }
  
  return { extractedData, flatData };
}
