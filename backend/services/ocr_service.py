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
    
    async def extract_timestamp_from_image(self, image_path: str) -> Dict[str, Any]:
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

ocr_service = OCRService()
