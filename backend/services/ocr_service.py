import os
import base64
import re
import logging
from datetime import datetime
from typing import Optional, Dict, Any
import httpx

logger = logging.getLogger(__name__)

class OCRService:
    def __init__(self):
        self.api_key = os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", ""))
        self.base_url = os.getenv("AI_INTEGRATIONS_OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.model = "gpt-4o"
    
    def _encode_image(self, image_path: str) -> Optional[str]:
        try:
            with open(image_path, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to encode image {image_path}: {e}")
            return None
    
    async def extract_timestamp_and_vrm_from_image(self, image_path: str) -> Dict[str, Any]:
        """Extract both timestamp and VRM in a single Vision GPT call for efficiency."""
        if not self.api_key:
            logger.warning("No OpenAI API key configured, using fallback extraction")
            fallback = self._fallback_extraction(image_path)
            fallback["vrm"] = None
            fallback["vrm_confidence"] = 0
            return fallback
        
        base64_image = self._encode_image(image_path)
        if not base64_image:
            return {"success": False, "error": "Failed to read image", "timestamp": None, "confidence": 0, "vrm": None, "vrm_confidence": 0}
        
        ext = os.path.splitext(image_path)[1].lower()
        media_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        
        prompt = """CRITICAL PARKING ENFORCEMENT EVIDENCE - Extract EXACT timestamp AND vehicle number plate (VRM).

=== TIMESTAMP EXTRACTION ===
1. Look at ALL corners and edges for camera overlay text showing date/time
2. READ EACH DIGIT CAREFULLY - accuracy is critical for legal enforcement
3. Common UK camera overlay formats:
   - DD/MM/YYYY HH:MM:SS (e.g., "22/11/2025 17:05:23")
   - YYYY-MM-DD HH:MM:SS (e.g., "2025-11-22 17:05:23")
4. Double-check similar digits: 1/7, 6/8, 0/O - examine pixel patterns carefully
5. NEVER guess - if unclear, report lower confidence

=== VRM (NUMBER PLATE) EXTRACTION - CRITICAL ACCURACY REQUIRED ===

STEP 1 - LOCATE THE PLATE:
- Find the rectangular plate on vehicle (front white or rear yellow background)
- UK plates have black text on white/yellow background
- Standard UK dimensions: 520mm x 111mm (front/rear)

STEP 2 - READ EACH CHARACTER INDIVIDUALLY:
Read the plate LEFT to RIGHT, spelling out EACH character one by one.
UK plates have 7 characters in format: XX00 XXX (2 letters, 2 numbers, space, 3 letters)

STEP 3 - CHARACTER VERIFICATION:
Common OCR confusion pairs - check EACH character carefully:
- 0 (zero) vs O (letter) - zeros are typically rounder and may have a slash
- 1 (one) vs I (letter I) vs L (letter L) - check serifs and proportions
- 5 (five) vs S (letter) - 5 has a flat top, S is curved
- 8 (eight) vs B (letter) - 8 is symmetrical, B has flat left side
- 2 (two) vs Z (letter) - 2 has curved bottom, Z is angular
- 6 (six) vs G (letter) - 6 is closed, G has an opening
- D vs 0 - D has flat left side

STEP 4 - UK FORMAT VALIDATION:
Current format (2001+): AA00 AAA - Two letters (area code), two numbers (age), three letters (random)
- First two chars MUST be letters (A-Z, excluding I and Q)
- Next two chars MUST be numbers (00-99)
- Last three chars MUST be letters
If your reading doesn't match this pattern, RE-CHECK the ambiguous characters!

STEP 5 - DOUBLE VERIFICATION:
Spell out the plate again character by character. If readings differ, use lower confidence.

Return a JSON object with:
{
  "timestamp": "YYYY-MM-DD HH:MM:SS" format (CONVERT the displayed format to this standard),
  "timestamp_raw_text": "EXACT characters as displayed in image",
  "timestamp_confidence": 0-100 (lower if any digits are ambiguous),
  "timestamp_location": "precise location (e.g., 'bottom-left corner overlay')",
  "vrm": "PLATE TEXT" with space after 4th char (e.g., "LS10 XRX") or null,
  "vrm_raw_text": "exact plate text character by character",
  "vrm_confidence": 0-100 score (lower if ANY character is ambiguous),
  "vrm_location": "where in image (e.g., 'rear plate on silver vehicle')",
  "vrm_char_by_char": "L-S-1-0 X-R-X (spell out each character you see)"
}

ACCURACY IS CRITICAL - wrong VRM means wrong vehicle charged. When in doubt, reduce confidence.
Return ONLY the JSON object, no other text."""
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:{media_type};base64,{base64_image}",
                                            "detail": "high"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 600
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"OpenAI API error: {response.status_code} - {response.text}")
                    fallback = self._fallback_extraction(image_path)
                    fallback["vrm"] = None
                    fallback["vrm_confidence"] = 0
                    return fallback
                
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                result = self._parse_combined_response(content)
                result["source"] = "ocr"
                result["success"] = result.get("timestamp") is not None or result.get("vrm") is not None
                return result
                
        except Exception as e:
            logger.error(f"Combined extraction failed: {e}")
            fallback = self._fallback_extraction(image_path)
            fallback["vrm"] = None
            fallback["vrm_confidence"] = 0
            return fallback
    
    def _parse_combined_response(self, content: str) -> Dict[str, Any]:
        """Parse combined timestamp + VRM response."""
        import json
        try:
            content = content.strip()
            if content.startswith("```"):
                content = re.sub(r"```json?\n?", "", content)
                content = content.replace("```", "")
            result = json.loads(content.strip())
            
            # Log character-by-character breakdown for debugging
            if result.get("vrm_char_by_char"):
                logger.info(f"VRM char-by-char breakdown: {result.get('vrm_char_by_char')}")
            
            # Normalize VRM if found
            if result.get("vrm"):
                original_vrm = result["vrm"]
                result["vrm"] = self._normalize_vrm(result["vrm"])
                logger.info(f"VRM extracted: '{original_vrm}' -> normalized: '{result['vrm']}' (confidence: {result.get('vrm_confidence', 0)})")
            
            # Remap for backward compatibility
            return {
                "timestamp": result.get("timestamp"),
                "raw_text": result.get("timestamp_raw_text"),
                "confidence": result.get("timestamp_confidence", 0),
                "location": result.get("timestamp_location"),
                "vrm": result.get("vrm"),
                "vrm_raw_text": result.get("vrm_raw_text"),
                "vrm_confidence": result.get("vrm_confidence", 0),
                "vrm_location": result.get("vrm_location"),
                "vrm_char_by_char": result.get("vrm_char_by_char")
            }
        except json.JSONDecodeError:
            # Try regex fallback
            timestamp_match = re.search(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})", content)
            vrm_match = re.search(r"([A-Z]{2}\d{2}\s?[A-Z]{3}|[A-Z]\d{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?\d{1,3}[A-Z])", content.upper())
            return {
                "timestamp": timestamp_match.group(1) if timestamp_match else None,
                "raw_text": timestamp_match.group(1) if timestamp_match else None,
                "confidence": 70 if timestamp_match else 0,
                "location": "extracted from text",
                "vrm": self._normalize_vrm(vrm_match.group(1)) if vrm_match else None,
                "vrm_raw_text": vrm_match.group(1) if vrm_match else None,
                "vrm_confidence": 60 if vrm_match else 0,
                "vrm_location": "extracted from text" if vrm_match else None
            }

    async def extract_timestamp_from_image(self, image_path: str) -> Dict[str, Any]:
        """Legacy method - now calls combined extraction for efficiency."""
        result = await self.extract_timestamp_and_vrm_from_image(image_path)
        return {
            "success": result.get("timestamp") is not None,
            "timestamp": result.get("timestamp"),
            "raw_text": result.get("raw_text"),
            "confidence": result.get("confidence", 0),
            "location": result.get("location"),
            "source": result.get("source", "ocr")
        }
    
    async def extract_vrm_from_image(self, image_path: str) -> Dict[str, Any]:
        """Legacy method - now calls combined extraction for efficiency."""
        result = await self.extract_timestamp_and_vrm_from_image(image_path)
        return {
            "success": result.get("vrm") is not None,
            "vrm": result.get("vrm"),
            "raw_text": result.get("vrm_raw_text"),
            "confidence": result.get("vrm_confidence", 0),
            "location": result.get("vrm_location")
        }
    
    async def extract_timestamp_from_image_original(self, image_path: str) -> Dict[str, Any]:
        if not self.api_key:
            logger.warning("No OpenAI API key configured, using fallback timestamp extraction")
            return self._fallback_extraction(image_path)
        
        base64_image = self._encode_image(image_path)
        if not base64_image:
            return {"success": False, "error": "Failed to read image", "timestamp": None, "confidence": 0}
        
        ext = os.path.splitext(image_path)[1].lower()
        media_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        
        prompt = """Analyze this parking enforcement evidence image and extract the timestamp information.

Look for:
1. Camera overlay text showing date and time (usually in corners)
2. Text like "11/01/2026 14:23:45" or similar date/time formats
3. Any "Observe From" or "Observe To" text with timestamps

Return a JSON object with:
{
  "timestamp": "YYYY-MM-DD HH:MM:SS" format if found, or null if not found,
  "raw_text": "the exact text you see for the timestamp",
  "confidence": 0-100 score for how confident you are,
  "location": "where in the image you found it (e.g., 'bottom-left corner')",
  "format_detected": "the original format of the timestamp"
}

If you cannot find any timestamp, return:
{
  "timestamp": null,
  "raw_text": null,
  "confidence": 0,
  "location": null,
  "format_detected": null,
  "error": "No timestamp found in image"
}

Return ONLY the JSON object, no other text."""

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:{media_type};base64,{base64_image}",
                                            "detail": "high"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 500
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"OpenAI API error: {response.status_code} - {response.text}")
                    return self._fallback_extraction(image_path)
                
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                result = self._parse_ocr_response(content)
                result["source"] = "ocr"
                result["success"] = result.get("timestamp") is not None
                return result
                
        except Exception as e:
            logger.error(f"OCR extraction failed: {e}")
            return self._fallback_extraction(image_path)
    
    def _parse_ocr_response(self, content: str) -> Dict[str, Any]:
        import json
        try:
            content = content.strip()
            if content.startswith("```"):
                content = re.sub(r"```json?\n?", "", content)
                content = content.replace("```", "")
            return json.loads(content.strip())
        except json.JSONDecodeError:
            timestamp_match = re.search(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})", content)
            if timestamp_match:
                return {
                    "timestamp": timestamp_match.group(1),
                    "raw_text": timestamp_match.group(1),
                    "confidence": 70,
                    "location": "extracted from text",
                    "format_detected": "ISO"
                }
            return {"timestamp": None, "confidence": 0, "error": "Failed to parse response"}
    
    def _fallback_extraction(self, image_path: str) -> Dict[str, Any]:
        try:
            mtime = os.path.getmtime(image_path)
            file_time = datetime.fromtimestamp(mtime)
            return {
                "success": True,
                "timestamp": file_time.strftime("%Y-%m-%d %H:%M:%S"),
                "raw_text": None,
                "confidence": 20,
                "location": "file_metadata",
                "source": "file_time",
                "format_detected": "file_modification_time",
                "warning": "Used file modification time as fallback - OCR not available"
            }
        except Exception:
            return {
                "success": False,
                "timestamp": None,
                "confidence": 0,
                "error": "No timestamp extraction method available"
            }
    
    def parse_timestamp_string(self, timestamp_str: str) -> Optional[datetime]:
        formats = [
            "%Y-%m-%d %H:%M:%S",
            "%d/%m/%Y %H:%M:%S",
            "%d-%m-%Y %H:%M:%S",
            "%Y/%m/%d %H:%M:%S",
            "%d/%m/%Y %H:%M",
            "%Y-%m-%d %H:%M",
        ]
        
        for fmt in formats:
            try:
                return datetime.strptime(timestamp_str.strip(), fmt)
            except ValueError:
                continue
        return None
    
    async def extract_vrm_from_image(self, image_path: str) -> Dict[str, Any]:
        """Extract vehicle registration mark (number plate) from image using Vision GPT."""
        if not self.api_key:
            logger.warning("No OpenAI API key configured for VRM extraction")
            return {"success": False, "vrm": None, "confidence": 0, "error": "API key not configured"}
        
        base64_image = self._encode_image(image_path)
        if not base64_image:
            return {"success": False, "vrm": None, "confidence": 0, "error": "Failed to read image"}
        
        ext = os.path.splitext(image_path)[1].lower()
        media_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        
        prompt = """Analyze this parking enforcement evidence image and extract the vehicle registration number (number plate/VRM).

Look for:
1. UK format number plates (e.g., AB12 CDE, AB12CDE)
2. Number plates on vehicles visible in the image
3. Text overlays showing VRM/registration information

UK number plate formats:
- Current format: AB12 ABC (2 letters, 2 numbers, 3 letters)
- Prefix format: A123 ABC (letter, 1-3 numbers, 3 letters)
- Suffix format: ABC 123A (3 letters, 1-3 numbers, letter)

Return a JSON object with:
{
  "vrm": "THE NUMBER PLATE" (normalized format with space, e.g., "AB12 CDE"),
  "raw_text": "exact text as seen in image",
  "confidence": 0-100 score for how confident you are,
  "location": "where in the image you found it (e.g., 'front of vehicle', 'rear plate')",
  "plate_type": "current" | "prefix" | "suffix" | "other"
}

If you cannot find a number plate, return:
{
  "vrm": null,
  "raw_text": null,
  "confidence": 0,
  "location": null,
  "plate_type": null,
  "error": "No number plate found in image"
}

Return ONLY the JSON object, no other text."""

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:{media_type};base64,{base64_image}",
                                            "detail": "high"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 300
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"OpenAI API error for VRM: {response.status_code} - {response.text}")
                    return {"success": False, "vrm": None, "confidence": 0, "error": "API request failed"}
                
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                result = self._parse_vrm_response(content)
                result["success"] = result.get("vrm") is not None
                return result
                
        except Exception as e:
            logger.error(f"VRM extraction failed: {e}")
            return {"success": False, "vrm": None, "confidence": 0, "error": str(e)}
    
    def _parse_vrm_response(self, content: str) -> Dict[str, Any]:
        """Parse VRM extraction response from Vision GPT."""
        import json
        try:
            content = content.strip()
            if content.startswith("```"):
                content = re.sub(r"```json?\n?", "", content)
                content = content.replace("```", "")
            result = json.loads(content.strip())
            
            # Normalize VRM if found
            if result.get("vrm"):
                result["vrm"] = self._normalize_vrm(result["vrm"])
            
            return result
        except json.JSONDecodeError:
            # Try to extract VRM using regex
            vrm_match = re.search(r"([A-Z]{2}\d{2}\s?[A-Z]{3}|[A-Z]\d{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?\d{1,3}[A-Z])", content.upper())
            if vrm_match:
                vrm = self._normalize_vrm(vrm_match.group(1))
                return {
                    "vrm": vrm,
                    "raw_text": vrm_match.group(1),
                    "confidence": 60,
                    "location": "extracted from text",
                    "plate_type": "current"
                }
            return {"vrm": None, "confidence": 0, "error": "Failed to parse response"}
    
    def _normalize_vrm(self, vrm: str) -> str:
        """Normalize VRM to standard UK format with space."""
        if not vrm:
            return vrm
        # Remove all spaces and convert to uppercase
        vrm = vrm.replace(" ", "").upper()
        # Current format: AB12 CDE (add space after 4 chars)
        if len(vrm) == 7 and re.match(r"^[A-Z]{2}\d{2}[A-Z]{3}$", vrm):
            return f"{vrm[:4]} {vrm[4:]}"
        # Prefix format: A123 ABC
        if re.match(r"^[A-Z]\d{1,3}[A-Z]{3}$", vrm):
            match = re.match(r"^([A-Z]\d{1,3})([A-Z]{3})$", vrm)
            if match:
                return f"{match.group(1)} {match.group(2)}"
        # Suffix format: ABC 123A
        if re.match(r"^[A-Z]{3}\d{1,3}[A-Z]$", vrm):
            match = re.match(r"^([A-Z]{3})(\d{1,3}[A-Z])$", vrm)
            if match:
                return f"{match.group(1)} {match.group(2)}"
        return vrm

    async def analyze_loading_activity(self, image_path: str, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Analyze image for loading bay activity detection using Vision GPT.
        
        Detects:
        - Vehicle type (van, lorry, pickup, car)
        - Human presence near vehicle
        - Staff/driver activity
        - Goods/items being handled
        - Vehicle door states (rear, side, boot)
        - Movement patterns
        
        Returns structured analysis for loading bay decision logic.
        """
        if not self.api_key:
            logger.warning("No OpenAI API key configured for loading activity analysis")
            return self._empty_loading_analysis(evidence_id)
        
        base64_image = self._encode_image(image_path)
        if not base64_image:
            return self._empty_loading_analysis(evidence_id)
        
        ext = os.path.splitext(image_path)[1].lower()
        media_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        
        prompt = """Analyze this parking enforcement evidence image for LOADING BAY activity detection.

You are helping determine if a vehicle is legitimately loading/unloading under UK regulations.

DETECT THE FOLLOWING:

1. VEHICLE TYPE:
- Is it a Van, Lorry/Truck, Pickup, or Passenger Car?
- What is the make/model if visible?

2. HUMAN PRESENCE:
- Is there a person visible near the vehicle?
- Are they a driver/staff member handling goods?
- What are they doing (carrying items, moving between vehicle and building)?

3. GOODS/ITEMS:
- Are there visible boxes, crates, packages, or bulky items?
- Are items being loaded INTO or OUT OF the vehicle?
- Are there items on the ground near the vehicle?

4. VEHICLE STATE:
- Are the rear doors open?
- Are the side doors open?
- Is the boot/tailgate open?
- Is a loading ramp deployed?

5. MOVEMENT INDICATORS:
- Does this appear to be mid-loading activity?
- Is there evidence of vehicle-to-building movement?

Return a JSON object with:
{
  "vehicleAnalysis": {
    "vehicleType": "van" | "lorry" | "pickup" | "passenger_car" | "unknown",
    "makeModel": "string or null",
    "confidence": 0-100
  },
  "loadingActivity": {
    "humanDetected": true/false,
    "humanLocation": "near vehicle door" | "between vehicle and building" | "not visible" | etc,
    "staffDetected": true/false,
    "goodsDetected": true/false,
    "goodsDescription": "boxes, packages, etc" or null,
    "objectsCarried": true/false,
    "doorsOpen": true/false,
    "rearDoorsOpen": true/false,
    "sideDoorsOpen": true/false,
    "bootOpen": true/false,
    "loadingRampDeployed": true/false,
    "movementDetected": true/false,
    "vehicleToBuildingMovement": true/false,
    "activityDescription": "Brief description of what's happening"
  },
  "overallAssessment": {
    "likelyLoading": true/false,
    "confidence": 0-100,
    "reasoning": "Brief explanation"
  }
}

Return ONLY the JSON object, no other text."""

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:{media_type};base64,{base64_image}",
                                            "detail": "high"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 800
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"OpenAI API error for loading analysis: {response.status_code} - {response.text}")
                    return self._empty_loading_analysis(evidence_id)
                
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                result = self._parse_loading_analysis_response(content)
                result["evidenceId"] = evidence_id
                result["success"] = True
                return result
                
        except Exception as e:
            logger.error(f"Loading activity analysis failed: {e}")
            return self._empty_loading_analysis(evidence_id)
    
    def _parse_loading_analysis_response(self, content: str) -> Dict[str, Any]:
        """Parse loading activity analysis response from Vision GPT."""
        import json
        try:
            content = content.strip()
            if content.startswith("```"):
                content = re.sub(r"```json?\n?", "", content)
                content = content.replace("```", "")
            return json.loads(content.strip())
        except json.JSONDecodeError:
            logger.warning("Failed to parse loading analysis JSON, using defaults")
            return {
                "vehicleAnalysis": {
                    "vehicleType": "unknown",
                    "makeModel": None,
                    "confidence": 0
                },
                "loadingActivity": {
                    "humanDetected": False,
                    "humanLocation": None,
                    "staffDetected": False,
                    "goodsDetected": False,
                    "goodsDescription": None,
                    "objectsCarried": False,
                    "doorsOpen": False,
                    "rearDoorsOpen": False,
                    "sideDoorsOpen": False,
                    "bootOpen": False,
                    "loadingRampDeployed": False,
                    "movementDetected": False,
                    "vehicleToBuildingMovement": False,
                    "activityDescription": "Analysis failed"
                },
                "overallAssessment": {
                    "likelyLoading": False,
                    "confidence": 0,
                    "reasoning": "Could not parse AI response"
                }
            }
    
    def _empty_loading_analysis(self, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """Return empty loading analysis result."""
        return {
            "evidenceId": evidence_id,
            "success": False,
            "vehicleAnalysis": {
                "vehicleType": "unknown",
                "makeModel": None,
                "confidence": 0
            },
            "loadingActivity": {
                "humanDetected": False,
                "humanLocation": None,
                "staffDetected": False,
                "goodsDetected": False,
                "goodsDescription": None,
                "objectsCarried": False,
                "doorsOpen": False,
                "rearDoorsOpen": False,
                "sideDoorsOpen": False,
                "bootOpen": False,
                "loadingRampDeployed": False,
                "movementDetected": False,
                "vehicleToBuildingMovement": False,
                "activityDescription": None
            },
            "overallAssessment": {
                "likelyLoading": False,
                "confidence": 0,
                "reasoning": "No analysis available"
            }
        }

    async def analyze_disabled_bay(self, image_path: str, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Analyze image for Disabled Bay compliance using Vision GPT.
        
        Detects:
        - Bay confirmation (wheelchair symbol, signage, road markings)
        - Vehicle position (fully inside bay, no overlap)
        - Blue Badge visibility (front visible, not obscured)
        - Badge details (expiry date, badge number, hologram)
        
        Returns structured analysis for disabled bay decision logic.
        """
        if not self.api_key:
            logger.warning("No OpenAI API key configured for disabled bay analysis")
            return self._empty_disabled_bay_analysis(evidence_id)
        
        base64_image = self._encode_image(image_path)
        if not base64_image:
            return self._empty_disabled_bay_analysis(evidence_id)
        
        ext = os.path.splitext(image_path)[1].lower()
        media_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        
        prompt = """Analyze this parking enforcement evidence image for DISABLED BAY compliance under UK Blue Badge regulations.

You are helping determine if a vehicle parked in a Disabled Bay is COMPLIANT or NON-COMPLIANT.

ANALYZE THE FOLLOWING:

1. DISABLED BAY CONFIRMATION:
- Is there a wheelchair symbol visible on the ground?
- Is there vertical signage indicating a disabled bay?
- Are there road markings showing this is a disabled parking space?

2. VEHICLE POSITION:
- Is the vehicle FULLY inside the disabled bay boundaries?
- Is the vehicle overlapping any adjacent parking bay?
- Is the vehicle overlapping any hatched markings?
- Is the vehicle blocking any disabled access zones?

3. BLUE BADGE VISIBILITY:
- Can you see the dashboard/fascia area through the windscreen?
- Is there a Blue Badge visible on the dashboard?
- Is the FRONT of the badge visible (or is the back showing)?
- Is the badge obscured by reflections or other objects?

4. BLUE BADGE DETAILS (if front is visible):
- Can you read the expiry date? If yes, what is it?
- Can you see the badge number?
- Is the hologram visible?

Return a JSON object with:
{
  "disabledBayAnalysis": {
    "isDisabledBay": true/false,
    "wheelchairSymbolVisible": true/false,
    "signageVisible": true/false,
    "roadMarkingsVisible": true/false,
    "bayConfirmationConfidence": 0-100,
    
    "vehiclePosition": {
      "fullyInsideBay": true/false,
      "overlapDetected": true/false,
      "overlapType": "adjacent_bay" | "hatched_area" | "access_zone" | null,
      "positionConfidence": 0-100
    },
    
    "blueBadge": {
      "dashboardVisible": true/false,
      "visible": true/false,
      "frontVisible": true/false,
      "backShowing": true/false,
      "partiallyObscured": true/false,
      "reflectionIssues": true/false,
      "expiryDate": "YYYY-MM-DD" or null if not readable,
      "badgeNumber": "string" or null if not readable,
      "hologramVisible": true/false,
      "confidence": 0-100,
      "notes": "Any relevant observations about badge visibility"
    },
    
    "overallAssessment": {
      "likelyCompliant": true/false,
      "confidence": 0-100,
      "primaryIssue": "description of main issue if non-compliant, null if compliant"
    }
  }
}

IMPORTANT:
- Never assume a Blue Badge is present if not clearly visible
- If expiry date is unreadable, set to null (do not guess)
- If badge back is showing instead of front, mark frontVisible=false, backShowing=true
- Be strict about badge visibility requirements

Return ONLY the JSON object, no other text."""

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:{media_type};base64,{base64_image}",
                                            "detail": "high"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 800
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"OpenAI API error for disabled bay analysis: {response.status_code} - {response.text}")
                    return self._empty_disabled_bay_analysis(evidence_id)
                
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                result = self._parse_disabled_bay_response(content)
                result["evidenceId"] = evidence_id
                result["success"] = True
                return result
                
        except Exception as e:
            logger.error(f"Disabled bay analysis failed: {e}")
            return self._empty_disabled_bay_analysis(evidence_id)
    
    def _parse_disabled_bay_response(self, content: str) -> Dict[str, Any]:
        """Parse disabled bay analysis response from Vision GPT."""
        import json
        try:
            content = content.strip()
            if content.startswith("```"):
                content = re.sub(r"```json?\n?", "", content)
                content = content.replace("```", "")
            return json.loads(content.strip())
        except json.JSONDecodeError:
            logger.warning("Failed to parse disabled bay analysis JSON, using defaults")
            return self._empty_disabled_bay_analysis()
    
    def _empty_disabled_bay_analysis(self, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """Return empty disabled bay analysis result."""
        return {
            "evidenceId": evidence_id,
            "success": False,
            "disabledBayAnalysis": {
                "isDisabledBay": False,
                "wheelchairSymbolVisible": False,
                "signageVisible": False,
                "roadMarkingsVisible": False,
                "bayConfirmationConfidence": 0,
                "vehiclePosition": {
                    "fullyInsideBay": True,
                    "overlapDetected": False,
                    "overlapType": None,
                    "positionConfidence": 0
                },
                "blueBadge": {
                    "dashboardVisible": False,
                    "visible": False,
                    "frontVisible": False,
                    "backShowing": False,
                    "partiallyObscured": False,
                    "reflectionIssues": False,
                    "expiryDate": None,
                    "badgeNumber": None,
                    "hologramVisible": False,
                    "confidence": 0,
                    "notes": "No analysis available"
                },
                "overallAssessment": {
                    "likelyCompliant": False,
                    "confidence": 0,
                    "primaryIssue": "Analysis not performed"
                }
            }
        }

    async def analyze_parent_child_bay(self, image_path: str, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Analyze image for Parent & Child Bay compliance using Vision GPT.
        
        Detects:
        - Bay confirmation (child/buggy symbol, signage, ground markings)
        - Vehicle position (fully inside bay, no overlap)
        - Child presence (children entering/exiting/near vehicle, with pram)
        - Adult and child counts
        
        Returns structured analysis for P&C bay decision logic.
        """
        if not self.api_key:
            logger.warning("No OpenAI API key configured for parent child bay analysis")
            return self._empty_parent_child_analysis(evidence_id)
        
        base64_image = self._encode_image(image_path)
        if not base64_image:
            return self._empty_parent_child_analysis(evidence_id)
        
        ext = os.path.splitext(image_path)[1].lower()
        media_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        
        prompt = """Analyze this parking enforcement evidence image for PARENT & CHILD BAY compliance under UK standards.

You are helping determine if a vehicle parked in a Parent & Child Bay is COMPLIANT or NON-COMPLIANT.
Child seat alone is NOT sufficient evidence of compliance - an actual child must be detected.

ANALYZE THE FOLLOWING:

1. PARENT & CHILD BAY CONFIRMATION:
- Is there a child/baby symbol visible on the ground or signage?
- Is there a buggy/pram/stroller symbol visible?
- Is there vertical signage indicating "Parent & Child" or similar?
- Are there ground markings showing this is a P&C parking space?

2. VEHICLE POSITION:
- Is the vehicle FULLY inside the bay boundaries?
- Is the vehicle overlapping any adjacent parking bay?
- Is the vehicle overlapping any hatched markings or access zones?

3. CHILD PRESENCE DETECTION (CRITICAL):
- Can you see any child exiting the vehicle?
- Can you see any child entering the vehicle?
- Can you see any child standing near the vehicle?
- Is there a pram/pushchair with a child IN it?
- Is there just an empty pram visible (no child)?
- Is there just a child seat visible in the vehicle (no actual child)?
- How many adults are visible?
- How many children are visible?

Return a JSON object with:
{
  "parentChildAnalysis": {
    "isParentChildBay": true/false,
    "groundMarkingsVisible": true/false,
    "signageVisible": true/false,
    "childSymbolVisible": true/false,
    "buggySymbolVisible": true/false,
    "bayConfirmationConfidence": 0-100,
    
    "vehiclePosition": {
      "fullyInsideBay": true/false,
      "overlapDetected": true/false,
      "overlapType": "adjacent_bay" | "hatched_area" | "access_zone" | null,
      "positionConfidence": 0-100
    },
    
    "childDetection": {
      "childDetected": true/false,
      "childExitingVehicle": true/false,
      "childEnteringVehicle": true/false,
      "childNearVehicle": true/false,
      "pramWithChild": true/false,
      "pramOnly": true/false,
      "childSeatOnly": true/false,
      "adultCount": number,
      "childCount": number,
      "confidence": 0-100,
      "notes": "Any relevant observations about people detected"
    },

    "overallAssessment": {
      "likelyCompliant": true/false,
      "confidence": 0-100,
      "primaryIssue": "string describing main finding"
    }
  }
}

Return ONLY the JSON object, no other text."""
        
        try:
            import json
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:{media_type};base64,{base64_image}",
                                            "detail": "high"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 1000
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"OpenAI API error for parent child analysis: {response.status_code}")
                    return self._empty_parent_child_analysis(evidence_id)
                
                result = response.json()
                content = result["choices"][0]["message"]["content"]
                
                parsed = self._parse_parent_child_response(content, evidence_id)
                parsed["evidenceId"] = evidence_id
                parsed["success"] = True
                return parsed
                
        except Exception as e:
            logger.error(f"Error in parent child bay analysis: {e}")
            return self._empty_parent_child_analysis(evidence_id)
    
    def _parse_parent_child_response(self, content: str, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """Parse Vision GPT response for parent child analysis."""
        import json
        try:
            if "```" in content:
                content = re.sub(r"```json?\n?", "", content)
                content = content.replace("```", "")
            return json.loads(content.strip())
        except json.JSONDecodeError:
            logger.warning("Failed to parse parent child analysis JSON, using defaults")
            return self._empty_parent_child_analysis()
    
    def _empty_parent_child_analysis(self, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """Return empty parent child analysis result."""
        return {
            "evidenceId": evidence_id,
            "success": False,
            "parentChildAnalysis": {
                "isParentChildBay": False,
                "groundMarkingsVisible": False,
                "signageVisible": False,
                "childSymbolVisible": False,
                "buggySymbolVisible": False,
                "bayConfirmationConfidence": 0,
                "vehiclePosition": {
                    "fullyInsideBay": True,
                    "overlapDetected": False,
                    "overlapType": None,
                    "positionConfidence": 0
                },
                "childDetection": {
                    "childDetected": False,
                    "childExitingVehicle": False,
                    "childEnteringVehicle": False,
                    "childNearVehicle": False,
                    "pramWithChild": False,
                    "pramOnly": False,
                    "childSeatOnly": False,
                    "adultCount": 0,
                    "childCount": 0,
                    "confidence": 0,
                    "notes": "No analysis available"
                },
                "overallAssessment": {
                    "likelyCompliant": False,
                    "confidence": 0,
                    "primaryIssue": "Analysis not performed"
                }
            }
        }
    
    async def analyze_authorised_bay(self, image_path: str, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Analyze image for Authorised Bay compliance using Vision GPT.
        
        Detects:
        - Evidence quality (full vehicle, windscreen, dashboard visibility)
        - Permit visibility and readability (number, expiry, site code)
        - Staff permit/ID visibility
        - Vehicle position (fully inside bay, no overlap)
        
        Returns structured analysis for authorisation decision logic.
        """
        if not self.api_key:
            logger.warning("No OpenAI API key configured for authorised bay analysis")
            return self._empty_authorised_bay_analysis(evidence_id)
        
        base64_image = self._encode_image(image_path)
        if not base64_image:
            return self._empty_authorised_bay_analysis(evidence_id)
        
        ext = os.path.splitext(image_path)[1].lower()
        media_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        
        prompt = """Analyze this parking enforcement evidence image for AUTHORISED BAY / PERMIT HOLDER BAY compliance under UK standards.

You are helping determine if a vehicle parked in an Authorised/Permit Holder Bay has valid authorisation.

ANALYZE THE FOLLOWING:

1. EVIDENCE QUALITY:
- Is the full vehicle visible in the image?
- Is the windscreen/front window clearly visible?
- Is the dashboard area visible where permits would be displayed?
- Overall image quality for permit reading (0-100)

2. PERMIT CHECK:
- Is there a permit visible in the windscreen or on the dashboard?
- If visible, is the permit readable (text clear enough to read)?
- Can you read any permit number or identifier?
- Can you read any expiry date?
- Can you read any site name or code?
- Does the permit appear expired (if date visible)?
- Confidence in permit detection (0-100)

3. STAFF/OPERATOR CHECK:
- Is there a staff permit or ID card visible?
- Is there any operator identification visible?

4. VEHICLE POSITION:
- Is the vehicle FULLY inside the bay boundaries?
- Is the vehicle overlapping any adjacent parking bay?
- Is the vehicle overlapping any hatched areas or access zones?
- Is the vehicle correctly parked (not obstructing)?

Return a JSON object with:
{
  "authorisedBayAnalysis": {
    "evidenceQuality": {
      "fullVehicleVisible": true/false,
      "windscreenVisible": true/false,
      "dashboardVisible": true/false,
      "ocrConfidence": 0-100,
      "notes": "Any relevant observations about image quality"
    },
    
    "permitCheck": {
      "permitVisible": true/false,
      "permitReadable": true/false,
      "permitNumber": "string or null",
      "permitExpiry": "string or null",
      "permitSiteCode": "string or null",
      "permitExpired": true/false,
      "permitValidForSite": true/false,
      "confidence": 0-100,
      "notes": "Any relevant observations about the permit"
    },
    
    "staffCheck": {
      "staffPermitVisible": true/false,
      "staffIdVisible": true/false,
      "notes": "Any relevant observations about staff identification"
    },
    
    "vehiclePosition": {
      "fullyInsideBay": true/false,
      "overlapDetected": true/false,
      "overlapType": "adjacent_bay" | "hatched_area" | "access_zone" | null,
      "correctlyParked": true/false,
      "positionConfidence": 0-100
    },
    
    "overallAssessment": {
      "authorisationLikely": true/false,
      "confidence": 0-100,
      "primaryFinding": "string describing main observation"
    }
  }
}

Return ONLY the JSON object, no other text."""
        
        try:
            import json
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:{media_type};base64,{base64_image}",
                                            "detail": "high"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 1000
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"OpenAI API error for authorised bay analysis: {response.status_code}")
                    return self._empty_authorised_bay_analysis(evidence_id)
                
                result = response.json()
                content = result["choices"][0]["message"]["content"]
                
                parsed = self._parse_authorised_bay_response(content, evidence_id)
                parsed["evidenceId"] = evidence_id
                parsed["success"] = True
                return parsed
                
        except Exception as e:
            logger.error(f"Error in authorised bay analysis: {e}")
            return self._empty_authorised_bay_analysis(evidence_id)
    
    def _parse_authorised_bay_response(self, content: str, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """Parse Vision GPT response for authorised bay analysis."""
        import json
        try:
            if "```" in content:
                content = re.sub(r"```json?\n?", "", content)
                content = content.replace("```", "")
            return json.loads(content.strip())
        except json.JSONDecodeError:
            logger.warning("Failed to parse authorised bay analysis JSON, using defaults")
            return self._empty_authorised_bay_analysis()
    
    def _empty_authorised_bay_analysis(self, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """Return empty authorised bay analysis result."""
        return {
            "evidenceId": evidence_id,
            "success": False,
            "authorisedBayAnalysis": {
                "evidenceQuality": {
                    "fullVehicleVisible": False,
                    "windscreenVisible": False,
                    "dashboardVisible": False,
                    "ocrConfidence": 0,
                    "notes": "No analysis available"
                },
                "permitCheck": {
                    "permitVisible": False,
                    "permitReadable": False,
                    "permitNumber": None,
                    "permitExpiry": None,
                    "permitSiteCode": None,
                    "permitExpired": False,
                    "permitValidForSite": False,
                    "confidence": 0,
                    "notes": "No analysis available"
                },
                "staffCheck": {
                    "staffPermitVisible": False,
                    "staffIdVisible": False,
                    "notes": "No analysis available"
                },
                "vehiclePosition": {
                    "fullyInsideBay": True,
                    "overlapDetected": False,
                    "overlapType": None,
                    "correctlyParked": True,
                    "positionConfidence": 0
                },
                "overallAssessment": {
                    "authorisationLikely": False,
                    "confidence": 0,
                    "primaryFinding": "Analysis not performed"
                }
            }
        }
    
    async def analyze_ev_bay(self, image_path: str, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Analyze image for EV bay compliance using Vision GPT.
        
        Detects:
        - Vehicle EV capability (BEV/PHEV badging)
        - Charging activity (cable, charger connection)
        - Signage requirements
        - Vehicle positioning
        """
        if not self.api_key:
            logger.warning("No OpenAI API key for EV bay analysis")
            return self._empty_ev_bay_analysis(evidence_id)
        
        base64_image = self._encode_image(image_path)
        if not base64_image:
            return self._empty_ev_bay_analysis(evidence_id)
        
        ext = os.path.splitext(image_path)[1].lower()
        media_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        
        prompt = """Analyze this parking enforcement evidence image for EV BAY (Electric Vehicle Bay) compliance under UK standards.

You are helping determine if a vehicle parked in an EV bay is COMPLIANT with EV bay rules. PAY SPECIAL ATTENTION to charging cables and charging activity - this is CRITICAL for compliance.

ANALYZE THE FOLLOWING:

1. EVIDENCE QUALITY:
- Is the full vehicle visible in the image?
- Is the charging port side of the vehicle visible?
- Is a charging unit/station visible in the image?
- Overall image quality (0-100)

2. VEHICLE EV CAPABILITY:
- Look for EV badging on the vehicle (Tesla, Electric, EV, PHEV, Hybrid badges)
- Is this clearly a Battery Electric Vehicle (BEV)?
- Is this clearly a Plug-in Hybrid (PHEV)?
- Look for: Tesla, Nissan Leaf, BMW i3, Audi e-tron, Jaguar I-Pace, VW ID, Polestar, etc.
- Look for hybrid badges: PHEV, Plug-in Hybrid, GTE, etc.
- Confidence in EV identification (0-100)

3. CHARGING ACTIVITY (CRITICAL - Examine very carefully):
CABLE DETECTION - Look for:
- ANY cable/wire running between the vehicle and a charging station
- A thick black or orange cable on the ground or suspended
- Cable connectors/plugs at either end
- Cable attached to or entering the vehicle's charging port area
- Cable attached to or coming from a charging pedestal/unit

VEHICLE CHARGING PORT - Look for:
- Open charging flap on vehicle (usually on front/rear wing or nose)
- Cable plug inserted into vehicle's charging socket
- Charging port lights (green, blue, or amber LEDs)
- Vehicle dashboard charging indicator visible through windscreen

CHARGING STATION - Look for:
- Charging unit/pedestal/bollard in the image
- LED indicator lights on the charger (green=charging, blue=ready)
- Display screen showing charging status
- Cable coming FROM the charging unit
- Type of charger: slow (3kW), fast (7-22kW), rapid (50kW+), Tesla Supercharger

IMPORTANT: If you see ANY cable connecting vehicle to charger, mark cableConnectedToVehicle AND cableConnectedToCharger as TRUE.

4. SIGNAGE CHECK:
- Is there "Electric vehicles only" signage visible?
- Is there "While charging only" signage visible?
- Is there a maximum stay time indicated?
- Any time restrictions visible?
- "Charge point users only" condition visible?

5. VEHICLE POSITION:
- Is the vehicle FULLY inside the EV bay boundaries?
- Is the vehicle overlapping any adjacent bays or hatched areas?
- Is the vehicle correctly positioned near the charging point?

Return a JSON object with:
{
  "evBayAnalysis": {
    "evidenceQuality": {
      "fullVehicleVisible": true/false,
      "chargingPortVisible": true/false,
      "chargingUnitVisible": true/false,
      "ocrConfidence": 0-100,
      "notes": "observations"
    },
    
    "vehicleEVCapability": {
      "evBadgingVisible": true/false,
      "isBEV": true/false,
      "isPHEV": true/false,
      "detectedMakeModel": "string or null",
      "evIndicators": ["list of EV indicators seen"],
      "confidence": 0-100,
      "notes": "observations"
    },
    
    "chargingActivity": {
      "cableVisible": true/false,
      "cableConnectedToVehicle": true/false,
      "cableConnectedToCharger": true/false,
      "chargingPortInUse": true/false,
      "chargerIndicatorLights": true/false,
      "vehicleChargingDisplay": true/false,
      "chargingUnitType": "string or null",
      "cableDescription": "describe the cable path if visible",
      "confidence": 0-100,
      "notes": "detailed observations about charging activity"
    },
    
    "signageCheck": {
      "evOnlySignage": true/false,
      "whileChargingOnly": true/false,
      "maxStayMinutes": number or null,
      "timeRestrictions": "string or null",
      "chargePointUsersOnly": true/false,
      "signageNotes": "observations"
    },
    
    "vehiclePosition": {
      "fullyInsideBay": true/false,
      "overlapDetected": true/false,
      "overlapType": "adjacent_bay" | "hatched_area" | "access_zone" | null,
      "nearChargingPoint": true/false,
      "positionConfidence": 0-100
    },
    
    "overallAssessment": {
      "appearsCompliant": true/false,
      "isEVCapable": true/false,
      "isCharging": true/false,
      "confidence": 0-100,
      "primaryFinding": "main observation"
    }
  }
}

Return ONLY the JSON object, no other text."""
        
        try:
            import json
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:{media_type};base64,{base64_image}",
                                            "detail": "high"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 1200
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"OpenAI API error for EV bay analysis: {response.status_code}")
                    return self._empty_ev_bay_analysis(evidence_id)
                
                result = response.json()
                content = result["choices"][0]["message"]["content"]
                
                parsed = self._parse_ev_bay_response(content, evidence_id)
                parsed["evidenceId"] = evidence_id
                parsed["success"] = True
                return parsed
                
        except Exception as e:
            logger.error(f"Error in EV bay analysis: {e}")
            return self._empty_ev_bay_analysis(evidence_id)
    
    def _parse_ev_bay_response(self, content: str, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """Parse Vision GPT response for EV bay analysis."""
        import json
        try:
            if "```" in content:
                content = re.sub(r"```json?\n?", "", content)
                content = content.replace("```", "")
            return json.loads(content.strip())
        except json.JSONDecodeError:
            logger.warning("Failed to parse EV bay analysis JSON, using defaults")
            return self._empty_ev_bay_analysis()
    
    def _empty_ev_bay_analysis(self, evidence_id: Optional[int] = None) -> Dict[str, Any]:
        """Return empty EV bay analysis result."""
        return {
            "evidenceId": evidence_id,
            "success": False,
            "evBayAnalysis": {
                "evidenceQuality": {
                    "fullVehicleVisible": False,
                    "chargingPortVisible": False,
                    "chargingUnitVisible": False,
                    "ocrConfidence": 0,
                    "notes": "No analysis available"
                },
                "vehicleEVCapability": {
                    "evBadgingVisible": False,
                    "isBEV": False,
                    "isPHEV": False,
                    "detectedMakeModel": None,
                    "evIndicators": [],
                    "confidence": 0,
                    "notes": "No analysis available"
                },
                "chargingActivity": {
                    "cableVisible": False,
                    "cableConnectedToVehicle": False,
                    "cableConnectedToCharger": False,
                    "chargingPortInUse": False,
                    "chargingUnitType": None,
                    "confidence": 0,
                    "notes": "No analysis available"
                },
                "signageCheck": {
                    "evOnlySignage": False,
                    "whileChargingOnly": False,
                    "maxStayMinutes": None,
                    "timeRestrictions": None,
                    "chargePointUsersOnly": False,
                    "signageNotes": "No analysis available"
                },
                "vehiclePosition": {
                    "fullyInsideBay": True,
                    "overlapDetected": False,
                    "overlapType": None,
                    "nearChargingPoint": False,
                    "positionConfidence": 0
                },
                "overallAssessment": {
                    "appearsCompliant": False,
                    "isEVCapable": False,
                    "isCharging": False,
                    "confidence": 0,
                    "primaryFinding": "Analysis not performed"
                }
            }
        }


ocr_service = OCRService()
