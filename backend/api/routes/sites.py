from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime

from backend.db import get_db
from backend.db.models import (
    User, ParkingSite, Site, SiteRule, SitePolicy, SiteNote, 
    SiteSurroundings, AuditLog
)
from backend.api.dependencies import get_current_user, require_role

router = APIRouter(tags=["sites"])

def site_to_dict(site: ParkingSite):
    return {
        "id": site.id,
        "siteName": site.site_name,
        "locationCode": site.location_code,
        "addressLine1": site.address_line_1,
        "addressLine2": site.address_line_2,
        "addressLine3": site.address_line_3,
        "addressLine4": site.address_line_4,
        "city": site.city,
        "postcode": site.postcode,
        "regulations": site.regulations,
        "enforcer": site.enforcer,
        "totalBays": site.total_bays,
        "disabledBays": site.disabled_bays,
        "evBays": site.ev_bays,
        "parentChildBays": site.parent_child_bays,
        "isActive": site.is_active,
        "createdAt": site.created_at.isoformat() if site.created_at else None
    }

def site_rule_to_dict(rule: SiteRule):
    return {
        "id": rule.id,
        "siteId": rule.site_id,
        "maxStayMinutes": rule.max_stay_minutes,
        "graceEntryMinutes": rule.grace_entry_minutes,
        "graceExitMinutes": rule.grace_exit_minutes,
        "enforcementMode": rule.enforcement_mode,
        "allowlists": rule.allowlists,
        "denylists": rule.denylists,
        "spikeOverridePolicy": rule.spike_override_policy,
        "enforceOnWeather": rule.enforce_on_weather,
        "enforceOnEvents": rule.enforce_on_events,
        "spikeThresholdMultiplier": rule.spike_threshold_multiplier,
        "baselineWindowDays": rule.baseline_window_days,
        "isActive": rule.is_active,
        "createdAt": rule.created_at.isoformat() if rule.created_at else None,
        "updatedAt": rule.updated_at.isoformat() if rule.updated_at else None
    }

