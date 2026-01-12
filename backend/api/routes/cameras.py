from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import Optional

from backend.db import get_db
from backend.db.models import User, Camera, AuditLog, AnprEvent
from backend.api.dependencies import get_current_user, require_role

router = APIRouter(prefix="/api/cameras", tags=["cameras"])

def camera_to_dict(camera: Camera, include_password: bool = False):
    result = {
        "id": camera.id,
        "name": camera.name,
        "location": camera.location,
        "ipAddress": camera.ip_address,
        "username": camera.username,
        "rtspUrl": camera.rtsp_url,
        "isapiUrl": camera.isapi_url,
        "isActive": camera.is_active,
        "status": camera.status,
        "statusMessage": camera.status_message,
        "siteId": camera.site_id,
        "createdAt": camera.created_at.isoformat() if camera.created_at else None,
        "lastSnapshot": camera.last_snapshot.isoformat() if camera.last_snapshot else None,
        "lastCheckedAt": camera.last_checked_at.isoformat() if camera.last_checked_at else None,
        "lastOnlineAt": camera.last_online_at.isoformat() if camera.last_online_at else None
    }
    if include_password:
        result["password"] = camera.password
    return result

@router.get("")
async def get_cameras(
    siteId: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Camera)
    if siteId and siteId != "all":
        query = query.filter(Camera.site_id == siteId)
    
    cameras = query.all()
    return [camera_to_dict(c) for c in cameras]

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_camera(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    camera = Camera(
        name=body.get("name"),
        location=body.get("location"),
        ip_address=body.get("ipAddress") or body.get("ip_address"),
        username=body.get("username"),
        password=body.get("password"),
        rtsp_url=body.get("rtspUrl") or body.get("rtsp_url"),
        isapi_url=body.get("isapiUrl") or body.get("isapi_url"),
        is_active=body.get("isActive", True) if body.get("isActive") is not None else body.get("is_active", True),
        status=body.get("status", "offline"),
        site_id=body.get("siteId") or body.get("site_id")
    )
    db.add(camera)
    db.commit()
    db.refresh(camera)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="create",
        entity_type="camera",
        entity_id=str(camera.id),
        details={"name": camera.name, "location": camera.location}
    )
    db.add(audit_log)
    db.commit()
    
    return camera_to_dict(camera)

@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    db.query(AnprEvent).filter(AnprEvent.camera_id == camera_id).update(
        {"camera_id": None}, synchronize_session=False
    )
    db.commit()
    
    db.delete(camera)
    db.commit()
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="delete",
        entity_type="camera",
        entity_id=str(camera_id)
    )
    db.add(audit_log)
    db.commit()
    
    return None

@router.post("/{camera_id}/check")
async def check_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail={"error": "Camera not found"})
    
    return {
        "online": False,
        "message": "Camera health check not implemented in Python backend",
        "method": "placeholder",
        "camera": {
            "status": camera.status,
            "statusMessage": camera.status_message,
            "lastCheckedAt": camera.last_checked_at.isoformat() if camera.last_checked_at else None,
            "lastOnlineAt": camera.last_online_at.isoformat() if camera.last_online_at else None
        }
    }
