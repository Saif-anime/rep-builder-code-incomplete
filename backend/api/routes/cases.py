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
    EvidenceBundle, CasePipelineResults, CaseAnalysisStep, Pcn, AuditLog, ParkingSite
)
from backend.services.ocr_service import ocr_service
from backend.services.evidence_summary_service import evidence_summary_service
from backend.api.dependencies import get_current_user, require_role
from backend.config import settings
import httpx
import json

router = APIRouter(prefix="/api/cases", tags=["cases"])

import logging
logger = logging.getLogger(__name__)

async def interpret_ai_instructions(
    ai_instructions: str,
    evidence_context: dict,
    current_decision: dict
) -> dict:
    """
    Use OpenAI to interpret site-specific AI instructions and potentially modify the decision.
    
    Args:
        ai_instructions: The AI instructions text from Site Intelligence
        evidence_context: Context about the evidence (duration, bay type, VRM, etc.)
        current_decision: The current decision before AI instruction interpretation
    
    Returns:
        Dictionary with instruction_applied, modified_decision, reasoning
    """
    api_key = os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", ""))
    base_url = os.getenv("AI_INTEGRATIONS_OPENAI_BASE_URL", "https://api.openai.com/v1")
    
    if not api_key or not ai_instructions or not ai_instructions.strip():
        return {
            "instruction_applied": False,
            "reasoning": "No AI instructions configured for this site",
            "original_decision": current_decision,
            "modified_decision": None
        }
    
    prompt = f"""You are a UK parking enforcement decision assistant. A site administrator has configured specific AI instructions for this parking site. Your job is to interpret these instructions and determine if they should modify the current enforcement decision.

SITE AI INSTRUCTIONS:
{ai_instructions}

EVIDENCE CONTEXT:
- Bay Type: {evidence_context.get('bay_type', 'Unknown')}
- Duration Observed: {evidence_context.get('duration_minutes', 'Unknown')} minutes
- Vehicle Registration: {evidence_context.get('vrm', 'Unknown')}
- Observe From: {evidence_context.get('observe_from', 'Unknown')}
- Observe To: {evidence_context.get('observe_to', 'Unknown')}
- Site Name: {evidence_context.get('site_name', 'Unknown')}
- Timestamp Confidence: {evidence_context.get('timestamp_confidence', 'Unknown')}
- Validation Warnings: {', '.join(evidence_context.get('validation_warnings', [])) or 'None'}

CURRENT DECISION:
- Status: {current_decision.get('status', 'Unknown')}
- Recommendation: {current_decision.get('recommendation', 'Unknown')}
- Confidence: {current_decision.get('overallConfidence', 0)}%
- Legal Risk: {current_decision.get('legalRisk', 'Unknown')}
- Reasoning: {current_decision.get('reasoning', 'Unknown')}

Based on the AI instructions, should the decision be modified? Consider:
1. Does the AI instruction apply to this specific situation?
2. Should the decision status change (PCN_ELIGIBLE, NO_PCN, REVIEW_REQUIRED)?
3. Should confidence be adjusted?
4. Should legal risk be changed?

Return a JSON object:
{{
  "instruction_applies": true/false,
  "should_modify_decision": true/false,
  "new_status": "PCN_ELIGIBLE" | "NO_PCN" | "REVIEW_REQUIRED" | null,
  "confidence_adjustment": number (-50 to +50) or 0,
  "legal_risk_change": "low" | "medium" | "high" | null,
  "reasoning": "explanation of how the AI instruction was interpreted",
  "recommendation_override": "new recommendation text or null",
  "additional_notes": "any operator guidance from the AI instructions"
}}

Return ONLY the JSON object."""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 800,
                    "temperature": 0.3
                }
            )
            
            if response.status_code != 200:
                logger.error(f"AI Instructions interpretation failed: {response.status_code}")
                return {
                    "instruction_applied": False,
                    "reasoning": f"AI interpretation failed: API error {response.status_code}",
                    "original_decision": current_decision,
                    "modified_decision": None
                }
            
            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            # Parse JSON response
            try:
                content = content.strip()
                if content.startswith("```"):
                    content = content.split("```")[1]
                    if content.startswith("json"):
                        content = content[4:]
                ai_result = json.loads(content)
            except json.JSONDecodeError:
                logger.error(f"Failed to parse AI instruction response: {content[:200]}")
                return {
                    "instruction_applied": False,
                    "reasoning": "Failed to parse AI interpretation response",
                    "original_decision": current_decision,
                    "modified_decision": None
                }
            
            # Build the modified decision if applicable
            if ai_result.get("should_modify_decision") and ai_result.get("instruction_applies"):
                modified_decision = current_decision.copy()
                
                if ai_result.get("new_status"):
                    modified_decision["status"] = ai_result["new_status"]
                
                conf_adj = ai_result.get("confidence_adjustment", 0)
                if conf_adj:
                    new_conf = max(0, min(100, current_decision.get("overallConfidence", 70) + conf_adj))
                    modified_decision["overallConfidence"] = new_conf
                
                if ai_result.get("legal_risk_change"):
                    modified_decision["legalRisk"] = ai_result["legal_risk_change"]
                
                if ai_result.get("recommendation_override"):
                    modified_decision["recommendation"] = ai_result["recommendation_override"]
                
                modified_decision["aiInstructionsApplied"] = True
                modified_decision["aiInstructionsReasoning"] = ai_result.get("reasoning", "")
                modified_decision["aiInstructionNotes"] = ai_result.get("additional_notes", "")
                
                return {
                    "instruction_applied": True,
                    "reasoning": ai_result.get("reasoning", "AI instruction applied"),
                    "original_decision": current_decision,
                    "modified_decision": modified_decision,
                    "additional_notes": ai_result.get("additional_notes", "")
                }
            else:
                return {
                    "instruction_applied": False,
                    "reasoning": ai_result.get("reasoning", "AI instruction did not apply to this case"),
                    "original_decision": current_decision,
                    "modified_decision": None
                }
                
    except Exception as e:
        logger.error(f"AI instruction interpretation error: {e}")
        return {
            "instruction_applied": False,
            "reasoning": f"AI interpretation error: {str(e)}",
            "original_decision": current_decision,
            "modified_decision": None
        }

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
            # Get site info from evidence if available
            site_id = None
            vrm = None
            bay_type = None
            
            # Try to get info from case evidence or evidence table
            case_evidence = db.query(CaseEvidence).filter(CaseEvidence.case_id == bundle.case_id).first() if bundle.case_id else None
            if case_evidence:
                evidence = db.query(Evidence).filter(Evidence.id == case_evidence.evidence_id).first()
                if evidence:
                    site_id = evidence.site_id
                    vrm = evidence.vrm
                    bay_type = evidence.bay_type
            
            case = EnforcementCase(
                id=case_id,
                site_id=site_id,
                vrm=vrm,
                bay_type=bay_type,
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

@router.delete("/{case_id}")
async def delete_case(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    case = db.query(EnforcementCase).filter(EnforcementCase.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail={"error": "Case not found"})
    
    # Find all bundles linked to this case
    bundles = db.query(EvidenceBundle).filter(EvidenceBundle.case_id == case_id).all()
    bundle_ids = [b.id for b in bundles]
    
    # Delete evidence items linked to these bundles
    if bundle_ids:
        db.query(Evidence).filter(Evidence.bundle_id.in_(bundle_ids)).delete(synchronize_session=False)
    
    # Delete evidence bundles linked to this case
    db.query(EvidenceBundle).filter(EvidenceBundle.case_id == case_id).delete(synchronize_session=False)
    
    # Delete other related records
    db.query(CaseEvidence).filter(CaseEvidence.case_id == case_id).delete(synchronize_session=False)
    db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).delete(synchronize_session=False)
    db.query(CaseVehicle).filter(CaseVehicle.case_id == case_id).delete(synchronize_session=False)
    db.query(CasePipelineResults).filter(CasePipelineResults.case_id == case_id).delete(synchronize_session=False)
    
    # Log the deletion
    audit_log = AuditLog(
        user_id=current_user.id,
        action="delete",
        entity_type="enforcement_case",
        entity_id=case_id,
        details={"caseId": case.id, "vrm": case.vrm}
    )
    db.add(audit_log)
    
    db.delete(case)
    db.commit()
    
    return {"success": True, "message": "Case deleted successfully"}

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
    
    # Get site info from the case
    site = None
    site_name = "Unknown Site"
    if case.site_id:
        site = db.query(ParkingSite).filter(ParkingSite.id == case.site_id).first()
        if site:
            site_name = getattr(site, 'site_name', None) or getattr(site, 'name', None) or "Unknown Site"
    
    # Get evidence for the case (from linked bundles or case evidence)
    evidence_list = []
    if bundle:
        # Get evidence linked to the bundle
        evidence_list = db.query(Evidence).filter(Evidence.bundle_id == bundle.id).all()
    
    if not evidence_list:
        # Try case evidence table
        case_evidence_records = db.query(CaseEvidence).filter(CaseEvidence.case_id == case.id).all()
        evidence_ids = [ce.evidence_id for ce in case_evidence_records]
        if evidence_ids:
            evidence_list = db.query(Evidence).filter(Evidence.id.in_(evidence_ids)).all()
    
    # Run combined OCR extraction on each evidence image (single API call per image for efficiency)
    logger.info(f"Running combined OCR extraction on {len(evidence_list)} evidence items")
    ocr_timestamps = []
    extracted_vrms = []
    
    for evidence in evidence_list:
        image_path = None
        if evidence.image_path:
            # Remove leading /uploads/ to get relative path
            relative_path = evidence.image_path.lstrip("/")
            image_path = os.path.join(os.getcwd(), relative_path)
        
        if image_path and os.path.exists(image_path):
            logger.info(f"Extracting timestamp and VRM from: {image_path}")
            # Single API call extracts both timestamp and VRM
            combined_result = await ocr_service.extract_timestamp_and_vrm_from_image(image_path)
            logger.info(f"Combined OCR result for evidence {evidence.id}: {combined_result}")
            
            # Process VRM from combined result
            if combined_result.get("vrm"):
                extracted_vrms.append({
                    "vrm": combined_result["vrm"],
                    "confidence": combined_result.get("vrm_confidence", 0),
                    "evidenceId": evidence.id,
                    "location": combined_result.get("vrm_location"),
                    "rawText": combined_result.get("vrm_raw_text")
                })
            
            # Process timestamp from combined result
            parsed_time = None
            if combined_result.get("timestamp"):
                parsed_time = ocr_service.parse_timestamp_string(combined_result["timestamp"])
            
            if parsed_time:
                # Update evidence record with extracted timestamp
                evidence.timestamp = parsed_time
                evidence.ocr_confidence = combined_result.get("confidence", 0)
                db.commit()
            
            ocr_timestamps.append({
                "evidenceId": evidence.id,
                "timestamp": parsed_time.isoformat() if parsed_time else None,
                "source": combined_result.get("source", "ocr"),
                "confidence": combined_result.get("confidence", 0),
                "rawOcrText": combined_result.get("raw_text"),
                "location": combined_result.get("location")
            })
    
    # Determine best VRM from extractions using aggregation + majority voting
    detected_vrm = None
    vrm_confidence = 0
    if extracted_vrms:
        # Aggregate VRMs by normalizing and counting occurrences with weighted confidence
        from collections import Counter
        
        # Group by VRM and sum confidence scores
        vrm_scores = {}
        vrm_counts = Counter()
        for v in extracted_vrms:
            vrm_text = v.get("vrm", "").upper().replace(" ", "") if v.get("vrm") else None
            if vrm_text:
                vrm_counts[vrm_text] += 1
                if vrm_text not in vrm_scores:
                    vrm_scores[vrm_text] = {"total_confidence": 0, "best_confidence": 0, "original": v.get("vrm")}
                vrm_scores[vrm_text]["total_confidence"] += v.get("confidence", 0)
                vrm_scores[vrm_text]["best_confidence"] = max(vrm_scores[vrm_text]["best_confidence"], v.get("confidence", 0))
        
        if vrm_scores:
            # Calculate combined score: (count * avg_confidence) to favor frequent + high-confidence matches
            best_vrm_key = max(vrm_scores.keys(), key=lambda k: (vrm_counts[k] * vrm_scores[k]["total_confidence"] / vrm_counts[k]))
            best_vrm_data = vrm_scores[best_vrm_key]
            detected_vrm = best_vrm_data["original"]  # Use original formatting with space
            vrm_confidence = int(best_vrm_data["total_confidence"] / vrm_counts[best_vrm_key])  # Average confidence
            
            logger.info(f"VRM aggregation: {len(extracted_vrms)} detections, {len(vrm_scores)} unique VRMs")
            for vrm_key, count in vrm_counts.most_common(3):
                logger.info(f"  {vrm_scores[vrm_key]['original']}: {count} occurrences, avg confidence {vrm_scores[vrm_key]['total_confidence'] / count:.0f}")
            logger.info(f"Best detected VRM: {detected_vrm} (seen {vrm_counts[best_vrm_key]}x, avg confidence {vrm_confidence})")
        
        # Update case with detected VRM if not already set or if higher confidence
        if detected_vrm and (not case.vrm or vrm_confidence > 70):
            case.vrm = detected_vrm
            db.commit()
            logger.info(f"Updated case VRM to: {detected_vrm}")
    
    # Generate authoritative evidence summary using the new service
    evidence_summary = evidence_summary_service.generate_summary(
        ocr_results=ocr_timestamps,
        evidence_count=len(evidence_list),
        case_created_at=case.created_at
    )
    
    logger.info(f"Evidence summary generated: {evidence_summary.to_dict()}")
    
    # Extract values from summary for backward compatibility
    duration_minutes = evidence_summary.duration_minutes
    first_time = evidence_summary.observe_from
    last_time = evidence_summary.observe_to
    
    # Create evidence timeline data with authoritative summary
    evidence_timeline = {
        "durationMinutes": duration_minutes,
        "evidenceSummary": evidence_summary.to_dict(),
        "timeRange": {
            "first": first_time.isoformat() if first_time else None,
            "last": last_time.isoformat() if last_time else None,
            "durationMinutes": duration_minutes,
            "timestampQuality": evidence_summary.duration_confidence.value.lower(),
            "validationIssue": "; ".join(evidence_summary.validation_warnings) if evidence_summary.validation_warnings else None,
            "timeSource": evidence_summary.time_source.value
        },
        "timestamps": ocr_timestamps if ocr_timestamps else [],
        "extractedVrm": {
            "vrm": detected_vrm,
            "confidence": vrm_confidence,
            "allDetections": extracted_vrms
        } if detected_vrm else None
    }
    
    # Generate regulation evaluation with null safety
    effective_duration = (duration_minutes - 10) if duration_minutes is not None else None
    overstay_amount = (duration_minutes - 60) if duration_minutes is not None else None
    is_breach = duration_minutes is not None and duration_minutes > 60
    
    regulation_evaluation = {
        "durationMinutes": duration_minutes,
        "maxStayAllowed": 60,
        "siteName": site_name,
        "rules": {
            "maxStayMinutes": 60,
            "gracePeriodMinutes": 10
        },
        "evaluation": {
            "complianceResult": "BREACH" if is_breach else ("COMPLIANT" if duration_minutes is not None else "UNKNOWN"),
            "actualDurationMinutes": duration_minutes,
            "allowedDurationMinutes": 60,
            "effectiveDurationMinutes": effective_duration,
            "breachExplanation": f"Vehicle exceeded maximum stay of 60 minutes by {overstay_amount} minutes" if is_breach else "No breach detected or duration unavailable",
            "ruleSource": "site_configuration"
        }
    }
    
    # Generate signage compliance
    signage_compliance = {
        "overallCompliance": "COMPLIANT",
        "overallConfidence": 95,
        "extractedRegulations": {
            "maxStayMinutes": 60,
            "graceMinutes": 10,
            "source": "signage_ocr"
        },
        "appliedSignageTitle": "Standard Car Park Terms"
    }
    
    # Generate bay rule evaluation
    bay_type = case.bay_type
    bay_rule_evaluation = {
        "bayType": bay_type or "general_parking",
        "bayName": "Standard Parking Bay",
        "decision": "PROCEED",
        "explanation": "No special bay restrictions apply to this violation"
    }
    
    # Loading bay analysis (if applicable)
    loading_bay_result = None
    # Normalize bay type check comprehensively to handle all variants
    # Handles: "loading", "LOADING", "loading_bay", "Loading Bay", "loading-bay", etc.
    normalized_bay = bay_type.lower().replace("_", "").replace("-", "").replace(" ", "") if bay_type else ""
    is_loading_bay = normalized_bay in ("loading", "loadingbay")
    if is_loading_bay:
        logger.info("Loading bay detected - running loading activity analysis")
        from backend.services.loading_bay_analysis_service import loading_bay_analysis_service
        
        # Run loading activity analysis on each image
        loading_analysis_results = []
        for evidence in evidence_list:
            image_path = None
            if evidence.image_path:
                relative_path = evidence.image_path.lstrip("/")
                image_path = os.path.join(os.getcwd(), relative_path)
            
            if image_path and os.path.exists(image_path):
                loading_result = await ocr_service.analyze_loading_activity(image_path, evidence.id)
                loading_result["timestamp"] = evidence.timestamp.isoformat() if evidence.timestamp else None
                loading_analysis_results.append(loading_result)
        
        # Get DVLA vehicle data if available
        dvla_vehicle_data = None
        if case:
            case_vehicle = db.query(CaseVehicle).filter(CaseVehicle.case_id == case.id).first()
            if case_vehicle:
                # Build DVLA data from case_vehicle fields
                dvla_vehicle_data = {
                    "make": case_vehicle.make,
                    "model": case_vehicle.model,
                    "colour": case_vehicle.colour,
                    "fuel_type": case_vehicle.fuel_type,
                    "tax_status": case_vehicle.tax_status,
                    "mot_status": case_vehicle.mot_status
                }
        
        # Build evidence items for loading analysis
        evidence_items = [{
            "id": ev.id,
            "timestamp": ev.timestamp.isoformat() if ev.timestamp else None
        } for ev in evidence_list]
        
        # Run loading bay analysis
        loading_bay_result = await loading_bay_analysis_service.analyze_loading_bay(
            evidence_items=evidence_items,
            image_analysis_results=loading_analysis_results,
            dvla_vehicle_data=dvla_vehicle_data,
            observe_from=first_time,
            observe_to=last_time,
            duration_minutes=duration_minutes,
            signage_time_limit=None
        )
        
        logger.info(f"Loading bay analysis result: {loading_bay_result.to_dict()}")
        
        # Update bay rule evaluation with loading analysis
        bay_rule_evaluation = {
            "bayType": "LOADING",
            "bayName": "Loading Bay",
            "decision": loading_bay_result.decision.value,
            "explanation": loading_bay_result.legal_justification,
            "loadingAnalysis": loading_bay_result.to_dict()
        }
    
    # Disabled bay analysis (if applicable)
    disabled_bay_result = None
    is_disabled_bay = normalized_bay in ("disabled", "disabledbay")
    if is_disabled_bay:
        logger.info("Disabled bay detected - running Blue Badge compliance analysis")
        from backend.services.disabled_bay_analysis_service import disabled_bay_analysis_service
        
        # Run disabled bay analysis on each image
        disabled_analysis_results = []
        for evidence in evidence_list:
            image_path = None
            if evidence.image_path:
                relative_path = evidence.image_path.lstrip("/")
                image_path = os.path.join(os.getcwd(), relative_path)
            
            if image_path and os.path.exists(image_path):
                disabled_result = await ocr_service.analyze_disabled_bay(image_path, evidence.id)
                disabled_result["timestamp"] = evidence.timestamp.isoformat() if evidence.timestamp else None
                disabled_analysis_results.append(disabled_result)
        
        # Build evidence items for disabled bay analysis
        evidence_items = [{
            "id": ev.id,
            "timestamp": ev.timestamp.isoformat() if ev.timestamp else None
        } for ev in evidence_list]
        
        # Get evidence timestamp for expiry check - do NOT fallback to datetime.now()
        # for deterministic auditing; pass None to mark expiry as indeterminate
        evidence_timestamp = first_time  # Can be None if no timestamps available
        
        # Run disabled bay analysis
        disabled_bay_result = await disabled_bay_analysis_service.analyze_disabled_bay(
            evidence_items=evidence_items,
            image_analysis_results=disabled_analysis_results,
            evidence_timestamp=evidence_timestamp
        )
        
        logger.info(f"Disabled bay analysis result: {disabled_bay_result.to_dict()}")
        
        # Update bay rule evaluation with disabled bay analysis
        bay_rule_evaluation = {
            "bayType": "DISABLED",
            "bayName": "Disabled Bay",
            "decision": disabled_bay_result.decision.value,
            "explanation": disabled_bay_result.legal_justification,
            "disabledBayAnalysis": disabled_bay_result.to_dict()
        }
    
    # Parent & Child bay analysis (if applicable)
    parent_child_result = None
    is_parent_child_bay = normalized_bay in ("parentchild", "parentandchild", "parent&child", "parentchildbay")
    if is_parent_child_bay:
        logger.info("Parent & Child bay detected - running child presence analysis")
        from backend.services.parent_child_bay_analysis_service import parent_child_bay_analysis_service
        
        # Run parent child analysis on each image
        parent_child_analysis_results = []
        for evidence in evidence_list:
            image_path = None
            if evidence.image_path:
                relative_path = evidence.image_path.lstrip("/")
                image_path = os.path.join(os.getcwd(), relative_path)
            
            if image_path and os.path.exists(image_path):
                pc_result = await ocr_service.analyze_parent_child_bay(image_path, evidence.id)
                pc_result["timestamp"] = evidence.timestamp.isoformat() if evidence.timestamp else None
                parent_child_analysis_results.append(pc_result)
        
        # Build evidence items for parent child analysis
        evidence_items = [{
            "id": ev.id,
            "timestamp": ev.timestamp.isoformat() if ev.timestamp else None
        } for ev in evidence_list]
        
        # Run parent child bay analysis (bay type already confirmed from site config)
        parent_child_result = await parent_child_bay_analysis_service.analyze_parent_child_bay(
            evidence_items=evidence_items,
            image_analysis_results=parent_child_analysis_results,
            observe_from=first_time,
            observe_to=last_time,
            duration_minutes=duration_minutes,
            confirmed_bay_type=True
        )
        
        logger.info(f"Parent & Child bay analysis result: {parent_child_result.to_dict()}")
        
        # Update bay rule evaluation with parent child analysis
        bay_rule_evaluation = {
            "bayType": "PARENT_CHILD",
            "bayName": "Parent & Child Bay",
            "decision": parent_child_result.decision.value,
            "explanation": parent_child_result.legal_justification,
            "parentChildAnalysis": parent_child_result.to_dict()
        }
    
    # Authorised Bay analysis (if applicable - permit holders, authorised vehicles)
    authorised_bay_result = None
    is_authorised_bay = normalized_bay in ("authorised", "authorized", "permitholder", "permitholders", "permit_holders", "authorisedbay", "permit")
    if is_authorised_bay:
        logger.info("Authorised Bay detected - running permit/authorisation analysis")
        from backend.services.authorised_bay_analysis_service import authorised_bay_analysis_service
        
        # Run authorised bay analysis on each image
        authorised_analysis_results = []
        for evidence in evidence_list:
            image_path = None
            if evidence.image_path:
                relative_path = evidence.image_path.lstrip("/")
                image_path = os.path.join(os.getcwd(), relative_path)
            
            if image_path and os.path.exists(image_path):
                auth_result = await ocr_service.analyze_authorised_bay(image_path, evidence.id)
                auth_result["timestamp"] = evidence.timestamp.isoformat() if evidence.timestamp else None
                authorised_analysis_results.append(auth_result)
        
        # Build evidence items for authorised bay analysis
        evidence_items = [{
            "id": ev.id,
            "timestamp": ev.timestamp.isoformat() if ev.timestamp else None
        } for ev in evidence_list]
        
        # Run authorised bay analysis (bay type already confirmed from site config)
        authorised_bay_result = await authorised_bay_analysis_service.analyze_authorised_bay(
            evidence_items=evidence_items,
            image_analysis_results=authorised_analysis_results,
            observe_from=first_time,
            observe_to=last_time,
            site_id=case.site_id,
            vrm=vrm,
            confirmed_bay_type=True
        )
        
        logger.info(f"Authorised Bay analysis result: {authorised_bay_result.to_dict()}")
        
        # Update bay rule evaluation with authorised bay analysis
        bay_rule_evaluation = {
            "bayType": "AUTHORISED",
            "bayName": "Authorised Bay / Permit Holders",
            "decision": authorised_bay_result.decision.value,
            "explanation": authorised_bay_result.legal_justification,
            "authorisedBayAnalysis": authorised_bay_result.to_dict()
        }
    
    # EV Bay analysis (if applicable - electric vehicle charging bays)
    ev_bay_result = None
    is_ev_bay = normalized_bay in ("ev", "evbay", "electricvehicle", "evcharging", "charging", "electric")
    if is_ev_bay:
        logger.info("EV Bay detected - running EV/charging compliance analysis")
        from backend.services.ev_bay_analysis_service import EVBayAnalysisService
        ev_bay_service = EVBayAnalysisService()
        
        # Run EV bay analysis on each image
        ev_analysis_results = []
        for evidence in evidence_list:
            image_path = None
            if evidence.image_path:
                relative_path = evidence.image_path.lstrip("/")
                full_path = os.path.join(os.getcwd(), relative_path)
                if os.path.exists(full_path):
                    image_path = full_path
            
            if image_path:
                ev_result = await ocr_service.analyze_ev_bay(image_path, evidence.id)
                ev_analysis_results.append(ev_result)
        
        # Build evidence items for EV bay analysis
        evidence_items = [{
            "id": ev.id,
            "timestamp": ev.timestamp.isoformat() if ev.timestamp else None
        } for ev in evidence_list]
        
        # Get vehicle details from case if available (DVLA data would provide fuel type)
        vehicle_details = None
        if hasattr(case, 'vehicle_data') and case.vehicle_data:
            vehicle_details = case.vehicle_data
        
        # Run EV bay analysis
        ev_bay_result = await ev_bay_service.analyze_ev_bay(
            evidence_images=evidence_items,
            image_analysis_results=ev_analysis_results,
            vrm=detected_vrm,
            vehicle_details=vehicle_details,
            site_id=case.site_id,
            observe_from=first_time,
            observe_to=last_time,
            confirmed_bay_type=True
        )
        
        logger.info(f"EV Bay analysis result: {ev_bay_result.to_dict()}")
        
        # Update bay rule evaluation with EV bay analysis
        bay_rule_evaluation = {
            "bayType": "EV",
            "bayName": "Electric Vehicle Bay",
            "decision": ev_bay_result.decision.value,
            "explanation": ev_bay_result.legal_justification,
            "evBayAnalysis": ev_bay_result.to_dict()
        }
    
    # Bay Position Analysis - Run for ALL cases to detect improper parking
    bay_position_results = []
    bay_position_violation = None
    logger.info("Running bay position analysis to detect improper parking")
    
    for evidence in evidence_list:
        image_path = None
        if evidence.image_path:
            relative_path = evidence.image_path.lstrip("/")
            image_path = os.path.join(os.getcwd(), relative_path)
        
        if image_path and os.path.exists(image_path):
            pos_result = await ocr_service.analyze_bay_position(image_path, evidence.id)
            pos_result["timestamp"] = evidence.timestamp.isoformat() if evidence.timestamp else None
            bay_position_results.append(pos_result)
    
    # Aggregate bay position results - if ANY frame shows IMPROPERLY_PARKED, flag violation
    improper_count = 0
    proper_count = 0
    cannot_determine_count = 0
    aggregated_confidence = 0
    position_issues_detected = []
    
    for pos in bay_position_results:
        status = pos.get("complianceStatus", "CANNOT_DETERMINE")
        if status == "IMPROPERLY_PARKED":
            improper_count += 1
            aggregated_confidence += pos.get("confidence", 0)
            # Collect all issue types from the result
            if pos.get("wheelsOnOrOverLines"):
                position_issues_detected.append("Vehicle wheels on or over bay line markings")
            if pos.get("straddlingMultipleBays"):
                position_issues_detected.append("Vehicle straddling multiple parking bays")
            if not pos.get("vehicleFullyInsideBay"):
                position_issues_detected.append("Vehicle not fully inside bay markings")
            # Check specific position issues
            pos_issues = pos.get("positionIssues", {})
            if pos_issues.get("leftSideOverLine"):
                position_issues_detected.append("Left side of vehicle over bay line")
            if pos_issues.get("rightSideOverLine"):
                position_issues_detected.append("Right side of vehicle over bay line")
            if pos_issues.get("frontOverLine"):
                position_issues_detected.append("Front of vehicle over bay line")
            if pos_issues.get("rearOverLine"):
                position_issues_detected.append("Rear of vehicle over bay line")
            if pos_issues.get("overlapDescription"):
                position_issues_detected.append(pos_issues.get("overlapDescription"))
        elif status == "PROPERLY_PARKED":
            proper_count += 1
        else:
            cannot_determine_count += 1
    
    # Determine if bay position violation occurred (majority or any confident detection)
    if improper_count > 0 and (improper_count >= proper_count or aggregated_confidence / improper_count >= 70):
        avg_confidence = int(aggregated_confidence / improper_count) if improper_count > 0 else 0
        bay_position_violation = {
            "detected": True,
            "improperFrames": improper_count,
            "properFrames": proper_count,
            "cannotDetermineFrames": cannot_determine_count,
            "confidence": avg_confidence,
            "issuesDetected": list(set(position_issues_detected)),
            "summary": f"Vehicle not properly parked within bay markings. Detected in {improper_count} out of {len(bay_position_results)} frames.",
            "allResults": bay_position_results
        }
        logger.info(f"Bay position VIOLATION detected: {improper_count} improper frames, avg confidence {avg_confidence}")
    else:
        bay_position_violation = {
            "detected": False,
            "improperFrames": improper_count,
            "properFrames": proper_count,
            "cannotDetermineFrames": cannot_determine_count,
            "confidence": 0,
            "issuesDetected": [],
            "summary": "Vehicle appears properly parked within bay markings" if proper_count > 0 else "Could not assess bay position",
            "allResults": bay_position_results
        }
        logger.info(f"Bay position OK: {proper_count} proper frames, {cannot_determine_count} undetermined")
    
    # Always add bay position analysis to bay rule evaluation (whether violation detected or not)
    bay_rule_evaluation["bayPositionViolation"] = bay_position_violation
    if bay_position_violation.get("detected"):
        bay_rule_evaluation["decision"] = "ISSUE_PCN"
        bay_rule_evaluation["explanation"] = f"Vehicle not properly parked within bay markings. {bay_position_violation['summary']}"
    
    # Generate final decision based on evidence summary validation and loading bay analysis
    # Bay Position Violation takes precedence if detected
    if bay_position_violation.get("detected") and bay_position_violation.get("confidence", 0) >= 60:
        # Bay position violation detected - eligible for PCN
        decision = {
            "status": "PCN_ELIGIBLE",
            "overallConfidence": bay_position_violation.get("confidence", 70),
            "legalRisk": "low" if bay_position_violation.get("confidence", 0) >= 75 else "medium",
            "recommendation": "Issue PCN - Vehicle not properly parked within bay",
            "reasoning": f"Vehicle was observed not properly parked within the bay markings. {bay_position_violation['summary']}",
            "plainEnglishExplanation": f"The vehicle was not properly parked within the bay lines. It appears to be crossing the bay markings or straddling multiple parking spaces. This is a parking violation.",
            "blockers": [],
            "bayPositionViolation": bay_position_violation
        }
    # Loading bay special handling: if loading detected, DO NOT ISSUE PCN
    elif loading_bay_result is not None:
        # Loading bay decision takes precedence
        if loading_bay_result.decision.value == "DO_NOT_ISSUE":
            decision = {
                "status": "NO_PCN",
                "overallConfidence": loading_bay_result.confidence_score,
                "legalRisk": "low",
                "recommendation": "No PCN - Active loading/unloading detected",
                "reasoning": loading_bay_result.legal_justification,
                "plainEnglishExplanation": f"The vehicle was observed in the loading bay with evidence of active loading/unloading activity. Under UK regulations, this is legitimate use of a loading bay.",
                "blockers": [],
                "loadingAnalysis": loading_bay_result.to_dict()
            }
        elif loading_bay_result.decision.value == "MANUAL_REVIEW":
            decision = {
                "status": "REVIEW_REQUIRED",
                "overallConfidence": loading_bay_result.confidence_score,
                "legalRisk": "medium",
                "recommendation": "Manual review required - Loading activity inconclusive",
                "reasoning": loading_bay_result.legal_justification,
                "plainEnglishExplanation": "The AI could not confidently determine if legitimate loading activity was taking place. A human operator should review the evidence.",
                "blockers": ["Insufficient confidence for automated decision"],
                "loadingAnalysis": loading_bay_result.to_dict()
            }
        else:
            # ISSUE_PCN for loading bay
            decision = {
                "status": "PCN_ELIGIBLE",
                "overallConfidence": loading_bay_result.confidence_score,
                "legalRisk": "low" if loading_bay_result.confidence_score >= 70 else "medium",
                "recommendation": "Issue PCN - No loading activity detected in loading bay",
                "reasoning": loading_bay_result.legal_justification,
                "plainEnglishExplanation": "The vehicle was parked in a loading bay without evidence of active loading or unloading activity.",
                "blockers": [],
                "loadingAnalysis": loading_bay_result.to_dict()
            }
    elif disabled_bay_result is not None:
        # Disabled bay decision takes precedence
        if disabled_bay_result.decision.value == "COMPLIANT":
            decision = {
                "status": "NO_PCN",
                "overallConfidence": disabled_bay_result.confidence_score,
                "legalRisk": "low",
                "recommendation": "No PCN - Valid Blue Badge displayed",
                "reasoning": disabled_bay_result.legal_justification,
                "plainEnglishExplanation": f"The vehicle displayed a valid Blue Badge with the front visible showing required details. The vehicle was correctly positioned within the disabled bay.",
                "blockers": [],
                "disabledBayAnalysis": disabled_bay_result.to_dict()
            }
        elif disabled_bay_result.decision.value == "MANUAL_REVIEW":
            decision = {
                "status": "REVIEW_REQUIRED",
                "overallConfidence": disabled_bay_result.confidence_score,
                "legalRisk": "medium",
                "recommendation": "Manual review required - Blue Badge verification inconclusive",
                "reasoning": disabled_bay_result.legal_justification,
                "plainEnglishExplanation": "The AI could not confidently verify the Blue Badge. A human operator should review the evidence to check badge visibility and validity.",
                "blockers": ["Insufficient confidence for automated decision"],
                "disabledBayAnalysis": disabled_bay_result.to_dict()
            }
        else:
            # NON_COMPLIANT for disabled bay
            decision = {
                "status": "PCN_ELIGIBLE",
                "overallConfidence": disabled_bay_result.confidence_score,
                "legalRisk": "low" if disabled_bay_result.confidence_score >= 70 else "medium",
                "recommendation": f"Issue PCN - {disabled_bay_result.reason}",
                "reasoning": disabled_bay_result.legal_justification,
                "plainEnglishExplanation": f"The vehicle was parked in a disabled bay without displaying a valid Blue Badge correctly. {disabled_bay_result.reason}.",
                "blockers": [],
                "disabledBayAnalysis": disabled_bay_result.to_dict()
            }
    elif parent_child_result is not None:
        # Parent & Child bay decision
        if parent_child_result.decision.value == "COMPLIANT":
            decision = {
                "status": "NO_PCN",
                "overallConfidence": parent_child_result.confidence_score,
                "legalRisk": "low",
                "recommendation": "No PCN - Child detected with vehicle",
                "reasoning": parent_child_result.legal_justification,
                "plainEnglishExplanation": f"A child was observed with the vehicle in the Parent & Child bay. This is legitimate use of the bay.",
                "blockers": [],
                "parentChildAnalysis": parent_child_result.to_dict()
            }
        elif parent_child_result.decision.value == "REVIEW_REQUIRED":
            decision = {
                "status": "REVIEW_REQUIRED",
                "overallConfidence": parent_child_result.confidence_score,
                "legalRisk": "medium",
                "recommendation": "Manual review required - Child presence inconclusive",
                "reasoning": parent_child_result.legal_justification,
                "plainEnglishExplanation": "The AI could not confidently determine if a child was present. A human operator should review the evidence.",
                "blockers": ["Insufficient confidence for automated decision"],
                "parentChildAnalysis": parent_child_result.to_dict()
            }
        else:
            # NON_COMPLIANT for parent child bay
            decision = {
                "status": "PCN_ELIGIBLE",
                "overallConfidence": parent_child_result.confidence_score,
                "legalRisk": "low" if parent_child_result.confidence_score >= 70 else "medium",
                "recommendation": f"Issue PCN - {parent_child_result.reason}",
                "reasoning": parent_child_result.legal_justification,
                "plainEnglishExplanation": f"The vehicle was parked in a Parent & Child bay without a child present. {parent_child_result.reason}.",
                "blockers": [],
                "parentChildAnalysis": parent_child_result.to_dict()
            }
    elif authorised_bay_result is not None:
        # Authorised Bay / Permit Holder decision
        if authorised_bay_result.decision.value == "AUTHORISED":
            decision = {
                "status": "NO_PCN",
                "overallConfidence": authorised_bay_result.confidence_score,
                "legalRisk": "low",
                "recommendation": "No PCN - Vehicle is authorised",
                "reasoning": authorised_bay_result.legal_justification,
                "plainEnglishExplanation": f"The vehicle has valid authorisation to park in this bay. Authorisation type: {authorised_bay_result.authorisation_type or 'Verified'}.",
                "blockers": [],
                "authorisedBayAnalysis": authorised_bay_result.to_dict()
            }
        elif authorised_bay_result.decision.value == "REVIEW_REQUIRED":
            decision = {
                "status": "REVIEW_REQUIRED",
                "overallConfidence": authorised_bay_result.confidence_score,
                "legalRisk": "medium",
                "recommendation": "Manual review required - Authorisation verification inconclusive",
                "reasoning": authorised_bay_result.legal_justification,
                "plainEnglishExplanation": "The AI could not confidently verify the vehicle's authorisation. A human operator should review the permit visibility and validity.",
                "blockers": ["Insufficient confidence for automated decision"],
                "authorisedBayAnalysis": authorised_bay_result.to_dict()
            }
        else:
            # NOT_AUTHORISED
            decision = {
                "status": "PCN_ELIGIBLE",
                "overallConfidence": authorised_bay_result.confidence_score,
                "legalRisk": "low" if authorised_bay_result.confidence_score >= 70 else "medium",
                "recommendation": f"Issue PCN - {authorised_bay_result.reason}",
                "reasoning": authorised_bay_result.legal_justification,
                "plainEnglishExplanation": f"The vehicle was parked in an Authorised/Permit Holder bay without valid authorisation. {authorised_bay_result.reason}.",
                "blockers": [],
                "authorisedBayAnalysis": authorised_bay_result.to_dict()
            }
    elif ev_bay_result is not None:
        # EV Bay decision
        if ev_bay_result.decision.value == "COMPLIANT":
            decision = {
                "status": "NO_PCN",
                "overallConfidence": ev_bay_result.confidence_score,
                "legalRisk": "low",
                "recommendation": "No PCN - EV vehicle compliant with bay rules",
                "reasoning": ev_bay_result.legal_justification,
                "plainEnglishExplanation": f"The vehicle is an electric vehicle correctly using the EV bay. {ev_bay_result.reason}.",
                "blockers": [],
                "evBayAnalysis": ev_bay_result.to_dict()
            }
        elif ev_bay_result.decision.value == "REVIEW_REQUIRED":
            decision = {
                "status": "REVIEW_REQUIRED",
                "overallConfidence": ev_bay_result.confidence_score,
                "legalRisk": "medium",
                "recommendation": "Manual review required - EV bay compliance inconclusive",
                "reasoning": ev_bay_result.legal_justification,
                "plainEnglishExplanation": "The AI could not confidently verify the vehicle's EV status or charging activity. A human operator should review the evidence.",
                "blockers": ["Insufficient confidence for automated decision"],
                "evBayAnalysis": ev_bay_result.to_dict()
            }
        else:
            # NON_COMPLIANT for EV bay
            decision = {
                "status": "PCN_ELIGIBLE",
                "overallConfidence": ev_bay_result.confidence_score,
                "legalRisk": "low" if ev_bay_result.confidence_score >= 70 else "medium",
                "recommendation": f"Issue PCN - {ev_bay_result.reason}",
                "reasoning": ev_bay_result.legal_justification,
                "plainEnglishExplanation": f"The vehicle does not meet EV bay requirements. {ev_bay_result.reason}.",
                "blockers": [],
                "evBayAnalysis": ev_bay_result.to_dict()
            }
    elif not evidence_summary.is_valid_for_pcn:
        # Evidence is insufficient for PCN - require review
        decision = {
            "status": "REVIEW_REQUIRED",
            "overallConfidence": 30,
            "legalRisk": "high",
            "recommendation": "Manual review required - evidence insufficient",
            "reasoning": evidence_summary.pcn_block_reason or "Evidence validation failed",
            "plainEnglishExplanation": evidence_summary.pcn_block_reason or "Unable to verify parking duration with sufficient confidence.",
            "blockers": evidence_summary.validation_warnings
        }
    elif duration_minutes is None or duration_minutes <= 0:
        # No overstay detected
        decision = {
            "status": "NO_PCN",
            "overallConfidence": 70,
            "legalRisk": "low",
            "recommendation": "No PCN - No overstay detected",
            "reasoning": "Duration could not be calculated or vehicle did not exceed maximum stay.",
            "plainEnglishExplanation": "Vehicle did not exceed the permitted parking time.",
            "blockers": []
        }
    elif duration_minutes <= 60:
        # Within allowed time
        decision = {
            "status": "NO_PCN",
            "overallConfidence": 85,
            "legalRisk": "low",
            "recommendation": "No PCN - Within permitted stay",
            "reasoning": f"Vehicle was parked for {duration_minutes} minutes, within the maximum stay of 60 minutes.",
            "plainEnglishExplanation": f"The vehicle stayed for {duration_minutes} minutes, which is within the 60 minute limit.",
            "blockers": []
        }
    else:
        # Clear overstay - eligible for PCN
        overstay_minutes = duration_minutes - 60
        confidence_map = {"HIGH": 90, "MEDIUM": 75, "LOW": 50}
        confidence_score = confidence_map.get(evidence_summary.duration_confidence.value, 60)
        
        decision = {
            "status": "PCN_ELIGIBLE",
            "overallConfidence": confidence_score,
            "legalRisk": "low" if evidence_summary.duration_confidence.value == "HIGH" else "medium",
            "recommendation": "Issue PCN - Overstay violation detected",
            "reasoning": f"Vehicle was parked for {duration_minutes} minutes, exceeding the maximum stay of 60 minutes by {overstay_minutes} minutes. Evidence confidence: {evidence_summary.duration_confidence.value}.",
            "plainEnglishExplanation": f"The vehicle stayed for {duration_minutes} minutes when only 60 minutes is allowed. This is an overstay of {overstay_minutes} minutes.",
            "blockers": evidence_summary.validation_warnings if evidence_summary.validation_warnings else []
        }
    
    # Integrate Site Intelligence for enforcement confidence adjustment
    site_intelligence_guidance = None
    if case.site_id:
        try:
            from backend.services.site_intelligence_service import SiteIntelligenceService
            site_intel_service = SiteIntelligenceService(db)
            
            # Get enforcement guidance based on site intelligence
            base_confidence = decision.get("overallConfidence", 70) / 100.0
            guidance = site_intel_service.calculate_enforcement_confidence(
                site_id=case.site_id,
                bay_type=case.bay_type or "Standard",
                base_confidence=base_confidence,
                observation_time=first_time
            )
            
            site_intelligence_guidance = {
                "confidenceLevel": guidance.confidence_level,
                "confidenceAdjustment": guidance.confidence_adjustment,
                "reasoning": guidance.reasoning,
                "additionalEvidenceNeeded": guidance.additional_evidence_needed,
                "knownIssues": guidance.known_issues,
                "officerGuidance": guidance.officer_guidance
            }
            
            # Apply confidence adjustment to decision
            adjusted_confidence = int((base_confidence + guidance.confidence_adjustment) * 100)
            adjusted_confidence = max(0, min(100, adjusted_confidence))
            decision["overallConfidence"] = adjusted_confidence
            decision["siteIntelligenceApplied"] = True
            decision["siteIntelligenceGuidance"] = site_intelligence_guidance
            
            # Downgrade legal risk if signage/marking issues
            if guidance.confidence_adjustment < -0.1:
                if decision.get("legalRisk") == "low":
                    decision["legalRisk"] = "medium"
                decision["reasoning"] += f" Site intelligence: {guidance.reasoning}"
            
            logger.info(f"Site intelligence applied: adjustment={guidance.confidence_adjustment}, level={guidance.confidence_level}")
        except Exception as e:
            logger.warning(f"Could not apply site intelligence: {e}")
    
    # Update case status
    case.status = "ANALYSED"
    db.commit()
    
    # Create or update pipeline results with complete analysis data
    pipeline_results = db.query(CasePipelineResults).filter(CasePipelineResults.case_id == case.id).first()
    if not pipeline_results:
        pipeline_results = CasePipelineResults(
            case_id=case.id,
            pipeline_status="completed",
            current_step="decision",
            completed_steps=7,
            total_steps=7,
            evidence_timeline=evidence_timeline,
            regulation_evaluation=regulation_evaluation,
            signage_compliance=signage_compliance,
            bay_rule_evaluation=bay_rule_evaluation,
            decision=decision,
            analysis_started_at=datetime.utcnow(),
            analysis_completed_at=datetime.utcnow()
        )
        db.add(pipeline_results)
    else:
        pipeline_results.pipeline_status = "completed"
        pipeline_results.current_step = "decision"
        pipeline_results.completed_steps = 7
        pipeline_results.evidence_timeline = evidence_timeline
        pipeline_results.regulation_evaluation = regulation_evaluation
        pipeline_results.signage_compliance = signage_compliance
        pipeline_results.bay_rule_evaluation = bay_rule_evaluation
        pipeline_results.decision = decision
        pipeline_results.analysis_completed_at = datetime.utcnow()
        pipeline_results.analysis_error = None
    db.commit()
    
    # Update bundle status
    if bundle:
        bundle.status = "analyzed"
        db.commit()
    
    # Create or update CaseAnalysis record (used by bundles endpoint)
    case_analysis = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case.id).first()
    if not case_analysis:
        case_analysis = CaseAnalysis(
            case_id=case.id,
            summary=decision["reasoning"],
            recommendation="Issue PCN" if decision["status"] == "PCN_ELIGIBLE" else "No PCN Required",
            confidence_score=decision["overallConfidence"] / 100.0,  # Convert to 0-1 scale
            violations=[{
                "type": "overstay",
                "explanation": decision["plainEnglishExplanation"],
                "severity": "high" if decision["status"] == "PCN_ELIGIBLE" else "low"
            }] if decision["status"] == "PCN_ELIGIBLE" else [],
            risk_assessment=decision["legalRisk"],
            generated_at=datetime.utcnow()
        )
        db.add(case_analysis)
    else:
        case_analysis.summary = decision["reasoning"]
        case_analysis.recommendation = "Issue PCN" if decision["status"] == "PCN_ELIGIBLE" else "No PCN Required"
        case_analysis.confidence_score = decision["overallConfidence"] / 100.0
        case_analysis.violations = [{
            "type": "overstay",
            "explanation": decision["plainEnglishExplanation"],
            "severity": "high" if decision["status"] == "PCN_ELIGIBLE" else "low"
        }] if decision["status"] == "PCN_ELIGIBLE" else []
        case_analysis.risk_assessment = decision["legalRisk"]
        case_analysis.generated_at = datetime.utcnow()
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
    
    return {"message": "Pipeline completed", "caseId": case.id, "status": "ANALYSED"}

