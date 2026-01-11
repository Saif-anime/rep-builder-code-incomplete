"""
Disabled Bay Analysis Service - UK Blue Badge compliance verification.

This service implements the 7-step analysis for Disabled Bay violations:
1. Disabled Bay Confirmation (wheelchair symbol, signage)
2. Vehicle Position Validation (fully inside bay, no overlap)
3. Blue Badge Visibility Check (dashboard inspection)
4. Blue Badge Front Verification (expiry, badge number, hologram)
5. Badge Validity Check (expiry date vs evidence timestamp)
6. Confidence Scoring (HIGH/MEDIUM/LOW)
7. Final Decision Logic (COMPLIANT/NON-COMPLIANT)

Reference: UK Blue Badge enforcement guidance.
"""

import logging
from datetime import datetime, date
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class DisabledBayDecision(str, Enum):
    COMPLIANT = "COMPLIANT"
    NON_COMPLIANT = "NON_COMPLIANT"
    MANUAL_REVIEW = "MANUAL_REVIEW"


class DisabledBayConfidence(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class NonComplianceReason(str, Enum):
    NO_BADGE_VISIBLE = "No Blue Badge visible on dashboard"
    BADGE_BACK_SHOWING = "Blue Badge showing back side (front required)"
    BADGE_EXPIRED = "Blue Badge has expired"
    BADGE_UNREADABLE = "Blue Badge details unreadable"
    VEHICLE_OVERLAP = "Vehicle overlapping bay boundaries or hatched area"
    VEHICLE_OUTSIDE_BAY = "Vehicle not fully within disabled bay"
    NOT_DISABLED_BAY = "Bay is not marked as a disabled bay"
    MISSING_HOLOGRAM = "Blue Badge hologram not visible"


@dataclass
class BlueBadgeDetails:
    """Extracted Blue Badge information."""
    visible: bool = False
    front_visible: bool = False
    expiry_date: Optional[str] = None  # YYYY-MM-DD format
    badge_number: Optional[str] = None
    hologram_visible: bool = False
    partially_obscured: bool = False
    reflection_issues: bool = False
    confidence: int = 0


@dataclass
class VehiclePositionDetails:
    """Vehicle positioning analysis."""
    fully_inside_bay: bool = False
    overlap_detected: bool = False
    overlap_type: Optional[str] = None  # "adjacent_bay", "hatched_area", "access_zone"
    confidence: int = 0


@dataclass
class BayConfirmationDetails:
    """Disabled bay confirmation analysis."""
    is_disabled_bay: bool = False
    wheelchair_symbol_visible: bool = False
    signage_visible: bool = False
    road_markings_visible: bool = False
    confidence: int = 0


@dataclass
class DisabledBayAnalysisResult:
    """Complete disabled bay analysis result."""
    bay_type: str
    decision: DisabledBayDecision
    confidence: DisabledBayConfidence
    confidence_score: int
    reason: str
    
    bay_confirmation: Dict[str, Any]
    vehicle_position: Dict[str, Any]
    blue_badge: Dict[str, Any]
    
    badge_expired: bool
    expiry_date_detected: Optional[str]
    vehicle_fully_inside_bay: bool
    overlap_detected: bool
    
    manual_review_required: bool
    legal_justification: str
    evidence_summary: List[Dict[str, Any]]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "bayType": "Disabled",
            "blueBadgeVisible": self.blue_badge.get("visible", False),
            "badgeFrontVisible": self.blue_badge.get("frontVisible", False),
            "expiryDateDetected": self.expiry_date_detected,
            "badgeExpired": self.badge_expired,
            "vehicleFullyInsideBay": self.vehicle_fully_inside_bay,
            "overlapDetected": self.overlap_detected,
            "decision": self.decision.value,
            "reason": self.reason,
            "confidence": self.confidence.value,
            "confidenceScore": self.confidence_score,
            "bayConfirmation": self.bay_confirmation,
            "vehiclePosition": self.vehicle_position,
            "blueBadge": self.blue_badge,
            "manualReviewRequired": self.manual_review_required,
            "legalJustification": self.legal_justification,
            "evidenceSummary": self.evidence_summary
        }