@router.get("/api/sites")
async def get_legacy_sites(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    sites = db.query(Site).all()
    return [{
        "id": s.id,
        "name": s.name,
        "address": s.address,
        "postcode": s.postcode,
        "isActive": s.is_active,
        "createdAt": s.created_at.isoformat() if s.created_at else None
    } for s in sites]

@router.get("/api/parking-sites")
async def get_parking_sites(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    sites = db.query(ParkingSite).all()
    return [site_to_dict(s) for s in sites]

@router.get("/api/parking-sites/{site_id}")
async def get_parking_site(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail={"error": "Site not found"})
    return site_to_dict(site)

@router.post("/api/parking-sites", status_code=status.HTTP_201_CREATED)
async def create_parking_site(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    site = ParkingSite(
        site_name=body.get("siteName") or body.get("site_name"),
        location_code=body.get("locationCode") or body.get("location_code"),
        address_line_1=body.get("addressLine1") or body.get("address_line_1"),
        address_line_2=body.get("addressLine2") or body.get("address_line_2"),
        address_line_3=body.get("addressLine3") or body.get("address_line_3"),
        address_line_4=body.get("addressLine4") or body.get("address_line_4"),
        city=body.get("city"),
        postcode=body.get("postcode"),
        regulations=body.get("regulations"),
        enforcer=body.get("enforcer"),
        total_bays=body.get("totalBays") or body.get("total_bays") or 0,
        disabled_bays=body.get("disabledBays") or body.get("disabled_bays") or 0,
        ev_bays=body.get("evBays") or body.get("ev_bays") or 0,
        parent_child_bays=body.get("parentChildBays") or body.get("parent_child_bays") or 0,
        is_active=body.get("isActive", True) if body.get("isActive") is not None else body.get("is_active", True)
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="create",
        entity_type="parking_site",
        entity_id=str(site.id),
        details={"siteName": site.site_name}
    )
    db.add(audit_log)
    db.commit()
    
    return site_to_dict(site)

@router.put("/api/parking-sites/{site_id}")
async def update_parking_site(
    site_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail={"error": "Site not found"})
    
    field_mapping = {
        "siteName": "site_name",
        "locationCode": "location_code",
        "addressLine1": "address_line_1",
        "addressLine2": "address_line_2",
        "addressLine3": "address_line_3",
        "addressLine4": "address_line_4",
        "totalBays": "total_bays",
        "disabledBays": "disabled_bays",
        "evBays": "ev_bays",
        "parentChildBays": "parent_child_bays",
        "isActive": "is_active"
    }
    
    for camel, snake in field_mapping.items():
        if camel in body:
            setattr(site, snake, body[camel])
        elif snake in body:
            setattr(site, snake, body[snake])
    
    for key in ["city", "postcode", "regulations", "enforcer"]:
        if key in body:
            setattr(site, key, body[key])
    
    db.commit()
    db.refresh(site)
    
    return site_to_dict(site)

@router.delete("/api/parking-sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_parking_site(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
    if site:
        db.delete(site)
        db.commit()
    return None

@router.get("/api/site-rules/by-site/{site_id}")
async def get_site_rules(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rule = db.query(SiteRule).filter(SiteRule.site_id == site_id, SiteRule.is_active == True).first()
    if not rule:
        return None
    return site_rule_to_dict(rule)

@router.post("/api/site-rules", status_code=status.HTTP_201_CREATED)
async def create_site_rule(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    rule = SiteRule(
        site_id=body.get("siteId") or body.get("site_id"),
        max_stay_minutes=body.get("maxStayMinutes") or body.get("max_stay_minutes"),
        grace_entry_minutes=body.get("graceEntryMinutes") or body.get("grace_entry_minutes") or 5,
        grace_exit_minutes=body.get("graceExitMinutes") or body.get("grace_exit_minutes") or 5,
        enforcement_mode=body.get("enforcementMode") or body.get("enforcement_mode") or "standard",
        allowlists=body.get("allowlists"),
        denylists=body.get("denylists"),
        is_active=True
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    
    return site_rule_to_dict(rule)

@router.get("/api/sites/{site_id}/notes")
async def get_site_notes(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    notes = db.query(SiteNote).filter(SiteNote.site_id == site_id, SiteNote.is_active == True).all()
    return [{
        "id": n.id,
        "siteId": n.site_id,
        "noteType": n.note_type,
        "content": n.content,
        "tags": n.tags,
        "validFrom": n.valid_from.isoformat() if n.valid_from else None,
        "validTo": n.valid_to.isoformat() if n.valid_to else None,
        "isActive": n.is_active,
        "createdBy": n.created_by,
        "createdAt": n.created_at.isoformat() if n.created_at else None
    } for n in notes]

@router.post("/api/sites/{site_id}/notes", status_code=status.HTTP_201_CREATED)
async def create_site_note(
    site_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    note = SiteNote(
        site_id=site_id,
        note_type=body.get("noteType") or body.get("note_type") or "general",
        content=body.get("content"),
        tags=body.get("tags"),
        valid_from=datetime.fromisoformat(body["validFrom"]) if body.get("validFrom") else datetime.utcnow(),
        valid_to=datetime.fromisoformat(body["validTo"]) if body.get("validTo") else None,
        is_active=True,
        created_by=current_user.id
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    
    return {
        "id": note.id,
        "siteId": note.site_id,
        "noteType": note.note_type,
        "content": note.content,
        "tags": note.tags,
        "validFrom": note.valid_from.isoformat() if note.valid_from else None,
        "validTo": note.valid_to.isoformat() if note.valid_to else None,
        "isActive": note.is_active,
        "createdBy": note.created_by,
        "createdAt": note.created_at.isoformat() if note.created_at else None
    }

@router.get("/api/sites/{site_id}/surroundings")
async def get_site_surroundings(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    surroundings = db.query(SiteSurroundings).filter(SiteSurroundings.site_id == site_id).first()
    if not surroundings:
        return None
    return {
        "id": surroundings.id,
        "siteId": surroundings.site_id,
        "nearbyPlaces": surroundings.nearby_places,
        "freeTextSummary": surroundings.free_text_summary,
        "createdAt": surroundings.created_at.isoformat() if surroundings.created_at else None,
        "updatedAt": surroundings.updated_at.isoformat() if surroundings.updated_at else None
    }

@router.get("/api/sites/{site_id}/policy")
async def get_site_policy(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    policy = db.query(SitePolicy).filter(SitePolicy.site_id == site_id).first()
    if not policy:
        return {
            "siteId": site_id,
            "eventCategoriesEnforce": [],
            "eventCategoriesGrace": [],
            "defaultEventPolicy": "hold",
            "weatherPolicy": "hold",
            "isActive": True
        }
    return {
        "id": policy.id,
        "siteId": policy.site_id,
        "eventCategoriesEnforce": policy.event_categories_enforce or [],
        "eventCategoriesGrace": policy.event_categories_grace or [],
        "defaultEventPolicy": policy.default_event_policy,
        "weatherPolicy": policy.weather_policy,
        "isActive": policy.is_active,
        "createdAt": policy.created_at.isoformat() if policy.created_at else None,
        "updatedAt": policy.updated_at.isoformat() if policy.updated_at else None
    }

@router.get("/api/event-categories")
async def get_event_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return [
        {"id": "SPORTS_MATCH", "name": "Sports Match", "description": "Football, rugby, or other sporting events"},
        {"id": "CONCERT", "name": "Concert", "description": "Music concerts and live performances"},
        {"id": "ROAD_CLOSURE", "name": "Road Closure", "description": "Road works or traffic diversions"},
        {"id": "WEATHER", "name": "Weather Event", "description": "Severe weather conditions"},
        {"id": "PUBLIC_HOLIDAY", "name": "Public Holiday", "description": "Bank holidays and public holidays"},
        {"id": "LOCAL_EVENT", "name": "Local Event", "description": "Markets, festivals, or community events"},
    ]
