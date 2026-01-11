"""
EV Bay Analysis Service

UK-compliant Electric Vehicle bay analysis for parking enforcement.
Determines whether a vehicle is AUTHORISED to occupy an EV bay.

Checks:
1. Evidence quality validation
2. Vehicle EV capability (BEV/PHEV)
3. Charging activity verification
4. Signage/rule compliance
5. Vehicle positioning
6. Time compliance

Decision outputs: COMPLIANT, NON_COMPLIANT, REVIEW_REQUIRED
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class EVDecision(str, Enum):
    """EV bay compliance decision."""
    COMPLIANT = "COMPLIANT"
    NON_COMPLIANT = "NON_COMPLIANT"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


class EVConfidence(str, Enum):
    """Confidence level for EV bay decision."""
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass
class EvidenceQualityDetails:
    """Evidence quality assessment for EV bay analysis."""
    sufficient_images: bool = False
    full_vehicle_visible: bool = False
    charging_port_visible: bool = False
    charging_unit_visible: bool = False
    ocr_confidence_met: bool = False
    overall_quality: str = "LOW"


@dataclass
class VehicleEVCapability:
    """Vehicle EV capability verification."""
    checked: bool = False
    is_bev: bool = False  # Battery Electric Vehicle
    is_phev: bool = False  # Plug-in Hybrid Electric Vehicle
    ev_badging_visible: bool = False
    fuel_type_from_dvla: Optional[str] = None
    make_model: Optional[str] = None
    is_ev_capable: bool = False
    confidence: int = 0


@dataclass
class ChargingActivityDetails:
    """Charging activity verification."""
    charging_required_by_signage: bool = False
    cable_connected_to_vehicle: bool = False
    cable_connected_to_charger: bool = False
    charging_port_in_use: bool = False
    is_actively_charging: bool = False
    charging_unit_type: Optional[str] = None
    confidence: int = 0


@dataclass
class SignageComplianceDetails:
    """Signage and rule compliance."""
    max_stay_duration_minutes: Optional[int] = None
    time_restrictions: Optional[str] = None
    return_restrictions: Optional[str] = None
    charge_point_users_only: bool = False
    duration_compliant: bool = True
    time_restriction_compliant: bool = True
    all_conditions_met: bool = True
    violations: List[str] = field(default_factory=list)


@dataclass
class VehiclePositionDetails:
    """Vehicle positioning in EV bay."""
    fully_inside_bay: bool = False
    overlap_detected: bool = False
    overlap_type: Optional[str] = None
    correctly_parked: bool = False
    confidence: int = 0


@dataclass
class EVBayAnalysisResult:
    """Complete EV bay analysis result."""
    bay_type: str = "EVBay"
    decision: EVDecision = EVDecision.REVIEW_REQUIRED
    confidence: EVConfidence = EVConfidence.LOW
    confidence_score: int = 0
    reason: str = ""
    
    # Detailed results
    evidence_quality: Dict[str, Any] = field(default_factory=dict)
    vehicle_ev_capability: Dict[str, Any] = field(default_factory=dict)
    charging_activity: Dict[str, Any] = field(default_factory=dict)
    signage_compliance: Dict[str, Any] = field(default_factory=dict)
    vehicle_position: Dict[str, Any] = field(default_factory=dict)
    observation_window: Dict[str, Any] = field(default_factory=dict)
    
    # Analysis metadata
    legal_justification: str = ""
    manual_review_required: bool = False
    analysis_report: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary."""
        return {
            "bayType": self.bay_type,
            "decision": self.decision.value,
            "confidence": self.confidence.value,
            "confidenceScore": self.confidence_score,
            "reason": self.reason,
            "evidenceQuality": self.evidence_quality,
            "vehicleEVCapability": self.vehicle_ev_capability,
            "chargingActivity": self.charging_activity,
            "signageCompliance": self.signage_compliance,
            "vehiclePosition": self.vehicle_position,
            "observationWindow": self.observation_window,
            "legalJustification": self.legal_justification,
            "manualReviewRequired": self.manual_review_required,
            "analysisReport": self.analysis_report,
        }


