"""
Evidence Weather Analysis Service

Fetches HISTORICAL weather data based on evidence timestamps.
Uses Open-Meteo Archive API (free, no key required) for past weather data.

Time Source Hierarchy (MANDATORY):
1. OCR timestamp extracted from image
2. Observe From / Observe To timestamps  
3. Manual upload timestamp (LAST RESORT)

NEVER uses system current time or live weather APIs.
"""

import httpx
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple, List
from sqlalchemy.orm import Session
from enum import Enum

from backend.db.models import Evidence, EvidenceBundle, EnforcementCase, ParkingSite, CasePipelineResults


class WeatherSeverity(str, Enum):
    NORMAL = "Normal"
    REDUCED_VISIBILITY = "Reduced Visibility"
    ADVERSE = "Adverse"
    SEVERE = "Severe"


class WeatherCondition(str, Enum):
    CLEAR = "Clear"
    CLOUDY = "Cloudy"
    RAIN = "Rain"
    SNOW = "Snow"
    FOG = "Fog"
    ICE = "Ice"
    STORM = "Storm"


WMO_WEATHER_CODES = {
    0: ("Clear sky", WeatherCondition.CLEAR),
    1: ("Mainly clear", WeatherCondition.CLEAR),
    2: ("Partly cloudy", WeatherCondition.CLOUDY),
    3: ("Overcast", WeatherCondition.CLOUDY),
    45: ("Fog", WeatherCondition.FOG),
    48: ("Depositing rime fog", WeatherCondition.FOG),
    51: ("Light drizzle", WeatherCondition.RAIN),
    53: ("Moderate drizzle", WeatherCondition.RAIN),
    55: ("Dense drizzle", WeatherCondition.RAIN),
    56: ("Light freezing drizzle", WeatherCondition.ICE),
    57: ("Dense freezing drizzle", WeatherCondition.ICE),
    61: ("Slight rain", WeatherCondition.RAIN),
    63: ("Moderate rain", WeatherCondition.RAIN),
    65: ("Heavy rain", WeatherCondition.RAIN),
    66: ("Light freezing rain", WeatherCondition.ICE),
    67: ("Heavy freezing rain", WeatherCondition.ICE),
    71: ("Slight snow", WeatherCondition.SNOW),
    73: ("Moderate snow", WeatherCondition.SNOW),
    75: ("Heavy snow", WeatherCondition.SNOW),
    77: ("Snow grains", WeatherCondition.SNOW),
    80: ("Slight rain showers", WeatherCondition.RAIN),
    81: ("Moderate rain showers", WeatherCondition.RAIN),
    82: ("Violent rain showers", WeatherCondition.RAIN),
    85: ("Slight snow showers", WeatherCondition.SNOW),
    86: ("Heavy snow showers", WeatherCondition.SNOW),
    95: ("Thunderstorm", WeatherCondition.STORM),
    96: ("Thunderstorm with hail", WeatherCondition.STORM),
    99: ("Thunderstorm with heavy hail", WeatherCondition.STORM),
}


async def geocode_postcode(postcode: str) -> Optional[Tuple[float, float]]:
    """Convert UK postcode to latitude/longitude using postcodes.io (free API)."""
    if not postcode:
        return None
    
    clean_postcode = postcode.strip().upper().replace(" ", "")
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"https://api.postcodes.io/postcodes/{clean_postcode}")
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == 200 and data.get("result"):
                    result = data["result"]
                    return (result["latitude"], result["longitude"])
            return None
    except Exception as e:
        print(f"[Weather] Geocoding error for {postcode}: {e}")
        return None


