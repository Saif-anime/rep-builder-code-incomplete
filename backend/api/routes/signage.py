from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime
import os
import hashlib
import uuid

from backend.db import get_db
from backend.db.models import (
    User, SignageInspection, SignagePhoto, ParkingSiteSignage, SignageRuleFile,
    AuditLog
)
from backend.api.dependencies import get_current_user, require_role
from backend.config import settings

router = APIRouter(tags=["signage"])

def inspection_to_dict(i: SignageInspection):
    return {
        "id": i.id,
        "siteId": i.site_id,
        "inspectionDate": i.inspection_date.isoformat() if i.inspection_date else None,
        "inspectorId": i.inspector_id,
        "inspectorName": i.inspector_name,
        "siteCode": i.site_code,
        "siteAddress": i.site_address,
        "status": i.status,
        "entranceSignagePresent": i.entrance_signage_present,
        "entranceClearlyVisible": i.entrance_clearly_visible,
        "entranceCorrectWording": i.entrance_correct_wording,
        "entranceHeightCompliant": i.entrance_height_compliant,
        "entranceCondition": i.entrance_condition,
        "tcTariffVisible": i.tc_tariff_visible,
        "tcFontReadable": i.tc_font_readable,
        "tcLanguageCorrect": i.tc_language_correct,
        "tcLightingPresent": i.tc_lighting_present,
        "disabledSignPresent": i.disabled_sign_present,
        "disabledMarkingsVisible": i.disabled_markings_visible,
        "evSignPresent": i.ev_sign_present,
        "evMarkingsVisible": i.ev_markings_visible,
        "parentChildSignPresent": i.parent_child_sign_present,
        "parentChildMarkingsVisible": i.parent_child_markings_visible,
        "bpaIpcCompliant": i.bpa_ipc_compliant,
        "conflictingSignagePresent": i.conflicting_signage_present,
        "obstructionsPresent": i.obstructions_present,
        "weatherDamage": i.weather_damage,
        "graffitiPresent": i.graffiti_present,
        "generalNotes": i.general_notes,
        "overallComplianceScore": i.overall_compliance_score,
        "entranceScore": i.entrance_score,
        "tcScore": i.tc_score,
        "baySignageScore": i.bay_signage_score,
        "generalScore": i.general_score,
        "appealRiskScore": i.appeal_risk_score,
        "nightVisibilityRisk": i.night_visibility_risk,
        "aiAnalysis": i.ai_analysis,
        "submittedAt": i.submitted_at.isoformat() if i.submitted_at else None,
        "approvedAt": i.approved_at.isoformat() if i.approved_at else None,
        "createdAt": i.created_at.isoformat() if i.created_at else None
    }

@router.get("/api/sites/{site_id}/signage-inspections")
async def get_site_signage_inspections(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    inspections = db.query(SignageInspection).filter(
        SignageInspection.site_id == site_id
    ).order_by(SignageInspection.created_at.desc()).all()
    
    return [inspection_to_dict(i) for i in inspections]

@router.get("/api/signage-inspections/{inspection_id}")
async def get_signage_inspection(
    inspection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    inspection = db.query(SignageInspection).filter(SignageInspection.id == inspection_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail={"error": "Inspection not found"})
    
    photos = db.query(SignagePhoto).filter(SignagePhoto.inspection_id == inspection_id).all()
    
    result = inspection_to_dict(inspection)
    result["photos"] = [{
        "id": p.id,
        "inspectionId": p.inspection_id,
        "section": p.section,
        "photoPath": p.photo_path,
        "thumbnailPath": p.thumbnail_path,
        "caption": p.caption,
        "createdAt": p.created_at.isoformat() if p.created_at else None
    } for p in photos]
    
    return result

@router.post("/api/sites/{site_id}/signage-inspections", status_code=status.HTTP_201_CREATED)
async def create_signage_inspection(
    site_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    inspection = SignageInspection(
        site_id=site_id,
        inspection_date=datetime.fromisoformat(body["inspectionDate"]) if body.get("inspectionDate") else datetime.utcnow(),
        inspector_id=current_user.id,
        inspector_name=body.get("inspectorName") or current_user.full_name,
        site_code=body.get("siteCode"),
        site_address=body.get("siteAddress"),
        status="draft"
    )
    db.add(inspection)
    db.commit()
    db.refresh(inspection)
    
    return inspection_to_dict(inspection)

@router.patch("/api/signage-inspections/{inspection_id}")
async def update_signage_inspection(
    inspection_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    inspection = db.query(SignageInspection).filter(SignageInspection.id == inspection_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail={"error": "Inspection not found"})
    
    field_mapping = {
        "inspectionDate": "inspection_date",
        "inspectorName": "inspector_name",
        "siteCode": "site_code",
        "siteAddress": "site_address",
        "entranceSignagePresent": "entrance_signage_present",
        "entranceClearlyVisible": "entrance_clearly_visible",
        "entranceCorrectWording": "entrance_correct_wording",
        "entranceHeightCompliant": "entrance_height_compliant",
        "entranceCondition": "entrance_condition",
        "tcTariffVisible": "tc_tariff_visible",
        "tcFontReadable": "tc_font_readable",
        "tcLanguageCorrect": "tc_language_correct",
        "tcLightingPresent": "tc_lighting_present",
        "disabledSignPresent": "disabled_sign_present",
        "disabledMarkingsVisible": "disabled_markings_visible",
        "evSignPresent": "ev_sign_present",
        "evMarkingsVisible": "ev_markings_visible",
        "parentChildSignPresent": "parent_child_sign_present",
        "parentChildMarkingsVisible": "parent_child_markings_visible",
        "bpaIpcCompliant": "bpa_ipc_compliant",
        "conflictingSignagePresent": "conflicting_signage_present",
        "obstructionsPresent": "obstructions_present",
        "weatherDamage": "weather_damage",
        "graffitiPresent": "graffiti_present",
        "generalNotes": "general_notes"
    }
    
    for camel, snake in field_mapping.items():
        if camel in body:
            value = body[camel]
            if camel == "inspectionDate" and value:
                value = datetime.fromisoformat(value)
            setattr(inspection, snake, value)
    
    inspection.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inspection)
    
    return inspection_to_dict(inspection)

@router.post("/api/signage-inspections/{inspection_id}/submit")
async def submit_signage_inspection(
    inspection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    inspection = db.query(SignageInspection).filter(SignageInspection.id == inspection_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail={"error": "Inspection not found"})
    
    inspection.status = "submitted"
    inspection.submitted_at = datetime.utcnow()
    db.commit()
    
    return inspection_to_dict(inspection)

@router.post("/api/signage-inspections/{inspection_id}/approve")
async def approve_signage_inspection(
    inspection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    inspection = db.query(SignageInspection).filter(SignageInspection.id == inspection_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail={"error": "Inspection not found"})
    
    inspection.status = "approved"
    inspection.approved_by = current_user.id
    inspection.approved_at = datetime.utcnow()
    db.commit()
    
    return inspection_to_dict(inspection)

@router.delete("/api/signage-inspections/{inspection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_signage_inspection(
    inspection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    inspection = db.query(SignageInspection).filter(SignageInspection.id == inspection_id).first()
    if inspection:
        db.query(SignagePhoto).filter(SignagePhoto.inspection_id == inspection_id).delete()
        db.delete(inspection)
        db.commit()
    return None
