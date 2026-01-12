"""
Weather Service - Fetches and caches historical weather data for evidence timestamps.

Uses Open-Meteo Archive API (free, no key required) for historical weather data.
Uses postcodes.io (free) for UK postcode geocoding.
"""

import httpx
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session

from backend.db.models import WeatherObservation, SiteGeolocation, ParkingSite


# WMO Weather Codes to human-readable descriptions
WMO_WEATHER_CODES = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


async def geocode_postcode(postcode: str) -> Optional[Tuple[float, float]]:
    """
    Convert a UK postcode to latitude/longitude using postcodes.io (free API).
    Returns (latitude, longitude) or None if not found.
    """
    if not postcode:
        return None
    
    # Clean and format postcode
    clean_postcode = postcode.strip().upper().replace(" ", "")
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"https://api.postcodes.io/postcodes/{clean_postcode}"
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == 200 and data.get("result"):
                    result = data["result"]
                    return (result["latitude"], result["longitude"])
            
            return None
    except Exception as e:
        print(f"[Weather] Geocoding error for {postcode}: {e}")
        return None


async def get_site_coordinates(db: Session, site_id: int) -> Optional[Tuple[float, float]]:
    """
    Get cached coordinates for a site, or geocode and cache if not available.
    """
    # Check cache first
    cached = db.query(SiteGeolocation).filter(SiteGeolocation.site_id == site_id).first()
    if cached:
        return (cached.latitude, cached.longitude)
    
    # Get site postcode
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site or not site.postcode:
        return None
    
    # Geocode the postcode
    coords = await geocode_postcode(site.postcode)
    if not coords:
        return None
    
    # Cache the result
    geo = SiteGeolocation(
        site_id=site_id,
        postcode=site.postcode,
        latitude=coords[0],
        longitude=coords[1],
        source="postcodes_io",
        raw_data={"postcode": site.postcode}
    )
    db.add(geo)
    db.commit()
    
    return coords


async def fetch_weather_from_api(
    latitude: float, 
    longitude: float, 
    timestamp: datetime
) -> Optional[Dict[str, Any]]:
    """
    Fetch historical weather data from Open-Meteo Archive API.
    Returns weather data for the closest hour to the timestamp.
    """
    # Round to nearest hour
    hour_timestamp = timestamp.replace(minute=0, second=0, microsecond=0)
    
    # Format date for API
    date_str = hour_timestamp.strftime("%Y-%m-%d")
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "start_date": date_str,
                    "end_date": date_str,
                    "hourly": "temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,apparent_temperature,is_day",
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
            
            # Find the index for the target hour
            target_hour = hour_timestamp.hour
            if target_hour >= len(times):
                target_hour = len(times) - 1
            
            # Extract weather data for that hour
            weather_code = hourly.get("weather_code", [None])[target_hour]
            
            return {
                "observation_time": hour_timestamp,
                "temperature_c": hourly.get("temperature_2m", [None])[target_hour],
                "feels_like_c": hourly.get("apparent_temperature", [None])[target_hour],
                "humidity_percent": hourly.get("relative_humidity_2m", [None])[target_hour],
                "precipitation_mm": hourly.get("precipitation", [None])[target_hour],
                "rain_mm": hourly.get("rain", [None])[target_hour],
                "cloud_cover_percent": hourly.get("cloud_cover", [None])[target_hour],
                "visibility_m": hourly.get("visibility", [None])[target_hour],
                "wind_speed_kmh": hourly.get("wind_speed_10m", [None])[target_hour],
                "wind_direction_deg": hourly.get("wind_direction_10m", [None])[target_hour],
                "weather_code": weather_code,
                "weather_description": WMO_WEATHER_CODES.get(weather_code, "Unknown"),
                "is_day": hourly.get("is_day", [None])[target_hour] == 1,
                "raw_data": data
            }
            
    except Exception as e:
        print(f"[Weather] API fetch error: {e}")
        return None


