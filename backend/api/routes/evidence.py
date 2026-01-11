from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import os
import hashlib
import uuid

from backend.db import get_db
from backend.db.models import (
    User, Evidence, EvidenceBundle, CaseEvidence, EnforcementCase,
    CasePipelineResults, AuditLog, ParkingSite
)
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
        pipeline_results = db.query(CasePipelineResults).filter(
            CasePipelineResults.case_id == b.case_id
        ).first()
        result.append(bundle_to_dict(b, pipeline_results))
    
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
    
    return {"message": "Bundle analysis started", "bundleId": bundle_id}
