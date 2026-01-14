from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import httpx

from backend.db.session import get_db
from backend.db.models import Camera, User
from backend.api.dependencies import get_current_user, require_role

router = APIRouter(prefix="/api/ptz", tags=["ptz"])

class PTZMoveRequest(BaseModel):
    cameraId: int
    pan: Optional[int] = 0
    tilt: Optional[int] = 0
    zoom: Optional[int] = 0

class PTZStopRequest(BaseModel):
    cameraId: int

class PTZPresetRequest(BaseModel):
    cameraId: int

def clamp(value: int, min_val: int, max_val: int) -> int:
    return max(min_val, min(max_val, value))

def build_ptz_xml(pan: int, tilt: int, zoom: int) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<PTZData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <pan>{pan}</pan>
  <tilt>{tilt}</tilt>
  <zoom>{zoom}</zoom>
</PTZData>'''

async def get_camera_by_id(camera_id: int, db: Session) -> Camera:
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    return camera

async def send_ptz_command(camera: Camera, pan: int, tilt: int, zoom: int) -> dict:
    try:
        url = f"http://{camera.ip_address}/ISAPI/PTZCtrl/channels/1/continuous"
        
        auth = httpx.DigestAuth(camera.username, camera.password)
        
        async with httpx.AsyncClient(auth=auth, timeout=10.0) as client:
            response = await client.put(
                url,
                content=build_ptz_xml(pan, tilt, zoom),
                headers={"Content-Type": "application/xml"}
            )
            
            if response.status_code == 200:
                return {"success": True}
            else:
                return {"success": False, "error": f"Camera returned {response.status_code}"}
    except httpx.TimeoutException:
        return {"success": False, "error": "Camera request timed out"}
    except httpx.RequestError as e:
        return {"success": False, "error": f"Network error: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.post("/move")
async def ptz_move(
    request: PTZMoveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    camera = await get_camera_by_id(request.cameraId, db)
    
    pan = clamp(request.pan or 0, -100, 100)
    tilt = clamp(request.tilt or 0, -100, 100)
    zoom = clamp(request.zoom or 0, -100, 100)
    
    result = await send_ptz_command(camera, pan, tilt, zoom)
    
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result.get("error", "PTZ command failed"))
    
    return {"success": True}

@router.post("/stop")
async def ptz_stop(
    request: PTZStopRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    camera = await get_camera_by_id(request.cameraId, db)
    result = await send_ptz_command(camera, 0, 0, 0)
    
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result.get("error", "PTZ stop failed"))
    
    return {"success": True}

@router.post("/preset/{preset_id}")
async def ptz_preset(
    preset_id: int,
    request: PTZPresetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    if preset_id < 1 or preset_id > 256:
        raise HTTPException(status_code=400, detail="Invalid preset ID (1-256)")
    
    camera = await get_camera_by_id(request.cameraId, db)
    
    try:
        url = f"http://{camera.ip_address}/ISAPI/PTZCtrl/channels/1/presets/{preset_id}/goto"
        auth = httpx.DigestAuth(camera.username, camera.password)
        
        preset_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<PTZData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <PresetID>{preset_id}</PresetID>
</PTZData>'''
        
        async with httpx.AsyncClient(auth=auth, timeout=10.0) as client:
            response = await client.put(
                url,
                content=preset_xml,
                headers={"Content-Type": "application/xml"}
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=500, detail=f"Camera returned {response.status_code}")
            
            return {"success": True}
    except httpx.TimeoutException:
        raise HTTPException(status_code=500, detail="Camera request timed out")
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Network error: {str(e)}")

@router.get("/status")
async def ptz_status(
    cameraId: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator"))
):
    camera = await get_camera_by_id(cameraId, db)
    
    return {
        "connected": True,
        "cameraId": camera.id,
        "cameraName": camera.name,
        "ipAddress": camera.ip_address
    }
