"""
Site Intelligence API Routes

Manages site-specific intelligence for parking enforcement:
- Bay details with signage/marking clarity scores
- Motorist behavior patterns
- Site attachments (photos, maps, videos)
"""

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import os
import hashlib
import shutil

from backend.db import get_db
from backend.db.models import (
    User, ParkingSite, SiteIntelligenceBay, SiteBehaviorPattern,
    SiteIntelligenceAttachment, AuditLog
)
from backend.api.dependencies import get_current_user, require_role
from backend.config import settings

router = APIRouter(tags=["site-intelligence"])


@router.get("/api/sites/{site_id}/intelligence/summary")
async def get_site_intelligence_summary(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get site intelligence summary for enforcement decisions."""
    from backend.services.site_intelligence_service import SiteIntelligenceService
    
    service = SiteIntelligenceService(db)
    return service.get_site_intelligence_summary(site_id)


@router.get("/api/sites/{site_id}/intelligence/enforcement-guidance")
async def get_enforcement_guidance(
    site_id: int,
    bay_type: str,
    base_confidence: float = 0.7,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get enforcement guidance based on site intelligence."""
    from backend.services.site_intelligence_service import SiteIntelligenceService
    
    service = SiteIntelligenceService(db)
    guidance = service.calculate_enforcement_confidence(
        site_id=site_id,
        bay_type=bay_type,
        base_confidence=base_confidence
    )
    
    return {
        "confidenceLevel": guidance.confidence_level,
        "confidenceAdjustment": guidance.confidence_adjustment,
        "reasoning": guidance.reasoning,
        "additionalEvidenceNeeded": guidance.additional_evidence_needed,
        "knownIssues": guidance.known_issues,
        "officerGuidance": guidance.officer_guidance
    }


def bay_to_dict(bay: SiteIntelligenceBay):
    return {
        "id": bay.id,
        "siteId": bay.site_id,
        "bayIdentifier": bay.bay_identifier,
        "bayType": bay.bay_type,
        "zone": bay.zone,
        "signageClarityScore": bay.signage_clarity_score,
        "markingConditionScore": bay.marking_condition_score,
        "commonMisusePatterns": bay.common_misuse_patterns or [],
        "notes": bay.notes,
        "isActive": bay.is_active,
        "createdBy": bay.created_by,
        "createdAt": bay.created_at.isoformat() if bay.created_at else None,
        "updatedAt": bay.updated_at.isoformat() if bay.updated_at else None
    }


def pattern_to_dict(pattern: SiteBehaviorPattern):
    return {
        "id": pattern.id,
        "siteId": pattern.site_id,
        "patternType": pattern.pattern_type,
        "description": pattern.description,
        "peakTimes": pattern.peak_times or [],
        "affectedBays": pattern.affected_bays or [],
        "frequency": pattern.frequency,
        "severity": pattern.severity,
        "notes": pattern.notes,
        "isActive": pattern.is_active,
        "createdBy": pattern.created_by,
        "createdAt": pattern.created_at.isoformat() if pattern.created_at else None,
        "updatedAt": pattern.updated_at.isoformat() if pattern.updated_at else None
    }


def attachment_to_dict(attachment: SiteIntelligenceAttachment):
    return {
        "id": attachment.id,
        "siteId": attachment.site_id,
        "bayId": attachment.bay_id,
        "attachmentType": attachment.attachment_type,
        "category": attachment.category,
        "title": attachment.title,
        "description": attachment.description,
        "filePath": attachment.file_path,
        "fileType": attachment.file_type,
        "mimeType": attachment.mime_type,
        "fileSize": attachment.file_size,
        "aiAnalysis": attachment.ai_analysis,
        "uploadedBy": attachment.uploaded_by,
        "uploadedAt": attachment.uploaded_at.isoformat() if attachment.uploaded_at else None
    }


@router.get("/api/sites/{site_id}/intelligence")
async def get_site_intelligence(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get complete site intelligence data."""
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    bays = db.query(SiteIntelligenceBay).filter(
        SiteIntelligenceBay.site_id == site_id,
        SiteIntelligenceBay.is_active == True
    ).all()
    
    patterns = db.query(SiteBehaviorPattern).filter(
        SiteBehaviorPattern.site_id == site_id,
        SiteBehaviorPattern.is_active == True
    ).all()
    
    attachments = db.query(SiteIntelligenceAttachment).filter(
        SiteIntelligenceAttachment.site_id == site_id
    ).all()
    
    return {
        "siteId": site_id,
        "siteName": site.site_name,
        "bays": [bay_to_dict(b) for b in bays],
        "behaviorPatterns": [pattern_to_dict(p) for p in patterns],
        "attachments": [attachment_to_dict(a) for a in attachments],
        "summary": {
            "totalBays": len(bays),
            "totalPatterns": len(patterns),
            "totalAttachments": len(attachments)
        }
    }


@router.get("/api/sites/{site_id}/intelligence/bays")
async def get_site_bays(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all bay intelligence for a site."""
    bays = db.query(SiteIntelligenceBay).filter(
        SiteIntelligenceBay.site_id == site_id
    ).order_by(SiteIntelligenceBay.bay_identifier).all()
    return [bay_to_dict(b) for b in bays]


@router.post("/api/sites/{site_id}/intelligence/bays", status_code=status.HTTP_201_CREATED)
async def create_site_bay(
    site_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new bay intelligence record."""
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    bay = SiteIntelligenceBay(
        site_id=site_id,
        bay_identifier=body.get("bayIdentifier"),
        bay_type=body.get("bayType"),
        zone=body.get("zone"),
        signage_clarity_score=body.get("signageClarityScore", 3),
        marking_condition_score=body.get("markingConditionScore", 3),
        common_misuse_patterns=body.get("commonMisusePatterns", []),
        notes=body.get("notes"),
        created_by=current_user.id
    )
    db.add(bay)
    db.commit()
    db.refresh(bay)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="create",
        entity_type="site_intelligence_bay",
        entity_id=str(bay.id),
        details={"siteId": site_id, "bayIdentifier": bay.bay_identifier}
    )
    db.add(audit_log)
    db.commit()
    
    return bay_to_dict(bay)


@router.put("/api/sites/{site_id}/intelligence/bays/{bay_id}")
async def update_site_bay(
    site_id: int,
    bay_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a bay intelligence record."""
    bay = db.query(SiteIntelligenceBay).filter(
        SiteIntelligenceBay.id == bay_id,
        SiteIntelligenceBay.site_id == site_id
    ).first()
    if not bay:
        raise HTTPException(status_code=404, detail="Bay not found")
    
    if "bayIdentifier" in body:
        bay.bay_identifier = body["bayIdentifier"]
    if "bayType" in body:
        bay.bay_type = body["bayType"]
    if "zone" in body:
        bay.zone = body["zone"]
    if "signageClarityScore" in body:
        bay.signage_clarity_score = body["signageClarityScore"]
    if "markingConditionScore" in body:
        bay.marking_condition_score = body["markingConditionScore"]
    if "commonMisusePatterns" in body:
        bay.common_misuse_patterns = body["commonMisusePatterns"]
    if "notes" in body:
        bay.notes = body["notes"]
    if "isActive" in body:
        bay.is_active = body["isActive"]
    
    bay.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(bay)
    
    return bay_to_dict(bay)


@router.delete("/api/sites/{site_id}/intelligence/bays/{bay_id}")
async def delete_site_bay(
    site_id: int,
    bay_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete (deactivate) a bay intelligence record."""
    bay = db.query(SiteIntelligenceBay).filter(
        SiteIntelligenceBay.id == bay_id,
        SiteIntelligenceBay.site_id == site_id
    ).first()
    if not bay:
        raise HTTPException(status_code=404, detail="Bay not found")
    
    bay.is_active = False
    bay.updated_at = datetime.utcnow()
    db.commit()
    
    return {"success": True, "message": "Bay deactivated"}


@router.get("/api/sites/{site_id}/intelligence/patterns")
async def get_behavior_patterns(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all behavior patterns for a site."""
    patterns = db.query(SiteBehaviorPattern).filter(
        SiteBehaviorPattern.site_id == site_id
    ).order_by(SiteBehaviorPattern.created_at.desc()).all()
    return [pattern_to_dict(p) for p in patterns]


@router.post("/api/sites/{site_id}/intelligence/patterns", status_code=status.HTTP_201_CREATED)
async def create_behavior_pattern(
    site_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new behavior pattern record."""
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    pattern = SiteBehaviorPattern(
        site_id=site_id,
        pattern_type=body.get("patternType"),
        description=body.get("description"),
        peak_times=body.get("peakTimes", []),
        affected_bays=body.get("affectedBays", []),
        frequency=body.get("frequency"),
        severity=body.get("severity", "MEDIUM"),
        notes=body.get("notes"),
        created_by=current_user.id
    )
    db.add(pattern)
    db.commit()
    db.refresh(pattern)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="create",
        entity_type="site_behavior_pattern",
        entity_id=str(pattern.id),
        details={"siteId": site_id, "patternType": pattern.pattern_type}
    )
    db.add(audit_log)
    db.commit()
    
    return pattern_to_dict(pattern)


@router.put("/api/sites/{site_id}/intelligence/patterns/{pattern_id}")
async def update_behavior_pattern(
    site_id: int,
    pattern_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a behavior pattern record."""
    pattern = db.query(SiteBehaviorPattern).filter(
        SiteBehaviorPattern.id == pattern_id,
        SiteBehaviorPattern.site_id == site_id
    ).first()
    if not pattern:
        raise HTTPException(status_code=404, detail="Pattern not found")
    
    if "patternType" in body:
        pattern.pattern_type = body["patternType"]
    if "description" in body:
        pattern.description = body["description"]
    if "peakTimes" in body:
        pattern.peak_times = body["peakTimes"]
    if "affectedBays" in body:
        pattern.affected_bays = body["affectedBays"]
    if "frequency" in body:
        pattern.frequency = body["frequency"]
    if "severity" in body:
        pattern.severity = body["severity"]
    if "notes" in body:
        pattern.notes = body["notes"]
    if "isActive" in body:
        pattern.is_active = body["isActive"]
    
    pattern.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pattern)
    
    return pattern_to_dict(pattern)


@router.delete("/api/sites/{site_id}/intelligence/patterns/{pattern_id}")
async def delete_behavior_pattern(
    site_id: int,
    pattern_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete (deactivate) a behavior pattern."""
    pattern = db.query(SiteBehaviorPattern).filter(
        SiteBehaviorPattern.id == pattern_id,
        SiteBehaviorPattern.site_id == site_id
    ).first()
    if not pattern:
        raise HTTPException(status_code=404, detail="Pattern not found")
    
    pattern.is_active = False
    pattern.updated_at = datetime.utcnow()
    db.commit()
    
    return {"success": True, "message": "Pattern deactivated"}


@router.get("/api/sites/{site_id}/intelligence/attachments")
async def get_site_attachments(
    site_id: int,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all attachments for a site."""
    query = db.query(SiteIntelligenceAttachment).filter(
        SiteIntelligenceAttachment.site_id == site_id
    )
    if category:
        query = query.filter(SiteIntelligenceAttachment.category == category)
    
    attachments = query.order_by(SiteIntelligenceAttachment.uploaded_at.desc()).all()
    return [attachment_to_dict(a) for a in attachments]


@router.post("/api/sites/{site_id}/intelligence/attachments", status_code=status.HTTP_201_CREATED)
async def upload_site_attachment(
    site_id: int,
    file: UploadFile = File(...),
    category: str = Form(...),
    title: str = Form(...),
    description: Optional[str] = Form(None),
    bay_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload an attachment for site intelligence."""
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    
    upload_dir = os.path.join(settings.UPLOAD_DIR, "site_intelligence", str(site_id))
    os.makedirs(upload_dir, exist_ok=True)
    
    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in title[:30])
    filename = f"{category}_{safe_title}_{timestamp}{ext}"
    file_path = os.path.join(upload_dir, filename)
    
    content = await file.read()
    sha256_hash = hashlib.sha256(content).hexdigest()
    
    with open(file_path, "wb") as f:
        f.write(content)
    
    ext_lower = ext.lower()
    if ext_lower in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
        attachment_type = "IMAGE"
    elif ext_lower in [".mp4", ".mov", ".avi", ".webm"]:
        attachment_type = "VIDEO"
    elif ext_lower == ".pdf":
        attachment_type = "PDF"
    else:
        attachment_type = "DOCUMENT"
    
    attachment = SiteIntelligenceAttachment(
        site_id=site_id,
        bay_id=bay_id,
        attachment_type=attachment_type,
        category=category,
        title=title,
        description=description,
        file_path=file_path,
        file_type=ext_lower,
        mime_type=file.content_type,
        file_size=len(content),
        sha256_hash=sha256_hash,
        uploaded_by=current_user.id
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="upload",
        entity_type="site_intelligence_attachment",
        entity_id=str(attachment.id),
        details={"siteId": site_id, "category": category, "title": title}
    )
    db.add(audit_log)
    db.commit()
    
    return attachment_to_dict(attachment)


@router.delete("/api/sites/{site_id}/intelligence/attachments/{attachment_id}")
async def delete_site_attachment(
    site_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete an attachment."""
    attachment = db.query(SiteIntelligenceAttachment).filter(
        SiteIntelligenceAttachment.id == attachment_id,
        SiteIntelligenceAttachment.site_id == site_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    
    if attachment.file_path and os.path.exists(attachment.file_path):
        try:
            os.remove(attachment.file_path)
        except Exception:
            pass
    
    db.delete(attachment)
    db.commit()
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="delete",
        entity_type="site_intelligence_attachment",
        entity_id=str(attachment_id),
        details={"siteId": site_id}
    )
    db.add(audit_log)
    db.commit()
    
    return {"success": True, "message": "Attachment deleted"}
