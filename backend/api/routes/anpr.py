"""ANPR folder scanning API routes."""
import os
import glob
import logging
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
import httpx

from backend.db.session import get_db
from backend.db.models import AnprScan, User
from backend.api.dependencies.auth import get_current_user, get_optional_user
from backend.services.ocr_service import OCRService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/anpr", tags=["anpr"])


class FolderScanRequest(BaseModel):
    folder_path: str
    run_dvla: bool = True


class AnprScanResponse(BaseModel):
    id: int
    folder_path: str
    image_filename: str
    vrm: Optional[str]
    vrm_confidence: Optional[float]
    timestamp_extracted: Optional[str]
    dvla_make: Optional[str]
    dvla_model: Optional[str]
    dvla_colour: Optional[str]
    dvla_fuel_type: Optional[str]
    dvla_tax_status: Optional[str]
    dvla_mot_status: Optional[str]
    dvla_year: Optional[int]
    dvla_verified: bool
    dvla_error: Optional[str]
    status: str
    error_message: Optional[str]
    created_at: str


async def lookup_dvla(vrm: str) -> dict:
    """Call DVLA API to get vehicle data."""
    dvla_api_key = os.environ.get("DVLA_API_KEY")
    if not dvla_api_key:
        return {"success": False, "error": "DVLA_API_KEY not configured"}
    
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
                return {"success": True, "data": response.json()}
            elif response.status_code == 404:
                return {"success": False, "error": "Vehicle not found in DVLA database"}
            else:
                return {"success": False, "error": f"DVLA API error: {response.status_code}"}
    except Exception as e:
        logger.error(f"DVLA API exception: {e}")
        return {"success": False, "error": str(e)}


async def process_single_image(image_path: str, folder_path: str, run_dvla: bool, db: Session):
    """Process a single image: extract VRM and optionally call DVLA."""
    filename = os.path.basename(image_path)
    
    existing = db.query(AnprScan).filter(
        AnprScan.image_path == image_path
    ).first()
    
    if existing:
        logger.info(f"Image already processed: {image_path}")
        return existing
    
    scan = AnprScan(
        folder_path=folder_path,
        image_filename=filename,
        image_path=image_path,
        status="processing"
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)
    
    try:
        ocr_service = OCRService()
        result = await ocr_service.extract_timestamp_and_vrm_from_image(image_path)
        
        scan.vrm = result.get("vrm")
        scan.vrm_confidence = result.get("vrm_confidence", 0)
        
        if result.get("timestamp"):
            try:
                from dateutil import parser
                scan.timestamp_extracted = parser.parse(result["timestamp"])
            except:
                pass
        scan.timestamp_confidence = result.get("confidence", 0)
        
        if scan.vrm and run_dvla:
            dvla_result = await lookup_dvla(scan.vrm)
            if dvla_result.get("success"):
                data = dvla_result["data"]
                scan.dvla_make = data.get("make")
                scan.dvla_model = data.get("model")
                scan.dvla_colour = data.get("colour")
                scan.dvla_fuel_type = data.get("fuelType")
                scan.dvla_tax_status = data.get("taxStatus")
                scan.dvla_mot_status = data.get("motStatus")
                scan.dvla_year = data.get("yearOfManufacture")
                scan.dvla_verified = True
                scan.dvla_raw_data = data
            else:
                scan.dvla_error = dvla_result.get("error")
        
        scan.status = "completed"
        scan.processed_at = datetime.utcnow()
        
    except Exception as e:
        logger.error(f"Error processing {image_path}: {e}")
        scan.status = "error"
        scan.error_message = str(e)
    
    db.commit()
    db.refresh(scan)
    return scan


@router.post("/scan")
async def scan_folder(
    request: FolderScanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_optional_user)
):
    """Scan a folder for images and extract VRMs."""
    folder_path = request.folder_path
    
    if not os.path.exists(folder_path):
        raise HTTPException(status_code=400, detail=f"Folder not found: {folder_path}")
    
    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=400, detail=f"Path is not a folder: {folder_path}")
    
    image_extensions = ["*.jpg", "*.jpeg", "*.png", "*.bmp", "*.gif"]
    image_files = []
    for ext in image_extensions:
        image_files.extend(glob.glob(os.path.join(folder_path, ext)))
        image_files.extend(glob.glob(os.path.join(folder_path, ext.upper())))
    
    if not image_files:
        return {
            "success": True,
            "message": "No images found in folder",
            "folder_path": folder_path,
            "images_found": 0,
            "results": []
        }
    
    results = []
    for image_path in image_files[:50]:
        scan = await process_single_image(image_path, folder_path, request.run_dvla, db)
        results.append({
            "id": scan.id,
            "filename": scan.image_filename,
            "vrm": scan.vrm,
            "vrm_confidence": scan.vrm_confidence,
            "dvla_make": scan.dvla_make,
            "dvla_colour": scan.dvla_colour,
            "status": scan.status
        })
    
    return {
        "success": True,
        "message": f"Processed {len(results)} images",
        "folder_path": folder_path,
        "images_found": len(image_files),
        "images_processed": len(results),
        "results": results
    }


