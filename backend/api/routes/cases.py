from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import os
import hashlib
import uuid

from backend.db import get_db
from backend.db.models import (
    User, EnforcementCase, CaseEvidence, CaseAnalysis, CaseVehicle, Evidence,
    EvidenceBundle, CasePipelineResults, CaseAnalysisStep, Pcn, AuditLog
)
from backend.api.dependencies import get_current_user, require_role
from backend.config import settings

router = APIRouter(prefix="/api/cases", tags=["cases"])

import logging
logger = logging.getLogger(__name__)

def resolve_case_from_id(db: Session, id_param: str, user_id: int = None, auto_create: bool = False):
    """
    Resolve a case from either a case ID or bundle ID.
    If auto_create is True and bundle exists without a case, create one.
    Returns tuple of (case, bundle)
    """
    # Try direct case lookup first
    case = db.query(EnforcementCase).filter(EnforcementCase.id == id_param).first()
    if case:
        logger.info(f"Found case directly by ID: {id_param}")
        return case, None
    
    # Try to find by bundle ID
    bundle = None
    try:
        bundle_id = int(id_param)
        bundle = db.query(EvidenceBundle).filter(EvidenceBundle.id == bundle_id).first()
        logger.info(f"Looking up bundle ID {bundle_id}: {'found' if bundle else 'not found'}")
    except (ValueError, TypeError):
        logger.info(f"ID {id_param} is not a valid bundle ID (not an integer)")
        pass
    
    if bundle:
        # Bundle found - check if it has a linked case
        if bundle.case_id:
            case = db.query(EnforcementCase).filter(EnforcementCase.id == bundle.case_id).first()
            if case:
                logger.info(f"Found case {case.id} linked to bundle {bundle.id}")
                return case, bundle
        
        # Bundle exists but no case - auto-create if requested
        if auto_create and user_id:
            case_id = f"CASE-{uuid.uuid4().hex[:8].upper()}"
            case = EnforcementCase(
                id=case_id,
                site_id=bundle.site_id,
                vrm=bundle.vrm,
                bay_type=bundle.bay_type,
                status="NEW",
                evidence_count=bundle.file_count or 0,
                created_by=user_id
            )
            db.add(case)
            bundle.case_id = case_id
            db.commit()
            db.refresh(case)
            logger.info(f"Auto-created case {case_id} for bundle {bundle.id}")
            return case, bundle
    
    return None, bundle

def case_to_dict(c: EnforcementCase):
    return {
        "id": c.id,
        "siteId": c.site_id,
        "vrm": c.vrm,
        "bayType": c.bay_type,
        "status": c.status,
        "evidenceCount": c.evidence_count,
        "createdBy": c.created_by,
        "createdAt": c.created_at.isoformat() if c.created_at else None,
        "updatedAt": c.updated_at.isoformat() if c.updated_at else None
    }

def pipeline_to_dict(p: CasePipelineResults):
    return {
        "id": p.id,
        "caseId": p.case_id,
        "pipelineStatus": p.pipeline_status,
        "currentStep": p.current_step,
        "completedSteps": p.completed_steps,
        "totalSteps": p.total_steps,
        "evidenceTimeline": p.evidence_timeline,
        "visionResults": p.vision_results,
        "dvlaData": p.dvla_data,
        "regulationEvaluation": p.regulation_evaluation,
        "signageCompliance": p.signage_compliance,
        "contextEnrichment": p.context_enrichment,
        "behaviourProfiling": p.behaviour_profiling,
        "bayRuleEvaluation": p.bay_rule_evaluation,
        "decision": p.decision,
        "analysisStartedAt": p.analysis_started_at.isoformat() if p.analysis_started_at else None,
        "analysisCompletedAt": p.analysis_completed_at.isoformat() if p.analysis_completed_at else None,
        "analysisError": p.analysis_error,
        "createdAt": p.created_at.isoformat() if p.created_at else None,
        "updatedAt": p.updated_at.isoformat() if p.updated_at else None
    }