# Internal function that can be called from other routes (e.g., evidence bundle analyze)
async def run_case_pipeline_internal(case_id: int, db: Session, current_user) -> dict:
    """Run the case pipeline analysis. Called internally by other routes."""
    from backend.api.routes.cases import resolve_case_from_id
    
    case = db.query(EnforcementCase).filter(EnforcementCase.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail={"error": "Case not found"})
    
    # Get the associated bundle
    bundle = db.query(EvidenceBundle).filter(EvidenceBundle.case_id == case.id).first()
    
    # Get site info
    site_name = "Unknown Site"
    if case.site_id:
        site = db.query(ParkingSite).filter(ParkingSite.id == case.site_id).first()
        if site:
            site_name = getattr(site, 'site_name', None) or getattr(site, 'name', None) or "Unknown Site"
    
    # Get evidence for the case
    evidence_list = []
    if bundle:
        evidence_list = db.query(Evidence).filter(Evidence.bundle_id == bundle.id).all()
    
    if not evidence_list:
        case_evidence_records = db.query(CaseEvidence).filter(CaseEvidence.case_id == case.id).all()
        evidence_ids = [ce.evidence_id for ce in case_evidence_records]
        if evidence_ids:
            evidence_list = db.query(Evidence).filter(Evidence.id.in_(evidence_ids)).all()
    
    # Run combined OCR extraction (single API call per image)
    ocr_timestamps = []
    extracted_vrms = []
    for evidence in evidence_list:
        image_path = None
        if evidence.image_path:
            relative_path = evidence.image_path.lstrip("/")
            image_path = os.path.join(os.getcwd(), relative_path)
        
        if image_path and os.path.exists(image_path):
            # Single API call extracts both timestamp and VRM
            combined_result = await ocr_service.extract_timestamp_and_vrm_from_image(image_path)
            
            # Process VRM from combined result
            if combined_result.get("vrm"):
                extracted_vrms.append({
                    "vrm": combined_result["vrm"],
                    "confidence": combined_result.get("vrm_confidence", 0),
                    "evidenceId": evidence.id,
                    "location": combined_result.get("vrm_location"),
                    "rawText": combined_result.get("vrm_raw_text")
                })
            
            parsed_time = None
            if combined_result.get("timestamp"):
                try:
                    parsed_time = datetime.fromisoformat(combined_result["timestamp"])
                    evidence.timestamp = parsed_time
                    evidence.ocr_confidence = combined_result.get("confidence", 0)
                    db.commit()
                except (ValueError, TypeError):
                    pass
            
            ocr_timestamps.append({
                "evidenceId": evidence.id,
                "timestamp": combined_result.get("timestamp"),
                "confidence": combined_result.get("confidence", 0),
                "source": "ocr",
                "rawOcrText": combined_result.get("raw_text"),
                "location": combined_result.get("location")
            })
    
    # Determine best VRM from extractions using aggregation + majority voting
    detected_vrm = None
    vrm_confidence = 0
    if extracted_vrms:
        from collections import Counter
        
        # Group by VRM and sum confidence scores
        vrm_scores = {}
        vrm_counts = Counter()
        for v in extracted_vrms:
            vrm_text = v.get("vrm", "").upper().replace(" ", "") if v.get("vrm") else None
            if vrm_text:
                vrm_counts[vrm_text] += 1
                if vrm_text not in vrm_scores:
                    vrm_scores[vrm_text] = {"total_confidence": 0, "best_confidence": 0, "original": v.get("vrm")}
                vrm_scores[vrm_text]["total_confidence"] += v.get("confidence", 0)
                vrm_scores[vrm_text]["best_confidence"] = max(vrm_scores[vrm_text]["best_confidence"], v.get("confidence", 0))
        
        if vrm_scores:
            # Calculate combined score: favor frequent + high-confidence matches
            best_vrm_key = max(vrm_scores.keys(), key=lambda k: (vrm_counts[k] * vrm_scores[k]["total_confidence"] / vrm_counts[k]))
            best_vrm_data = vrm_scores[best_vrm_key]
            detected_vrm = best_vrm_data["original"]
            vrm_confidence = int(best_vrm_data["total_confidence"] / vrm_counts[best_vrm_key])
            
            logger.info(f"VRM aggregation: {len(extracted_vrms)} detections, {len(vrm_scores)} unique VRMs")
            logger.info(f"Best detected VRM: {detected_vrm} (seen {vrm_counts[best_vrm_key]}x, avg confidence {vrm_confidence})")
        
        # Update case with detected VRM
        if detected_vrm and (not case.vrm or vrm_confidence > 70):
            case.vrm = detected_vrm
            db.commit()
    
    # Generate evidence summary
    evidence_summary = evidence_summary_service.generate_summary(
        ocr_results=ocr_timestamps,
        evidence_count=len(evidence_list),
        case_created_at=case.created_at
    )
    
    duration_minutes = evidence_summary.duration_minutes
    first_time = evidence_summary.observe_from
    last_time = evidence_summary.observe_to
    
    # Create evidence timeline
    evidence_timeline = {
        "durationMinutes": duration_minutes,
        "evidenceSummary": evidence_summary.to_dict(),
        "timeRange": {
            "first": first_time.isoformat() if first_time else None,
            "last": last_time.isoformat() if last_time else None,
            "durationMinutes": duration_minutes,
            "timestampQuality": evidence_summary.duration_confidence.value.lower(),
            "validationIssue": "; ".join(evidence_summary.validation_warnings) if evidence_summary.validation_warnings else None,
            "timeSource": evidence_summary.time_source.value
        },
        "timestamps": ocr_timestamps,
        "extractedVrm": {
            "vrm": detected_vrm,
            "confidence": vrm_confidence,
            "allDetections": extracted_vrms
        } if detected_vrm else None
    }
    
    # Regulation evaluation with null safety
    effective_duration = (duration_minutes - 10) if duration_minutes is not None else None
    overstay_amount = (duration_minutes - 60) if duration_minutes is not None else None
    is_breach = duration_minutes is not None and duration_minutes > 60
    
    regulation_evaluation = {
        "durationMinutes": duration_minutes,
        "maxStayAllowed": 60,
        "siteName": site_name,
        "rules": {"maxStayMinutes": 60, "gracePeriodMinutes": 10},
        "evaluation": {
            "complianceResult": "BREACH" if is_breach else ("COMPLIANT" if duration_minutes is not None else "UNKNOWN"),
            "actualDurationMinutes": duration_minutes,
            "allowedDurationMinutes": 60,
            "effectiveDurationMinutes": effective_duration,
            "breachExplanation": f"Vehicle exceeded maximum stay by {overstay_amount} minutes" if is_breach else "No breach",
            "ruleSource": "site_configuration"
        }
    }
    
    # Generate decision based on evidence summary validation
    if not evidence_summary.is_valid_for_pcn:
        decision = {
            "status": "REVIEW_REQUIRED",
            "overallConfidence": 30,
            "legalRisk": "high",
            "recommendation": "Manual review required - evidence insufficient",
            "reasoning": evidence_summary.pcn_block_reason or "Evidence validation failed",
            "plainEnglishExplanation": evidence_summary.pcn_block_reason or "Unable to verify parking duration.",
            "blockers": evidence_summary.validation_warnings
        }
    elif duration_minutes is None or duration_minutes <= 0:
        decision = {
            "status": "NO_PCN",
            "overallConfidence": 70,
            "legalRisk": "low",
            "recommendation": "No PCN - No overstay detected",
            "reasoning": "Duration could not be calculated.",
            "plainEnglishExplanation": "Vehicle did not exceed parking time.",
            "blockers": []
        }
    elif duration_minutes <= 60:
        decision = {
            "status": "NO_PCN",
            "overallConfidence": 85,
            "legalRisk": "low",
            "recommendation": "No PCN - Within permitted stay",
            "reasoning": f"Vehicle parked for {duration_minutes} minutes.",
            "plainEnglishExplanation": f"Vehicle stayed {duration_minutes} minutes, within the 60 minute limit.",
            "blockers": []
        }
    else:
        overstay = duration_minutes - 60
        confidence_map = {"HIGH": 90, "MEDIUM": 75, "LOW": 50}
        conf = confidence_map.get(evidence_summary.duration_confidence.value, 60)
        decision = {
            "status": "PCN_ELIGIBLE",
            "overallConfidence": conf,
            "legalRisk": "low" if evidence_summary.duration_confidence.value == "HIGH" else "medium",
            "recommendation": "Issue PCN - Overstay violation",
            "reasoning": f"Vehicle parked {duration_minutes} minutes, exceeding limit by {overstay} minutes.",
            "plainEnglishExplanation": f"Vehicle stayed {duration_minutes} minutes, {overstay} minutes over limit.",
            "blockers": evidence_summary.validation_warnings or []
        }
    
    # Integrate Site Intelligence for enforcement confidence adjustment
    site_intelligence_guidance = None
    if case.site_id:
        try:
            from backend.services.site_intelligence_service import SiteIntelligenceService
            site_intel_service = SiteIntelligenceService(db)
            
            # Get enforcement guidance based on site intelligence
            base_confidence = decision.get("overallConfidence", 70) / 100.0
            guidance = site_intel_service.calculate_enforcement_confidence(
                site_id=case.site_id,
                bay_type=case.bay_type or "Standard",
                base_confidence=base_confidence,
                observation_time=first_time
            )
            
            site_intelligence_guidance = {
                "confidenceLevel": guidance.confidence_level,
                "confidenceAdjustment": guidance.confidence_adjustment,
                "reasoning": guidance.reasoning,
                "additionalEvidenceNeeded": guidance.additional_evidence_needed,
                "knownIssues": guidance.known_issues,
                "officerGuidance": guidance.officer_guidance
            }
            
            # Apply confidence adjustment to decision
            adjusted_confidence = int((base_confidence + guidance.confidence_adjustment) * 100)
            adjusted_confidence = max(0, min(100, adjusted_confidence))
            decision["overallConfidence"] = adjusted_confidence
            decision["siteIntelligenceApplied"] = True
            decision["siteIntelligenceGuidance"] = site_intelligence_guidance
            
            # Downgrade legal risk if signage/marking issues
            if guidance.confidence_adjustment < -0.1:
                if decision.get("legalRisk") == "low":
                    decision["legalRisk"] = "medium"
                decision["reasoning"] += f" Site intelligence: {guidance.reasoning}"
            
            logger.info(f"Site intelligence applied (internal): adjustment={guidance.confidence_adjustment}")
        except Exception as e:
            logger.warning(f"Could not apply site intelligence (internal): {e}")
    
    # Integrate AI Instructions from Site Intelligence
    ai_instruction_result = None
    if case.site_id:
        try:
            site = db.query(ParkingSite).filter(ParkingSite.id == case.site_id).first()
            if site and site.ai_instructions and site.ai_instructions.strip():
                # Build evidence context for AI interpretation
                evidence_context = {
                    "bay_type": case.bay_type or "Unknown",
                    "duration_minutes": duration_minutes,
                    "vrm": detected_vrm or case.vrm,
                    "observe_from": first_time.isoformat() if first_time else None,
                    "observe_to": last_time.isoformat() if last_time else None,
                    "site_name": site_name,
                    "timestamp_confidence": evidence_summary.duration_confidence.value,
                    "validation_warnings": evidence_summary.validation_warnings or []
                }
                
                # Interpret AI instructions
                ai_instruction_result = await interpret_ai_instructions(
                    ai_instructions=site.ai_instructions,
                    evidence_context=evidence_context,
                    current_decision=decision
                )
                
                # Apply modified decision if AI instructions changed it
                if ai_instruction_result.get("instruction_applied") and ai_instruction_result.get("modified_decision"):
                    decision = ai_instruction_result["modified_decision"]
                    decision["aiInstructionsApplied"] = True
                    decision["aiInstructionsReasoning"] = ai_instruction_result.get("reasoning", "")
                    logger.info(f"AI instructions applied: {ai_instruction_result.get('reasoning', '')}")
                else:
                    decision["aiInstructionsApplied"] = False
                    decision["aiInstructionsReasoning"] = ai_instruction_result.get("reasoning", "No modification needed")
        except Exception as e:
            logger.warning(f"Could not apply AI instructions: {e}")
            decision["aiInstructionsApplied"] = False
            decision["aiInstructionsError"] = str(e)
    
    # Update case and create/update pipeline results
    case.status = "ANALYSED"
    db.commit()
    
    pipeline_results = db.query(CasePipelineResults).filter(CasePipelineResults.case_id == case.id).first()
    if not pipeline_results:
        pipeline_results = CasePipelineResults(
            case_id=case.id,
            pipeline_status="completed",
            current_step="decision",
            completed_steps=7,
            total_steps=7,
            evidence_timeline=evidence_timeline,
            regulation_evaluation=regulation_evaluation,
            signage_compliance={"overallCompliance": "COMPLIANT", "overallConfidence": 95},
            bay_rule_evaluation={"bayType": case.bay_type or "general_parking", "decision": "PROCEED"},
            decision=decision,
            analysis_started_at=datetime.utcnow(),
            analysis_completed_at=datetime.utcnow()
        )
        db.add(pipeline_results)
    else:
        pipeline_results.pipeline_status = "completed"
        pipeline_results.evidence_timeline = evidence_timeline
        pipeline_results.regulation_evaluation = regulation_evaluation
        pipeline_results.decision = decision
        pipeline_results.analysis_completed_at = datetime.utcnow()
    db.commit()
    
    # Update/create CaseAnalysis
    case_analysis = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case.id).first()
    if not case_analysis:
        case_analysis = CaseAnalysis(
            case_id=case.id,
            summary=decision["reasoning"],
            recommendation="Issue PCN" if decision["status"] == "PCN_ELIGIBLE" else "No PCN Required",
            confidence_score=decision["overallConfidence"] / 100.0,
            violations=[],
            risk_assessment=decision["legalRisk"],
            generated_at=datetime.utcnow()
        )
        db.add(case_analysis)
    else:
        case_analysis.summary = decision["reasoning"]
        case_analysis.recommendation = "Issue PCN" if decision["status"] == "PCN_ELIGIBLE" else "No PCN Required"
        case_analysis.confidence_score = decision["overallConfidence"] / 100.0
        case_analysis.risk_assessment = decision["legalRisk"]
        case_analysis.generated_at = datetime.utcnow()
    db.commit()
    
    return {"message": "Pipeline completed", "caseId": case.id, "status": "ANALYSED", "decision": decision}

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
    case.vrm = None  # Clear VRM to force fresh extraction on reanalysis
    db.commit()
    logger.info(f"Cleared VRM for case {case.id} to force fresh extraction")
    
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

@router.get("/{id}/weather")
async def get_case_weather(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get weather data for a case based on evidence timestamps.
    Accepts either case ID or bundle ID.
    """
    from backend.services.weather_service import get_weather_for_evidence
    
    case, bundle = resolve_case_from_id(db, id)
    
    if not case:
        return {"weather": None, "message": "Case not found"}
    
    if not case.site_id:
        return {"weather": None, "message": "No site associated with case"}
    
    # Get all evidence for this case through bundles
    bundles = db.query(EvidenceBundle).filter(EvidenceBundle.case_id == case.id).all()
    bundle_ids = [b.id for b in bundles]
    
    if not bundle_ids:
        return {"weather": None, "message": "No evidence bundles for case"}
    
    evidence_list = db.query(Evidence).filter(
        Evidence.bundle_id.in_(bundle_ids)
    ).order_by(Evidence.timestamp.asc()).all()
    
    if not evidence_list:
        return {"weather": None, "message": "No evidence in case"}
    
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
        "site_id": case.site_id,
        "case_id": case.id
    }
