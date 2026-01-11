from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.db.models import User, Bay, AuditLog
from backend.api.dependencies import get_current_user, require_role

router = APIRouter(prefix="/api/bays", tags=["bays"])

def bay_to_dict(bay: Bay):
    return {
        "id": bay.id,
        "name": bay.name,
        "type": bay.type,
        "cameraId": bay.camera_id,
        "location": bay.location,
        "rules": bay.rules,
        "isActive": bay.is_active,
        "createdAt": bay.created_at.isoformat() if bay.created_at else None
    }

@router.get("")
async def get_bays(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    bays = db.query(Bay).all()
    return [bay_to_dict(b) for b in bays]

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_bay(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    bay = Bay(
        name=body.get("name"),
        type=body.get("type"),
        camera_id=body.get("cameraId") or body.get("camera_id"),
        location=body.get("location"),
        rules=body.get("rules"),
        is_active=body.get("isActive", True) if body.get("isActive") is not None else body.get("is_active", True)
    )
    db.add(bay)
    db.commit()
    db.refresh(bay)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="create",
        entity_type="bay",
        entity_id=str(bay.id),
        details={"name": bay.name, "type": bay.type}
    )
    db.add(audit_log)
    db.commit()
    
    return bay_to_dict(bay)

@router.delete("/{bay_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bay(
    bay_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    bay = db.query(Bay).filter(Bay.id == bay_id).first()
    if bay:
        db.delete(bay)
        db.commit()
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="delete",
        entity_type="bay",
        entity_id=str(bay_id)
    )
    db.add(audit_log)
    db.commit()
    
    return None
