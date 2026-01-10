import Tesseract from "tesseract.js";
import { createCanvas } from "canvas";
import { createRequire } from "module";
import type { Canvas } from "canvas";

const require = createRequire(import.meta.url);

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

// Extract text using pdf-parse (CommonJS module)
async function extractWithPdfParse(buffer: Buffer): Promise<{ text: string; pages: number }> {
  try {
    // pdf-parse is a CommonJS module that exports a function directly
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    console.log("[PDF] pdf-parse extracted:", data.text?.length || 0, "chars,", data.numpages, "pages");
    return { text: data.text || "", pages: data.numpages || 0 };
  } catch (error: any) {
    console.log("[PDF] pdf-parse error:", error.message);
    return { text: "", pages: 0 };
  }
}

// Extract text using pdfjs-dist
async function extractWithPdfjs(buffer: Buffer): Promise<{ text: string; pages: number }> {
  try {
    // Dynamic import for ES module
    const pdfjsLib = await import("pdfjs-dist");
    
    // Set worker to empty string to disable worker (runs in main thread)
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
    
    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true,
      standardFontDataUrl: undefined,
    });
    
    const doc = await loadingTask.promise;
    let fullText = "";
    
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str || "")
        .join(" ");
      fullText += pageText + "\n";
    }
    
    console.log("[PDF] pdfjs-dist extracted:", fullText.length, "chars,", doc.numPages, "pages");
    return { text: fullText, pages: doc.numPages };
  } catch (error: any) {
    console.log("[PDF] pdfjs-dist error:", error.message);
    return { text: "", pages: 0 };
  }
}

// Extract text via OCR (render PDF pages to images, then OCR)
async function extractWithOcr(buffer: Buffer): Promise<{ text: string; pages: number }> {
  console.log("[PDF OCR] Starting OCR extraction...");
  
  try {
    // Test canvas availability first
    try {
      createCanvas(10, 10);
    } catch (e: any) {
      console.error("[PDF OCR] Canvas not available:", e.message);
      return { text: "", pages: 0 };
    }
    
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
    
    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true,
    });
    
    const doc = await loadingTask.promise;
    const numPages = doc.numPages;
    console.log("[PDF OCR] Document has", numPages, "pages");
    
    let fullText = "";
    const maxPages = Math.min(numPages, 5); // Limit to 5 pages for OCR
    
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log("[PDF OCR] Processing page", pageNum);
      
      try {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext("2d");
        
        // Render page to canvas
        const renderContext = {
          canvasContext: context as any,
          viewport: viewport,
        };
        
        await page.render(renderContext).promise;
        
        // Convert canvas to PNG buffer
        const imageBuffer = canvas.toBuffer("image/png");
        
        // OCR the image
        const { data } = await Tesseract.recognize(imageBuffer, "eng", {
          logger: (m) => {
            if (m.status === "recognizing text" && m.progress > 0.5) {
              console.log("[PDF OCR] Page", pageNum, ":", Math.round(m.progress * 100) + "%");
            }
          },
        });
        
        fullText += data.text + "\n";
        console.log("[PDF OCR] Page", pageNum, ":", data.text.length, "chars");
      } catch (pageError: any) {
        console.error("[PDF OCR] Page", pageNum, "error:", pageError.message);
      }
    }
    
    console.log("[PDF OCR] Total extracted:", fullText.length, "chars");
    return { text: fullText, pages: numPages };
  } catch (error: any) {
    console.error("[PDF OCR] Failed:", error.message);
    return { text: "", pages: 0 };
  }
}

export async function processPdf(buffer: Buffer, fileName: string): Promise<PdfProcessResult> {
  console.log("[PDF] Processing:", fileName, "size:", buffer.length);
  
  if (!buffer || buffer.length === 0) {
    return {
      success: false,
      source: "none",
      pdfName: fileName,
      extractedText: "",
      pageCount: 0,
      error: "Empty file",
    };
  }
  
  // Validate PDF header
  const header = buffer.slice(0, 5).toString();
  if (!header.startsWith("%PDF")) {
    return {
      success: false,
      source: "none",
      pdfName: fileName,
      extractedText: "",
      pageCount: 0,
      error: "Not a valid PDF file",
    };
  }
  
  // Try pdf-parse first (fastest, most reliable for text PDFs)
  let result = await extractWithPdfParse(buffer);
  if (result.text.trim().length >= MIN_TEXT_LENGTH) {
    return {
      success: true,
      source: "text",
      pdfName: fileName,
      extractedText: result.text,
      pageCount: result.pages,
    };
  }
  
  // Try pdfjs-dist as fallback
  console.log("[PDF] Text too short, trying pdfjs-dist...");
  result = await extractWithPdfjs(buffer);
  if (result.text.trim().length >= MIN_TEXT_LENGTH) {
    return {
      success: true,
      source: "text",
      pdfName: fileName,
      extractedText: result.text,
      pageCount: result.pages,
    };
  }
  
  // Last resort: OCR
  console.log("[PDF] Still insufficient text, trying OCR...");
  result = await extractWithOcr(buffer);
  if (result.text.trim().length > 0) {
    return {
      success: true,
      source: "ocr",
      pdfName: fileName,
      extractedText: result.text,
      pageCount: result.pages,
    };
  }
  
  return {
    success: false,
    source: "none",
    pdfName: fileName,
    extractedText: "",
    pageCount: result.pages || 0,
    error: "Could not extract text from PDF",
  };
}

