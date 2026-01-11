"""
Loading Bay Analysis Service - UK compliant loading/unloading detection.

This service implements the 8-phase analysis for loading bay violations:
1. Vehicle Type Classification
2. Loading Activity Detection (staff, goods, doors)
3. Continuity Check (multi-frame analysis)
4. Time Reasonableness (UK standards)
5. Final Decision Logic
6. UI Output Structure
7. UI Display Rules
8. Fail-Safe (manual review for low confidence)

Reference: UK Civil Parking Enforcement guidance for loading bays.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class VehicleType(str, Enum):
    VAN = "van"
    LORRY = "lorry"
    PICKUP = "pickup"
    PASSENGER_CAR = "passenger_car"
    UNKNOWN = "unknown"


class LoadingDecision(str, Enum):
    DO_NOT_ISSUE = "DO_NOT_ISSUE"
    ISSUE_PCN = "ISSUE_PCN"
    MANUAL_REVIEW = "MANUAL_REVIEW"


class LoadingConfidence(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass
class LoadingActivityFlags:
    """Flags detected from image analysis."""
    staff_detected: bool = False
    goods_detected: bool = False
    doors_open: bool = False
    motion_across_frames: bool = False
    human_near_vehicle: bool = False
    objects_being_carried: bool = False
    vehicle_to_building_movement: bool = False


@dataclass
class LoadingAnalysisResult:
    """Complete loading bay analysis result."""
    bay_type: str
    decision: LoadingDecision
    confidence: LoadingConfidence
    confidence_score: int
    loading_analysis: Dict[str, Any]
    legal_justification: str
    manual_review_required: bool
    activity_frames: List[Dict[str, Any]]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "bayType": self.bay_type,
            "decision": self.decision.value,
            "confidence": self.confidence.value,
            "confidenceScore": self.confidence_score,
            "loadingAnalysis": self.loading_analysis,
            "legalJustification": self.legal_justification,
            "manualReviewRequired": self.manual_review_required,
            "activityFrames": self.activity_frames
        }


class LoadingBayAnalysisService:
    """
    Analyzes evidence for loading bay violations with UK compliance.
    
    A vehicle MAY use a loading bay if:
    - Vehicle is a goods vehicle (van/lorry/pickup) OR
    - Private vehicle actively loading/unloading heavy/bulky items
    - Loading/unloading is CONTINUOUS
    - No maximum stay exceeded
    
    A PCN MUST NOT be issued if:
    - Active loading/unloading is visible
    - Staff/driver present handling goods
    - Doors/boot open during activity
    - Time on site is reasonable
    """
    
    # Time limits for reasonable loading (minutes)
    SMALL_GOODS_MAX_MINUTES = 20
    LARGE_GOODS_MAX_MINUTES = 40
    
    # Maximum gap allowed between activity (minutes)
    MAX_ACTIVITY_GAP_MINUTES = 3
    
    # Minimum confidence for auto-decision
    MIN_AUTO_DECISION_CONFIDENCE = 70
    
    # Vehicle types likely to be loading
    LOADING_VEHICLE_TYPES = {VehicleType.VAN, VehicleType.LORRY, VehicleType.PICKUP}
    
    def __init__(self):
        pass
    
    async def analyze_loading_bay(
        self,
        evidence_items: List[Dict[str, Any]],
        image_analysis_results: List[Dict[str, Any]],
        dvla_vehicle_data: Optional[Dict[str, Any]],
        observe_from: Optional[datetime],
        observe_to: Optional[datetime],
        duration_minutes: Optional[int],
        signage_time_limit: Optional[int] = None
    ) -> LoadingAnalysisResult:
        """
        Perform complete loading bay analysis.
        
        Args:
            evidence_items: List of evidence items with timestamps
            image_analysis_results: Vision GPT analysis results for each image
            dvla_vehicle_data: Vehicle data from DVLA lookup (if available)
            observe_from: First observation timestamp
            observe_to: Last observation timestamp
            duration_minutes: Total duration on site
            signage_time_limit: Maximum stay from signage (if any)
        
        Returns:
            LoadingAnalysisResult with decision and justification
        """
        logger.info(f"Starting loading bay analysis with {len(evidence_items)} evidence items")
        
        # Phase 1: Vehicle Type Classification
        vehicle_type = self._classify_vehicle_type(image_analysis_results, dvla_vehicle_data)
        vehicle_likely_for_loading = vehicle_type in self.LOADING_VEHICLE_TYPES
        
        logger.info(f"Phase 1 - Vehicle type: {vehicle_type.value}, likely for loading: {vehicle_likely_for_loading}")
        
        # Phase 2: Loading Activity Detection
        activity_flags = self._detect_loading_activity(image_analysis_results)
        
        logger.info(f"Phase 2 - Activity flags: staff={activity_flags.staff_detected}, "
                   f"goods={activity_flags.goods_detected}, doors={activity_flags.doors_open}")
        
        # Phase 3: Continuity Check
        continuous_loading, activity_frames = self._check_continuity(
            evidence_items, image_analysis_results
        )
        
        logger.info(f"Phase 3 - Continuous loading: {continuous_loading}, "
                   f"activity frames: {len(activity_frames)}")
        
        # Phase 4: Time Reasonableness
        time_reasonable = self._check_time_reasonableness(
            duration_minutes,
            signage_time_limit,
            activity_flags.goods_detected
        )
        
        logger.info(f"Phase 4 - Time reasonable: {time_reasonable} "
                   f"(duration: {duration_minutes} min)")
        
        # Phase 5: Final Decision Logic
        decision, confidence, confidence_score, justification = self._make_decision(
            vehicle_likely_for_loading,
            activity_flags,
            continuous_loading,
            time_reasonable,
            duration_minutes
        )
        
        logger.info(f"Phase 5 - Decision: {decision.value}, confidence: {confidence.value} ({confidence_score}%)")
        
        # Phase 8: Fail-Safe Check
        manual_review_required = confidence_score < self.MIN_AUTO_DECISION_CONFIDENCE
        if manual_review_required:
            decision = LoadingDecision.MANUAL_REVIEW
            logger.info("Phase 8 - Low confidence, marking for manual review")
        
        # Build loading analysis dict for Phase 6
        loading_analysis = {
            "vehicleType": vehicle_type.value,
            "vehicleLikelyForLoading": vehicle_likely_for_loading,
            "staffDetected": activity_flags.staff_detected,
            "goodsDetected": activity_flags.goods_detected,
            "doorsOpen": activity_flags.doors_open,
            "humanNearVehicle": activity_flags.human_near_vehicle,
            "objectsBeingCarried": activity_flags.objects_being_carried,
            "motionAcrossFrames": activity_flags.motion_across_frames,
            "continuousLoading": continuous_loading,
            "durationMinutes": duration_minutes,
            "signageTimeLimit": signage_time_limit,
            "timeReasonable": time_reasonable,
            "activityFrameCount": len(activity_frames)
        }
        
        return LoadingAnalysisResult(
            bay_type="LOADING",
            decision=decision,
            confidence=confidence,
            confidence_score=confidence_score,
            loading_analysis=loading_analysis,
            legal_justification=justification,
            manual_review_required=manual_review_required,
            activity_frames=activity_frames
        )
    
    def _classify_vehicle_type(
        self,
        image_analysis_results: List[Dict[str, Any]],
        dvla_data: Optional[Dict[str, Any]]
    ) -> VehicleType:
        """Phase 1: Classify vehicle type from images and DVLA data."""
        
        # Try DVLA data first (most reliable)
        if dvla_data:
            body_type = dvla_data.get("bodyType", "").lower()
            make = dvla_data.get("make", "").lower()
            
            if any(t in body_type for t in ["van", "panel"]):
                return VehicleType.VAN
            if any(t in body_type for t in ["lorry", "truck", "hgv", "lgv"]):
                return VehicleType.LORRY
            if any(t in body_type for t in ["pickup", "pick-up", "pick up"]):
                return VehicleType.PICKUP
            
            # Check common commercial vehicle makes
            commercial_makes = ["ford transit", "mercedes sprinter", "volkswagen transporter",
                              "renault traffic", "citroen relay", "peugeot boxer"]
            for cm in commercial_makes:
                if cm in f"{make} {dvla_data.get('model', '')}".lower():
                    return VehicleType.VAN
        
        # Fall back to image analysis
        for result in image_analysis_results:
            vehicle_data = result.get("vehicleAnalysis", {})
            detected_type = vehicle_data.get("vehicleType", "").lower()
            
            if "van" in detected_type:
                return VehicleType.VAN
            if any(t in detected_type for t in ["lorry", "truck", "hgv"]):
                return VehicleType.LORRY
            if "pickup" in detected_type or "pick-up" in detected_type:
                return VehicleType.PICKUP
            if any(t in detected_type for t in ["car", "saloon", "hatchback", "suv"]):
                return VehicleType.PASSENGER_CAR
        
        return VehicleType.UNKNOWN
    
    def _detect_loading_activity(
        self,
        image_analysis_results: List[Dict[str, Any]]
    ) -> LoadingActivityFlags:
        """Phase 2: Detect loading activity from image analysis."""
        
        flags = LoadingActivityFlags()
        
        for result in image_analysis_results:
            loading_data = result.get("loadingActivity", {})
            
            # Check for staff/human presence
            if loading_data.get("humanDetected", False):
                flags.human_near_vehicle = True
            if loading_data.get("staffDetected", False):
                flags.staff_detected = True
            
            # Check for goods being handled
            if loading_data.get("goodsDetected", False):
                flags.goods_detected = True
            if loading_data.get("objectsCarried", False):
                flags.objects_being_carried = True
            
            # Check for vehicle state
            if loading_data.get("doorsOpen", False):
                flags.doors_open = True
            if loading_data.get("bootOpen", False):
                flags.doors_open = True
            if loading_data.get("rearDoorsOpen", False):
                flags.doors_open = True
            if loading_data.get("sideDoorsOpen", False):
                flags.doors_open = True
            
            # Check for movement patterns
            if loading_data.get("movementDetected", False):
                flags.motion_across_frames = True
            if loading_data.get("vehicleToBuildingMovement", False):
                flags.vehicle_to_building_movement = True
        
        # Infer staff detected from human near vehicle + activity
        if flags.human_near_vehicle and (flags.goods_detected or flags.doors_open):
            flags.staff_detected = True
        
        return flags
    
    def _check_continuity(
        self,
        evidence_items: List[Dict[str, Any]],
        image_analysis_results: List[Dict[str, Any]]
    ) -> tuple[bool, List[Dict[str, Any]]]:
        """Phase 3: Check for continuous loading activity across frames."""
        
        activity_frames = []
        
        # Match analysis results to evidence items by index or ID
        for i, result in enumerate(image_analysis_results):
            loading_data = result.get("loadingActivity", {})
            has_activity = (
                loading_data.get("humanDetected", False) or
                loading_data.get("staffDetected", False) or
                loading_data.get("goodsDetected", False) or
                loading_data.get("doorsOpen", False) or
                loading_data.get("bootOpen", False) or
                loading_data.get("rearDoorsOpen", False) or
                loading_data.get("sideDoorsOpen", False)
            )
            
            if has_activity:
                evidence_id = result.get("evidenceId")
                timestamp = result.get("timestamp")
                
                # Find matching evidence item for timestamp
                if i < len(evidence_items):
                    ev = evidence_items[i]
                    evidence_id = ev.get("id", evidence_id)
                    timestamp = ev.get("timestamp", timestamp)
                
                activity_frames.append({
                    "evidenceId": evidence_id,
                    "timestamp": timestamp,
                    "activityType": self._describe_activity(loading_data),
                    "details": loading_data
                })
        
        # Continuous if at least 2 frames show activity
        if len(activity_frames) < 2:
            return False, activity_frames
        
        # Check for large gaps between activity frames
        sorted_frames = sorted(
            activity_frames,
            key=lambda f: f.get("timestamp") or datetime.min
        )
        
        for i in range(1, len(sorted_frames)):
            prev_ts = sorted_frames[i-1].get("timestamp")
            curr_ts = sorted_frames[i].get("timestamp")
            
            if prev_ts and curr_ts:
                if isinstance(prev_ts, str):
                    try:
                        prev_ts = datetime.fromisoformat(prev_ts)
                    except ValueError:
                        continue
                if isinstance(curr_ts, str):
                    try:
                        curr_ts = datetime.fromisoformat(curr_ts)
                    except ValueError:
                        continue
                
                gap = (curr_ts - prev_ts).total_seconds() / 60
                if gap > self.MAX_ACTIVITY_GAP_MINUTES:
                    # Large gap - not continuous
                    logger.info(f"Activity gap of {gap:.1f} min exceeds {self.MAX_ACTIVITY_GAP_MINUTES} min")
                    return False, activity_frames
        
        return True, activity_frames
    
    def _describe_activity(self, loading_data: Dict[str, Any]) -> str:
        """Generate human-readable activity description."""
        activities = []
        
        if loading_data.get("staffDetected"):
            activities.append("Staff present")
        elif loading_data.get("humanDetected"):
            activities.append("Person near vehicle")
        
        if loading_data.get("goodsDetected"):
            activities.append("Goods visible")
        if loading_data.get("objectsCarried"):
            activities.append("Items being carried")
        
        if loading_data.get("rearDoorsOpen"):
            activities.append("Rear doors open")
        elif loading_data.get("sideDoorsOpen"):
            activities.append("Side doors open")
        elif loading_data.get("bootOpen"):
            activities.append("Boot open")
        elif loading_data.get("doorsOpen"):
            activities.append("Doors open")
        
        return ", ".join(activities) if activities else "Activity detected"
    
    def _check_time_reasonableness(
        self,
        duration_minutes: Optional[int],
        signage_limit: Optional[int],
        has_large_goods: bool
    ) -> bool:
        """Phase 4: Check if time on site is reasonable for loading."""
        
        if duration_minutes is None:
            # Cannot assess without duration
            return True  # Give benefit of doubt
        
        # If signage limit exists, use that
        if signage_limit is not None:
            return duration_minutes <= signage_limit
        
        # Otherwise use UK standard reasonable durations
        if has_large_goods:
            return duration_minutes <= self.LARGE_GOODS_MAX_MINUTES
        else:
            return duration_minutes <= self.SMALL_GOODS_MAX_MINUTES
    
    def _make_decision(
        self,
        vehicle_likely_for_loading: bool,
        activity_flags: LoadingActivityFlags,
        continuous_loading: bool,
        time_reasonable: bool,
        duration_minutes: Optional[int]
    ) -> tuple[LoadingDecision, LoadingConfidence, int, str]:
        """Phase 5: Make final decision with UK compliance."""
        
        # Calculate evidence strength
        evidence_points = 0
        evidence_factors = []
        
        # Vehicle type (1-2 points)
        if vehicle_likely_for_loading:
            evidence_points += 2
            evidence_factors.append("Commercial vehicle type")
        
        # Activity detection (up to 5 points)
        if activity_flags.staff_detected:
            evidence_points += 2
            evidence_factors.append("Staff/driver present")
        elif activity_flags.human_near_vehicle:
            evidence_points += 1
            evidence_factors.append("Person near vehicle")
        
        if activity_flags.goods_detected:
            evidence_points += 2
            evidence_factors.append("Goods visible")
        if activity_flags.objects_being_carried:
            evidence_points += 1
            evidence_factors.append("Items being handled")
        
        if activity_flags.doors_open:
            evidence_points += 1
            evidence_factors.append("Vehicle doors open")
        
        # Continuity (2 points)
        if continuous_loading:
            evidence_points += 2
            evidence_factors.append("Continuous activity observed")
        
        # Time reasonableness (2 points if yes, -2 if no)
        if time_reasonable:
            evidence_points += 2
            evidence_factors.append("Duration within reasonable limits")
        else:
            evidence_points -= 2
            evidence_factors.append("Duration exceeds reasonable limits")
        
        # Decision logic based on UK regulations
        # Max possible points: 12, Min: -2
        max_points = 12
        confidence_score = max(0, min(100, int((evidence_points / max_points) * 100)))
        
        # Decision thresholds
        if evidence_points >= 6 and time_reasonable:
            # Strong evidence of legitimate loading
            decision = LoadingDecision.DO_NOT_ISSUE
            confidence = LoadingConfidence.HIGH if evidence_points >= 8 else LoadingConfidence.MEDIUM
            justification = self._build_do_not_issue_justification(
                evidence_factors,
                duration_minutes,
                vehicle_likely_for_loading
            )
        elif evidence_points <= 2 or not time_reasonable:
            # Weak or no evidence of loading, or exceeded time
            decision = LoadingDecision.ISSUE_PCN
            confidence = LoadingConfidence.MEDIUM
            justification = self._build_issue_pcn_justification(
                evidence_factors,
                duration_minutes,
                time_reasonable
            )
        else:
            # Inconclusive - needs manual review
            decision = LoadingDecision.MANUAL_REVIEW
            confidence = LoadingConfidence.LOW
            confidence_score = min(confidence_score, 65)  # Cap at below threshold
            justification = self._build_review_justification(evidence_factors)
        
        return decision, confidence, confidence_score, justification
    
    def _build_do_not_issue_justification(
        self,
        factors: List[str],
        duration: Optional[int],
        is_commercial: bool
    ) -> str:
        """Build legal justification for DO NOT ISSUE decision."""
        vehicle_desc = "commercial vehicle" if is_commercial else "vehicle"
        duration_str = f"for {duration} minutes" if duration else ""
        
        justification = (
            f"Under UK Civil Parking Enforcement guidance, a PCN should NOT be issued. "
            f"The {vehicle_desc} was observed in the loading bay {duration_str} with clear evidence "
            f"of active loading/unloading activity. "
            f"Key observations: {'; '.join(factors)}. "
            f"This usage complies with loading bay regulations as the driver was engaged in "
            f"legitimate loading/unloading operations."
        )
        return justification
    
    def _build_issue_pcn_justification(
        self,
        factors: List[str],
        duration: Optional[int],
        time_reasonable: bool
    ) -> str:
        """Build legal justification for ISSUE PCN decision."""
        duration_str = f"{duration} minutes" if duration else "unknown duration"
        
        if not time_reasonable:
            justification = (
                f"The vehicle exceeded the reasonable loading time limit. "
                f"Duration: {duration_str}. "
                f"Under UK regulations, loading bays are for active loading/unloading only. "
                f"Observations: {'; '.join(factors) if factors else 'No active loading detected'}. "
                f"The extended stay suggests the bay is being used for parking rather than loading."
            )
        else:
            justification = (
                f"No active loading or unloading activity was observed. "
                f"Duration: {duration_str}. "
                f"Observations: {'; '.join(factors) if factors else 'No staff, goods, or loading activity detected'}. "
                f"Under UK Civil Parking Enforcement guidance, a PCN may be issued when a vehicle "
                f"is parked in a loading bay without engaging in loading/unloading operations."
            )
        return justification
    
    def _build_review_justification(self, factors: List[str]) -> str:
        """Build justification for manual review case."""
        return (
            f"The evidence is inconclusive and requires manual review. "
            f"Observations: {'; '.join(factors) if factors else 'Limited activity detected'}. "
            f"A human operator should review the evidence to determine whether active "
            f"loading/unloading was taking place."
        )


# Singleton instance
loading_bay_analysis_service = LoadingBayAnalysisService()
