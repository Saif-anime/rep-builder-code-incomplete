from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import os
import hashlib
import uuid
import json
import re

from backend.db import get_db
from backend.db.models import (
    User, SignageInspection, SignagePhoto, ParkingSiteSignage, SignageRuleFile,
    AuditLog, ParkingSite
)
from backend.api.dependencies import get_current_user, require_role
from backend.config import settings

router = APIRouter(tags=["signage"])

def signage_to_dict(s: ParkingSiteSignage, files: List[SignageRuleFile] = None):
    """Convert ParkingSiteSignage model to dict."""
    return {
        "id": s.id,
        "siteId": s.site_id,
        "signageType": s.signage_type,
        "title": s.title,
        "source": s.source,
        "extractedData": s.extracted_data,
        "confidenceScore": s.confidence_score,
        "effectiveFrom": s.effective_from.isoformat() if s.effective_from else None,
        "effectiveTo": s.effective_to.isoformat() if s.effective_to else None,
        "status": s.status,
        "displayPriority": s.display_priority,
        "createdAt": s.created_at.isoformat() if s.created_at else None,
        "files": [{
            "id": f.id,
            "filePath": f.file_path,
            "fileType": f.file_type,
            "extractedText": f.extracted_text,
            "aiAnalysis": f.ai_analysis,
        } for f in (files or [])]
    }

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


# =============================================
# Site Signage Rules Endpoints (PDF Upload)
# =============================================

@router.get("/api/sites/{site_id}/signage")
async def get_site_signage(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all signage rules for a site."""
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail={"error": "Site not found"})
    
    signage_list = db.query(ParkingSiteSignage).filter(
        ParkingSiteSignage.site_id == site_id
    ).order_by(ParkingSiteSignage.created_at.desc()).all()
    
    result = []
    for s in signage_list:
        files = db.query(SignageRuleFile).filter(
            SignageRuleFile.signage_id == s.id
        ).all()
        result.append(signage_to_dict(s, files))
    
    return result


@router.post("/api/sites/{site_id}/signage/upload", status_code=status.HTTP_201_CREATED)
async def upload_site_signage_pdf(
    site_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    """Upload and process a signage PDF to extract rules."""
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail={"error": "Site not found"})
    
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail={"error": "Only PDF files are accepted"})
    
    # Save file
    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)
    
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    safe_filename = f"signage_{site_id}_{timestamp}_{uuid.uuid4().hex[:8]}.pdf"
    file_path = os.path.join(upload_dir, safe_filename)
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Calculate hash
    sha256_hash = hashlib.sha256(content).hexdigest()
    
    # Extract text from PDF using pdf_parse library
    extracted_text = ""
    try:
        import pdf_parse as pdf_parser
        parsed = pdf_parser.parse(content)
        extracted_text = parsed.get("text", "") if parsed else ""
    except Exception:
        try:
            # Fallback: Use PyPDF2 if available
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(content))
            text_parts = []
            for page in reader.pages:
                text_parts.append(page.extract_text() or "")
            extracted_text = "\n".join(text_parts)
        except Exception:
            # Last fallback - just note the file was uploaded
            extracted_text = f"[PDF uploaded: {file.filename or 'unknown'}]"
    
    # Analyze signage using AI
    filename = file.filename or "uploaded.pdf"
    extracted_data = await analyze_signage_pdf(extracted_text, filename)
    confidence_score = extracted_data.get("confidenceScore", 0.5)
    
    # Create signage record
    signage_id = str(uuid.uuid4())
    signage = ParkingSiteSignage(
        id=signage_id,
        site_id=site_id,
        signage_type="TERMS_AND_CONDITIONS",
        title=extracted_data.get("title", f"Signage from {file.filename}"),
        source="PDF",
        extracted_data=extracted_data,
        confidence_score=confidence_score,
        status="ACTIVE",
        created_by=current_user.id
    )
    db.add(signage)
    
    # Create file record
    rule_file = SignageRuleFile(
        signage_id=signage_id,
        file_path=f"/uploads/{safe_filename}",
        file_type="PDF",
        mime_type="application/pdf",
        sha256_hash=sha256_hash,
        extracted_text=extracted_text[:10000] if extracted_text else None,
        ai_analysis=extracted_data,
        uploaded_by=current_user.id
    )
    db.add(rule_file)
    
    db.commit()
    db.refresh(signage)
    
    files = db.query(SignageRuleFile).filter(SignageRuleFile.signage_id == signage_id).all()
    
    return signage_to_dict(signage, files)


@router.post("/api/signage/{signage_id}/archive")
async def archive_signage(
    signage_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    """Archive a signage record."""
    signage = db.query(ParkingSiteSignage).filter(ParkingSiteSignage.id == signage_id).first()
    if not signage:
        raise HTTPException(status_code=404, detail={"error": "Signage not found"})
    
    signage.status = "ARCHIVED"
    signage.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(signage)
    
    files = db.query(SignageRuleFile).filter(SignageRuleFile.signage_id == signage_id).all()
    return signage_to_dict(signage, files)


@router.post("/api/signage/{signage_id}/activate")
async def activate_signage(
    signage_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    """Activate a signage record."""
    signage = db.query(ParkingSiteSignage).filter(ParkingSiteSignage.id == signage_id).first()
    if not signage:
        raise HTTPException(status_code=404, detail={"error": "Signage not found"})
    
    signage.status = "ACTIVE"
    signage.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(signage)
    
    files = db.query(SignageRuleFile).filter(SignageRuleFile.signage_id == signage_id).all()
    return signage_to_dict(signage, files)


async def analyze_signage_pdf(text: str, filename: str) -> dict:
    """Analyze PDF text to extract signage rules using AI."""
    try:
        from openai import OpenAI
        
        client = OpenAI()
        
        prompt = f"""Analyze this parking signage document and extract the following information:

Document: {filename}
Text content:
{text[:8000]}

Extract and return a JSON object with:
1. title: A descriptive title for this signage
2. maxStayMinutes: Maximum stay duration in minutes (null if not found)
3. gracePeriodMinutes: Grace period in minutes (null if not found)
4. enforcementHours: Object with start, end times and days array
5. tariff: Parking tariff/charges information
6. restrictions: Array of specific restrictions
7. specialBays: Array of special bay types mentioned (disabled, EV, parent & child, loading)
8. penalties: Penalty charge amount if mentioned
9. confidenceScore: Your confidence in the extraction (0-1)
10. notes: Any additional relevant notes

Return ONLY valid JSON."""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a parking signage analysis expert. Extract structured data from parking signage documents."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=1500
        )
        
        result_text = response.choices[0].message.content
        
        # Parse JSON from response
        json_match = re.search(r'\{[\s\S]*\}', result_text)
        if json_match:
            return json.loads(json_match.group())
        
        return {
            "title": f"Signage from {filename}",
            "confidenceScore": 0.3,
            "notes": "Could not parse AI response"
        }
        
    except Exception as e:
        return {
            "title": f"Signage from {filename}",
            "confidenceScore": 0.2,
            "notes": f"AI analysis error: {str(e)}",
            "rawText": text[:2000] if text else None
        }