async def get_weather_for_evidence(
    db: Session,
    site_id: int,
    timestamp: datetime
) -> Optional[Dict[str, Any]]:
    """
    Get weather data for a specific site and timestamp.
    Uses cached data if available, otherwise fetches from API.
    
    Returns a dictionary with weather information or None if unavailable.
    """
    # Round to hour for caching
    hour_timestamp = timestamp.replace(minute=0, second=0, microsecond=0)
    
    # Check cache first
    cached = db.query(WeatherObservation).filter(
        WeatherObservation.site_id == site_id,
        WeatherObservation.observation_time == hour_timestamp,
        WeatherObservation.source == "open_meteo"
    ).first()
    
    if cached:
        return format_weather_response(cached)
    
    # Get site coordinates
    coords = await get_site_coordinates(db, site_id)
    if not coords:
        print(f"[Weather] Could not get coordinates for site {site_id}")
        return None
    
    # Fetch from API
    weather_data = await fetch_weather_from_api(coords[0], coords[1], timestamp)
    if not weather_data:
        return None
    
    # Cache the result
    observation = WeatherObservation(
        site_id=site_id,
        observation_time=hour_timestamp,
        latitude=coords[0],
        longitude=coords[1],
        source="open_meteo",
        temperature_c=weather_data.get("temperature_c"),
        feels_like_c=weather_data.get("feels_like_c"),
        humidity_percent=weather_data.get("humidity_percent"),
        precipitation_mm=weather_data.get("precipitation_mm"),
        rain_mm=weather_data.get("rain_mm"),
        cloud_cover_percent=weather_data.get("cloud_cover_percent"),
        visibility_m=weather_data.get("visibility_m"),
        wind_speed_kmh=weather_data.get("wind_speed_kmh"),
        wind_direction_deg=weather_data.get("wind_direction_deg"),
        weather_code=weather_data.get("weather_code"),
        weather_description=weather_data.get("weather_description"),
        is_day=weather_data.get("is_day"),
        raw_data=weather_data.get("raw_data")
    )
    
    try:
        db.add(observation)
        db.commit()
        db.refresh(observation)
    except Exception as e:
        db.rollback()
        print(f"[Weather] Cache save error: {e}")
    
    return format_weather_response(observation)


def format_weather_response(obs: WeatherObservation) -> Dict[str, Any]:
    """Format a weather observation for API response."""
    return {
        "observation_time": obs.observation_time.isoformat() if obs.observation_time else None,
        "temperature_c": obs.temperature_c,
        "feels_like_c": obs.feels_like_c,
        "humidity_percent": obs.humidity_percent,
        "precipitation_mm": obs.precipitation_mm,
        "rain_mm": obs.rain_mm,
        "cloud_cover_percent": obs.cloud_cover_percent,
        "visibility_m": obs.visibility_m,
        "wind_speed_kmh": obs.wind_speed_kmh,
        "wind_direction_deg": obs.wind_direction_deg,
        "weather_code": obs.weather_code,
        "weather_description": obs.weather_description,
        "is_day": obs.is_day,
        "conditions_summary": get_conditions_summary(obs),
        "enforcement_notes": get_enforcement_notes(obs)
    }


def get_conditions_summary(obs: WeatherObservation) -> str:
    """Generate a human-readable weather summary."""
    parts = []
    
    if obs.weather_description:
        parts.append(obs.weather_description)
    
    if obs.temperature_c is not None:
        parts.append(f"{obs.temperature_c:.1f}°C")
    
    if obs.wind_speed_kmh is not None and obs.wind_speed_kmh > 20:
        parts.append(f"Wind: {obs.wind_speed_kmh:.0f} km/h")
    
    if obs.visibility_m is not None and obs.visibility_m < 5000:
        parts.append(f"Visibility: {obs.visibility_m}m")
    
    return ", ".join(parts) if parts else "Unknown conditions"


def get_enforcement_notes(obs: WeatherObservation) -> Optional[str]:
    """
    Generate enforcement-relevant notes based on weather conditions.
    These can be used by AI analysis to adjust confidence or flag issues.
    """
    notes = []
    
    # Visibility concerns
    if obs.visibility_m is not None:
        if obs.visibility_m < 1000:
            notes.append("Very poor visibility (<1km) - signage may not be clearly visible")
        elif obs.visibility_m < 3000:
            notes.append("Reduced visibility (<3km) - potential signage visibility issues")
    
    # Rain/precipitation
    if obs.rain_mm is not None and obs.rain_mm > 0:
        if obs.rain_mm > 5:
            notes.append("Heavy rain - bay markings may be obscured")
        elif obs.rain_mm > 1:
            notes.append("Moderate rain - potential visibility of markings affected")
    
    # Fog
    if obs.weather_code in [45, 48]:
        notes.append("Foggy conditions - visibility significantly reduced")
    
    # Snow/ice
    if obs.weather_code in [71, 73, 75, 77, 85, 86]:
        notes.append("Snowy conditions - bay markings likely obscured")
    
    # Freezing conditions
    if obs.weather_code in [56, 57, 66, 67]:
        notes.append("Freezing precipitation - hazardous conditions")
    
    # Dark conditions
    if obs.is_day is False:
        notes.append("Night-time observation - reduced visibility of signage/markings")
    
    return "; ".join(notes) if notes else None
