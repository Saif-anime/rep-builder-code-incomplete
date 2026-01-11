"""
Evidence Summary Service - Authoritative timestamp extraction and duration calculation.

This service is the SINGLE SOURCE OF TRUTH for:
- Observe From / Observe To times
- Duration calculations
- Timestamp validation
- Confidence scoring

The frontend MUST NOT calculate these values - only display them.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from enum import Enum

logger = logging.getLogger(__name__)


class DurationConfidence(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class TimeSource(str, Enum):
    OCR = "OCR"
    CAMERA_META = "CAMERA_META"
    MANUAL = "MANUAL"
    UNKNOWN = "UNKNOWN"


class TimestampConsistency(str, Enum):
    CONSISTENT = "CONSISTENT"
    PARTIAL = "PARTIAL"
    CONFLICT = "CONFLICT"


class EvidenceSummary:
    """Immutable evidence summary - calculated once by backend."""
    
    def __init__(
        self,
        observe_from: Optional[datetime],
        observe_to: Optional[datetime],
        duration_minutes: Optional[int],
        duration_confidence: DurationConfidence,
        time_source: TimeSource,
        evidence_count: int,
        timestamp_consistency: TimestampConsistency,
        validation_warnings: List[str],
        is_valid_for_pcn: bool,
        pcn_block_reason: Optional[str] = None
    ):
        self.observe_from = observe_from
        self.observe_to = observe_to
        self.duration_minutes = duration_minutes
        self.duration_confidence = duration_confidence
        self.time_source = time_source
        self.evidence_count = evidence_count
        self.timestamp_consistency = timestamp_consistency
        self.validation_warnings = validation_warnings
        self.is_valid_for_pcn = is_valid_for_pcn
        self.pcn_block_reason = pcn_block_reason
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "observeFrom": self.observe_from.isoformat() if self.observe_from else None,
            "observeTo": self.observe_to.isoformat() if self.observe_to else None,
            "durationMinutes": self.duration_minutes,
            "durationConfidence": self.duration_confidence.value,
            "timeSource": self.time_source.value,
            "evidenceCount": self.evidence_count,
            "timestampConsistency": self.timestamp_consistency.value,
            "validationWarnings": self.validation_warnings,
            "isValidForPcn": self.is_valid_for_pcn,
            "pcnBlockReason": self.pcn_block_reason
        }


class EvidenceSummaryService:
    """
    Generates authoritative evidence summaries from OCR extraction results.
    
    Rules:
    - NEVER default to large duration values
    - NEVER infer duration from single image
    - If Observe From == Observe To → duration = 0
    - If duration > 24 hours → mark INVALID
    - If < 2 valid timestamps → LOW confidence
    """
    
    # Maximum valid duration (24 hours)
    MAX_DURATION_MINUTES = 24 * 60
    
    # Minimum confidence for OCR to be considered valid
    MIN_OCR_CONFIDENCE = 50
    
    # High confidence threshold
    HIGH_CONFIDENCE_THRESHOLD = 70
    
    def generate_summary(
        self,
        ocr_results: List[Dict[str, Any]],
        evidence_count: int,
        case_created_at: Optional[datetime] = None
    ) -> EvidenceSummary:
        """
        Generate an authoritative evidence summary from OCR extraction results.
        
        Args:
            ocr_results: List of OCR extraction results with timestamps
            evidence_count: Total number of evidence items
            case_created_at: When the case was created (for validation)
        
        Returns:
            EvidenceSummary with validated data
        """
        validation_warnings: List[str] = []
        
        # Step 1: Filter and validate timestamps
        valid_timestamps = self._extract_valid_timestamps(
            ocr_results, case_created_at, validation_warnings
        )
        
        logger.info(f"Valid timestamps extracted: {len(valid_timestamps)} from {len(ocr_results)} OCR results")
        
        # Step 2: Determine time source
        time_source = self._determine_time_source(ocr_results)
        
        # Step 3: Calculate observe from/to
        observe_from, observe_to = self._calculate_observation_window(valid_timestamps)
        
        # Step 4: Calculate duration with validation
        duration_minutes, duration_valid = self._calculate_duration(
            observe_from, observe_to, validation_warnings
        )
        
        # Step 5: Determine confidence
        duration_confidence = self._calculate_confidence(
            valid_timestamps, ocr_results, duration_valid
        )
        
        # Step 6: Check timestamp consistency
        timestamp_consistency = self._check_consistency(
            valid_timestamps, validation_warnings
        )
        
        # Step 7: Determine PCN eligibility
        is_valid_for_pcn, pcn_block_reason = self._check_pcn_eligibility(
            duration_minutes,
            duration_confidence,
            timestamp_consistency,
            len(valid_timestamps),
            validation_warnings
        )
        
        return EvidenceSummary(
            observe_from=observe_from,
            observe_to=observe_to,
            duration_minutes=duration_minutes,
            duration_confidence=duration_confidence,
            time_source=time_source,
            evidence_count=evidence_count,
            timestamp_consistency=timestamp_consistency,
            validation_warnings=validation_warnings,
            is_valid_for_pcn=is_valid_for_pcn,
            pcn_block_reason=pcn_block_reason
        )
    
    def _extract_valid_timestamps(
        self,
        ocr_results: List[Dict[str, Any]],
        case_created_at: Optional[datetime],
        warnings: List[str]
    ) -> List[datetime]:
        """Extract and validate timestamps from OCR results."""
        valid_timestamps: List[datetime] = []
        now = datetime.utcnow()
        
        for result in ocr_results:
            timestamp_str = result.get("timestamp")
            confidence = result.get("confidence", 0)
            evidence_id = result.get("evidenceId")
            
            if not timestamp_str:
                continue
            
            # Skip low confidence results
            if confidence < self.MIN_OCR_CONFIDENCE:
                warnings.append(f"Evidence {evidence_id}: Low OCR confidence ({confidence}%)")
                continue
            
            try:
                timestamp = datetime.fromisoformat(timestamp_str)
            except (ValueError, TypeError):
                warnings.append(f"Evidence {evidence_id}: Invalid timestamp format")
                continue
            
            # Validate: No future timestamps
            if timestamp > now + timedelta(hours=1):  # Allow 1 hour buffer for timezone
                warnings.append(f"Evidence {evidence_id}: Future timestamp rejected ({timestamp_str})")
                continue
            
            # Validate: Not older than case creation (if available)
            if case_created_at and timestamp < case_created_at - timedelta(days=7):
                warnings.append(f"Evidence {evidence_id}: Timestamp before case creation")
                continue
            
            # Validate: Not unreasonably old (more than 30 days)
            if timestamp < now - timedelta(days=30):
                warnings.append(f"Evidence {evidence_id}: Timestamp too old (>30 days)")
                continue
            
            valid_timestamps.append(timestamp)
        
        return valid_timestamps
    
    def _determine_time_source(self, ocr_results: List[Dict[str, Any]]) -> TimeSource:
        """Determine the primary time source from OCR results."""
        sources = [r.get("source", "unknown") for r in ocr_results if r.get("timestamp")]
        
        if not sources:
            return TimeSource.UNKNOWN
        
        if "ocr" in sources:
            return TimeSource.OCR
        if "camera_overlay" in sources or "exif" in sources:
            return TimeSource.CAMERA_META
        if "manual" in sources:
            return TimeSource.MANUAL
        
        return TimeSource.UNKNOWN
    
    def _calculate_observation_window(
        self,
        valid_timestamps: List[datetime]
    ) -> tuple[Optional[datetime], Optional[datetime]]:
        """Calculate observe from/to from valid timestamps."""
        if not valid_timestamps:
            return None, None
        
        sorted_timestamps = sorted(valid_timestamps)
        return sorted_timestamps[0], sorted_timestamps[-1]
    
    def _calculate_duration(
        self,
        observe_from: Optional[datetime],
        observe_to: Optional[datetime],
        warnings: List[str]
    ) -> tuple[Optional[int], bool]:
        """
        Calculate duration with strict validation.
        
        Returns:
            Tuple of (duration_minutes, is_valid)
        """
        if not observe_from or not observe_to:
            return None, False
        
        # Handle same timestamp
        if observe_from == observe_to:
            warnings.append("Observe From equals Observe To - duration is 0")
            return 0, True
        
        # Calculate duration
        if observe_to < observe_from:
            warnings.append("Invalid: Observe To before Observe From")
            return None, False
        
        duration = observe_to - observe_from
        duration_minutes = int(duration.total_seconds() / 60)
        
        # Validate: Duration > 24 hours is invalid
        if duration_minutes > self.MAX_DURATION_MINUTES:
            warnings.append(f"Duration exceeds 24 hours ({duration_minutes} minutes) - INVALID")
            return None, False
        
        return duration_minutes, True
    
    def _calculate_confidence(
        self,
        valid_timestamps: List[datetime],
        ocr_results: List[Dict[str, Any]],
        duration_valid: bool
    ) -> DurationConfidence:
        """Calculate duration confidence level."""
        if not duration_valid:
            return DurationConfidence.LOW
        
        # Less than 2 valid timestamps = LOW confidence
        if len(valid_timestamps) < 2:
            return DurationConfidence.LOW
        
        # Check OCR confidence scores
        confidences = [r.get("confidence", 0) for r in ocr_results if r.get("timestamp")]
        
        if not confidences:
            return DurationConfidence.LOW
        
        avg_confidence = sum(confidences) / len(confidences)
        
        if avg_confidence >= self.HIGH_CONFIDENCE_THRESHOLD and len(valid_timestamps) >= 2:
            return DurationConfidence.HIGH
        
        if avg_confidence >= self.MIN_OCR_CONFIDENCE:
            return DurationConfidence.MEDIUM
        
        return DurationConfidence.LOW
    
    def _check_consistency(
        self,
        valid_timestamps: List[datetime],
        warnings: List[str]
    ) -> TimestampConsistency:
        """Check timestamp consistency across evidence."""
        if len(valid_timestamps) == 0:
            return TimestampConsistency.CONFLICT
        
        if len(valid_timestamps) == 1:
            warnings.append("Single timestamp - cannot verify consistency")
            return TimestampConsistency.PARTIAL
        
        # Check for suspicious gaps (more than 6 hours between consecutive)
        sorted_timestamps = sorted(valid_timestamps)
        for i in range(1, len(sorted_timestamps)):
            gap = sorted_timestamps[i] - sorted_timestamps[i-1]
            if gap > timedelta(hours=6):
                warnings.append(f"Large gap detected between timestamps ({gap})")
                return TimestampConsistency.PARTIAL
        
        return TimestampConsistency.CONSISTENT
    
    def _check_pcn_eligibility(
        self,
        duration_minutes: Optional[int],
        confidence: DurationConfidence,
        consistency: TimestampConsistency,
        valid_count: int,
        warnings: List[str]
    ) -> tuple[bool, Optional[str]]:
        """
        Check if evidence is sufficient for PCN issuance.
        
        PCN can ONLY be issued if:
        - Duration is valid (not None)
        - Confidence >= MEDIUM
        - Timestamp consistency = CONSISTENT
        """
        if duration_minutes is None:
            return False, "Duration cannot be calculated - manual review required"
        
        if confidence == DurationConfidence.LOW:
            return False, "Low timestamp confidence - manual review required"
        
        if consistency == TimestampConsistency.CONFLICT:
            return False, "Timestamp conflict detected - manual review required"
        
        if valid_count < 2:
            return False, "Insufficient evidence images with valid timestamps"
        
        return True, None


# Singleton instance
evidence_summary_service = EvidenceSummaryService()
