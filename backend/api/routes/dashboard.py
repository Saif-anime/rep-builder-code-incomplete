from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
import os

from backend.db import get_db
from backend.db.models import (
    User, Evidence, ParkingEvent, Camera, ParkingSite, ParkingSession
)
from backend.api.dependencies import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("/stats")
async def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    pending_count = db.query(Evidence).filter(Evidence.status == "pending").count()
    
    violations_count = db.query(ParkingEvent).filter(ParkingEvent.is_violation == True).count()
    
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    processed_today = db.query(Evidence).filter(
        Evidence.status.in_(["completed", "approved"]),
        Evidence.analysis_completed_at >= today_start
    ).count()
    
    active_cameras = db.query(Camera).filter(Camera.status == "online").count()
    
    total_sites = db.query(ParkingSite).filter(ParkingSite.is_active == True).count()
    
    uploads_dir = os.path.join(os.getcwd(), "uploads")
    storage_bytes = 0
    if os.path.exists(uploads_dir):
        for root, dirs, files in os.walk(uploads_dir):
            for f in files:
                storage_bytes += os.path.getsize(os.path.join(root, f))
    
    if storage_bytes >= 1024 * 1024 * 1024:
        storage_used = f"{storage_bytes / (1024 * 1024 * 1024):.1f} GB"
    elif storage_bytes >= 1024 * 1024:
        storage_used = f"{storage_bytes / (1024 * 1024):.1f} MB"
    else:
        storage_used = f"{storage_bytes / 1024:.1f} KB"
    
    recent_events = db.query(ParkingEvent).order_by(ParkingEvent.created_at.desc()).limit(10).all()
    
    return {
        "pendingReview": pending_count,
        "totalViolations": violations_count,
        "processedToday": processed_today,
        "activeCameras": active_cameras,
        "totalSites": total_sites,
        "storageUsed": storage_used,
        "recentEvents": [{
            "id": e.id,
            "violationType": e.violation_type,
            "plateText": "",
            "timestamp": e.created_at.isoformat() if e.created_at else None,
            "confidence": e.ai_confidence,
            "status": e.status
        } for e in recent_events]
    }
