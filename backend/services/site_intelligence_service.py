"""
Site Intelligence Service

Provides site-specific intelligence for enforcement decisions:
- Bay-level information (signage clarity, marking condition)
- Behavior patterns and known issues
- Enforcement confidence adjustments based on site data
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from dataclasses import dataclass

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass
class BayIntelligence:
    """Intelligence data for a specific bay."""
    bay_identifier: str
    bay_type: str
    zone: Optional[str]
    signage_clarity_score: int
    marking_condition_score: int
    common_misuse_patterns: List[str]
    notes: Optional[str]


@dataclass
class EnforcementGuidance:
    """Guidance for enforcement officers based on site intelligence."""
    confidence_level: str
    confidence_adjustment: float
    reasoning: str
    additional_evidence_needed: List[str]
    known_issues: List[str]
    officer_guidance: List[str]


class SiteIntelligenceService:
    """
    Service for providing site-specific intelligence during enforcement analysis.
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    def get_bay_intelligence(
        self,
        site_id: int,
        bay_type: Optional[str] = None,
        bay_identifier: Optional[str] = None
    ) -> Optional[BayIntelligence]:
        """Get intelligence for a specific bay at a site."""
        from backend.db.models import SiteIntelligenceBay
        
        query = self.db.query(SiteIntelligenceBay).filter(
            SiteIntelligenceBay.site_id == site_id,
            SiteIntelligenceBay.is_active == True
        )
        
        if bay_identifier:
            query = query.filter(SiteIntelligenceBay.bay_identifier == bay_identifier)
        elif bay_type:
            query = query.filter(SiteIntelligenceBay.bay_type == bay_type)
        
        bay = query.first()
        
        if not bay:
            return None
        
        return BayIntelligence(
            bay_identifier=bay.bay_identifier,
            bay_type=bay.bay_type,
            zone=bay.zone,
            signage_clarity_score=bay.signage_clarity_score,
            marking_condition_score=bay.marking_condition_score,
            common_misuse_patterns=bay.common_misuse_patterns or [],
            notes=bay.notes
        )
    
    def get_all_bay_intelligence(self, site_id: int) -> List[BayIntelligence]:
        """Get all bay intelligence for a site."""
        from backend.db.models import SiteIntelligenceBay
        
        bays = self.db.query(SiteIntelligenceBay).filter(
            SiteIntelligenceBay.site_id == site_id,
            SiteIntelligenceBay.is_active == True
        ).all()
        
        return [
            BayIntelligence(
                bay_identifier=bay.bay_identifier,
                bay_type=bay.bay_type,
                zone=bay.zone,
                signage_clarity_score=bay.signage_clarity_score,
                marking_condition_score=bay.marking_condition_score,
                common_misuse_patterns=bay.common_misuse_patterns or [],
                notes=bay.notes
            )
            for bay in bays
        ]
    
    def get_behavior_patterns(
        self,
        site_id: int,
        pattern_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get behavior patterns for a site."""
        from backend.db.models import SiteBehaviorPattern
        
        query = self.db.query(SiteBehaviorPattern).filter(
            SiteBehaviorPattern.site_id == site_id,
            SiteBehaviorPattern.is_active == True
        )
        
        if pattern_type:
            query = query.filter(SiteBehaviorPattern.pattern_type == pattern_type)
        
        patterns = query.all()
        
        return [
            {
                "id": p.id,
                "patternType": p.pattern_type,
                "description": p.description,
                "peakTimes": p.peak_times or [],
                "affectedBays": p.affected_bays or [],
                "frequency": p.frequency,
                "severity": p.severity,
                "notes": p.notes
            }
            for p in patterns
        ]
    
    def calculate_enforcement_confidence(
        self,
        site_id: int,
        bay_type: str,
        base_confidence: float,
        observation_time: Optional[datetime] = None
    ) -> EnforcementGuidance:
        """
        Calculate enforcement confidence based on site intelligence.
        
        Adjusts confidence based on:
        - Signage clarity score
        - Marking condition score
        - Known behavior patterns
        - Time of observation (peak times)
        """
        bay_intel = self.get_bay_intelligence(site_id, bay_type=bay_type)
        patterns = self.get_behavior_patterns(site_id)
        
        confidence_adjustment = 0.0
        reasoning_parts = []
        additional_evidence = []
        known_issues = []
        officer_guidance = []
        
        if bay_intel:
            if bay_intel.signage_clarity_score <= 2:
                confidence_adjustment -= 0.15
                reasoning_parts.append(f"Signage clarity is poor ({bay_intel.signage_clarity_score}/5)")
                additional_evidence.append("Clear photo of signage from driver's perspective")
                officer_guidance.append("Ensure signage is clearly visible in evidence photos")
            elif bay_intel.signage_clarity_score >= 4:
                confidence_adjustment += 0.05
                reasoning_parts.append(f"Signage clarity is good ({bay_intel.signage_clarity_score}/5)")
            
            if bay_intel.marking_condition_score <= 2:
                confidence_adjustment -= 0.10
                reasoning_parts.append(f"Bay markings are degraded ({bay_intel.marking_condition_score}/5)")
                additional_evidence.append("Photo showing bay markings clearly")
                officer_guidance.append("Document the condition of bay markings")
            elif bay_intel.marking_condition_score >= 4:
                confidence_adjustment += 0.05
                reasoning_parts.append(f"Bay markings are clear ({bay_intel.marking_condition_score}/5)")
            
            if bay_intel.common_misuse_patterns:
                known_issues.extend(bay_intel.common_misuse_patterns)
                reasoning_parts.append(f"Known misuse patterns at this bay: {', '.join(bay_intel.common_misuse_patterns[:2])}")
        else:
            reasoning_parts.append("No site-specific bay intelligence available")
            additional_evidence.append("Bay photograph showing signage and markings")
        
        for pattern in patterns:
            if pattern["severity"] == "HIGH":
                known_issues.append(f"{pattern['patternType']}: {pattern['description'][:50]}...")
            
            if observation_time and pattern.get("peakTimes"):
                hour = observation_time.hour
                for peak_time in pattern["peakTimes"]:
                    if isinstance(peak_time, str):
                        if "morning" in peak_time.lower() and 7 <= hour <= 10:
                            reasoning_parts.append(f"Observation during known peak time ({peak_time})")
                        elif "evening" in peak_time.lower() and 16 <= hour <= 19:
                            reasoning_parts.append(f"Observation during known peak time ({peak_time})")
        
        adjusted_confidence = max(0.0, min(1.0, base_confidence + confidence_adjustment))
        
        if adjusted_confidence >= 0.8:
            confidence_level = "HIGH"
        elif adjusted_confidence >= 0.6:
            confidence_level = "MEDIUM"
        else:
            confidence_level = "LOW"
        
        if not reasoning_parts:
            reasoning_parts.append("Standard enforcement confidence applied")
        
        return EnforcementGuidance(
            confidence_level=confidence_level,
            confidence_adjustment=confidence_adjustment,
            reasoning="; ".join(reasoning_parts),
            additional_evidence_needed=additional_evidence,
            known_issues=known_issues,
            officer_guidance=officer_guidance
        )
    
    def get_site_intelligence_summary(self, site_id: int) -> Dict[str, Any]:
        """Get a complete summary of site intelligence for enforcement."""
        from backend.db.models import ParkingSite, SiteIntelligenceAttachment
        
        site = self.db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
        if not site:
            return {"error": "Site not found"}
        
        bays = self.get_all_bay_intelligence(site_id)
        patterns = self.get_behavior_patterns(site_id)
        
        attachments = self.db.query(SiteIntelligenceAttachment).filter(
            SiteIntelligenceAttachment.site_id == site_id
        ).count()
        
        avg_signage_clarity = 0
        avg_marking_condition = 0
        if bays:
            avg_signage_clarity = sum(b.signage_clarity_score for b in bays) / len(bays)
            avg_marking_condition = sum(b.marking_condition_score for b in bays) / len(bays)
        
        high_severity_patterns = [p for p in patterns if p["severity"] == "HIGH"]
        
        return {
            "siteId": site_id,
            "siteName": site.site_name,
            "intelligenceAvailable": len(bays) > 0 or len(patterns) > 0,
            "bayCount": len(bays),
            "patternCount": len(patterns),
            "attachmentCount": attachments,
            "averageSignageClarity": round(avg_signage_clarity, 1),
            "averageMarkingCondition": round(avg_marking_condition, 1),
            "highSeverityIssues": len(high_severity_patterns),
            "baysByType": {},
            "knownIssues": [
                {
                    "type": p["patternType"],
                    "description": p["description"],
                    "severity": p["severity"]
                }
                for p in high_severity_patterns[:5]
            ]
        }