class DisabledBayAnalysisService:
    """
    Analyzes evidence for Disabled Bay violations with UK Blue Badge compliance.
    
    A vehicle parked in a Disabled Bay is COMPLIANT if:
    - Bay is confirmed as a Disabled Bay
    - Vehicle is fully within bay boundaries
    - Blue Badge is clearly visible on dashboard
    - Badge FRONT is visible with expiry date, badge number, hologram
    - Badge has not expired
    
    A PCN MUST be issued if:
    - No Blue Badge visible
    - Badge back is showing instead of front
    - Badge is expired
    - Vehicle overlaps bay boundaries/hatched areas
    """
    
    MIN_AUTO_DECISION_CONFIDENCE = 70
    
    def __init__(self):
        pass
    
    async def analyze_disabled_bay(
        self,
        evidence_items: List[Dict[str, Any]],
        image_analysis_results: List[Dict[str, Any]],
        evidence_timestamp: Optional[datetime] = None
    ) -> DisabledBayAnalysisResult:
        """
        Perform complete disabled bay compliance analysis.
        
        Args:
            evidence_items: List of evidence items with timestamps
            image_analysis_results: Vision GPT analysis results for each image
            evidence_timestamp: Timestamp of evidence for expiry check
        
        Returns:
            DisabledBayAnalysisResult with decision and justification
        """
        logger.info(f"Starting disabled bay analysis with {len(evidence_items)} evidence items")
        
        # Step 1: Disabled Bay Confirmation
        bay_confirmation = self._confirm_disabled_bay(image_analysis_results)
        logger.info(f"Step 1 - Bay confirmation: is_disabled={bay_confirmation.is_disabled_bay}, "
                   f"symbol={bay_confirmation.wheelchair_symbol_visible}")
        
        if not bay_confirmation.is_disabled_bay:
            return self._build_not_applicable_result(bay_confirmation)
        
        # Step 2: Vehicle Position Validation
        vehicle_position = self._validate_vehicle_position(image_analysis_results)
        logger.info(f"Step 2 - Vehicle position: inside_bay={vehicle_position.fully_inside_bay}, "
                   f"overlap={vehicle_position.overlap_detected}")
        
        # Step 3: Blue Badge Visibility Check
        badge_details = self._check_badge_visibility(image_analysis_results)
        logger.info(f"Step 3 - Badge visibility: visible={badge_details.visible}, "
                   f"front={badge_details.front_visible}")
        
        # Step 4: Blue Badge Front Verification
        front_verified = self._verify_badge_front(badge_details)
        logger.info(f"Step 4 - Front verification: expiry={badge_details.expiry_date}, "
                   f"number={badge_details.badge_number}, hologram={badge_details.hologram_visible}")
        
        # Step 5: Badge Validity Check
        badge_expired, could_verify_expiry = self._check_badge_validity(badge_details, evidence_timestamp)
        logger.info(f"Step 5 - Badge validity: expired={badge_expired}, could_verify={could_verify_expiry}")
        
        # Step 6 & 7: Confidence Scoring and Final Decision
        decision, confidence, confidence_score, reason, justification, needs_manual_review = self._make_decision(
            bay_confirmation,
            vehicle_position,
            badge_details,
            front_verified,
            badge_expired,
            could_verify_expiry
        )
        logger.info(f"Step 6/7 - Decision: {decision.value}, confidence: {confidence.value} ({confidence_score}%), needs_review={needs_manual_review}")
        
        # Build evidence summary
        evidence_summary = self._build_evidence_summary(
            evidence_items, image_analysis_results, badge_details
        )
        
        # Check for manual review requirement - respect needs_manual_review signal from _make_decision
        # Manual review is needed if:
        # 1. _make_decision set needs_manual_review (occlusion, unverified expiry, etc.)
        # 2. _make_decision returned MANUAL_REVIEW decision
        # 3. Confidence score is below threshold
        manual_review_required = (
            needs_manual_review or
            decision == DisabledBayDecision.MANUAL_REVIEW or
            confidence_score < self.MIN_AUTO_DECISION_CONFIDENCE
        )
        
        # If manual review is required, ensure decision reflects this
        if manual_review_required and decision != DisabledBayDecision.MANUAL_REVIEW:
            decision = DisabledBayDecision.MANUAL_REVIEW
            logger.info("Manual review required - updating decision")
        
        return DisabledBayAnalysisResult(
            bay_type="DISABLED",
            decision=decision,
            confidence=confidence,
            confidence_score=confidence_score,
            reason=reason,
            bay_confirmation={
                "isDisabledBay": bay_confirmation.is_disabled_bay,
                "wheelchairSymbolVisible": bay_confirmation.wheelchair_symbol_visible,
                "signageVisible": bay_confirmation.signage_visible,
                "roadMarkingsVisible": bay_confirmation.road_markings_visible,
                "confidence": bay_confirmation.confidence
            },
            vehicle_position={
                "fullyInsideBay": vehicle_position.fully_inside_bay,
                "overlapDetected": vehicle_position.overlap_detected,
                "overlapType": vehicle_position.overlap_type,
                "confidence": vehicle_position.confidence
            },
            blue_badge={
                "visible": badge_details.visible,
                "frontVisible": badge_details.front_visible,
                "expiryDate": badge_details.expiry_date,
                "badgeNumber": badge_details.badge_number,
                "hologramVisible": badge_details.hologram_visible,
                "partiallyObscured": badge_details.partially_obscured,
                "reflectionIssues": badge_details.reflection_issues,
                "confidence": badge_details.confidence
            },
            badge_expired=badge_expired if could_verify_expiry else False,
            expiry_date_detected=badge_details.expiry_date,
            vehicle_fully_inside_bay=vehicle_position.fully_inside_bay,
            overlap_detected=vehicle_position.overlap_detected,
            manual_review_required=manual_review_required,
            legal_justification=justification,
            evidence_summary=evidence_summary
        )
    
    def _confirm_disabled_bay(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> BayConfirmationDetails:
        """Step 1: Confirm the bay is marked as a Disabled Bay (aggregates across all frames)."""
        
        details = BayConfirmationDetails()
        wheelchair_count = 0
        signage_count = 0
        markings_count = 0
        total_frames = len(image_analysis_results) if image_analysis_results else 1
        
        # Aggregate findings across ALL frames
        for result in image_analysis_results:
            bay_data = result.get("disabledBayAnalysis", {})
            
            if bay_data.get("wheelchairSymbolVisible", False):
                details.wheelchair_symbol_visible = True
                wheelchair_count += 1
            
            if bay_data.get("signageVisible", False):
                details.signage_visible = True
                signage_count += 1
            
            if bay_data.get("roadMarkingsVisible", False):
                details.road_markings_visible = True
                markings_count += 1
            
            if bay_data.get("isDisabledBay", False):
                details.is_disabled_bay = True
        
        # Bay is confirmed if any marker is visible in any frame
        if details.wheelchair_symbol_visible or details.signage_visible or details.road_markings_visible:
            details.is_disabled_bay = True
        
        # Calculate confidence based on consistency across frames
        confidence_points = 0
        if details.wheelchair_symbol_visible:
            confidence_points += 40 * (wheelchair_count / total_frames)
        if details.signage_visible:
            confidence_points += 30 * (signage_count / total_frames)
        if details.road_markings_visible:
            confidence_points += 20 * (markings_count / total_frames)
        
        details.confidence = min(100, int(confidence_points))
        return details
    
    def _validate_vehicle_position(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> VehiclePositionDetails:
        """Step 2: Validate vehicle is fully within bay boundaries."""
        
        details = VehiclePositionDetails()
        fully_inside_count = 0
        overlap_count = 0
        total_assessments = 0
        
        for result in image_analysis_results:
            position_data = result.get("disabledBayAnalysis", {}).get("vehiclePosition", {})
            
            if position_data:
                total_assessments += 1
                
                if position_data.get("fullyInsideBay", False):
                    fully_inside_count += 1
                
                if position_data.get("overlapDetected", False):
                    overlap_count += 1
                    details.overlap_type = position_data.get("overlapType")
        
        if total_assessments > 0:
            details.fully_inside_bay = fully_inside_count > (total_assessments / 2)
            details.overlap_detected = overlap_count > 0
            details.confidence = int((max(fully_inside_count, overlap_count) / total_assessments) * 100)
        else:
            # Assume inside if no contrary evidence
            details.fully_inside_bay = True
            details.confidence = 50
        
        return details
    
    def _check_badge_visibility(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> BlueBadgeDetails:
        """Step 3: Check Blue Badge visibility on dashboard (aggregates across all frames)."""
        
        details = BlueBadgeDetails()
        visible_count = 0
        front_visible_count = 0
        hologram_count = 0
        obscured_count = 0
        reflection_count = 0
        total_frames = len(image_analysis_results) if image_analysis_results else 1
        confidence_sum = 0
        confidence_count = 0
        
        # Aggregate findings across ALL frames
        for result in image_analysis_results:
            badge_data = result.get("disabledBayAnalysis", {}).get("blueBadge", {})
            
            if badge_data.get("visible", False):
                details.visible = True
                visible_count += 1
            
            if badge_data.get("frontVisible", False):
                details.front_visible = True
                front_visible_count += 1
            
            # Collect expiry date from any frame that has it
            if badge_data.get("expiryDate") and not details.expiry_date:
                details.expiry_date = badge_data["expiryDate"]
            
            # Collect badge number from any frame that has it
            if badge_data.get("badgeNumber") and not details.badge_number:
                details.badge_number = badge_data["badgeNumber"]
            
            if badge_data.get("hologramVisible", False):
                details.hologram_visible = True
                hologram_count += 1
            
            if badge_data.get("partiallyObscured", False):
                details.partially_obscured = True
                obscured_count += 1
            
            if badge_data.get("reflectionIssues", False):
                details.reflection_issues = True
                reflection_count += 1
            
            # Collect confidence values
            conf = badge_data.get("confidence", 0)
            if conf > 0:
                confidence_sum += conf
                confidence_count += 1
        
        # Calculate average confidence across frames
        if confidence_count > 0:
            details.confidence = int(confidence_sum / confidence_count)
        else:
            # If badge not visible in any frame, low confidence
            details.confidence = 20 if not details.visible else 50
        
        return details
    
    def _verify_badge_front(self, badge_details: BlueBadgeDetails) -> bool:
        """Step 4: Verify Blue Badge front is visible with required elements."""
        
        if not badge_details.visible:
            return False
        
        if not badge_details.front_visible:
            return False
        
        # Front should show expiry, badge number, and hologram
        has_expiry = badge_details.expiry_date is not None
        has_number = badge_details.badge_number is not None
        has_hologram = badge_details.hologram_visible
        
        # Need at least expiry date and one other element
        return has_expiry and (has_number or has_hologram)
    
    def _check_badge_validity(
        self,
        badge_details: BlueBadgeDetails,
        evidence_timestamp: Optional[datetime]
    ) -> tuple[bool, bool]:
        """
        Step 5: Check if badge has expired against evidence timestamp.
        
        Returns:
            tuple: (badge_expired: bool, could_verify: bool)
            - badge_expired: True if badge is expired
            - could_verify: True if we could verify expiry, False if indeterminate
        """
        
        if not badge_details.expiry_date:
            # Cannot determine expiry - indeterminate
            return False, False
        
        if not evidence_timestamp:
            # Cannot verify without evidence timestamp - indeterminate for auditing
            logger.warning("No evidence timestamp provided for expiry check - marking as indeterminate")
            return False, False
        
        try:
            # Parse expiry date (expected YYYY-MM-DD format)
            expiry = datetime.strptime(badge_details.expiry_date, "%Y-%m-%d").date()
            compare_date = evidence_timestamp.date()
            
            return expiry < compare_date, True
        except ValueError:
            logger.warning(f"Could not parse expiry date: {badge_details.expiry_date}")
            return False, False
    
    def _make_decision(
        self,
        bay_confirmation: BayConfirmationDetails,
        vehicle_position: VehiclePositionDetails,
        badge_details: BlueBadgeDetails,
        front_verified: bool,
        badge_expired: bool,
        could_verify_expiry: bool = True
    ) -> tuple[DisabledBayDecision, DisabledBayConfidence, int, str, str, bool]:
        """Step 6 & 7: Confidence scoring and final decision."""
        
        failures = []
        confidence_deductions = 0
        needs_manual_review = False
        
        # Check each compliance requirement
        if not badge_details.visible:
            failures.append(NonComplianceReason.NO_BADGE_VISIBLE)
            confidence_deductions += 0  # Clear failure
        elif not badge_details.front_visible:
            failures.append(NonComplianceReason.BADGE_BACK_SHOWING)
            confidence_deductions += 0
        elif not front_verified:
            failures.append(NonComplianceReason.BADGE_UNREADABLE)
            confidence_deductions += 20  # Partial visibility
            # If badge is visible but unreadable, request manual review rather than auto-fail
            if badge_details.partially_obscured or badge_details.reflection_issues:
                needs_manual_review = True
        
        if badge_expired and could_verify_expiry:
            failures.append(NonComplianceReason.BADGE_EXPIRED)
            confidence_deductions += 0
        elif not could_verify_expiry and badge_details.expiry_date:
            # Could not verify expiry - indeterminate, reduce confidence
            confidence_deductions += 15
            needs_manual_review = True
        
        if vehicle_position.overlap_detected:
            failures.append(NonComplianceReason.VEHICLE_OVERLAP)
            confidence_deductions += 0
        elif not vehicle_position.fully_inside_bay:
            failures.append(NonComplianceReason.VEHICLE_OUTSIDE_BAY)
            confidence_deductions += 10
        
        # Hologram check - if front is visible but hologram not detected, reduce confidence
        # but don't immediately fail (per guidance: request manual review for unclear evidence)
        if not badge_details.hologram_visible and badge_details.front_visible:
            # Only add as failure if badge is otherwise readable
            if not badge_details.partially_obscured and not badge_details.reflection_issues:
                failures.append(NonComplianceReason.MISSING_HOLOGRAM)
                confidence_deductions += 15
            else:
                # Hologram not visible due to occlusion/reflection - request review
                confidence_deductions += 25
                needs_manual_review = True
        
        # Calculate base confidence
        base_confidence = min(
            bay_confirmation.confidence,
            vehicle_position.confidence,
            badge_details.confidence if badge_details.visible else 80
        )
        
        # Apply deductions for partial visibility issues
        if badge_details.partially_obscured:
            confidence_deductions += 15
        if badge_details.reflection_issues:
            confidence_deductions += 10
        
        confidence_score = max(0, base_confidence - confidence_deductions)
        
        # Determine decision
        if len(failures) == 0 and not needs_manual_review:
            # All checks passed
            decision = DisabledBayDecision.COMPLIANT
            reason = "Valid Blue Badge displayed, vehicle correctly positioned"
            confidence = DisabledBayConfidence.HIGH if confidence_score >= 80 else DisabledBayConfidence.MEDIUM
            justification = self._build_compliant_justification(badge_details, vehicle_position)
        elif needs_manual_review or confidence_score < self.MIN_AUTO_DECISION_CONFIDENCE:
            # Low confidence or unclear evidence - needs review
            decision = DisabledBayDecision.MANUAL_REVIEW
            reason = failures[0].value if failures else "Unclear evidence requires manual review"
            confidence = DisabledBayConfidence.LOW
            justification = self._build_review_justification(failures, badge_details)
            # Cap confidence score for manual review
            if confidence_score >= self.MIN_AUTO_DECISION_CONFIDENCE:
                confidence_score = self.MIN_AUTO_DECISION_CONFIDENCE - 1
        else:
            # Clear failure
            decision = DisabledBayDecision.NON_COMPLIANT
            reason = failures[0].value
            confidence = DisabledBayConfidence.HIGH if confidence_score >= 80 else DisabledBayConfidence.MEDIUM
            justification = self._build_non_compliant_justification(failures, badge_details, vehicle_position)
        
        return decision, confidence, confidence_score, reason, justification, needs_manual_review
    
    def _build_compliant_justification(
        self,
        badge_details: BlueBadgeDetails,
        vehicle_position: VehiclePositionDetails
    ) -> str:
        """Build legal justification for COMPLIANT decision."""
        
        elements = []
        if badge_details.expiry_date:
            elements.append(f"expiry date {badge_details.expiry_date}")
        if badge_details.badge_number:
            elements.append(f"badge number {badge_details.badge_number}")
        if badge_details.hologram_visible:
            elements.append("hologram present")
        
        return (
            f"Under UK Blue Badge enforcement guidance, the vehicle is COMPLIANT. "
            f"A valid Blue Badge was clearly visible on the dashboard displaying: "
            f"{', '.join(elements) if elements else 'required details'}. "
            f"The vehicle was correctly positioned fully within the disabled bay boundaries. "
            f"No Penalty Charge Notice should be issued."
        )
    
    def _build_non_compliant_justification(
        self,
        failures: List[NonComplianceReason],
        badge_details: BlueBadgeDetails,
        vehicle_position: VehiclePositionDetails
    ) -> str:
        """Build legal justification for NON-COMPLIANT decision."""
        
        failure_texts = [f.value for f in failures]
        
        if NonComplianceReason.NO_BADGE_VISIBLE in failures:
            return (
                f"Under UK Blue Badge enforcement guidance, the vehicle is NON-COMPLIANT. "
                f"No Blue Badge was visible on the vehicle dashboard. "
                f"Vehicles parked in disabled bays must display a valid Blue Badge "
                f"with the front facing outward showing expiry date and badge number. "
                f"A Penalty Charge Notice may be issued."
            )
        
        if NonComplianceReason.BADGE_EXPIRED in failures:
            return (
                f"Under UK Blue Badge enforcement guidance, the vehicle is NON-COMPLIANT. "
                f"The displayed Blue Badge has expired (expiry date: {badge_details.expiry_date}). "
                f"Only valid, unexpired Blue Badges permit parking in disabled bays. "
                f"A Penalty Charge Notice may be issued."
            )
        
        if NonComplianceReason.BADGE_BACK_SHOWING in failures:
            return (
                f"Under UK Blue Badge enforcement guidance, the vehicle is NON-COMPLIANT. "
                f"The Blue Badge is displayed with the back facing outward. "
                f"The front of the badge must be visible showing expiry date, badge number, and hologram. "
                f"A Penalty Charge Notice may be issued."
            )
        
        if NonComplianceReason.VEHICLE_OVERLAP in failures:
            overlap_desc = vehicle_position.overlap_type or "adjacent area"
            return (
                f"Under UK Blue Badge enforcement guidance, the vehicle is NON-COMPLIANT. "
                f"The vehicle is overlapping the {overlap_desc}. "
                f"Vehicles must be fully within the disabled bay boundaries and not obstruct "
                f"hatched areas or access zones. A Penalty Charge Notice may be issued."
            )
        
        return (
            f"Under UK Blue Badge enforcement guidance, the vehicle is NON-COMPLIANT. "
            f"Violations: {'; '.join(failure_texts)}. "
            f"A Penalty Charge Notice may be issued."
        )
    
    def _build_review_justification(
        self,
        failures: List[NonComplianceReason],
        badge_details: BlueBadgeDetails
    ) -> str:
        """Build justification for manual review case."""
        
        issues = []
        if badge_details.partially_obscured:
            issues.append("badge partially obscured")
        if badge_details.reflection_issues:
            issues.append("reflection affecting visibility")
        if failures:
            issues.extend([f.value.lower() for f in failures])
        
        return (
            f"The evidence requires manual review before a decision can be made. "
            f"Issues identified: {'; '.join(issues) if issues else 'unclear visibility'}. "
            f"A human operator should examine the evidence to determine whether "
            f"a valid Blue Badge is correctly displayed."
        )
    
    def _build_not_applicable_result(
        self,
        bay_confirmation: BayConfirmationDetails
    ) -> DisabledBayAnalysisResult:
        """Build result when bay is not a disabled bay."""
        
        return DisabledBayAnalysisResult(
            bay_type="NOT_DISABLED",
            decision=DisabledBayDecision.MANUAL_REVIEW,
            confidence=DisabledBayConfidence.HIGH,
            confidence_score=90,
            reason="Bay is not marked as a disabled bay",
            bay_confirmation={
                "isDisabledBay": False,
                "wheelchairSymbolVisible": bay_confirmation.wheelchair_symbol_visible,
                "signageVisible": bay_confirmation.signage_visible,
                "roadMarkingsVisible": bay_confirmation.road_markings_visible,
                "confidence": bay_confirmation.confidence
            },
            vehicle_position={
                "fullyInsideBay": True,
                "overlapDetected": False,
                "overlapType": None,
                "confidence": 0
            },
            blue_badge={
                "visible": False,
                "frontVisible": False,
                "expiryDate": None,
                "badgeNumber": None,
                "hologramVisible": False,
                "partiallyObscured": False,
                "reflectionIssues": False,
                "confidence": 0
            },
            badge_expired=False,
            expiry_date_detected=None,
            vehicle_fully_inside_bay=True,
            overlap_detected=False,
            manual_review_required=False,
            legal_justification="This analysis is not applicable as the bay is not marked as a disabled bay.",
            evidence_summary=[]
        )
    
    def _build_evidence_summary(
        self,
        evidence_items: List[Dict[str, Any]],
        image_analysis_results: List[Dict[str, Any]],
        badge_details: BlueBadgeDetails
    ) -> List[Dict[str, Any]]:
        """Build evidence summary for each analyzed image."""
        
        summary = []
        
        for i, result in enumerate(image_analysis_results):
            evidence_id = result.get("evidenceId")
            timestamp = result.get("timestamp")
            
            if i < len(evidence_items):
                ev = evidence_items[i]
                evidence_id = ev.get("id", evidence_id)
                timestamp = ev.get("timestamp", timestamp)
            
            badge_data = result.get("disabledBayAnalysis", {}).get("blueBadge", {})
            
            summary.append({
                "evidenceId": evidence_id,
                "timestamp": timestamp,
                "badgeVisible": badge_data.get("visible", False),
                "badgeFrontVisible": badge_data.get("frontVisible", False),
                "expiryDateFound": badge_data.get("expiryDate"),
                "notes": badge_data.get("notes", "")
            })
        
        return summary


# Singleton instance
disabled_bay_analysis_service = DisabledBayAnalysisService()