def filter_outlier_timestamps(timestamps: List[datetime]) -> List[datetime]:
    """
    Filter out outlier timestamps using IQR method.
    If most timestamps cluster together, remove ones that are far off.
    """
    if len(timestamps) < 3:
        return timestamps
    
    sorted_ts = sorted(timestamps)
    median = sorted_ts[len(sorted_ts) // 2]
    
    max_deviation_days = 7
    
    valid = []
    for ts in sorted_ts:
        days_diff = abs((ts - median).total_seconds()) / 86400
        if days_diff <= max_deviation_days:
            valid.append(ts)
    
    if len(valid) >= 2:
        return valid
    return timestamps


def extract_observe_window(
    evidence_list: List[Evidence],
    ocr_timestamps: Optional[List[datetime]] = None
) -> Tuple[Optional[datetime], Optional[datetime], str, str]:
    """
    Extract observation window following the strict time source hierarchy.
    
    Returns: (observe_from, observe_to, time_source, confidence)
    
    Time Source Hierarchy:
    1. OCR timestamps from images
    2. Evidence timestamps (Observe From/To)
    3. Manual upload timestamp (last resort)
    """
    observe_from = None
    observe_to = None
    time_source = "UNKNOWN"
    confidence = "LOW"
    
    if ocr_timestamps and len(ocr_timestamps) > 0:
        valid_ocr = [ts for ts in ocr_timestamps if ts and ts < datetime.utcnow()]
        valid_ocr = filter_outlier_timestamps(valid_ocr)
        if valid_ocr:
            observe_from = min(valid_ocr)
            observe_to = max(valid_ocr)
            time_source = "OCR"
            confidence = "HIGH"
            return (observe_from, observe_to, time_source, confidence)
    
    if evidence_list:
        timestamps = [e.timestamp for e in evidence_list if e.timestamp]
        timestamps = [ts for ts in timestamps if ts < datetime.utcnow()]
        timestamps = filter_outlier_timestamps(timestamps)
        
        if timestamps:
            observe_from = min(timestamps)
            observe_to = max(timestamps)
            time_source = "CAMERA_META"
            confidence = "HIGH" if len(timestamps) > 1 else "MEDIUM"
            return (observe_from, observe_to, time_source, confidence)
    
    if evidence_list:
        created_dates = [e.created_at for e in evidence_list if e.created_at]
        created_dates = [ts for ts in created_dates if ts < datetime.utcnow()]
        
        if created_dates:
            observe_from = min(created_dates)
            observe_to = max(created_dates)
            time_source = "UPLOAD"
            confidence = "LOW"
            return (observe_from, observe_to, time_source, confidence)
    
    return (None, None, "UNKNOWN", "LOW")


def calculate_query_time(observe_from: datetime, observe_to: datetime) -> datetime:
    """
    Calculate the time to query for weather.
    - If same time: use that time
    - If window > 0: use midpoint
    """
    if observe_from == observe_to:
        return observe_from
    
    midpoint = observe_from + (observe_to - observe_from) / 2
    return midpoint


def classify_severity(
    weather_code: Optional[int],
    visibility_m: Optional[float],
    precipitation_mm: Optional[float],
    wind_speed_mph: Optional[float]
) -> WeatherSeverity:
    """Classify weather severity for enforcement context."""
    if weather_code in [95, 96, 99]:
        return WeatherSeverity.SEVERE
    
    if weather_code in [75, 86, 67]:
        return WeatherSeverity.SEVERE
    
    if visibility_m is not None and visibility_m < 200:
        return WeatherSeverity.SEVERE
    
    if weather_code in [45, 48]:
        return WeatherSeverity.REDUCED_VISIBILITY
    
    if visibility_m is not None and visibility_m < 1000:
        return WeatherSeverity.REDUCED_VISIBILITY
    
    if weather_code in [56, 57, 66]:
        return WeatherSeverity.ADVERSE
    
    if weather_code in [73, 85]:
        return WeatherSeverity.ADVERSE
    
    if precipitation_mm is not None and precipitation_mm > 5:
        return WeatherSeverity.ADVERSE
    
    if wind_speed_mph is not None and wind_speed_mph > 40:
        return WeatherSeverity.ADVERSE
    
    if weather_code in [63, 65, 81, 82]:
        return WeatherSeverity.REDUCED_VISIBILITY
    
    if precipitation_mm is not None and precipitation_mm > 2:
        return WeatherSeverity.REDUCED_VISIBILITY
    
    return WeatherSeverity.NORMAL


async def fetch_historical_weather(
    latitude: float,
    longitude: float,
    query_time: datetime
) -> Optional[Dict[str, Any]]:
    """
    Fetch historical weather from Open-Meteo Archive API.
    NEVER fetches live/current weather.
    """
    hour_time = query_time.replace(minute=0, second=0, microsecond=0)
    date_str = hour_time.strftime("%Y-%m-%d")
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "start_date": date_str,
                    "end_date": date_str,
                    "hourly": "temperature_2m,relative_humidity_2m,precipitation,rain,snowfall,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,is_day",
                    "timezone": "Europe/London"
                }
            )
            
            if response.status_code != 200:
                print(f"[Weather] API error: {response.status_code}")
                return None
            
            data = response.json()
            hourly = data.get("hourly", {})
            times = hourly.get("time", [])
            
            if not times:
                return None
            
            target_hour = hour_time.hour
            if target_hour >= len(times):
                target_hour = len(times) - 1
            
            weather_code = hourly.get("weather_code", [None])[target_hour]
            wind_speed_kmh = hourly.get("wind_speed_10m", [None])[target_hour]
            wind_speed_mph = wind_speed_kmh * 0.621371 if wind_speed_kmh else None
            visibility_m = hourly.get("visibility", [None])[target_hour]
            precipitation_mm = hourly.get("precipitation", [None])[target_hour]
            
            code_info = WMO_WEATHER_CODES.get(weather_code, ("Unknown", WeatherCondition.CLOUDY))
            
            return {
                "observation_time": hour_time.isoformat(),
                "temperature_c": hourly.get("temperature_2m", [None])[target_hour],
                "humidity_percent": hourly.get("relative_humidity_2m", [None])[target_hour],
                "precipitation_mm": precipitation_mm,
                "rain_mm": hourly.get("rain", [None])[target_hour],
                "snowfall_mm": hourly.get("snowfall", [None])[target_hour],
                "visibility_m": visibility_m,
                "wind_speed_mph": round(wind_speed_mph, 1) if wind_speed_mph else None,
                "wind_direction_deg": hourly.get("wind_direction_10m", [None])[target_hour],
                "weather_code": weather_code,
                "weather_description": code_info[0],
                "condition": code_info[1].value,
                "is_day": hourly.get("is_day", [None])[target_hour] == 1,
                "severity": classify_severity(weather_code, visibility_m, precipitation_mm, wind_speed_mph).value,
                "api_source": "open_meteo_archive"
            }
            
    except Exception as e:
        print(f"[Weather] API fetch error: {e}")
        return None


