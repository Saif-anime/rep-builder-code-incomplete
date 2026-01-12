from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
import os

from backend.db import get_db
from backend.db.models import (
    User, Evidence, Camera, ParkingSite,
    AuditLog, AnprEvent, EnforcementCase, CaseAnalysis
)
from backend.api.dependencies import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("/stats")
async def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    
    pending_count = db.query(EnforcementCase).filter(
        EnforcementCase.status.in_(["NEW", "pending", "pending_review", "awaiting_review", "ANALYZING"])
    ).count()
    
    violations_today = db.query(EnforcementCase).join(
        CaseAnalysis, CaseAnalysis.case_id == EnforcementCase.id, isouter=True
    ).filter(
        EnforcementCase.created_at >= today_start,
        CaseAnalysis.recommendation == "ISSUE_PCN"
    ).count()
    
    processed_today = db.query(EnforcementCase).filter(
        EnforcementCase.updated_at >= today_start,
        EnforcementCase.status.in_(["COMPLETED", "completed", "approved", "closed", "pcn_issued", "PCN_ISSUED"])
    ).count()
    
    active_cameras = db.query(Camera).filter(Camera.status == "online").count()
    
    total_sites = db.query(ParkingSite).filter(ParkingSite.is_active == True).count()
    
    uploads_dir = os.path.join(os.getcwd(), "uploads")
    storage_bytes = 0
    if os.path.exists(uploads_dir):
        for root, dirs, files in os.walk(uploads_dir):
            for f in files:
                try:
                    storage_bytes += os.path.getsize(os.path.join(root, f))
                except:
                    pass
    
    if storage_bytes >= 1024 * 1024 * 1024:
        storage_used = f"{storage_bytes / (1024 * 1024 * 1024):.1f} GB"
    elif storage_bytes >= 1024 * 1024:
        storage_used = f"{storage_bytes / (1024 * 1024):.1f} MB"
    else:
        storage_used = f"{storage_bytes / 1024:.1f} KB"
    
    anpr_count = db.query(AnprEvent).filter(
        AnprEvent.created_at >= today_start
    ).count()
    
    recent_cases_with_analysis = db.query(EnforcementCase, CaseAnalysis).outerjoin(
        CaseAnalysis, CaseAnalysis.case_id == EnforcementCase.id
    ).filter(
        CaseAnalysis.recommendation == "ISSUE_PCN"
    ).order_by(EnforcementCase.created_at.desc()).limit(10).all()
    
    recent_activity = db.query(AuditLog).order_by(
        AuditLog.created_at.desc()
    ).limit(10).all()
    
    activity_user_ids = [a.user_id for a in recent_activity if a.user_id]
    users = {u.id: u for u in db.query(User).filter(User.id.in_(activity_user_ids)).all()} if activity_user_ids else {}
    
    return {
        "pendingReview": pending_count,
        "totalViolations": violations_today,
        "processedToday": processed_today,
        "activeCameras": active_cameras,
        "totalSites": total_sites,
        "storageUsed": storage_used,
        "anprCount": anpr_count,
        "recentEvents": [{
            "id": c.id,
            "violationType": c.bay_type or (a.bay_type if a else "Unknown"),
            "plateText": c.vrm or "Unknown",
            "timestamp": c.created_at.isoformat() if c.created_at else None,
            "confidence": a.confidence_score if a else 0,
            "status": c.status or "pending"
        } for c, a in recent_cases_with_analysis],
        "recentActivity": [{
            "id": a.id,
            "action": a.action,
            "entityType": a.entity_type,
            "entityId": a.entity_id or "",
            "userName": users.get(a.user_id).full_name if a.user_id and users.get(a.user_id) else "System",
            "timestamp": a.created_at.isoformat() if a.created_at else None,
            "details": a.details.get("summary") if a.details and isinstance(a.details, dict) else None
        } for a in recent_activity]
    }