@router.get("/scans")
async def get_all_scans(
    db: Session = Depends(get_db),
    limit: int = 100,
    offset: int = 0
):
    """Get all ANPR scan results."""
    scans = db.query(AnprScan).order_by(AnprScan.created_at.desc()).offset(offset).limit(limit).all()
    total = db.query(AnprScan).count()
    
    return {
        "success": True,
        "total": total,
        "limit": limit,
        "offset": offset,
        "scans": [
            {
                "id": s.id,
                "folder_path": s.folder_path,
                "image_filename": s.image_filename,
                "image_path": s.image_path,
                "vrm": s.vrm,
                "vrm_confidence": s.vrm_confidence,
                "timestamp_extracted": s.timestamp_extracted.isoformat() if s.timestamp_extracted else None,
                "dvla_make": s.dvla_make,
                "dvla_model": s.dvla_model,
                "dvla_colour": s.dvla_colour,
                "dvla_fuel_type": s.dvla_fuel_type,
                "dvla_tax_status": s.dvla_tax_status,
                "dvla_mot_status": s.dvla_mot_status,
                "dvla_year": s.dvla_year,
                "dvla_verified": s.dvla_verified,
                "dvla_error": s.dvla_error,
                "status": s.status,
                "error_message": s.error_message,
                "created_at": s.created_at.isoformat() if s.created_at else None
            }
            for s in scans
        ]
    }


@router.get("/scans/{scan_id}")
async def get_scan(scan_id: int, db: Session = Depends(get_db)):
    """Get a single ANPR scan result with full DVLA data."""
    scan = db.query(AnprScan).filter(AnprScan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    return {
        "success": True,
        "scan": {
            "id": scan.id,
            "folder_path": scan.folder_path,
            "image_filename": scan.image_filename,
            "image_path": scan.image_path,
            "vrm": scan.vrm,
            "vrm_confidence": scan.vrm_confidence,
            "timestamp_extracted": scan.timestamp_extracted.isoformat() if scan.timestamp_extracted else None,
            "timestamp_confidence": scan.timestamp_confidence,
            "dvla_make": scan.dvla_make,
            "dvla_model": scan.dvla_model,
            "dvla_colour": scan.dvla_colour,
            "dvla_fuel_type": scan.dvla_fuel_type,
            "dvla_tax_status": scan.dvla_tax_status,
            "dvla_mot_status": scan.dvla_mot_status,
            "dvla_year": scan.dvla_year,
            "dvla_verified": scan.dvla_verified,
            "dvla_error": scan.dvla_error,
            "dvla_raw_data": scan.dvla_raw_data,
            "status": scan.status,
            "error_message": scan.error_message,
            "processed_at": scan.processed_at.isoformat() if scan.processed_at else None,
            "created_at": scan.created_at.isoformat() if scan.created_at else None
        }
    }


@router.delete("/scans")
async def clear_all_scans(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Clear all ANPR scan results (admin only)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    count = db.query(AnprScan).delete()
    db.commit()
    
    return {"success": True, "message": f"Deleted {count} scan records"}


@router.post("/scan-single")
async def scan_single_image(
    image_path: str,
    run_dvla: bool = True,
    db: Session = Depends(get_db)
):
    """Scan a single image file for VRM extraction."""
    if not os.path.exists(image_path):
        raise HTTPException(status_code=400, detail=f"Image not found: {image_path}")
    
    folder_path = os.path.dirname(image_path)
    scan = await process_single_image(image_path, folder_path, run_dvla, db)
    
    return {
        "success": True,
        "scan": {
            "id": scan.id,
            "image_filename": scan.image_filename,
            "vrm": scan.vrm,
            "vrm_confidence": scan.vrm_confidence,
            "dvla_make": scan.dvla_make,
            "dvla_model": scan.dvla_model,
            "dvla_colour": scan.dvla_colour,
            "dvla_verified": scan.dvla_verified,
            "status": scan.status
        }
    }
