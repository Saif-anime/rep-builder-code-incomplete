from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import Optional
from datetime import datetime
import httpx

from backend.db import get_db
from backend.db.models import User, Camera, AuditLog, AnprEvent, ParkingSite
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
    site_id = body.get("siteId") or body.get("site_id")
    location = body.get("location")
    ip_address = body.get("ipAddress") or body.get("ip_address")
    
    if not location and site_id:
        site = db.query(ParkingSite).filter(ParkingSite.id == site_id).first()
        if site:
            location = site.name
    
    if not location:
        location = f"Camera @ {ip_address}" if ip_address else body.get("name", "Unknown Location")
    
    camera = Camera(
        name=body.get("name"),
        location=location,
        ip_address=body.get("ipAddress") or body.get("ip_address"),
        username=body.get("username"),
        password=body.get("password"),
        rtsp_url=body.get("rtspUrl") or body.get("rtsp_url"),
        isapi_url=body.get("isapiUrl") or body.get("isapi_url"),
        is_active=body.get("isActive", True) if body.get("isActive") is not None else body.get("is_active", True),
        status=body.get("status", "offline"),
        site_id=site_id
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
    
    online = False
    message = "Camera offline"
    method = "isapi"
    
    try:
        url = f"http://{camera.ip_address}/ISAPI/System/deviceInfo"
        auth = httpx.DigestAuth(camera.username, camera.password)
        
        async with httpx.AsyncClient(auth=auth, timeout=5.0) as client:
            response = await client.get(url)
            
            if response.status_code == 200:
                online = True
                message = "Camera online and responding"
                camera.status = "online"
                camera.status_message = message
                camera.last_online_at = datetime.utcnow()
            elif response.status_code == 401:
                message = "Authentication failed - check username/password"
                camera.status = "error"
                camera.status_message = message
            else:
                message = f"Camera returned HTTP {response.status_code}"
                camera.status = "error"
                camera.status_message = message
                
    except httpx.TimeoutException:
        message = "Connection timeout - camera may be offline or unreachable"
        camera.status = "offline"
        camera.status_message = message
    except httpx.ConnectError:
        message = "Cannot connect - check IP address and network"
        camera.status = "offline"
        camera.status_message = message
    except Exception as e:
        message = f"Connection error: {str(e)}"
        camera.status = "error"
        camera.status_message = message
    
    camera.last_checked_at = datetime.utcnow()
    db.commit()
    
    return {
        "online": online,
        "message": message,
        "method": method,
        "camera": {
            "status": camera.status,
            "statusMessage": camera.status_message,
            "lastCheckedAt": camera.last_checked_at.isoformat() if camera.last_checked_at else None,
            "lastOnlineAt": camera.last_online_at.isoformat() if camera.last_online_at else None
        }
    }


@router.post("/onvif/test")
async def test_onvif_connection_endpoint(
    body: dict,
    current_user: User = Depends(get_current_user)
):
    from backend.services.onvif_service import test_onvif_connection
    
    ip_address = body.get("ipAddress") or body.get("ip_address")
    port = body.get("port", 80)
    username = body.get("username")
    password = body.get("password")
    
    if not ip_address or not username or not password:
        raise HTTPException(status_code=400, detail="IP address, username, and password are required")
    
    try:
        port = int(port)
    except (ValueError, TypeError):
        port = 80
    
    result = await test_onvif_connection(ip_address, port, username, password)
    return result


@router.post("/{camera_id}/onvif/connect")
async def connect_camera_onvif(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from backend.services.onvif_service import test_onvif_connection
    
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    port = 80
    if ":" in camera.ip_address:
        parts = camera.ip_address.split(":")
        ip = parts[0]
        try:
            port = int(parts[1])
        except:
            port = 80
    else:
        ip = camera.ip_address
    
    result = await test_onvif_connection(ip, port, camera.username, camera.password)
    
    if result["success"]:
        camera.status = "online"
        camera.status_message = f"ONVIF connected - {result['deviceInfo'].get('manufacturer', '')} {result['deviceInfo'].get('model', '')}"
        camera.last_online_at = datetime.utcnow()
    else:
        camera.status = "error"
        camera.status_message = result["message"]
    
    camera.last_checked_at = datetime.utcnow()
    db.commit()
    
    return {
        **result,
        "camera": camera_to_dict(camera)
    }


@router.post("/{camera_id}/onvif/snapshot")
async def capture_onvif_snapshot(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    import base64
    from backend.services.onvif_service import OnvifService
    
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    port = 80
    if ":" in camera.ip_address:
        parts = camera.ip_address.split(":")
        ip = parts[0]
        try:
            port = int(parts[1])
        except:
            port = 80
    else:
        ip = camera.ip_address
    
    service = OnvifService(ip, port, camera.username, camera.password)
    success, msg, _ = await service.connect()
    
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to connect: {msg}")
    
    snapshot_bytes = await service.capture_snapshot()
    
    if not snapshot_bytes:
        raise HTTPException(status_code=500, detail="Failed to capture snapshot")
    
    camera.last_snapshot = datetime.utcnow()
    db.commit()
    
    return {
        "success": True,
        "image": base64.b64encode(snapshot_bytes).decode('utf-8'),
        "contentType": "image/jpeg",
        "timestamp": datetime.utcnow().isoformat()
    }


@router.post("/{camera_id}/onvif/ptz")
async def control_ptz_onvif(
    camera_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from backend.services.onvif_service import OnvifService
    
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    action = body.get("action", "move")
    pan = float(body.get("pan", 0))
    tilt = float(body.get("tilt", 0))
    zoom = float(body.get("zoom", 0))
    
    port = 80
    if ":" in camera.ip_address:
        parts = camera.ip_address.split(":")
        ip = parts[0]
        try:
            port = int(parts[1])
        except:
            port = 80
    else:
        ip = camera.ip_address
    
    service = OnvifService(ip, port, camera.username, camera.password)
    success, msg, _ = await service.connect()
    
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to connect: {msg}")
    
    if action == "stop":
        result = await service.ptz_stop()
    else:
        result = await service.ptz_move(pan, tilt, zoom)
    
    if not result:
        raise HTTPException(status_code=500, detail="PTZ operation failed - camera may not support PTZ")
    
    return {
        "success": True,
        "action": action,
        "pan": pan,
        "tilt": tilt,
        "zoom": zoom
    }


@router.get("/{camera_id}/onvif/status")
async def get_onvif_status(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from backend.services.onvif_service import OnvifService
    
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    port = 80
    if ":" in camera.ip_address:
        parts = camera.ip_address.split(":")
        ip = parts[0]
        try:
            port = int(parts[1])
        except:
            port = 80
    else:
        ip = camera.ip_address
    
    service = OnvifService(ip, port, camera.username, camera.password)
    success, msg, device_info = await service.connect()
    
    if not success:
        return {
            "connected": False,
            "message": msg,
            "deviceInfo": None,
            "profiles": [],
            "capabilities": {},
            "ptzStatus": None
        }
    
    profiles = await service.get_profiles()
    capabilities = await service.get_capabilities()
    ptz_status = await service.get_ptz_status()
    stream_uri = await service.get_stream_uri()
    
    return {
        "connected": True,
        "message": "Connected via ONVIF",
        "deviceInfo": device_info,
        "profiles": profiles,
        "capabilities": capabilities,
        "ptzStatus": ptz_status,
        "streamUri": stream_uri
    }