class EVBayAnalysisService:
    """
    Service for analysing EV bay compliance.
    
    Determines if a vehicle is authorised to occupy an EV bay based on:
    - Vehicle EV capability (BEV/PHEV)
    - Active charging status (if required)
    - Signage compliance
    - Correct positioning
    """
    
    def __init__(self):
        self.min_ocr_confidence = 60
        self.min_overall_confidence = 70
    
    async def analyze_ev_bay(
        self,
        evidence_images: List[Dict[str, Any]],
        image_analysis_results: List[Dict[str, Any]],
        vrm: Optional[str] = None,
        vehicle_details: Optional[Dict[str, Any]] = None,
        site_id: Optional[int] = None,
        site_ev_regulations: Optional[Dict[str, Any]] = None,
        observe_from: Optional[datetime] = None,
        observe_to: Optional[datetime] = None,
        confirmed_bay_type: bool = False
    ) -> EVBayAnalysisResult:
        """
        Perform comprehensive EV bay analysis.
        
        Args:
            evidence_images: List of evidence image data
            image_analysis_results: Vision GPT analysis results
            vrm: Vehicle registration mark
            vehicle_details: DVLA/database vehicle info
            site_id: Parking site identifier
            site_ev_regulations: Site-specific EV bay rules
            observe_from: Observation start time
            observe_to: Observation end time
            confirmed_bay_type: If True, bay type is confirmed by site config
        
        Returns:
            EVBayAnalysisResult with decision and detailed findings
        """
        
        report_lines = [
            "=== EV BAY ANALYSIS REPORT ===",
            f"Generated: {datetime.now().isoformat()}",
            f"VRM: {vrm or 'Unknown'}",
            f"Site ID: {site_id or 'Unknown'}",
            ""
        ]
        
        # Build observation window
        observation_window = {
            "observeFrom": observe_from.isoformat() if observe_from else None,
            "observeTo": observe_to.isoformat() if observe_to else None,
            "durationMinutes": None
        }
        
        if observe_from and observe_to:
            duration = (observe_to - observe_from).total_seconds() / 60
            observation_window["durationMinutes"] = round(duration, 1)
            report_lines.append(f"Observation Window: {observe_from} to {observe_to}")
            report_lines.append(f"Duration: {round(duration, 1)} minutes")
        
        report_lines.append("")
        
        # Check if we have analysis results
        if not image_analysis_results:
            return self._build_insufficient_evidence_result(observation_window, report_lines)
        
        # 1. Evidence Quality Check
        report_lines.append("--- EVIDENCE QUALITY CHECK ---")
        evidence_quality = self._check_evidence_quality(evidence_images, image_analysis_results)
        report_lines.append(f"Sufficient images: {evidence_quality.sufficient_images}")
        report_lines.append(f"Full vehicle visible: {evidence_quality.full_vehicle_visible}")
        report_lines.append(f"Charging port visible: {evidence_quality.charging_port_visible}")
        report_lines.append(f"Charging unit visible: {evidence_quality.charging_unit_visible}")
        report_lines.append(f"OCR confidence met: {evidence_quality.ocr_confidence_met}")
        report_lines.append(f"Overall quality: {evidence_quality.overall_quality}")
        report_lines.append("")
        
        # 2. Vehicle EV Capability Check
        report_lines.append("--- VEHICLE EV CAPABILITY CHECK ---")
        ev_capability = self._check_vehicle_ev_capability(
            image_analysis_results, vehicle_details, vrm
        )
        report_lines.append(f"EV capability checked: {ev_capability.checked}")
        report_lines.append(f"Is BEV: {ev_capability.is_bev}")
        report_lines.append(f"Is PHEV: {ev_capability.is_phev}")
        report_lines.append(f"EV badging visible: {ev_capability.ev_badging_visible}")
        report_lines.append(f"DVLA fuel type: {ev_capability.fuel_type_from_dvla or 'N/A'}")
        report_lines.append(f"Is EV capable: {ev_capability.is_ev_capable}")
        report_lines.append("")
        
        # 3. Charging Activity Check
        report_lines.append("--- CHARGING ACTIVITY CHECK ---")
        charging_activity = self._check_charging_activity(
            image_analysis_results, site_ev_regulations
        )
        report_lines.append(f"Charging required by signage: {charging_activity.charging_required_by_signage}")
        report_lines.append(f"Cable connected to vehicle: {charging_activity.cable_connected_to_vehicle}")
        report_lines.append(f"Cable connected to charger: {charging_activity.cable_connected_to_charger}")
        report_lines.append(f"Charging port in use: {charging_activity.charging_port_in_use}")
        report_lines.append(f"Is actively charging: {charging_activity.is_actively_charging}")
        report_lines.append("")
        
        # 4. Signage Compliance Check
        report_lines.append("--- SIGNAGE COMPLIANCE CHECK ---")
        signage_compliance = self._check_signage_compliance(
            image_analysis_results, site_ev_regulations, observation_window
        )
        report_lines.append(f"Max stay: {signage_compliance.max_stay_duration_minutes or 'N/A'} mins")
        report_lines.append(f"Time restrictions: {signage_compliance.time_restrictions or 'None'}")
        report_lines.append(f"Duration compliant: {signage_compliance.duration_compliant}")
        report_lines.append(f"Time restriction compliant: {signage_compliance.time_restriction_compliant}")
        report_lines.append(f"All conditions met: {signage_compliance.all_conditions_met}")
        if signage_compliance.violations:
            report_lines.append(f"Violations: {', '.join(signage_compliance.violations)}")
        report_lines.append("")
        
        # 5. Vehicle Position Check
        report_lines.append("--- VEHICLE POSITION CHECK ---")
        vehicle_position = self._check_vehicle_position(image_analysis_results)
        report_lines.append(f"Fully inside bay: {vehicle_position.fully_inside_bay}")
        report_lines.append(f"Overlap detected: {vehicle_position.overlap_detected}")
        report_lines.append(f"Correctly parked: {vehicle_position.correctly_parked}")
        report_lines.append("")
        
        # 6. Make Decision
        report_lines.append("--- DECISION ---")
        (
            decision, confidence, confidence_score, reason, justification,
            is_compliant, non_compliance_reasons, needs_review
        ) = self._make_decision(
            evidence_quality, ev_capability, charging_activity,
            signage_compliance, vehicle_position
        )
        
        report_lines.append(f"Decision: {decision.value}")
        report_lines.append(f"Confidence: {confidence.value} ({confidence_score}%)")
        report_lines.append(f"Reason: {reason}")
        report_lines.append(f"Manual review required: {needs_review}")
        report_lines.append("")
        report_lines.append("=== END REPORT ===")
        
        return EVBayAnalysisResult(
            bay_type="EVBay",
            decision=decision,
            confidence=confidence,
            confidence_score=confidence_score,
            reason=reason,
            evidence_quality={
                "sufficientImages": evidence_quality.sufficient_images,
                "fullVehicleVisible": evidence_quality.full_vehicle_visible,
                "chargingPortVisible": evidence_quality.charging_port_visible,
                "chargingUnitVisible": evidence_quality.charging_unit_visible,
                "ocrConfidenceMet": evidence_quality.ocr_confidence_met,
                "overallQuality": evidence_quality.overall_quality,
            },
            vehicle_ev_capability={
                "checked": ev_capability.checked,
                "isBEV": ev_capability.is_bev,
                "isPHEV": ev_capability.is_phev,
                "evBadgingVisible": ev_capability.ev_badging_visible,
                "fuelTypeFromDVLA": ev_capability.fuel_type_from_dvla,
                "makeModel": ev_capability.make_model,
                "isEVCapable": ev_capability.is_ev_capable,
                "confidence": ev_capability.confidence,
            },
            charging_activity={
                "chargingRequiredBySignage": charging_activity.charging_required_by_signage,
                "cableConnectedToVehicle": charging_activity.cable_connected_to_vehicle,
                "cableConnectedToCharger": charging_activity.cable_connected_to_charger,
                "chargingPortInUse": charging_activity.charging_port_in_use,
                "isActivelyCharging": charging_activity.is_actively_charging,
                "chargingUnitType": charging_activity.charging_unit_type,
                "confidence": charging_activity.confidence,
            },
            signage_compliance={
                "maxStayDurationMinutes": signage_compliance.max_stay_duration_minutes,
                "timeRestrictions": signage_compliance.time_restrictions,
                "returnRestrictions": signage_compliance.return_restrictions,
                "chargePointUsersOnly": signage_compliance.charge_point_users_only,
                "durationCompliant": signage_compliance.duration_compliant,
                "timeRestrictionCompliant": signage_compliance.time_restriction_compliant,
                "allConditionsMet": signage_compliance.all_conditions_met,
                "violations": signage_compliance.violations,
            },
            vehicle_position={
                "fullyInsideBay": vehicle_position.fully_inside_bay,
                "overlapDetected": vehicle_position.overlap_detected,
                "overlapType": vehicle_position.overlap_type,
                "correctlyParked": vehicle_position.correctly_parked,
                "confidence": vehicle_position.confidence,
            },
            observation_window=observation_window,
            legal_justification=justification,
            manual_review_required=needs_review,
            analysis_report="\n".join(report_lines),
        )
    
    def _check_evidence_quality(
        self,
        evidence_images: List[Dict[str, Any]],
        image_analysis_results: List[Dict[str, Any]]
    ) -> EvidenceQualityDetails:
        """Check evidence quality for EV bay analysis."""
        
        details = EvidenceQualityDetails()
        details.sufficient_images = len(evidence_images) >= 1
        
        full_vehicle_count = 0
        charging_port_count = 0
        charging_unit_count = 0
        ocr_confidence_sum = 0
        ocr_count = 0
        
        for result in image_analysis_results:
            ev_data = result.get("evBayAnalysis", {})
            evidence = ev_data.get("evidenceQuality", {})
            
            if evidence.get("fullVehicleVisible", False):
                full_vehicle_count += 1
            
            if evidence.get("chargingPortVisible", False):
                charging_port_count += 1
            
            if evidence.get("chargingUnitVisible", False):
                charging_unit_count += 1
            
            ocr_conf = evidence.get("ocrConfidence", 0)
            if ocr_conf > 0:
                ocr_confidence_sum += ocr_conf
                ocr_count += 1
        
        details.full_vehicle_visible = full_vehicle_count > 0
        details.charging_port_visible = charging_port_count > 0
        details.charging_unit_visible = charging_unit_count > 0
        
        avg_ocr_confidence = ocr_confidence_sum / ocr_count if ocr_count > 0 else 0
        details.ocr_confidence_met = avg_ocr_confidence >= self.min_ocr_confidence
        
        # Calculate overall quality
        quality_score = 0
        if details.sufficient_images:
            quality_score += 20
        if details.full_vehicle_visible:
            quality_score += 30
        if details.charging_port_visible:
            quality_score += 25
        if details.charging_unit_visible:
            quality_score += 15
        if details.ocr_confidence_met:
            quality_score += 10
        
        if quality_score >= 80:
            details.overall_quality = "HIGH"
        elif quality_score >= 50:
            details.overall_quality = "MEDIUM"
        else:
            details.overall_quality = "LOW"
        
        return details
    
    def _check_vehicle_ev_capability(
        self,
        image_analysis_results: List[Dict[str, Any]],
        vehicle_details: Optional[Dict[str, Any]],
        vrm: Optional[str]
    ) -> VehicleEVCapability:
        """Check if vehicle is EV capable (BEV or PHEV)."""
        
        details = VehicleEVCapability()
        details.checked = True
        
        # Check DVLA data if available
        if vehicle_details:
            fuel_type = vehicle_details.get("fuelType", "").upper()
            details.fuel_type_from_dvla = fuel_type
            details.make_model = f"{vehicle_details.get('make', '')} {vehicle_details.get('model', '')}".strip()
            
            if fuel_type in ["ELECTRIC", "ELECTRICITY", "EV", "BEV"]:
                details.is_bev = True
                details.is_ev_capable = True
                details.confidence = 95
            elif fuel_type in ["HYBRID ELECTRIC", "PHEV", "PLUG-IN HYBRID", "PETROL/ELECTRIC", "DIESEL/ELECTRIC"]:
                details.is_phev = True
                details.is_ev_capable = True
                details.confidence = 90
        
        # Check Vision GPT analysis for EV badging
        for result in image_analysis_results:
            ev_data = result.get("evBayAnalysis", {})
            vehicle_check = ev_data.get("vehicleEVCapability", {})
            
            if vehicle_check.get("evBadgingVisible", False):
                details.ev_badging_visible = True
                
                if not details.is_ev_capable:
                    if vehicle_check.get("isBEV", False):
                        details.is_bev = True
                        details.is_ev_capable = True
                        details.confidence = max(details.confidence, 80)
                    elif vehicle_check.get("isPHEV", False):
                        details.is_phev = True
                        details.is_ev_capable = True
                        details.confidence = max(details.confidence, 75)
            
            badge_conf = vehicle_check.get("confidence", 0)
            if badge_conf > details.confidence and details.ev_badging_visible:
                details.confidence = badge_conf
        
        return details
    
    def _check_charging_activity(
        self,
        image_analysis_results: List[Dict[str, Any]],
        site_ev_regulations: Optional[Dict[str, Any]]
    ) -> ChargingActivityDetails:
        """Check charging activity status."""
        
        details = ChargingActivityDetails()
        
        # Determine if charging is required by signage
        if site_ev_regulations:
            details.charging_required_by_signage = site_ev_regulations.get(
                "chargingRequired", False
            )
        
        cable_to_vehicle_count = 0
        cable_to_charger_count = 0
        port_in_use_count = 0
        total_frames = len(image_analysis_results) if image_analysis_results else 1
        confidence_sum = 0
        
        for result in image_analysis_results:
            ev_data = result.get("evBayAnalysis", {})
            charging = ev_data.get("chargingActivity", {})
            
            if charging.get("cableConnectedToVehicle", False):
                cable_to_vehicle_count += 1
            
            if charging.get("cableConnectedToCharger", False):
                cable_to_charger_count += 1
            
            if charging.get("chargingPortInUse", False):
                port_in_use_count += 1
            
            if charging.get("chargingUnitType"):
                details.charging_unit_type = charging["chargingUnitType"]
            
            # Also check signage for charging requirements
            signage = ev_data.get("signageCheck", {})
            if signage.get("whileChargingOnly", False):
                details.charging_required_by_signage = True
            
            confidence_sum += charging.get("confidence", 0)
        
        details.cable_connected_to_vehicle = cable_to_vehicle_count > 0
        details.cable_connected_to_charger = cable_to_charger_count > 0
        details.charging_port_in_use = port_in_use_count > 0
        
        # Determine if actively charging
        if details.cable_connected_to_vehicle and details.cable_connected_to_charger:
            details.is_actively_charging = True
        elif details.cable_connected_to_vehicle and details.charging_port_in_use:
            details.is_actively_charging = True
        
        details.confidence = int(confidence_sum / total_frames) if total_frames > 0 else 0
        
        return details
    
    def _check_signage_compliance(
        self,
        image_analysis_results: List[Dict[str, Any]],
        site_ev_regulations: Optional[Dict[str, Any]],
        observation_window: Dict[str, Any]
    ) -> SignageComplianceDetails:
        """Check compliance with signage and rules."""
        
        details = SignageComplianceDetails()
        
        # Get rules from site regulations or detected signage
        if site_ev_regulations:
            details.max_stay_duration_minutes = site_ev_regulations.get("maxStayMinutes")
            details.time_restrictions = site_ev_regulations.get("timeRestrictions")
            details.return_restrictions = site_ev_regulations.get("returnRestrictions")
            details.charge_point_users_only = site_ev_regulations.get("chargePointUsersOnly", False)
        
        # Check signage from Vision GPT
        for result in image_analysis_results:
            ev_data = result.get("evBayAnalysis", {})
            signage = ev_data.get("signageCheck", {})
            
            if signage.get("maxStayMinutes") and not details.max_stay_duration_minutes:
                details.max_stay_duration_minutes = signage["maxStayMinutes"]
            
            if signage.get("timeRestrictions") and not details.time_restrictions:
                details.time_restrictions = signage["timeRestrictions"]
            
            if signage.get("chargePointUsersOnly", False):
                details.charge_point_users_only = True
        
        # Check duration compliance
        duration = observation_window.get("durationMinutes")
        if duration and details.max_stay_duration_minutes:
            if duration > details.max_stay_duration_minutes:
                details.duration_compliant = False
                details.violations.append(
                    f"Exceeded max stay ({duration} mins > {details.max_stay_duration_minutes} mins)"
                )
        
        # Update all conditions met
        details.all_conditions_met = (
            details.duration_compliant and
            details.time_restriction_compliant and
            len(details.violations) == 0
        )
        
        return details
    
    def _check_vehicle_position(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> VehiclePositionDetails:
        """Check vehicle is correctly positioned in EV bay."""
        
        details = VehiclePositionDetails()
        inside_count = 0
        overlap_count = 0
        total_frames = len(image_analysis_results) if image_analysis_results else 1
        
        for result in image_analysis_results:
            ev_data = result.get("evBayAnalysis", {})
            position = ev_data.get("vehiclePosition", {})
            
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
        evidence: EvidenceQualityDetails,
        ev_capability: VehicleEVCapability,
        charging: ChargingActivityDetails,
        signage: SignageComplianceDetails,
        position: VehiclePositionDetails
    ) -> tuple:
        """Make final EV bay compliance decision."""
        
        is_compliant = True
        non_compliance_reasons = []
        needs_review = False
        
        # Check evidence quality
        if evidence.overall_quality == "LOW":
            needs_review = True
        
        # Check EV capability
        if not ev_capability.is_ev_capable:
            is_compliant = False
            non_compliance_reasons.append("Vehicle is not EV capable (not BEV or PHEV)")
        
        # Check charging if required
        if charging.charging_required_by_signage:
            if not charging.is_actively_charging:
                # Check if cable is visible but unclear
                if charging.cable_connected_to_vehicle or charging.charging_port_in_use:
                    needs_review = True
                else:
                    is_compliant = False
                    non_compliance_reasons.append("Not actively charging (required by signage)")
        
        # Check signage compliance
        if not signage.all_conditions_met:
            is_compliant = False
            non_compliance_reasons.extend(signage.violations)
        
        # Check position
        if not position.correctly_parked:
            if position.overlap_detected:
                is_compliant = False
                non_compliance_reasons.append(f"Vehicle overlapping: {position.overlap_type or 'adjacent area'}")
            elif not position.fully_inside_bay:
                needs_review = True
        
        # Calculate confidence score
        confidence_score = 0
        if ev_capability.confidence > 0:
            confidence_score += ev_capability.confidence * 0.4
        if charging.confidence > 0:
            confidence_score += charging.confidence * 0.3
        if position.confidence > 0:
            confidence_score += position.confidence * 0.3
        
        if confidence_score == 0:
            confidence_score = 60 if is_compliant else 50
        
        confidence_score = int(min(confidence_score, 100))
        
        # Determine final decision
        if needs_review or evidence.overall_quality == "LOW":
            decision = EVDecision.REVIEW_REQUIRED
            confidence = EVConfidence.LOW
            if is_compliant:
                reason = "Evidence unclear - manual verification required"
                justification = "While initial analysis suggests compliance, evidence quality is insufficient for automated decision. Under UK parking enforcement guidelines, unclear charging status or signage requires manual review."
            else:
                reason = "Potential non-compliance detected but review required"
                justification = f"Analysis indicates potential issues: {'; '.join(non_compliance_reasons)}. However, evidence quality requires manual verification before enforcement action."
        elif is_compliant:
            decision = EVDecision.COMPLIANT
            confidence = EVConfidence.HIGH if confidence_score >= 75 else EVConfidence.MEDIUM
            
            if ev_capability.is_bev:
                vehicle_type = "Battery Electric Vehicle (BEV)"
            elif ev_capability.is_phev:
                vehicle_type = "Plug-in Hybrid (PHEV)"
            else:
                vehicle_type = "EV-capable vehicle"
            
            reason = f"{vehicle_type} correctly parked in EV bay"
            
            if charging.is_actively_charging:
                justification = f"{vehicle_type} confirmed via {'DVLA data' if ev_capability.fuel_type_from_dvla else 'visual identification'}. Vehicle is actively charging with cable connected. All EV bay conditions satisfied."
            else:
                justification = f"{vehicle_type} confirmed via {'DVLA data' if ev_capability.fuel_type_from_dvla else 'visual identification'}. Vehicle correctly positioned in EV bay. Signage does not require active charging."
        else:
            decision = EVDecision.NON_COMPLIANT
            confidence = EVConfidence.HIGH if confidence_score >= 75 else EVConfidence.MEDIUM
            reason = "; ".join(non_compliance_reasons)
            justification = f"Vehicle does not meet EV bay requirements. {reason}. Under UK parking regulations, EV bays are reserved for electric vehicles meeting posted conditions."
        
        return (
            decision, confidence, confidence_score, reason, justification,
            is_compliant, non_compliance_reasons, needs_review
        )
    
    def _build_insufficient_evidence_result(
        self,
        observation_window: Dict[str, Any],
        report_lines: List[str]
    ) -> EVBayAnalysisResult:
        """Build result for insufficient evidence."""
        
        report_lines.append("--- INSUFFICIENT EVIDENCE ---")
        report_lines.append("No image analysis results available")
        report_lines.append("Decision: REVIEW_REQUIRED")
        report_lines.append("=== END REPORT ===")
        
        return EVBayAnalysisResult(
            bay_type="EVBay",
            decision=EVDecision.REVIEW_REQUIRED,
            confidence=EVConfidence.LOW,
            confidence_score=0,
            reason="No evidence images available for analysis",
            evidence_quality={
                "sufficientImages": False,
                "fullVehicleVisible": False,
                "chargingPortVisible": False,
                "chargingUnitVisible": False,
                "ocrConfidenceMet": False,
                "overallQuality": "LOW",
            },
            vehicle_ev_capability={
                "checked": False,
                "isBEV": False,
                "isPHEV": False,
                "evBadgingVisible": False,
                "fuelTypeFromDVLA": None,
                "makeModel": None,
                "isEVCapable": False,
                "confidence": 0,
            },
            charging_activity={
                "chargingRequiredBySignage": False,
                "cableConnectedToVehicle": False,
                "cableConnectedToCharger": False,
                "chargingPortInUse": False,
                "isActivelyCharging": False,
                "chargingUnitType": None,
                "confidence": 0,
            },
            signage_compliance={
                "maxStayDurationMinutes": None,
                "timeRestrictions": None,
                "returnRestrictions": None,
                "chargePointUsersOnly": False,
                "durationCompliant": True,
                "timeRestrictionCompliant": True,
                "allConditionsMet": True,
                "violations": [],
            },
            vehicle_position={
                "fullyInsideBay": False,
                "overlapDetected": False,
                "overlapType": None,
                "correctlyParked": False,
                "confidence": 0,
            },
            observation_window=observation_window,
            legal_justification="Insufficient evidence for EV bay compliance analysis. Manual review required.",
            manual_review_required=True,
            analysis_report="\n".join(report_lines),
        )