export function parsePdfToSignageData(text: string): { extractedData: ExtractedSections; flatData: Record<string, any> } {
  const flatData: Record<string, any> = {};
  const extractedData: ExtractedSections = {};
  
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // Pattern matching for common signage inspection fields
  const patterns: Record<string, RegExp> = {
    inspectorName: /(?:inspector(?:\s*name)?|surveyor|auditor|signed\s*by|officer)[\s:]+([A-Za-z\s\-'.]+)/i,
    inspectionDate: /(?:date|inspection\s*date|survey\s*date)[\s:]+(\d{1,2}[\s\/\-\.]\d{1,2}[\s\/\-\.]\d{2,4}|\d{4}[\s\/\-\.]\d{1,2}[\s\/\-\.]\d{1,2})/i,
    siteCode: /(?:site\s*(?:code|ref|id)|location\s*code|ref(?:erence)?(?:\s*no)?\.?)[\s:]+([A-Za-z0-9\-_]+)/i,
    siteAddress: /(?:site\s*)?address[\s:]+([A-Za-z0-9\s,.\-']+)/i,
    siteName: /(?:site\s*name|location\s*name|car\s*park\s*name)[\s:]+([A-Za-z0-9\s\-'.&]+)/i,
  };
  
  // Boolean field patterns
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
  
  // Extract string fields
  for (const [key, pattern] of Object.entries(patterns)) {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match && match[1]) {
        flatData[key] = match[1].trim();
        break;
      }
    }
  }
  
  // Extract boolean fields
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
  
  // Extract notes
  const notesMatch = text.match(/(?:notes?|comments?|observations?)[\s:]+([^\n]+(?:\n[^\n]+)*)/i);
  if (notesMatch) {
    flatData.generalNotes = notesMatch[1].trim().slice(0, 500);
  }
  
  // Extract condition
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
  
  // Build extracted sections
  if (flatData.inspectorName || flatData.inspectionDate || flatData.siteCode || flatData.siteAddress || flatData.siteName) {
    extractedData.siteInformation = {};
    if (flatData.inspectorName) extractedData.siteInformation.inspectorName = flatData.inspectorName;
    if (flatData.inspectionDate) extractedData.siteInformation.inspectionDate = flatData.inspectionDate;
    if (flatData.siteCode) extractedData.siteInformation.siteCode = flatData.siteCode;
    if (flatData.siteAddress) extractedData.siteInformation.siteAddress = flatData.siteAddress;
    if (flatData.siteName) extractedData.siteInformation.siteName = flatData.siteName;
  }
  
  // Entrance signage section
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
  
  // T&C section
  const tcFields = ["tcTariffVisible", "tcFontReadable", "tcLanguageCorrect", "tcLightingPresent", "tcDistanceReadable"];
  const tcData: Record<string, any> = {};
  for (const field of tcFields) {
    if (flatData[field] !== undefined) {
      const key = field.replace("tc", "").replace(/^[A-Z]/, c => c.toLowerCase());
      tcData[key] = flatData[field];
    }
  }
  if (Object.keys(tcData).length > 0) extractedData.termsAndConditions = tcData;
  
  // Bay signage section
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
  
  // General signage section
  const generalFields = ["bpaIpcCompliant", "conflictingSignagePresent", "obstructionsPresent", 
    "weatherDamage", "graffitiPresent", "generalNotes"];
  const generalData: Record<string, any> = {};
  for (const field of generalFields) {
    if (flatData[field] !== undefined) {
      generalData[field === "generalNotes" ? "notes" : field] = flatData[field];
    }
  }
  if (Object.keys(generalData).length > 0) extractedData.generalSignage = generalData;
  
  // Declaration section
  if (flatData.inspectorName || flatData.inspectionDate) {
    extractedData.declaration = {};
    if (flatData.inspectorName) extractedData.declaration.signedBy = flatData.inspectorName;
    if (flatData.inspectionDate) extractedData.declaration.date = flatData.inspectionDate;
  }
  
  return { extractedData, flatData };
}
