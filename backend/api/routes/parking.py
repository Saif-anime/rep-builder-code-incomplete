from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from backend.db import get_db
from backend.db.models import (
    User, ParkingEvent, ParkingSession, AnprEvent, NumberPlate, 
    SessionFlag, PcnRecommendation, DriverProfile, AuditLog
)
from backend.api.dependencies import get_current_user, require_role

router = APIRouter(tags=["parking"])

@router.get("/api/parking-events")
async def get_parking_events(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(ParkingEvent)
    if status:
        query = query.filter(ParkingEvent.status == status)
    
    events = query.order_by(ParkingEvent.created_at.desc()).all()
    return [{
        "id": e.id,
        "evidenceId": e.evidence_id,
        "bayId": e.bay_id,
        "numberPlateId": e.number_plate_id,
        "violationType": e.violation_type,
        "isViolation": e.is_violation,
        "aiConfidence": e.ai_confidence,
        "aiExplanation": e.ai_explanation,
        "aiReasoning": e.ai_reasoning,
        "status": e.status,
        "pcnNumber": e.pcn_number,
        "pcnIssuedAt": e.pcn_issued_at.isoformat() if e.pcn_issued_at else None,
        "pcnAmount": e.pcn_amount,
        "createdAt": e.created_at.isoformat() if e.created_at else None
    } for e in events]

@router.get("/api/parking-events/{event_id}")
async def get_parking_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(ParkingEvent).filter(ParkingEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail={"error": "Parking event not found"})
    
    return {
        "id": event.id,
        "evidenceId": event.evidence_id,
        "bayId": event.bay_id,
        "numberPlateId": event.number_plate_id,
        "violationType": event.violation_type,
        "isViolation": event.is_violation,
        "aiConfidence": event.ai_confidence,
        "aiExplanation": event.ai_explanation,
        "aiReasoning": event.ai_reasoning,
        "status": event.status,
        "pcnNumber": event.pcn_number,
        "pcnIssuedAt": event.pcn_issued_at.isoformat() if event.pcn_issued_at else None,
        "pcnAmount": event.pcn_amount,
        "createdAt": event.created_at.isoformat() if event.created_at else None
    }

@router.get("/api/number-plates")
async def get_number_plates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    plates = db.query(NumberPlate).order_by(NumberPlate.created_at.desc()).all()
    return [{
        "id": p.id,
        "evidenceId": p.evidence_id,
        "plateText": p.plate_text,
        "confidence": p.confidence,
        "isValidUkFormat": p.is_valid_uk_format,
        "boundingBox": p.bounding_box,
        "createdAt": p.created_at.isoformat() if p.created_at else None
    } for p in plates]

@router.get("/api/sessions/{session_id}/flags")
async def get_session_flags(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    flags = db.query(SessionFlag).filter(SessionFlag.session_id == session_id).all()
    return [{
        "id": f.id,
        "sessionId": f.session_id,
        "siteId": f.site_id,
        "flagType": f.flag_type,
        "severity": f.severity,
        "reason": f.reason,
        "recommendation": f.recommendation,
        "evidence": f.evidence,
        "status": f.status,
        "resolvedAt": f.resolved_at.isoformat() if f.resolved_at else None,
        "createdAt": f.created_at.isoformat() if f.created_at else None
    } for f in flags]

@router.get("/api/sessions/{session_id}/recommendations")
async def get_session_recommendations(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    recs = db.query(PcnRecommendation).filter(PcnRecommendation.session_id == session_id).all()
    return [{
        "id": r.id,
        "sessionId": r.session_id,
        "siteId": r.site_id,
        "vrm": r.vrm,
        "action": r.action,
        "previousAction": r.previous_action,
        "source": r.source,
        "reason": r.reason,
        "reasonPlain": r.reason_plain,
        "confidence": r.confidence,
        "isOverride": r.is_override,
        "createdAt": r.created_at.isoformat() if r.created_at else None
    } for r in recs]

@router.get("/api/sites/{site_id}/drivers")
async def get_site_drivers(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    profiles = db.query(DriverProfile).filter(DriverProfile.site_id == site_id).all()
    return [{
        "id": p.id,
        "siteId": p.site_id,
        "vrm": p.vrm,
        "firstSeen": p.first_seen.isoformat() if p.first_seen else None,
        "lastSeen": p.last_seen.isoformat() if p.last_seen else None,
        "visits30d": p.visits_30d,
        "visits90d": p.visits_90d,
        "totalVisits": p.total_visits,
        "behaviourClassification": p.behaviour_classification,
        "riskFlag": p.risk_flag,
        "riskScore": p.risk_score,
        "createdAt": p.created_at.isoformat() if p.created_at else None
    } for p in profiles]

@router.get("/api/sites/{site_id}/drivers/{vrm}/profile")
async def get_driver_profile(
    site_id: int,
    vrm: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    profile = db.query(DriverProfile).filter(
        DriverProfile.site_id == site_id,
        DriverProfile.vrm == vrm.upper()
    ).first()
    
    if not profile:
        return None
    
    return {
        "id": profile.id,
        "siteId": profile.site_id,
        "vrm": profile.vrm,
        "firstSeen": profile.first_seen.isoformat() if profile.first_seen else None,
        "lastSeen": profile.last_seen.isoformat() if profile.last_seen else None,
        "visits30d": profile.visits_30d,
        "visits90d": profile.visits_90d,
        "totalVisits": profile.total_visits,
        "medianDurationMinutes": profile.median_duration_minutes,
        "meanDurationMinutes": profile.mean_duration_minutes,
        "durationStddev": profile.duration_stddev,
        "commonArrivalTimeBuckets": profile.common_arrival_time_buckets,
        "behaviourClassification": profile.behaviour_classification,
        "riskFlag": profile.risk_flag,
        "riskScore": profile.risk_score,
        "riskFactors": profile.risk_factors,
        "lastCalculatedAt": profile.last_calculated_at.isoformat() if profile.last_calculated_at else None,
        "createdAt": profile.created_at.isoformat() if profile.created_at else None
    }

@router.get("/api/sites/{site_id}/flags")
async def get_site_flags(
    site_id: int,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(SessionFlag).filter(SessionFlag.site_id == site_id)
    if status:
        query = query.filter(SessionFlag.status == status)
    
    flags = query.order_by(SessionFlag.created_at.desc()).all()
    return [{
        "id": f.id,
        "sessionId": f.session_id,
        "siteId": f.site_id,
        "flagType": f.flag_type,
        "severity": f.severity,
        "reason": f.reason,
        "recommendation": f.recommendation,
        "evidence": f.evidence,
        "status": f.status,
        "resolvedAt": f.resolved_at.isoformat() if f.resolved_at else None,
        "createdAt": f.created_at.isoformat() if f.created_at else None
    } for f in flags]

@router.post("/api/flags/{flag_id}/resolve")
async def resolve_flag(
    flag_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    flag = db.query(SessionFlag).filter(SessionFlag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail={"error": "Flag not found"})
    
    flag.status = "RESOLVED"
    flag.resolved_at = datetime.utcnow()
    flag.resolved_by = current_user.id
    flag.resolution_notes = body.get("notes")
    db.commit()
    
    return {"success": True, "flagId": flag_id}
