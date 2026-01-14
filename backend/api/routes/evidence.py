from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import os
import hashlib
import uuid
import httpx

from backend.db import get_db
from backend.db.models import (
    User, Evidence, EvidenceBundle, CaseEvidence, EnforcementCase,
    CasePipelineResults, AuditLog, ParkingSite, CaseAnalysis, CaseVehicle
)
import logging

logger = logging.getLogger(__name__)
from backend.api.dependencies import get_current_user
from backend.config import settings

router = APIRouter(prefix="/api/evidence", tags=["evidence"])

def calculate_file_hash(file_path: str) -> str:
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def evidence_to_dict(e: Evidence):
    return {
        "id": e.id,
        "type": e.type,
        "bundleId": e.bundle_id,
        "siteId": e.site_id,
        "cameraId": e.camera_id,
        "bayId": e.bay_id,
        "uploadedBy": e.uploaded_by,
        "imagePath": e.image_path,
        "videoPath": e.video_path,
        "thumbnailPath": e.thumbnail_path,
        "timestamp": e.timestamp.isoformat() if e.timestamp else None,
        "sha256Hash": e.sha256_hash,
        "metadata": e.file_metadata,
        "notes": e.notes,
        "status": e.status,
        "reviewedBy": e.reviewed_by,
        "reviewedAt": e.reviewed_at.isoformat() if e.reviewed_at else None,
        "analysisStartedAt": e.analysis_started_at.isoformat() if e.analysis_started_at else None,
        "analysisCompletedAt": e.analysis_completed_at.isoformat() if e.analysis_completed_at else None,
        "aiResult": e.ai_result,
        "confidenceScore": e.confidence_score,
        "analysisError": e.analysis_error,
        "createdAt": e.created_at.isoformat() if e.created_at else None
    }

def bundle_to_dict(b: EvidenceBundle, pipeline_results=None):
    time_range = None
    if pipeline_results and pipeline_results.evidence_timeline:
        timeline = pipeline_results.evidence_timeline
        if isinstance(timeline, dict) and "timeRange" in timeline:
            tr = timeline["timeRange"]
            time_range = {
                "first": tr.get("first"),
                "last": tr.get("last"),
                "durationMinutes": tr.get("durationMinutes")
            }
    
    return {
        "id": b.id,
        "caseId": b.case_id,
        "name": b.name,
        "status": b.status,
        "fileCount": b.file_count,
        "aiResult": b.ai_result,
        "analysisStartedAt": b.analysis_started_at.isoformat() if b.analysis_started_at else None,
        "analysisCompletedAt": b.analysis_completed_at.isoformat() if b.analysis_completed_at else None,
        "analysisError": b.analysis_error,
        "createdBy": b.created_by,
        "createdAt": b.created_at.isoformat() if b.created_at else None,
        "timeRange": time_range
    }

@router.get("")
async def get_evidence(
    type: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Evidence)
    if type:
        query = query.filter(Evidence.type == type)
    if status:
        query = query.filter(Evidence.status == status)
    
    evidence_list = query.order_by(Evidence.created_at.desc()).all()
    return [evidence_to_dict(e) for e in evidence_list]

