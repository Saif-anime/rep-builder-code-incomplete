"""
Parent & Child Bay Analysis Service

Implements 7-phase UK-compliant verification for Parent & Child parking bays.
Determines whether a PCN should be issued based on child presence detection.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class ParentChildDecision(Enum):
    COMPLIANT = "COMPLIANT"
    NON_COMPLIANT = "NON-COMPLIANT"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


class ParentChildAction(Enum):
    DO_NOT_ISSUE = "DO NOT ISSUE"
    ISSUE_PCN = "ISSUE PCN"


class ParentChildConfidence(Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass
class BayConfirmationDetails:
    is_parent_child_bay: bool = False
    ground_markings_visible: bool = False
    signage_visible: bool = False
    child_symbol_visible: bool = False
    buggy_symbol_visible: bool = False
    confidence: int = 0


@dataclass
class VehiclePositionDetails:
    fully_inside_bay: bool = False
    overlap_detected: bool = False
    overlap_type: Optional[str] = None
    confidence: int = 0


@dataclass
class ChildDetectionDetails:
    child_detected: bool = False
    child_exiting_vehicle: bool = False
    child_entering_vehicle: bool = False
    child_near_vehicle: bool = False
    pram_with_child: bool = False
    pram_only: bool = False
    child_seat_only: bool = False
    adult_count: int = 0
    child_count: int = 0
    confidence: int = 0


@dataclass
class ParentChildAnalysisResult:
    bay_type: str
    decision: ParentChildDecision
    action: ParentChildAction
    confidence: ParentChildConfidence
    confidence_score: int
    reason: str
    
    bay_confirmation: Dict[str, Any]
    vehicle_position: Dict[str, Any]
    child_detection: Dict[str, Any]
    
    child_detected: bool
    vehicle_position_valid: bool
    observation_duration_minutes: Optional[float]
    
    manual_review_required: bool
    legal_justification: str
    evidence_summary: List[Dict[str, Any]]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "bayType": "ParentChild",
            "childDetected": self.child_detected,
            "vehiclePositionValid": self.vehicle_position_valid,
            "observationDurationMinutes": self.observation_duration_minutes,
            "decision": self.decision.value,
            "action": self.action.value,
            "confidence": self.confidence.value,
            "confidenceScore": self.confidence_score,
            "reason": self.reason,
            "bayConfirmation": self.bay_confirmation,
            "vehiclePosition": self.vehicle_position,
            "childDetection": self.child_detection,
            "manualReviewRequired": self.manual_review_required,
            "legalJustification": self.legal_justification,
            "evidenceSummary": self.evidence_summary
        }


class ParentChildBayAnalysisService:
    """
    Analyzes evidence for Parent & Child bay violations with UK compliance.
    
    A vehicle parked in a P&C bay is COMPLIANT if:
    - Bay is confirmed as P&C bay
    - Vehicle is fully within bay boundaries
    - A child is detected (exiting/entering/near vehicle or with pram)
    - Sufficient observation time exists
    """
    
    MIN_OBSERVATION_MINUTES = 2.0
    MIN_AUTO_DECISION_CONFIDENCE = 70
    
    async def analyze_parent_child_bay(
        self,
        evidence_items: List[Dict[str, Any]],
        image_analysis_results: List[Dict[str, Any]],
        observe_from: Optional[datetime] = None,
        observe_to: Optional[datetime] = None,
        duration_minutes: Optional[float] = None,
        confirmed_bay_type: bool = False
    ) -> ParentChildAnalysisResult:
        """
        Perform complete 7-phase Parent & Child bay analysis.
        
        Args:
            confirmed_bay_type: If True, bay is already confirmed as P&C from site config,
                               so visual confirmation is informational only.
        """
        logger.info(f"Starting Parent & Child bay analysis with {len(evidence_items)} evidence items")
        
        if not image_analysis_results:
            return self._build_insufficient_evidence_result()
        
        # Phase 1: Confirm Bay Type (informational if already confirmed)
        bay_confirmation = self._confirm_bay_type(image_analysis_results)
        logger.info(f"Phase 1 - Bay confirmation: is_pc={bay_confirmation.is_parent_child_bay}, pre_confirmed={confirmed_bay_type}")
        
        # If bay type was pre-confirmed by the case pipeline, proceed even without visual markers
        if confirmed_bay_type:
            bay_confirmation.is_parent_child_bay = True
        
        if not bay_confirmation.is_parent_child_bay:
            return self._build_unclear_bay_result(bay_confirmation)
        
        # Phase 2: Vehicle Position Check
        vehicle_position = self._check_vehicle_position(image_analysis_results)
        logger.info(f"Phase 2 - Vehicle position: inside_bay={vehicle_position.fully_inside_bay}")
        
        # Phase 3: Child Presence Detection (CRITICAL)
        child_detection = self._detect_child_presence(image_analysis_results)
        logger.info(f"Phase 3 - Child detection: detected={child_detection.child_detected}, count={child_detection.child_count}")
        
        # Phase 4: Observation Window Check
        observation_ok, obs_duration = self._check_observation_window(
            observe_from, observe_to, duration_minutes
        )
        logger.info(f"Phase 4 - Observation: ok={observation_ok}, duration={obs_duration}min")
        
        # Phase 5: Blue Badge check (ignored unless site allows)
        # Blue Badge does NOT override P&C rules by default
        
        # Phase 6 & 7: Final Decision and Output
        decision, action, confidence, confidence_score, reason, justification, needs_review = self._make_decision(
            bay_confirmation,
            vehicle_position,
            child_detection,
            observation_ok,
            obs_duration
        )
        logger.info(f"Phase 6/7 - Decision: {decision.value}, action: {action.value}")
        
        evidence_summary = self._build_evidence_summary(
            evidence_items, image_analysis_results, child_detection
        )
        
        manual_review_required = needs_review or confidence_score < self.MIN_AUTO_DECISION_CONFIDENCE
        if manual_review_required and decision != ParentChildDecision.REVIEW_REQUIRED:
            decision = ParentChildDecision.REVIEW_REQUIRED
            action = ParentChildAction.DO_NOT_ISSUE
        
        return ParentChildAnalysisResult(
            bay_type="ParentChild",
            decision=decision,
            action=action,
            confidence=confidence,
            confidence_score=confidence_score,
            reason=reason,
            bay_confirmation={
                "isParentChildBay": bay_confirmation.is_parent_child_bay,
                "groundMarkingsVisible": bay_confirmation.ground_markings_visible,
                "signageVisible": bay_confirmation.signage_visible,
                "childSymbolVisible": bay_confirmation.child_symbol_visible,
                "buggySymbolVisible": bay_confirmation.buggy_symbol_visible,
                "confidence": bay_confirmation.confidence
            },
            vehicle_position={
                "fullyInsideBay": vehicle_position.fully_inside_bay,
                "overlapDetected": vehicle_position.overlap_detected,
                "overlapType": vehicle_position.overlap_type,
                "confidence": vehicle_position.confidence
            },
            child_detection={
                "childDetected": child_detection.child_detected,
                "childExitingVehicle": child_detection.child_exiting_vehicle,
                "childEnteringVehicle": child_detection.child_entering_vehicle,
                "childNearVehicle": child_detection.child_near_vehicle,
                "pramWithChild": child_detection.pram_with_child,
                "pramOnly": child_detection.pram_only,
                "childSeatOnly": child_detection.child_seat_only,
                "adultCount": child_detection.adult_count,
                "childCount": child_detection.child_count,
                "confidence": child_detection.confidence
            },
            child_detected=child_detection.child_detected,
            vehicle_position_valid=vehicle_position.fully_inside_bay and not vehicle_position.overlap_detected,
            observation_duration_minutes=obs_duration,
            manual_review_required=manual_review_required,
            legal_justification=justification,
            evidence_summary=evidence_summary
        )
    
    def _confirm_bay_type(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> BayConfirmationDetails:
        """Phase 1: Confirm the bay is marked as Parent & Child."""
        
        details = BayConfirmationDetails()
        ground_count = 0
        signage_count = 0
        child_symbol_count = 0
        buggy_count = 0
        total_frames = len(image_analysis_results) if image_analysis_results else 1
        
        for result in image_analysis_results:
            bay_data = result.get("parentChildAnalysis", {})
            
            if bay_data.get("groundMarkingsVisible", False):
                details.ground_markings_visible = True
                ground_count += 1
            
            if bay_data.get("signageVisible", False):
                details.signage_visible = True
                signage_count += 1
            
            if bay_data.get("childSymbolVisible", False):
                details.child_symbol_visible = True
                child_symbol_count += 1
            
            if bay_data.get("buggySymbolVisible", False):
                details.buggy_symbol_visible = True
                buggy_count += 1
            
            if bay_data.get("isParentChildBay", False):
                details.is_parent_child_bay = True
        
        if details.ground_markings_visible or details.signage_visible or details.child_symbol_visible or details.buggy_symbol_visible:
            details.is_parent_child_bay = True
        
        confidence_points = 0
        if details.child_symbol_visible:
            confidence_points += 40 * (child_symbol_count / total_frames)
        if details.signage_visible:
            confidence_points += 30 * (signage_count / total_frames)
        if details.ground_markings_visible:
            confidence_points += 20 * (ground_count / total_frames)
        if details.buggy_symbol_visible:
            confidence_points += 10 * (buggy_count / total_frames)
        
        details.confidence = min(100, int(confidence_points))
        return details
    
    def _check_vehicle_position(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> VehiclePositionDetails:
        """Phase 2: Check vehicle is fully inside the P&C bay."""
        
        details = VehiclePositionDetails()
        inside_count = 0
        overlap_count = 0
        total_frames = len(image_analysis_results) if image_analysis_results else 1
        
        for result in image_analysis_results:
            position_data = result.get("parentChildAnalysis", {}).get("vehiclePosition", {})
            
            if position_data.get("fullyInsideBay", False):
                details.fully_inside_bay = True
                inside_count += 1
            
            if position_data.get("overlapDetected", False):
                details.overlap_detected = True
                overlap_count += 1
                if not details.overlap_type:
                    details.overlap_type = position_data.get("overlapType")
        
        if inside_count > 0 and inside_count >= total_frames / 2:
            details.fully_inside_bay = True
        
        consistency = inside_count / total_frames if not details.overlap_detected else 0.5
        details.confidence = int(60 + (consistency * 40))
        
        return details
    
    def _detect_child_presence(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> ChildDetectionDetails:
        """Phase 3: Critical child presence detection across all frames."""
        
        details = ChildDetectionDetails()
        child_detected_count = 0
        max_child_count = 0
        max_adult_count = 0
        confidence_sum = 0
        confidence_count = 0
        
        for result in image_analysis_results:
            child_data = result.get("parentChildAnalysis", {}).get("childDetection", {})
            
            if child_data.get("childDetected", False):
                details.child_detected = True
                child_detected_count += 1
            
            if child_data.get("childExitingVehicle", False):
                details.child_exiting_vehicle = True
                details.child_detected = True
            
            if child_data.get("childEnteringVehicle", False):
                details.child_entering_vehicle = True
                details.child_detected = True
            
            if child_data.get("childNearVehicle", False):
                details.child_near_vehicle = True
                details.child_detected = True
            
            if child_data.get("pramWithChild", False):
                details.pram_with_child = True
                details.child_detected = True
            
            if child_data.get("pramOnly", False):
                details.pram_only = True
            
            if child_data.get("childSeatOnly", False):
                details.child_seat_only = True
            
            child_count = child_data.get("childCount", 0)
            adult_count = child_data.get("adultCount", 0)
            if child_count > max_child_count:
                max_child_count = child_count
            if adult_count > max_adult_count:
                max_adult_count = adult_count
            
            conf = child_data.get("confidence", 0)
            if conf > 0:
                confidence_sum += conf
                confidence_count += 1
        
        details.child_count = max_child_count
        details.adult_count = max_adult_count
        
        if confidence_count > 0:
            details.confidence = int(confidence_sum / confidence_count)
        else:
            details.confidence = 30 if not details.child_detected else 60
        
        return details
    
    def _check_observation_window(
        self,
        observe_from: Optional[datetime],
        observe_to: Optional[datetime],
        duration_minutes: Optional[float]
    ) -> tuple[bool, Optional[float]]:
        """Phase 4: Check observation window is sufficient."""
        
        if duration_minutes is not None:
            return duration_minutes >= self.MIN_OBSERVATION_MINUTES, duration_minutes
        
        if observe_from and observe_to:
            delta = observe_to - observe_from
            minutes = delta.total_seconds() / 60
            return minutes >= self.MIN_OBSERVATION_MINUTES, minutes
        
        return False, None
    
    def _make_decision(
        self,
        bay_confirmation: BayConfirmationDetails,
        vehicle_position: VehiclePositionDetails,
        child_detection: ChildDetectionDetails,
        observation_ok: bool,
        obs_duration: Optional[float]
    ) -> tuple[ParentChildDecision, ParentChildAction, ParentChildConfidence, int, str, str, bool]:
        """Phase 6 & 7: Final decision logic."""
        
        needs_review = False
        
        bay_confirmed = bay_confirmation.is_parent_child_bay
        vehicle_valid = vehicle_position.fully_inside_bay and not vehicle_position.overlap_detected
        child_present = child_detection.child_detected
        
        base_confidence = min(
            bay_confirmation.confidence,
            vehicle_position.confidence,
            child_detection.confidence
        )
        
        confidence_deductions = 0
        
        if vehicle_position.overlap_detected:
            confidence_deductions += 0
        
        if child_detection.pram_only and not child_detection.child_detected:
            confidence_deductions += 15
            needs_review = True
        
        if child_detection.child_seat_only and not child_detection.child_detected:
            confidence_deductions += 20
        
        if not observation_ok:
            confidence_deductions += 25
            needs_review = True
        
        confidence_score = max(0, base_confidence - confidence_deductions)
        
        if bay_confirmed and vehicle_valid and child_present:
            decision = ParentChildDecision.COMPLIANT
            action = ParentChildAction.DO_NOT_ISSUE
            reason = "Child detected with vehicle in Parent & Child bay - legitimate use"
            confidence = ParentChildConfidence.HIGH if confidence_score >= 80 else ParentChildConfidence.MEDIUM
            justification = self._build_compliant_justification(child_detection)
        
        elif bay_confirmed and vehicle_valid and not child_present and observation_ok:
            decision = ParentChildDecision.NON_COMPLIANT
            action = ParentChildAction.ISSUE_PCN
            reason = "No child detected during observation period - bay misuse"
            confidence = ParentChildConfidence.HIGH if confidence_score >= 80 else ParentChildConfidence.MEDIUM
            justification = self._build_non_compliant_justification(child_detection, obs_duration)
        
        elif not vehicle_valid:
            decision = ParentChildDecision.NON_COMPLIANT
            action = ParentChildAction.ISSUE_PCN
            reason = "Incorrect bay positioning"
            confidence = ParentChildConfidence.HIGH
            justification = "Vehicle not correctly positioned within Parent & Child bay boundaries."
        
        elif not observation_ok:
            decision = ParentChildDecision.REVIEW_REQUIRED
            action = ParentChildAction.DO_NOT_ISSUE
            reason = "Insufficient observation time"
            confidence = ParentChildConfidence.LOW
            justification = "Observation window too short to make definitive determination."
            needs_review = True
        
        else:
            decision = ParentChildDecision.REVIEW_REQUIRED
            action = ParentChildAction.DO_NOT_ISSUE
            reason = "Evidence unclear - manual review required"
            confidence = ParentChildConfidence.LOW
            justification = "Evidence does not clearly establish compliance or non-compliance."
            needs_review = True
        
        return decision, action, confidence, confidence_score, reason, justification, needs_review
    
    def _build_compliant_justification(self, child_detection: ChildDetectionDetails) -> str:
        """Build legal justification for COMPLIANT decision."""
        
        evidence_points = []
        if child_detection.child_exiting_vehicle:
            evidence_points.append("child exiting vehicle")
        if child_detection.child_entering_vehicle:
            evidence_points.append("child entering vehicle")
        if child_detection.child_near_vehicle:
            evidence_points.append("child near vehicle")
        if child_detection.pram_with_child:
            evidence_points.append("pram with child present")
        if child_detection.child_count > 0:
            evidence_points.append(f"{child_detection.child_count} child(ren) observed")
        
        evidence_text = ", ".join(evidence_points) if evidence_points else "child presence confirmed"
        
        return (
            f"Under UK Parent & Child parking enforcement guidance, this vehicle is COMPLIANT. "
            f"Evidence confirms: {evidence_text}. "
            f"The vehicle is correctly positioned within the Parent & Child bay. "
            f"No Penalty Charge Notice should be issued."
        )
    
    def _build_non_compliant_justification(
        self,
        child_detection: ChildDetectionDetails,
        obs_duration: Optional[float]
    ) -> str:
        """Build legal justification for NON-COMPLIANT decision."""
        
        duration_text = f"{obs_duration:.1f} minutes" if obs_duration else "the observation period"
        
        mitigating = []
        if child_detection.pram_only:
            mitigating.append("empty pram/pushchair observed but no child visible")
        if child_detection.child_seat_only:
            mitigating.append("child seat visible but child seat alone is not sufficient")
        
        mitigating_text = f" Note: {'; '.join(mitigating)}." if mitigating else ""
        
        return (
            f"Under UK Parent & Child parking enforcement guidance, this vehicle is NON-COMPLIANT. "
            f"During {duration_text} of observation, no child was detected exiting, entering, "
            f"or near the vehicle. Parent & Child bays are reserved for drivers with young children. "
            f"A Penalty Charge Notice may be issued.{mitigating_text}"
        )
    
    def _build_insufficient_evidence_result(self) -> ParentChildAnalysisResult:
        """Build result when no evidence is available."""
        
        return ParentChildAnalysisResult(
            bay_type="ParentChild",
            decision=ParentChildDecision.REVIEW_REQUIRED,
            action=ParentChildAction.DO_NOT_ISSUE,
            confidence=ParentChildConfidence.LOW,
            confidence_score=0,
            reason="No evidence available for analysis",
            bay_confirmation={"isParentChildBay": False, "confidence": 0},
            vehicle_position={"fullyInsideBay": False, "overlapDetected": False, "confidence": 0},
            child_detection={"childDetected": False, "confidence": 0},
            child_detected=False,
            vehicle_position_valid=False,
            observation_duration_minutes=None,
            manual_review_required=True,
            legal_justification="Insufficient evidence to make determination.",
            evidence_summary=[]
        )
    
    def _build_unclear_bay_result(
        self,
        bay_confirmation: BayConfirmationDetails
    ) -> ParentChildAnalysisResult:
        """Build result when bay type cannot be confirmed."""
        
        return ParentChildAnalysisResult(
            bay_type="UNCLEAR",
            decision=ParentChildDecision.REVIEW_REQUIRED,
            action=ParentChildAction.DO_NOT_ISSUE,
            confidence=ParentChildConfidence.LOW,
            confidence_score=bay_confirmation.confidence,
            reason="Unclear Parent & Child bay signage",
            bay_confirmation={
                "isParentChildBay": False,
                "groundMarkingsVisible": bay_confirmation.ground_markings_visible,
                "signageVisible": bay_confirmation.signage_visible,
                "childSymbolVisible": bay_confirmation.child_symbol_visible,
                "buggySymbolVisible": bay_confirmation.buggy_symbol_visible,
                "confidence": bay_confirmation.confidence
            },
            vehicle_position={"fullyInsideBay": True, "overlapDetected": False, "confidence": 50},
            child_detection={"childDetected": False, "confidence": 0},
            child_detected=False,
            vehicle_position_valid=True,
            observation_duration_minutes=None,
            manual_review_required=True,
            legal_justification="Bay type cannot be confidently confirmed as Parent & Child. No PCN should be issued.",
            evidence_summary=[]
        )
    
    def _build_evidence_summary(
        self,
        evidence_items: List[Dict[str, Any]],
        image_analysis_results: List[Dict[str, Any]],
        child_detection: ChildDetectionDetails
    ) -> List[Dict[str, Any]]:
        """Build evidence summary for the analysis."""
        
        summary = []
        for i, item in enumerate(evidence_items):
            analysis = image_analysis_results[i] if i < len(image_analysis_results) else {}
            child_data = analysis.get("parentChildAnalysis", {}).get("childDetection", {})
            
            summary.append({
                "evidenceId": item.get("id"),
                "timestamp": item.get("timestamp"),
                "childDetected": child_data.get("childDetected", False),
                "childCount": child_data.get("childCount", 0),
                "adultCount": child_data.get("adultCount", 0)
            })
        
        return summary


parent_child_bay_analysis_service = ParentChildBayAnalysisService()