@router.get("")
async def get_cases(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    cases = db.query(EnforcementCase).order_by(EnforcementCase.created_at.desc()).all()
    return [case_to_dict(c) for c in cases]

@router.get("/{case_id}")
async def get_case(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    case = db.query(EnforcementCase).filter(EnforcementCase.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail={"error": "Case not found"})
    return case_to_dict(case)

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_case(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    case = EnforcementCase(
        site_id=body.get("siteId") or body.get("site_id"),
        vrm=body.get("vrm"),
        bay_type=body.get("bayType") or body.get("bay_type"),
        status="NEW",
        evidence_count=0,
        created_by=current_user.id
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="create",
        entity_type="enforcement_case",
        entity_id=case.id,
        details={"siteId": case.site_id, "vrm": case.vrm}
    )
    db.add(audit_log)
    db.commit()
    
    return case_to_dict(case)

@router.get("/{case_id}/evidence")
async def get_case_evidence(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    case_evidence = db.query(CaseEvidence).filter(CaseEvidence.case_id == case_id).all()
    evidence_ids = [ce.evidence_id for ce in case_evidence]
    
    if not evidence_ids:
        return []
    
    evidence_items = db.query(Evidence).filter(Evidence.id.in_(evidence_ids)).all()
    
    return [{
        "id": e.id,
        "type": e.type,
        "imagePath": e.image_path,
        "videoPath": e.video_path,
        "timestamp": e.timestamp.isoformat() if e.timestamp else None,
        "status": e.status,
        "aiResult": e.ai_result,
        "createdAt": e.created_at.isoformat() if e.created_at else None
    } for e in evidence_items]

@router.get("/{case_id}/bundles")
async def get_case_bundles(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    bundles = db.query(EvidenceBundle).filter(EvidenceBundle.case_id == case_id).all()
    return [{
        "id": b.id,
        "caseId": b.case_id,
        "name": b.name,
        "status": b.status,
        "fileCount": b.file_count,
        "aiResult": b.ai_result,
        "createdAt": b.created_at.isoformat() if b.created_at else None
    } for b in bundles]

@router.get("/{case_id}/analysis")
async def get_case_analysis(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    analysis = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).first()
    if not analysis:
        return None
    return {
        "id": analysis.id,
        "caseId": analysis.case_id,
        "summary": analysis.summary,
        "vehicleDetails": analysis.vehicle_details,
        "bayType": analysis.bay_type,
        "signageFindings": analysis.signage_findings,
        "humanDetection": analysis.human_detection,
        "violations": analysis.violations,
        "confidenceScore": analysis.confidence_score,
        "riskAssessment": analysis.risk_assessment,
        "recommendation": analysis.recommendation,
        "timelineSummary": analysis.timeline_summary,
        "timeWindow": analysis.time_window,
        "generatedAt": analysis.generated_at.isoformat() if analysis.generated_at else None
    }

@router.get("/{case_id}/vehicles")
async def get_case_vehicles(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    vehicles = db.query(CaseVehicle).filter(CaseVehicle.case_id == case_id).all()
    return [{
        "id": v.id,
        "caseId": v.case_id,
        "registrationNumber": v.registration_number,
        "make": v.make,
        "model": v.model,
        "colour": v.colour,
        "fuelType": v.fuel_type,
        "taxStatus": v.tax_status,
        "motStatus": v.mot_status,
        "confidenceScore": v.confidence_score,
        "dvlaVerified": v.dvla_verified,
        "createdAt": v.created_at.isoformat() if v.created_at else None
    } for v in vehicles]

@router.get("/{id}/pipeline/results")
async def get_pipeline_results(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    logger.info(f"GET pipeline/results for ID: {id}")
    case, bundle = resolve_case_from_id(db, id)
    
    if case:
        results = db.query(CasePipelineResults).filter(CasePipelineResults.case_id == case.id).first()
        if results:
            return pipeline_to_dict(results)
    
    # If bundle exists but no results, return None (no analysis yet)
    if bundle:
        return None
    
    return None

@router.get("/{case_id}/pipeline/steps")
async def get_pipeline_steps(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    steps = db.query(CaseAnalysisStep).filter(
        CaseAnalysisStep.case_id == case_id
    ).order_by(CaseAnalysisStep.step_order).all()
    
    return [{
        "id": s.id,
        "caseId": s.case_id,
        "stepName": s.step_name,
        "stepOrder": s.step_order,
        "status": s.status,
        "inputData": s.input_data,
        "outputData": s.output_data,
        "errorMessage": s.error_message,
        "startedAt": s.started_at.isoformat() if s.started_at else None,
        "completedAt": s.completed_at.isoformat() if s.completed_at else None,
        "durationMs": s.duration_ms,
        "modelVersion": s.model_version
    } for s in steps]

@router.post("/{id}/pipeline/run")
async def run_case_pipeline(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    logger.info(f"POST pipeline/run for ID: {id}")
    
    # Resolve case from ID (auto-create if bundle exists without case)
    case, bundle = resolve_case_from_id(db, id, user_id=current_user.id, auto_create=True)
    
    if not case:
        logger.error(f"Could not find or create case for ID: {id}")
        raise HTTPException(status_code=404, detail={"error": "Case not found and could not be created"})
    
    logger.info(f"Running pipeline for case: {case.id}")
    case.status = "ANALYSING"
    db.commit()
    
    # Create or update pipeline results
    pipeline_results = db.query(CasePipelineResults).filter(CasePipelineResults.case_id == case.id).first()
    if not pipeline_results:
        pipeline_results = CasePipelineResults(
            case_id=case.id,
            pipeline_status="running",
            current_step="vision_analysis",
            completed_steps=0,
            total_steps=7,
            analysis_started_at=datetime.utcnow()
        )
        db.add(pipeline_results)
    else:
        pipeline_results.pipeline_status = "running"
        pipeline_results.current_step = "vision_analysis"
        pipeline_results.analysis_started_at = datetime.utcnow()
        pipeline_results.analysis_completed_at = None
        pipeline_results.analysis_error = None
    db.commit()
    
    # Log the action
    audit_log = AuditLog(
        user_id=current_user.id,
        action="pipeline_run",
        entity_type="enforcement_case",
        entity_id=case.id,
        details={"triggered_by": "manual", "bundle_id": bundle.id if bundle else None}
    )
    db.add(audit_log)
    db.commit()
    
    return {"message": "Pipeline started", "caseId": case.id, "status": "ANALYSING"}

@router.post("/{id}/reanalyze-evidence")
async def reanalyze_case_evidence(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    logger.info(f"POST reanalyze-evidence for ID: {id}")
    
    # Resolve case from ID (auto-create if bundle exists without case)
    case, bundle = resolve_case_from_id(db, id, user_id=current_user.id, auto_create=True)
    
    if not case:
        logger.error(f"Could not find or create case for ID: {id}")
        raise HTTPException(status_code=404, detail={"error": "Case not found and could not be created"})
    
    case.status = "ANALYSING"
    db.commit()
    
    # Update all bundles linked to this case
    bundles = db.query(EvidenceBundle).filter(EvidenceBundle.case_id == case.id).all()
    for b in bundles:
        b.status = "analyzing"
    db.commit()
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="reanalyze",
        entity_type="enforcement_case",
        entity_id=case.id,
        details={"triggered_by": "manual", "bundle_id": bundle.id if bundle else None}
    )
    db.add(audit_log)
    db.commit()
    
    return {"message": "Analysis started", "caseId": case.id, "status": "ANALYSING"}

@router.get("/{case_id}/pcn")
async def get_case_pcn(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    pcn = db.query(Pcn).filter(Pcn.case_id == case_id).first()
    if not pcn:
        return None
    return {
        "id": pcn.id,
        "pcnNumber": pcn.pcn_number,
        "caseId": pcn.case_id,
        "siteId": pcn.site_id,
        "vrm": pcn.vrm,
        "status": pcn.status,
        "eligibility": pcn.eligibility,
        "amount": pcn.amount,
        "explanation": pcn.explanation,
        "issuedAt": pcn.issued_at.isoformat() if pcn.issued_at else None,
        "createdAt": pcn.created_at.isoformat() if pcn.created_at else None
    }