@router.get("/bundles")
async def get_evidence_bundles(
    caseId: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(EvidenceBundle)
    if caseId:
        query = query.filter(EvidenceBundle.case_id == caseId)
    
    bundles = query.order_by(EvidenceBundle.created_at.desc()).all()
    
    result = []
    for b in bundles:
        case = db.query(EnforcementCase).filter(EnforcementCase.id == b.case_id).first()
        evidence_items = db.query(Evidence).filter(Evidence.bundle_id == b.id).all()
        case_analysis = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == b.case_id).first()
        
        site_name = "Unknown Site"
        site_id = None
        if case and case.site_id:
            site = db.query(ParkingSite).filter(ParkingSite.id == case.site_id).first()
            if site:
                site_name = site.site_name
                site_id = site.id
        
        has_camera = any(e.camera_id for e in evidence_items)
        
        time_window = None
        if evidence_items:
            timestamps = [e.timestamp for e in evidence_items if e.timestamp]
            if timestamps:
                time_window = {
                    "start": min(timestamps).isoformat(),
                    "end": max(timestamps).isoformat()
                }
        
        result.append({
            "id": str(b.id),
            "caseReference": b.case_id or f"CASE-{b.id}",
            "siteName": site_name,
            "siteId": site_id,
            "bayType": case.bay_type if case else None,
            "uploadSource": "camera" if has_camera else "manual",
            "evidenceCount": len(evidence_items),
            "status": b.status or "pending",
            "timeWindow": time_window,
            "createdAt": b.created_at.isoformat() if b.created_at else None,
            "vrm": case.vrm if case else None,
            "evidenceFiles": [evidence_to_dict(e) for e in evidence_items],
            "analysis": {
                "id": case_analysis.id,
                "caseId": case_analysis.case_id,
                "summary": case_analysis.summary,
                "recommendation": case_analysis.recommendation,
                "confidenceScore": case_analysis.confidence_score,
                "generatedAt": case_analysis.generated_at.isoformat() if case_analysis.generated_at else None
            } if case_analysis else None,
            "vehicles": []
        })
    
    return result

@router.get("/{evidence_id}")
async def get_single_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    if not evidence:
        raise HTTPException(status_code=404, detail={"error": "Evidence not found"})
    return evidence_to_dict(evidence)

