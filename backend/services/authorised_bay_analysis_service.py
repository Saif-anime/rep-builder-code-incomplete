"""
Authorised Bay Analysis Service

Implements UK-compliant authorisation verification for Authorised/Permit parking bays.
Determines whether a vehicle is AUTHORISED to park based on visible permits,
digital authorisation records, or staff vehicle status.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class AuthorisedDecision(Enum):
    AUTHORISED = "AUTHORISED"
    NOT_AUTHORISED = "NOT_AUTHORISED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


class AuthorisedConfidence(Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass
class PermitDetails:
    permit_visible: bool = False
    permit_readable: bool = False
    permit_number: Optional[str] = None
    permit_expiry: Optional[str] = None
    permit_site_code: Optional[str] = None
    permit_valid_for_site: bool = False
    permit_expired: bool = False
    confidence: int = 0


@dataclass
class DigitalAuthorisationDetails:
    checked: bool = False
    vrm_matched: bool = False
    authorisation_active: bool = False
    covers_observation_window: bool = False
    authorisation_type: Optional[str] = None


@dataclass
class StaffVehicleDetails:
    checked: bool = False
    is_staff_vehicle: bool = False
    staff_permit_visible: bool = False
    staff_id_visible: bool = False


@dataclass
class VehiclePositionDetails:
    fully_inside_bay: bool = False
    overlap_detected: bool = False
    overlap_type: Optional[str] = None
    correctly_parked: bool = False
    confidence: int = 0


@dataclass
class EvidenceQualityDetails:
    sufficient_images: bool = False
    full_vehicle_visible: bool = False
    windscreen_visible: bool = False
    dashboard_visible: bool = False
    ocr_confidence_met: bool = False
    overall_quality: str = "LOW"


@dataclass
class AuthorisedBayAnalysisResult:
    bay_type: str
    decision: AuthorisedDecision
    confidence: AuthorisedConfidence
    confidence_score: int
    reason: str
    
    evidence_quality: Dict[str, Any]
    permit_check: Dict[str, Any]
    digital_authorisation: Dict[str, Any]
    staff_vehicle: Dict[str, Any]
    vehicle_position: Dict[str, Any]
    
    authorisation_found: bool
    authorisation_type: Optional[str]
    vehicle_position_valid: bool
    observation_window: Dict[str, Any]
    
    manual_review_required: bool
    legal_justification: str
    analysis_report: List[str]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "bayType": "AuthorisedBay",
            "decision": self.decision.value,
            "confidence": self.confidence.value,
            "confidenceScore": self.confidence_score,
            "reason": self.reason,
            "authorisationFound": self.authorisation_found,
            "authorisationType": self.authorisation_type,
            "vehiclePositionValid": self.vehicle_position_valid,
            "observationWindow": self.observation_window,
            "evidenceQuality": self.evidence_quality,
            "permitCheck": self.permit_check,
            "digitalAuthorisation": self.digital_authorisation,
            "staffVehicle": self.staff_vehicle,
            "vehiclePosition": self.vehicle_position,
            "manualReviewRequired": self.manual_review_required,
            "legalJustification": self.legal_justification,
            "analysisReport": self.analysis_report
        }


class AuthorisedBayAnalysisService:
    """
    Analyzes evidence for Authorised Bay parking compliance.
    
    A vehicle is AUTHORISED if:
    - Valid permit visible and readable (correct site, not expired, within time window)
    - OR digital authorisation matches VRM and covers observation window
    - OR listed as staff/operator vehicle
    AND vehicle is correctly positioned within bay
    """
    
    MIN_OCR_CONFIDENCE = 60
    MIN_AUTO_DECISION_CONFIDENCE = 70
    
    async def analyze_authorised_bay(
        self,
        evidence_items: List[Dict[str, Any]],
        image_analysis_results: List[Dict[str, Any]],
        observe_from: Optional[datetime] = None,
        observe_to: Optional[datetime] = None,
        site_id: Optional[int] = None,
        vrm: Optional[str] = None,
        site_authorised_vehicles: Optional[List[str]] = None,
        digital_authorisations: Optional[List[Dict[str, Any]]] = None,
        confirmed_bay_type: bool = False
    ) -> AuthorisedBayAnalysisResult:
        """
        Perform complete authorisation check for Authorised Bay.
        """
        logger.info(f"Starting Authorised Bay analysis with {len(evidence_items)} evidence items")
        
        observation_window = {
            "observeFrom": observe_from.isoformat() if observe_from else None,
            "observeTo": observe_to.isoformat() if observe_to else None
        }
        
        report_lines = [
            "=== AUTHORISED BAY ANALYSIS REPORT ===",
            f"Bay Type: AUTHORISED BAY",
            f"Observation Window: {observation_window.get('observeFrom', 'Unknown')} → {observation_window.get('observeTo', 'Unknown')}",
            f"VRM: {vrm or 'Not provided'}",
            ""
        ]
        
        if not image_analysis_results:
            return self._build_insufficient_evidence_result(observation_window, report_lines)
        
        evidence_quality = self._validate_evidence_quality(image_analysis_results)
        report_lines.append("--- EVIDENCE VALIDATION ---")
        report_lines.append(f"Sufficient Images: {'Yes' if evidence_quality.sufficient_images else 'No'}")
        report_lines.append(f"Full Vehicle Visible: {'Yes' if evidence_quality.full_vehicle_visible else 'No'}")
        report_lines.append(f"Windscreen Visible: {'Yes' if evidence_quality.windscreen_visible else 'No'}")
        report_lines.append(f"OCR Confidence Met: {'Yes' if evidence_quality.ocr_confidence_met else 'No'}")
        report_lines.append(f"Overall Quality: {evidence_quality.overall_quality}")
        report_lines.append("")
        
        if evidence_quality.overall_quality == "LOW":
            logger.info("Evidence quality insufficient for automated decision")
            return self._build_review_required_result(
                "Evidence quality insufficient for reliable analysis",
                evidence_quality, observation_window, report_lines
            )
        
        permit_check = self._check_permit_authorisation(image_analysis_results, site_id)
        report_lines.append("--- PERMIT AUTHORISATION CHECK ---")
        report_lines.append(f"Permit Visible: {'Yes' if permit_check.permit_visible else 'No'}")
        report_lines.append(f"Permit Readable: {'Yes' if permit_check.permit_readable else 'No'}")
        if permit_check.permit_number:
            report_lines.append(f"Permit Number: {permit_check.permit_number}")
        if permit_check.permit_expiry:
            report_lines.append(f"Permit Expiry: {permit_check.permit_expiry}")
        report_lines.append(f"Permit Valid for Site: {'Yes' if permit_check.permit_valid_for_site else 'No'}")
        report_lines.append(f"Permit Expired: {'Yes' if permit_check.permit_expired else 'No'}")
        report_lines.append("")
        
        digital_auth = self._check_digital_authorisation(
            vrm, digital_authorisations, observe_from, observe_to
        )
        report_lines.append("--- DIGITAL AUTHORISATION CHECK ---")
        report_lines.append(f"Digital Auth Checked: {'Yes' if digital_auth.checked else 'No'}")
        if digital_auth.checked:
            report_lines.append(f"VRM Matched: {'Yes' if digital_auth.vrm_matched else 'No'}")
            report_lines.append(f"Authorisation Active: {'Yes' if digital_auth.authorisation_active else 'No'}")
            report_lines.append(f"Covers Observation Window: {'Yes' if digital_auth.covers_observation_window else 'No'}")
        report_lines.append("")
        
        staff_vehicle = self._check_staff_vehicle(
            vrm, site_authorised_vehicles, image_analysis_results
        )
        report_lines.append("--- STAFF/OPERATOR VEHICLE CHECK ---")
        report_lines.append(f"Staff Vehicle Checked: {'Yes' if staff_vehicle.checked else 'No'}")
        if staff_vehicle.checked:
            report_lines.append(f"Is Staff Vehicle: {'Yes' if staff_vehicle.is_staff_vehicle else 'No'}")
            report_lines.append(f"Staff Permit Visible: {'Yes' if staff_vehicle.staff_permit_visible else 'No'}")
        report_lines.append("")
        
        vehicle_position = self._check_vehicle_position(image_analysis_results)
        report_lines.append("--- VEHICLE POSITION CHECK ---")
        report_lines.append(f"Fully Inside Bay: {'Yes' if vehicle_position.fully_inside_bay else 'No'}")
        report_lines.append(f"Overlap Detected: {'Yes' if vehicle_position.overlap_detected else 'No'}")
        if vehicle_position.overlap_type:
            report_lines.append(f"Overlap Type: {vehicle_position.overlap_type}")
        report_lines.append(f"Correctly Parked: {'Yes' if vehicle_position.correctly_parked else 'No'}")
        report_lines.append("")
        
        decision, confidence, confidence_score, reason, justification, auth_found, auth_type, needs_review = self._make_decision(
            permit_check, digital_auth, staff_vehicle, vehicle_position, evidence_quality
        )
        
        report_lines.append("--- FINAL DECISION ---")
        report_lines.append(f"Authorisation Found: {'Yes' if auth_found else 'No'}")
        if auth_type:
            report_lines.append(f"Authorisation Type: {auth_type}")
        report_lines.append(f"Decision: {decision.value}")
        report_lines.append(f"Confidence: {confidence.value} ({confidence_score}%)")
        report_lines.append(f"Reason: {reason}")
        report_lines.append("")
        report_lines.append("=== END REPORT ===")
        
        logger.info(f"Authorised Bay analysis complete: {decision.value}")
        
        return AuthorisedBayAnalysisResult(
            bay_type="AuthorisedBay",
            decision=decision,
            confidence=confidence,
            confidence_score=confidence_score,
            reason=reason,
            evidence_quality={
                "sufficientImages": evidence_quality.sufficient_images,
                "fullVehicleVisible": evidence_quality.full_vehicle_visible,
                "windscreenVisible": evidence_quality.windscreen_visible,
                "dashboardVisible": evidence_quality.dashboard_visible,
                "ocrConfidenceMet": evidence_quality.ocr_confidence_met,
                "overallQuality": evidence_quality.overall_quality
            },
            permit_check={
                "permitVisible": permit_check.permit_visible,
                "permitReadable": permit_check.permit_readable,
                "permitNumber": permit_check.permit_number,
                "permitExpiry": permit_check.permit_expiry,
                "permitSiteCode": permit_check.permit_site_code,
                "permitValidForSite": permit_check.permit_valid_for_site,
                "permitExpired": permit_check.permit_expired,
                "confidence": permit_check.confidence
            },
            digital_authorisation={
                "checked": digital_auth.checked,
                "vrmMatched": digital_auth.vrm_matched,
                "authorisationActive": digital_auth.authorisation_active,
                "coversObservationWindow": digital_auth.covers_observation_window,
                "authorisationType": digital_auth.authorisation_type
            },
            staff_vehicle={
                "checked": staff_vehicle.checked,
                "isStaffVehicle": staff_vehicle.is_staff_vehicle,
                "staffPermitVisible": staff_vehicle.staff_permit_visible,
                "staffIdVisible": staff_vehicle.staff_id_visible
            },
            vehicle_position={
                "fullyInsideBay": vehicle_position.fully_inside_bay,
                "overlapDetected": vehicle_position.overlap_detected,
                "overlapType": vehicle_position.overlap_type,
                "correctlyParked": vehicle_position.correctly_parked,
                "confidence": vehicle_position.confidence
            },
            authorisation_found=auth_found,
            authorisation_type=auth_type,
            vehicle_position_valid=vehicle_position.correctly_parked,
            observation_window=observation_window,
            manual_review_required=needs_review,
            legal_justification=justification,
            analysis_report=report_lines
        )
    
    def _validate_evidence_quality(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> EvidenceQualityDetails:
        """Validate evidence quality meets requirements."""
        
        details = EvidenceQualityDetails()
        details.sufficient_images = len(image_analysis_results) >= 1
        
        full_vehicle_count = 0
        windscreen_count = 0
        dashboard_count = 0
        ocr_confidence_sum = 0
        ocr_count = 0
        
        for result in image_analysis_results:
            auth_data = result.get("authorisedBayAnalysis", {})
            evidence = auth_data.get("evidenceQuality", {})
            
            if evidence.get("fullVehicleVisible", False):
                full_vehicle_count += 1
                details.full_vehicle_visible = True
            
            if evidence.get("windscreenVisible", False):
                windscreen_count += 1
                details.windscreen_visible = True
            
            if evidence.get("dashboardVisible", False):
                dashboard_count += 1
                details.dashboard_visible = True
            
            ocr_conf = evidence.get("ocrConfidence", 0)
            if ocr_conf > 0:
                ocr_confidence_sum += ocr_conf
                ocr_count += 1
        
        if ocr_count > 0:
            avg_ocr = ocr_confidence_sum / ocr_count
            details.ocr_confidence_met = avg_ocr >= self.MIN_OCR_CONFIDENCE
        
        quality_score = 0
        if details.sufficient_images:
            quality_score += 20
        if details.full_vehicle_visible:
            quality_score += 30
        if details.windscreen_visible:
            quality_score += 30
        if details.ocr_confidence_met:
            quality_score += 20
        
        if quality_score >= 80:
            details.overall_quality = "HIGH"
        elif quality_score >= 50:
            details.overall_quality = "MEDIUM"
        else:
            details.overall_quality = "LOW"
        
        return details
    
    def _check_permit_authorisation(
        self,
        image_analysis_results: List[Dict[str, Any]],
        site_id: Optional[int]
    ) -> PermitDetails:
        """Check for valid permit authorisation."""
        
        details = PermitDetails()
        best_confidence = 0
        
        for result in image_analysis_results:
            auth_data = result.get("authorisedBayAnalysis", {})
            permit = auth_data.get("permitCheck", {})
            
            if permit.get("permitVisible", False):
                details.permit_visible = True
            
            if permit.get("permitReadable", False):
                details.permit_readable = True
                
                if permit.get("permitNumber"):
                    details.permit_number = permit["permitNumber"]
                if permit.get("permitExpiry"):
                    details.permit_expiry = permit["permitExpiry"]
                if permit.get("permitSiteCode"):
                    details.permit_site_code = permit["permitSiteCode"]
                
                if permit.get("permitExpired", False):
                    details.permit_expired = True
                
                if permit.get("permitValidForSite", False):
                    details.permit_valid_for_site = True
            
            conf = permit.get("confidence", 0)
            if conf > best_confidence:
                best_confidence = conf
        
        details.confidence = best_confidence
        return details
    
    def _check_digital_authorisation(
        self,
        vrm: Optional[str],
        digital_authorisations: Optional[List[Dict[str, Any]]],
        observe_from: Optional[datetime],
        observe_to: Optional[datetime]
    ) -> DigitalAuthorisationDetails:
        """Check for digital authorisation matching VRM."""
        
        details = DigitalAuthorisationDetails()
        
        if not vrm or not digital_authorisations:
            return details
        
        details.checked = True
        normalized_vrm = vrm.upper().replace(" ", "")
        
        for auth in digital_authorisations:
            auth_vrm = auth.get("vrm", "").upper().replace(" ", "")
            if auth_vrm == normalized_vrm:
                details.vrm_matched = True
                details.authorisation_type = auth.get("type", "Digital")
                
                if auth.get("active", False):
                    details.authorisation_active = True
                
                auth_start = auth.get("validFrom")
                auth_end = auth.get("validTo")
                
                if auth_start and auth_end and observe_from and observe_to:
                    try:
                        if isinstance(auth_start, str):
                            auth_start = datetime.fromisoformat(auth_start.replace("Z", "+00:00"))
                        if isinstance(auth_end, str):
                            auth_end = datetime.fromisoformat(auth_end.replace("Z", "+00:00"))
                        
                        if auth_start <= observe_from and auth_end >= observe_to:
                            details.covers_observation_window = True
                    except Exception as e:
                        logger.warning(f"Error parsing authorisation dates: {e}")
                elif details.authorisation_active:
                    details.covers_observation_window = True
                
                break
        
        return details
    
    def _check_staff_vehicle(
        self,
        vrm: Optional[str],
        site_authorised_vehicles: Optional[List[str]],
        image_analysis_results: List[Dict[str, Any]]
    ) -> StaffVehicleDetails:
        """Check if vehicle is a staff/operator vehicle."""
        
        details = StaffVehicleDetails()
        
        if vrm and site_authorised_vehicles:
            details.checked = True
            normalized_vrm = vrm.upper().replace(" ", "")
            
            for auth_vrm in site_authorised_vehicles:
                if auth_vrm.upper().replace(" ", "") == normalized_vrm:
                    details.is_staff_vehicle = True
                    break
        
        for result in image_analysis_results:
            auth_data = result.get("authorisedBayAnalysis", {})
            staff = auth_data.get("staffCheck", {})
            
            if staff.get("staffPermitVisible", False):
                details.staff_permit_visible = True
                details.checked = True
            
            if staff.get("staffIdVisible", False):
                details.staff_id_visible = True
                details.checked = True
        
        return details
    
    def _check_vehicle_position(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> VehiclePositionDetails:
        """Check vehicle is correctly positioned in bay."""
        
        details = VehiclePositionDetails()
        inside_count = 0
        overlap_count = 0
        total_frames = len(image_analysis_results) if image_analysis_results else 1
        
        for result in image_analysis_results:
            auth_data = result.get("authorisedBayAnalysis", {})
            position = auth_data.get("vehiclePosition", {})
            
            if position.get("fullyInsideBay", False):
                inside_count += 1
            
            if position.get("overlapDetected", False):
                overlap_count += 1
                details.overlap_type = position.get("overlapType")
        
        details.fully_inside_bay = inside_count > 0
        details.overlap_detected = overlap_count > 0
        details.correctly_parked = details.fully_inside_bay and not details.overlap_detected
        
        if details.correctly_parked:
            details.confidence = int(80 * (inside_count / total_frames))
        else:
            details.confidence = 40
        
        return details
    
    def _make_decision(
        self,
        permit: PermitDetails,
        digital_auth: DigitalAuthorisationDetails,
        staff_vehicle: StaffVehicleDetails,
        vehicle_position: VehiclePositionDetails,
        evidence_quality: EvidenceQualityDetails
    ) -> tuple:
        """Make final authorisation decision."""
        
        auth_found = False
        auth_type = None
        needs_review = False
        
        if permit.permit_visible and permit.permit_readable:
            if permit.permit_expired:
                needs_review = True
            else:
                auth_found = True
                auth_type = "PERMIT"
        elif permit.permit_visible and not permit.permit_readable:
            needs_review = True
        
        if not auth_found and digital_auth.checked and digital_auth.vrm_matched:
            if digital_auth.authorisation_active and digital_auth.covers_observation_window:
                auth_found = True
                auth_type = "DIGITAL"
        
        if not auth_found and staff_vehicle.checked:
            if staff_vehicle.is_staff_vehicle or staff_vehicle.staff_permit_visible:
                auth_found = True
                auth_type = "STAFF"
        
        if not vehicle_position.correctly_parked:
            if auth_found:
                needs_review = True
            else:
                pass
        
        if evidence_quality.overall_quality == "LOW":
            needs_review = True
        
        confidence_score = 0
        if auth_found:
            confidence_score = 70
            if permit.confidence > 0:
                confidence_score = max(confidence_score, permit.confidence)
            if vehicle_position.confidence > 0:
                confidence_score = int((confidence_score + vehicle_position.confidence) / 2)
        else:
            confidence_score = 60
            if evidence_quality.overall_quality == "HIGH":
                confidence_score = 80
        
        if needs_review:
            decision = AuthorisedDecision.REVIEW_REQUIRED
            confidence = AuthorisedConfidence.LOW
            if auth_found:
                reason = "Authorisation found but requires manual verification"
                justification = "Evidence suggests authorisation may be present but clarity insufficient for automated decision. Manual review required under enforcement guidelines."
            else:
                reason = "Insufficient evidence clarity for automated decision"
                justification = "Evidence quality or permit visibility insufficient for reliable automated decision. Manual operator review required."
        elif auth_found:
            decision = AuthorisedDecision.AUTHORISED
            confidence = AuthorisedConfidence.HIGH if confidence_score >= 75 else AuthorisedConfidence.MEDIUM
            reason = f"Vehicle authorised via {auth_type}"
            if auth_type == "PERMIT":
                justification = f"Valid permit clearly visible in windscreen. Permit number: {permit.permit_number or 'detected'}. Vehicle is authorised to park in this bay."
            elif auth_type == "DIGITAL":
                justification = "Vehicle registration matches active digital authorisation record covering the observation time window."
            else:
                justification = "Vehicle identified as authorised staff/operator vehicle for this site."
        else:
            decision = AuthorisedDecision.NOT_AUTHORISED
            confidence = AuthorisedConfidence.HIGH if confidence_score >= 75 else AuthorisedConfidence.MEDIUM
            reason = "No valid authorisation found"
            justification = "No valid permit visible, no digital authorisation record matches, and vehicle not listed as staff vehicle. Under UK parking regulations, vehicles without valid authorisation are not permitted in Authorised/Permit Holder bays."
        
        return decision, confidence, confidence_score, reason, justification, auth_found, auth_type, needs_review
    
    def _build_insufficient_evidence_result(
        self,
        observation_window: Dict[str, Any],
        report_lines: List[str]
    ) -> AuthorisedBayAnalysisResult:
        """Build result for insufficient evidence."""
        
        report_lines.append("--- INSUFFICIENT EVIDENCE ---")
        report_lines.append("No image analysis results available")
        report_lines.append("Decision: REVIEW_REQUIRED")
        report_lines.append("=== END REPORT ===")
        
        return AuthorisedBayAnalysisResult(
            bay_type="AuthorisedBay",
            decision=AuthorisedDecision.REVIEW_REQUIRED,
            confidence=AuthorisedConfidence.LOW,
            confidence_score=0,
            reason="No evidence images available for analysis",
            evidence_quality={
                "sufficientImages": False,
                "fullVehicleVisible": False,
                "windscreenVisible": False,
                "dashboardVisible": False,
                "ocrConfidenceMet": False,
                "overallQuality": "LOW"
            },
            permit_check={
                "permitVisible": False,
                "permitReadable": False,
                "permitNumber": None,
                "permitExpiry": None,
                "permitSiteCode": None,
                "permitValidForSite": False,
                "permitExpired": False,
                "confidence": 0
            },
            digital_authorisation={
                "checked": False,
                "vrmMatched": False,
                "authorisationActive": False,
                "coversObservationWindow": False,
                "authorisationType": None
            },
            staff_vehicle={
                "checked": False,
                "isStaffVehicle": False,
                "staffPermitVisible": False,
                "staffIdVisible": False
            },
            vehicle_position={
                "fullyInsideBay": False,
                "overlapDetected": False,
                "overlapType": None,
                "correctlyParked": False,
                "confidence": 0
            },
            authorisation_found=False,
            authorisation_type=None,
            vehicle_position_valid=False,
            observation_window=observation_window,
            manual_review_required=True,
            legal_justification="Insufficient evidence for automated analysis. Manual review required.",
            analysis_report=report_lines
        )
    
    def _build_review_required_result(
        self,
        reason: str,
        evidence_quality: EvidenceQualityDetails,
        observation_window: Dict[str, Any],
        report_lines: List[str]
    ) -> AuthorisedBayAnalysisResult:
        """Build result requiring manual review."""
        
        report_lines.append("--- REVIEW REQUIRED ---")
        report_lines.append(f"Reason: {reason}")
        report_lines.append("Decision: REVIEW_REQUIRED")
        report_lines.append("=== END REPORT ===")
        
        return AuthorisedBayAnalysisResult(
            bay_type="AuthorisedBay",
            decision=AuthorisedDecision.REVIEW_REQUIRED,
            confidence=AuthorisedConfidence.LOW,
            confidence_score=30,
            reason=reason,
            evidence_quality={
                "sufficientImages": evidence_quality.sufficient_images,
                "fullVehicleVisible": evidence_quality.full_vehicle_visible,
                "windscreenVisible": evidence_quality.windscreen_visible,
                "dashboardVisible": evidence_quality.dashboard_visible,
                "ocrConfidenceMet": evidence_quality.ocr_confidence_met,
                "overallQuality": evidence_quality.overall_quality
            },
            permit_check={
                "permitVisible": False,
                "permitReadable": False,
                "permitNumber": None,
                "permitExpiry": None,
                "permitSiteCode": None,
                "permitValidForSite": False,
                "permitExpired": False,
                "confidence": 0
            },
            digital_authorisation={
                "checked": False,
                "vrmMatched": False,
                "authorisationActive": False,
                "coversObservationWindow": False,
                "authorisationType": None
            },
            staff_vehicle={
                "checked": False,
                "isStaffVehicle": False,
                "staffPermitVisible": False,
                "staffIdVisible": False
            },
            vehicle_position={
                "fullyInsideBay": False,
                "overlapDetected": False,
                "overlapType": None,
                "correctlyParked": False,
                "confidence": 0
            },
            authorisation_found=False,
            authorisation_type=None,
            vehicle_position_valid=False,
            observation_window=observation_window,
            manual_review_required=True,
            legal_justification=f"Manual review required: {reason}",
            analysis_report=report_lines
        )


authorised_bay_analysis_service = AuthorisedBayAnalysisService()