async def get_evidence_weather(
    db: Session,
    bundle_id: int
) -> Dict[str, Any]:
    """
    Main entry point: Get weather analysis for an evidence bundle.
    
    Returns a complete weather analysis response including:
    - Time window used
    - Site information
    - Weather data
    - Severity classification
    - Confidence level
    """
    bundle = db.query(EvidenceBundle).filter(EvidenceBundle.id == bundle_id).first()
    if not bundle:
        return {
            "status": "error",
            "message": "Bundle not found",
            "confidence": "LOW"
        }
    
    case = None
    site = None
    
    if bundle.case_id:
        case = db.query(EnforcementCase).filter(EnforcementCase.id == bundle.case_id).first()
        if case and case.site_id:
            site = db.query(ParkingSite).filter(ParkingSite.id == case.site_id).first()
    
    if not site and bundle.site_id:
        site = db.query(ParkingSite).filter(ParkingSite.id == bundle.site_id).first()
    
    if not site:
        return {
            "status": "error",
            "message": "No site associated with evidence",
            "confidence": "LOW"
        }
    
    evidence_list = db.query(Evidence).filter(Evidence.bundle_id == bundle_id).all()
    if not evidence_list:
        return {
            "status": "error",
            "message": "No evidence items found",
            "confidence": "LOW"
        }
    
    ocr_timestamps = []
    case_id = bundle.case_id
    if case_id:
        pipeline_result = db.query(CasePipelineResults).filter(
            CasePipelineResults.case_id == case_id
        ).order_by(CasePipelineResults.created_at.desc()).first()
        
        if pipeline_result and pipeline_result.evidence_timeline:
            timeline = pipeline_result.evidence_timeline
            if isinstance(timeline, dict) and "timestamps" in timeline:
                for ts_entry in timeline["timestamps"]:
                    if "timestamp" in ts_entry and ts_entry.get("source") == "ocr":
                        try:
                            ts_str = ts_entry["timestamp"]
                            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                            ocr_timestamps.append(ts.replace(tzinfo=None))
                        except Exception as e:
                            print(f"[Weather] Failed to parse OCR timestamp: {e}")
    
    observe_from, observe_to, time_source, confidence = extract_observe_window(
        evidence_list, 
        ocr_timestamps if ocr_timestamps else None
    )
    
    if not observe_from:
        return {
            "status": "unavailable",
            "message": "Weather unavailable - time not reliable",
            "confidence": "LOW",
            "time_source": time_source
        }
    
    if not site.postcode:
        return {
            "status": "unavailable",
            "message": "Weather unavailable - no site location",
            "confidence": "LOW",
            "observe_from": observe_from.isoformat() if observe_from else None,
            "observe_to": observe_to.isoformat() if observe_to else None,
            "time_source": time_source
        }
    
    coords = await geocode_postcode(site.postcode)
    if not coords:
        return {
            "status": "unavailable",
            "message": "Weather unavailable - location not found",
            "confidence": "LOW",
            "observe_from": observe_from.isoformat() if observe_from else None,
            "observe_to": observe_to.isoformat() if observe_to else None,
            "time_source": time_source,
            "site_name": site.site_name
        }
    
    query_time = calculate_query_time(observe_from, observe_to)
    
    weather_data = await fetch_historical_weather(coords[0], coords[1], query_time)
    
    if not weather_data:
        return {
            "status": "unavailable",
            "message": "Weather unavailable - API error",
            "confidence": "LOW",
            "observe_from": observe_from.isoformat() if observe_from else None,
            "observe_to": observe_to.isoformat() if observe_to else None,
            "time_source": time_source,
            "site_name": site.site_name
        }
    
    duration_minutes = None
    if observe_from and observe_to:
        duration_minutes = int((observe_to - observe_from).total_seconds() / 60)
    
    return {
        "status": "available",
        "observe_from": observe_from.isoformat(),
        "observe_to": observe_to.isoformat(),
        "duration_minutes": duration_minutes,
        "time_source": time_source,
        "confidence": confidence,
        "site_name": site.site_name,
        "site_postcode": site.postcode,
        "latitude": coords[0],
        "longitude": coords[1],
        "query_time": query_time.isoformat(),
        "weather": weather_data
    }