@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_evidence(
    file: UploadFile = File(...),
    type: str = Form(default="manual"),
    siteId: Optional[int] = Form(default=None),
    cameraId: Optional[int] = Form(default=None),
    bayId: Optional[int] = Form(default=None),
    notes: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    unique_suffix = f"{int(datetime.utcnow().timestamp())}-{uuid.uuid4().hex[:12]}"
    ext = os.path.splitext(file.filename)[1] if file.filename else ".jpg"
    filename = f"{unique_suffix}{ext}"
    file_path = os.path.join(settings.UPLOAD_DIR, filename)
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    file_hash = calculate_file_hash(file_path)
    
    is_video = ext.lower() in [".mp4", ".avi", ".mov"]
    
    evidence = Evidence(
        type=type,
        site_id=siteId,
        camera_id=cameraId,
        bay_id=bayId,
        uploaded_by=current_user.id,
        image_path=None if is_video else f"/uploads/{filename}",
        video_path=f"/uploads/{filename}" if is_video else None,
        timestamp=datetime.utcnow(),
        sha256_hash=file_hash,
        file_metadata={"fileSize": len(content), "originalFilename": file.filename},
        notes=notes,
        status="pending"
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="create",
        entity_type="evidence",
        entity_id=str(evidence.id),
        details={"type": type, "filename": filename}
    )
    db.add(audit_log)
    db.commit()
    
    return evidence_to_dict(evidence)

@router.post("/bundles/upload", status_code=status.HTTP_201_CREATED)
async def upload_evidence_bundle(
    files: List[UploadFile] = File(...),
    siteId: Optional[str] = Form(default=None),
    cameraId: Optional[str] = Form(default=None),
    bayType: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    site_id_int = int(siteId) if siteId and siteId != "none" else None
    camera_id_int = int(cameraId) if cameraId and cameraId != "none" else None
    
    site_name = "Unknown Site"
    if site_id_int:
        site = db.query(ParkingSite).filter(ParkingSite.id == site_id_int).first()
        if site:
            site_name = site.site_name
    
    case_id = f"CASE-{uuid.uuid4().hex[:8].upper()}"
    case = EnforcementCase(
        id=case_id,
        site_id=site_id_int,
        bay_type=bayType,
        status="NEW",
        evidence_count=len(files),
        created_by=current_user.id
    )
    db.add(case)
    db.commit()
    
    bundle = EvidenceBundle(
        case_id=case_id,
        name=f"Bundle uploaded {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
        status="pending",
        file_count=len(files),
        created_by=current_user.id
    )
    db.add(bundle)
    db.commit()
    db.refresh(bundle)
    
    evidence_ids = []
    for file in files:
        unique_suffix = f"{int(datetime.utcnow().timestamp())}-{uuid.uuid4().hex[:12]}"
        ext = os.path.splitext(file.filename)[1] if file.filename else ".jpg"
        filename = f"{unique_suffix}{ext}"
        file_path = os.path.join(settings.UPLOAD_DIR, filename)
        
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        
        file_hash = calculate_file_hash(file_path)
        is_video = ext.lower() in [".mp4", ".avi", ".mov"]
        
        evidence = Evidence(
            type="manual",
            bundle_id=bundle.id,
            site_id=site_id_int,
            camera_id=camera_id_int,
            bay_id=None,
            uploaded_by=current_user.id,
            image_path=None if is_video else f"/uploads/{filename}",
            video_path=f"/uploads/{filename}" if is_video else None,
            timestamp=datetime.utcnow(),
            sha256_hash=file_hash,
            file_metadata={"fileSize": len(content), "originalFilename": file.filename, "bayType": bayType},
            status="pending"
        )
        db.add(evidence)
        db.commit()
        db.refresh(evidence)
        
        case_evidence = CaseEvidence(
            case_id=case_id,
            evidence_id=evidence.id,
            source="manual"
        )
        db.add(case_evidence)
        
        evidence_ids.append(evidence.id)
    
    db.commit()
    
    return {
        "bundleId": bundle.id,
        "caseId": case_id,
        "evidenceIds": evidence_ids,
        "siteName": site_name,
        "siteId": site_id_int,
        "bayType": bayType,
        "uploadSource": "camera" if camera_id_int else "manual",
        "evidenceCount": len(files),
        "status": "pending"
    }

@router.get("/bundles/{bundle_id}")
async def get_bundle(
    bundle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    bundle = db.query(EvidenceBundle).filter(EvidenceBundle.id == bundle_id).first()
    if not bundle:
        raise HTTPException(status_code=404, detail={"error": "Bundle not found"})
    
    evidence_items = db.query(Evidence).filter(Evidence.bundle_id == bundle_id).all()
    
    pipeline_results = db.query(CasePipelineResults).filter(
        CasePipelineResults.case_id == bundle.case_id
    ).first()
    
    result = bundle_to_dict(bundle, pipeline_results)
    result["evidence"] = [evidence_to_dict(e) for e in evidence_items]
    result["pipelineResults"] = {
        "evidenceTimeline": pipeline_results.evidence_timeline if pipeline_results else None,
        "visionResults": pipeline_results.vision_results if pipeline_results else None
    } if pipeline_results else None
    
    return result

@router.post("/{evidence_id}/analyze")
async def analyze_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    if not evidence:
        raise HTTPException(status_code=404, detail={"error": "Evidence not found"})
    
    evidence.status = "analyzing"
    evidence.analysis_started_at = datetime.utcnow()
    db.commit()
    
    return {"message": "Analysis started", "evidenceId": evidence_id}

@router.post("/bundles/{bundle_id}/analyze")
async def analyze_bundle(
    bundle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    bundle = db.query(EvidenceBundle).filter(EvidenceBundle.id == bundle_id).first()
    if not bundle:
        raise HTTPException(status_code=404, detail={"error": "Bundle not found"})
    
    bundle.status = "analyzing"
    bundle.analysis_started_at = datetime.utcnow()
    db.commit()
    
    # Import here to avoid circular imports
    from backend.api.routes.cases import run_case_pipeline_internal
    
    # Run the full pipeline for the associated case
    if bundle.case_id:
        try:
            result = await run_case_pipeline_internal(bundle.case_id, db, current_user)
            bundle.status = "analyzed"
            db.commit()
            return {"message": "Bundle analysis complete", "bundleId": bundle_id, "pipelineResult": result}
        except Exception as e:
            bundle.status = "error"
            db.commit()
            logger.error(f"Bundle analysis failed: {str(e)}")
            raise HTTPException(status_code=500, detail={"error": f"Analysis failed: {str(e)}"})
    
    return {"message": "Bundle analysis started", "bundleId": bundle_id}

from pydantic import BaseModel

class VehicleLookupRequest(BaseModel):
    registrationNumber: str

@router.post("/bundles/{bundle_id}/vehicles/lookup")
async def lookup_vehicle_for_bundle(
    bundle_id: int,
    request: VehicleLookupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    bundle = db.query(EvidenceBundle).filter(EvidenceBundle.id == bundle_id).first()
    if not bundle:
        raise HTTPException(status_code=404, detail={"error": "Bundle not found"})
    
    vrm = request.registrationNumber.upper().replace(" ", "")
    logger.info(f"DVLA lookup for VRM: '{vrm}' on bundle {bundle_id}, case_id: {bundle.case_id}")
    
    existing_vehicle = db.query(CaseVehicle).filter(
        CaseVehicle.registration_number == vrm,
        CaseVehicle.case_id == bundle.case_id
    ).first() if bundle.case_id else None
    
    if existing_vehicle and existing_vehicle.make and existing_vehicle.dvla_verified:
        print(f"[DVLA API] Returning cached data for {vrm}")
        print(f"[DVLA API] Make: {existing_vehicle.make}, Colour: {existing_vehicle.colour}, Fuel: {existing_vehicle.fuel_type}")
        return {
            "success": True,
            "vehicle": {
                "vrm": vrm,
                "make": existing_vehicle.make,
                "model": existing_vehicle.model,
                "colour": existing_vehicle.colour,
                "yearOfManufacture": existing_vehicle.year_of_manufacture,
                "taxStatus": existing_vehicle.tax_status,
                "motStatus": existing_vehicle.mot_status,
                "fuelType": existing_vehicle.fuel_type,
                "co2Emissions": existing_vehicle.co2_emissions
            },
            "cached": True
        }
    
    dvla_api_key = os.environ.get("DVLA_API_KEY")
    if not dvla_api_key:
        logger.error("DVLA_API_KEY not configured")
        return {"success": False, "error": "DVLA API key not configured"}
    
    dvla_url = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles"
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                dvla_url,
                json={"registrationNumber": vrm},
                headers={
                    "x-api-key": dvla_api_key,
                    "Content-Type": "application/json"
                },
                timeout=30.0
            )
            
            if response.status_code == 200:
                dvla_data = response.json()
                print(f"[DVLA API] Success for {vrm}")
                print(f"[DVLA API] Make: {dvla_data.get('make')}, Colour: {dvla_data.get('colour')}, Fuel: {dvla_data.get('fuelType')}")
                logger.info(f"DVLA API success for {vrm}: {dvla_data}")
            elif response.status_code == 404:
                logger.warning(f"Vehicle not found in DVLA: {vrm}")
                return {"success": False, "error": "Vehicle not found in DVLA database"}
            else:
                logger.error(f"DVLA API error {response.status_code}: {response.text}")
                return {"success": False, "error": f"DVLA API error: {response.status_code}"}
    except Exception as e:
        logger.error(f"DVLA API request failed: {str(e)}")
        return {"success": False, "error": f"DVLA API request failed: {str(e)}"}
    
    if existing_vehicle:
        existing_vehicle.make = dvla_data.get("make")
        existing_vehicle.model = dvla_data.get("model") 
        existing_vehicle.colour = dvla_data.get("colour")
        existing_vehicle.year_of_manufacture = dvla_data.get("yearOfManufacture")
        existing_vehicle.tax_status = dvla_data.get("taxStatus")
        existing_vehicle.mot_status = dvla_data.get("motStatus")
        existing_vehicle.fuel_type = dvla_data.get("fuelType")
        existing_vehicle.co2_emissions = dvla_data.get("co2Emissions")
        existing_vehicle.engine_capacity = dvla_data.get("engineCapacity")
        existing_vehicle.dvla_verified = True
        existing_vehicle.confidence_score = 100
    elif bundle.case_id:
        new_vehicle = CaseVehicle(
            case_id=bundle.case_id,
            registration_number=vrm,
            make=dvla_data.get("make"),
            model=dvla_data.get("model"),
            colour=dvla_data.get("colour"),
            year_of_manufacture=dvla_data.get("yearOfManufacture"),
            tax_status=dvla_data.get("taxStatus"),
            mot_status=dvla_data.get("motStatus"),
            fuel_type=dvla_data.get("fuelType"),
            co2_emissions=dvla_data.get("co2Emissions"),
            engine_capacity=dvla_data.get("engineCapacity"),
            confidence_score=100,
            detection_method="dvla_lookup",
            dvla_verified=True
        )
        db.add(new_vehicle)
    
    db.commit()
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="dvla_lookup",
        entity_type="vehicle",
        entity_id=vrm,
        details={"bundle_id": bundle_id, "result": "success", "dvla_response": dvla_data}
    )
    db.add(audit_log)
    db.commit()
    
    return {
        "success": True,
        "vehicle": {
            "vrm": vrm,
            "make": dvla_data.get("make"),
            "model": dvla_data.get("model"),
            "colour": dvla_data.get("colour"),
            "yearOfManufacture": dvla_data.get("yearOfManufacture"),
            "taxStatus": dvla_data.get("taxStatus"),
            "motStatus": dvla_data.get("motStatus"),
            "fuelType": dvla_data.get("fuelType"),
            "co2Emissions": dvla_data.get("co2Emissions"),
            "engineCapacity": dvla_data.get("engineCapacity")
        },
        "cached": False
    }


@router.get("/bundles/{bundle_id}/weather")
async def get_bundle_weather(
    bundle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get weather data for an evidence bundle based on evidence timestamps.
    Uses the site's postcode to geocode location, then fetches historical weather.
    """
    bundle = db.query(EvidenceBundle).filter(EvidenceBundle.id == bundle_id).first()
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    
    case = db.query(EnforcementCase).filter(EnforcementCase.id == bundle.case_id).first()
    if not case or not case.site_id:
        return {"weather": None, "message": "No site associated with case"}
    
    evidence_list = db.query(Evidence).filter(
        Evidence.bundle_id == bundle_id
    ).order_by(Evidence.timestamp.asc()).all()
    
    if not evidence_list:
        return {"weather": None, "message": "No evidence in bundle"}
    
    timestamps = [e.timestamp for e in evidence_list if e.timestamp]
    if not timestamps:
        return {"weather": None, "message": "No timestamps on evidence"}
    
    earliest_ts = min(timestamps)
    latest_ts = max(timestamps)
    
    earliest_weather = await get_weather_for_evidence(db, case.site_id, earliest_ts)
    
    latest_weather = None
    if latest_ts != earliest_ts:
        latest_weather = await get_weather_for_evidence(db, case.site_id, latest_ts)
    
    return {
        "weather": {
            "earliest": earliest_weather,
            "latest": latest_weather,
            "observation_period": {
                "start": earliest_ts.isoformat(),
                "end": latest_ts.isoformat()
            }
        },
        "site_id": case.site_id
    }


@router.get("/weather/{site_id}")
async def get_site_weather_at_time(
    site_id: int,
    timestamp: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get weather data for a specific site and timestamp.
    Timestamp should be in ISO format (e.g., 2024-01-15T14:30:00).
    """
    try:
        ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid timestamp format. Use ISO format.")
    
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    weather = await get_weather_for_evidence(db, site_id, ts)
    
    if not weather:
        return {
            "weather": None,
            "message": "Could not retrieve weather data. Site may not have a valid UK postcode."
        }
    
    return {
        "weather": weather,
        "site_id": site_id,
        "site_name": site.site_name
    }


@router.get("/weather/{site_id}/hourly")
async def get_site_hourly_weather(
    site_id: int,
    date: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get 24-hour weather data for a specific site and date.
    Returns all hourly weather data so user can pick a specific hour.
    
    Date format: YYYY-MM-DD (e.g., 2025-01-10)
    """
    try:
        query_date = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    if not site.postcode:
        return {
            "hourly": None,
            "message": "Site has no postcode configured for weather lookup"
        }
    
    from backend.services.weather_service import geocode_postcode, WMO_WEATHER_CODES, WeatherCondition, classify_severity
    
    coords = await geocode_postcode(site.postcode)
    if not coords:
        return {
            "hourly": None,
            "message": f"Could not geocode postcode: {site.postcode}"
        }
    
    date_str = query_date.strftime("%Y-%m-%d")
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params={
                    "latitude": coords[0],
                    "longitude": coords[1],
                    "start_date": date_str,
                    "end_date": date_str,
                    "hourly": "temperature_2m,relative_humidity_2m,precipitation,rain,snowfall,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,is_day",
                    "timezone": "Europe/London"
                }
            )
            
            if response.status_code != 200:
                return {
                    "hourly": None,
                    "message": f"Weather API error: {response.status_code}"
                }
            
            data = response.json()
            hourly = data.get("hourly", {})
            times = hourly.get("time", [])
            
            if not times:
                return {
                    "hourly": None,
                    "message": "No hourly data available for this date"
                }
            
            hourly_data = []
            for i, time_str in enumerate(times):
                weather_code = hourly.get("weather_code", [None])[i]
                wind_speed_kmh = hourly.get("wind_speed_10m", [None])[i]
                wind_speed_mph = wind_speed_kmh * 0.621371 if wind_speed_kmh else None
                visibility_m = hourly.get("visibility", [None])[i]
                precipitation_mm = hourly.get("precipitation", [None])[i]
                
                code_info = WMO_WEATHER_CODES.get(weather_code, ("Unknown", WeatherCondition.CLOUDY))
                
                hourly_data.append({
                    "hour": i,
                    "time": time_str,
                    "temperature_c": hourly.get("temperature_2m", [None])[i],
                    "humidity_percent": hourly.get("relative_humidity_2m", [None])[i],
                    "precipitation_mm": precipitation_mm,
                    "rain_mm": hourly.get("rain", [None])[i],
                    "snowfall_mm": hourly.get("snowfall", [None])[i],
                    "visibility_m": visibility_m,
                    "wind_speed_mph": round(wind_speed_mph, 1) if wind_speed_mph else None,
                    "wind_direction_deg": hourly.get("wind_direction_10m", [None])[i],
                    "weather_code": weather_code,
                    "weather_description": code_info[0],
                    "condition": code_info[1].value,
                    "is_day": hourly.get("is_day", [None])[i] == 1,
                    "severity": classify_severity(weather_code, visibility_m, precipitation_mm, wind_speed_mph).value
                })
            
            return {
                "hourly": hourly_data,
                "date": date_str,
                "site_id": site_id,
                "site_name": site.site_name,
                "site_postcode": site.postcode,
                "latitude": coords[0],
                "longitude": coords[1],
                "api_source": "open_meteo_archive"
            }
            
    except Exception as e:
        logger.error(f"Weather API error: {e}")
        return {
            "hourly": None,
            "message": f"Failed to fetch weather: {str(e)}"
        }


@router.post("/weather/{site_id}/select-hour")
async def select_weather_hour(
    site_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Select a specific hour's weather and optionally update a case/bundle with it.
    
    Body:
    {
        "date": "2025-01-10",
        "hour": 14,
        "case_identifier": "123" or "CASE-123"  # Optional - resolves to case/bundle
    }
    """
    date_str = body.get("date")
    hour = body.get("hour")
    case_identifier = body.get("case_identifier")
    
    if not date_str or hour is None:
        raise HTTPException(status_code=400, detail="date and hour are required")
    
    if not isinstance(hour, int) or hour < 0 or hour > 23:
        raise HTTPException(status_code=400, detail="hour must be an integer 0-23")
    
    try:
        query_date = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    if not site.postcode:
        raise HTTPException(status_code=400, detail="Site has no postcode")
    
    from backend.services.weather_service import geocode_postcode, WMO_WEATHER_CODES, WeatherCondition, classify_severity
    
    coords = await geocode_postcode(site.postcode)
    if not coords:
        raise HTTPException(status_code=400, detail=f"Could not geocode postcode: {site.postcode}")
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params={
                    "latitude": coords[0],
                    "longitude": coords[1],
                    "start_date": date_str,
                    "end_date": date_str,
                    "hourly": "temperature_2m,relative_humidity_2m,precipitation,rain,snowfall,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,is_day",
                    "timezone": "Europe/London"
                }
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=500, detail=f"Weather API error: {response.status_code}")
            
            data = response.json()
            hourly = data.get("hourly", {})
            times = hourly.get("time", [])
            
            if hour >= len(times):
                raise HTTPException(status_code=400, detail=f"Hour {hour} not available in data")
            
            weather_code = hourly.get("weather_code", [None])[hour]
            wind_speed_kmh = hourly.get("wind_speed_10m", [None])[hour]
            wind_speed_mph = wind_speed_kmh * 0.621371 if wind_speed_kmh else None
            visibility_m = hourly.get("visibility", [None])[hour]
            precipitation_mm = hourly.get("precipitation", [None])[hour]
            
            code_info = WMO_WEATHER_CODES.get(weather_code, ("Unknown", WeatherCondition.CLOUDY))
            
            selected_weather = {
                "observation_time": times[hour],
                "hour": hour,
                "temperature_c": hourly.get("temperature_2m", [None])[hour],
                "humidity_percent": hourly.get("relative_humidity_2m", [None])[hour],
                "precipitation_mm": precipitation_mm,
                "rain_mm": hourly.get("rain", [None])[hour],
                "snowfall_mm": hourly.get("snowfall", [None])[hour],
                "visibility_m": visibility_m,
                "wind_speed_mph": round(wind_speed_mph, 1) if wind_speed_mph else None,
                "wind_direction_deg": hourly.get("wind_direction_10m", [None])[hour],
                "weather_code": weather_code,
                "weather_description": code_info[0],
                "condition": code_info[1].value,
                "is_day": hourly.get("is_day", [None])[hour] == 1,
                "severity": classify_severity(weather_code, visibility_m, precipitation_mm, wind_speed_mph).value,
                "selected_by": current_user.username,
                "selected_at": datetime.utcnow().isoformat(),
                "api_source": "open_meteo_archive"
            }
            
            updated_case = None
            updated_bundle = None
            
            if case_identifier:
                case = None
                bundle = None
                
                case = db.query(EnforcementCase).filter(EnforcementCase.id == str(case_identifier)).first()
                
                if not case:
                    try:
                        bundle_id_int = int(case_identifier)
                        bundle = db.query(EvidenceBundle).filter(EvidenceBundle.id == bundle_id_int).first()
                        if bundle and bundle.case_id:
                            case = db.query(EnforcementCase).filter(EnforcementCase.id == bundle.case_id).first()
                    except (ValueError, TypeError):
                        pass
                
                if case:
                    updated_case = case.id
                    
                    audit_log = AuditLog(
                        user_id=current_user.id,
                        action="update_weather",
                        entity_type="case",
                        entity_id=str(case.id),
                        details={
                            "hour_selected": hour,
                            "date": date_str,
                            "weather": selected_weather
                        }
                    )
                    db.add(audit_log)
                    db.commit()
                
                if bundle:
                    pipeline = db.query(CasePipelineResults).filter(
                        CasePipelineResults.bundle_id == bundle.id
                    ).order_by(CasePipelineResults.created_at.desc()).first()
                    
                    if pipeline:
                        enrichment = pipeline.enrichment_data or {}
                        enrichment["weather"] = selected_weather
                        enrichment["weather_manually_selected"] = True
                        pipeline.enrichment_data = enrichment
                        db.commit()
                        updated_bundle = bundle.id
            
            return {
                "success": True,
                "weather": selected_weather,
                "site_id": site_id,
                "site_name": site.site_name,
                "updated_case": updated_case,
                "updated_bundle": updated_bundle
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Weather selection error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to select weather: {str(e)}")
