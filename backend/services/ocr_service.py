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
        
        prompt = """Analyze this parking enforcement evidence image and extract BOTH the timestamp AND vehicle number plate (VRM).

TIMESTAMP - Look for:
1. Camera overlay text showing date and time (usually in corners)
2. Text like "11/01/2026 14:23:45" or similar date/time formats
3. Any "Observe From" or "Observe To" text with timestamps

VRM (NUMBER PLATE) - Look for:
1. UK format number plates (e.g., AB12 CDE, AB12CDE)
2. Number plates on vehicles visible in the image
3. Text overlays showing VRM/registration information

UK number plate formats:
- Current format: AB12 ABC (2 letters, 2 numbers, 3 letters)
- Prefix format: A123 ABC (letter, 1-3 numbers, 3 letters)
- Suffix format: ABC 123A (3 letters, 1-3 numbers, letter)

Return a JSON object with:
{
  "timestamp": "YYYY-MM-DD HH:MM:SS" format if found, or null if not found,
  "timestamp_raw_text": "exact timestamp text as seen",
  "timestamp_confidence": 0-100 score,
  "timestamp_location": "where in the image (e.g., 'bottom-left corner')",
  "vrm": "THE NUMBER PLATE" normalized with space (e.g., "AB12 CDE") or null,
  "vrm_raw_text": "exact plate text as seen in image",
  "vrm_confidence": 0-100 score,
  "vrm_location": "where in the image (e.g., 'front of vehicle', 'rear plate')"
}

If items not found, set their values to null with 0 confidence.

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
            
            # Normalize VRM if found
            if result.get("vrm"):
                result["vrm"] = self._normalize_vrm(result["vrm"])
            
            # Remap for backward compatibility
            return {
                "timestamp": result.get("timestamp"),
                "raw_text": result.get("timestamp_raw_text"),
                "confidence": result.get("timestamp_confidence", 0),
                "location": result.get("timestamp_location"),
                "vrm": result.get("vrm"),
                "vrm_raw_text": result.get("vrm_raw_text"),
                "vrm_confidence": result.get("vrm_confidence", 0),
                "vrm_location": result.get("vrm_location")
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


ocr_service = OCRService()
