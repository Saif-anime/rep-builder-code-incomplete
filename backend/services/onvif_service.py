import logging
import asyncio
from typing import Optional, Dict, Any, Tuple
from datetime import datetime
import httpx
import base64
from io import BytesIO

logger = logging.getLogger(__name__)

class OnvifService:
    def __init__(self, ip_address: str, port: int, username: str, password: str):
        self.ip_address = ip_address
        self.port = port
        self.username = username
        self.password = password
        self.camera = None
        self.device_info = None
        self.profiles = []
        self.ptz_service = None
        self.media_service = None
    
    def _connect_sync(self) -> Tuple[bool, str, Optional[Dict]]:
        try:
            from onvif import ONVIFCamera
            
            self.camera = ONVIFCamera(
                self.ip_address,
                self.port,
                self.username,
                self.password
            )
            
            device_service = self.camera.create_devicemgmt_service()
            device_info = device_service.GetDeviceInformation()
            
            self.device_info = {
                "manufacturer": getattr(device_info, 'Manufacturer', 'Unknown'),
                "model": getattr(device_info, 'Model', 'Unknown'),
                "firmwareVersion": getattr(device_info, 'FirmwareVersion', 'Unknown'),
                "serialNumber": getattr(device_info, 'SerialNumber', 'Unknown'),
                "hardwareId": getattr(device_info, 'HardwareId', 'Unknown')
            }
            
            try:
                self.media_service = self.camera.create_media_service()
                profiles = self.media_service.GetProfiles()
                self.profiles = [
                    {
                        "token": p.token,
                        "name": p.Name,
                        "videoEncoding": getattr(p.VideoEncoderConfiguration, 'Encoding', 'Unknown') if hasattr(p, 'VideoEncoderConfiguration') and p.VideoEncoderConfiguration else None,
                        "resolution": {
                            "width": p.VideoEncoderConfiguration.Resolution.Width,
                            "height": p.VideoEncoderConfiguration.Resolution.Height
                        } if hasattr(p, 'VideoEncoderConfiguration') and p.VideoEncoderConfiguration and hasattr(p.VideoEncoderConfiguration, 'Resolution') else None
                    }
                    for p in profiles
                ]
            except Exception as e:
                logger.warning(f"Could not get media profiles: {e}")
            
            try:
                self.ptz_service = self.camera.create_ptz_service()
            except Exception as e:
                logger.info(f"PTZ service not available: {e}")
                self.ptz_service = None
            
            return True, "Connected successfully", self.device_info
            
        except Exception as e:
            error_msg = str(e)
            if "401" in error_msg or "Unauthorized" in error_msg:
                return False, "Authentication failed - check username and password", None
            elif "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
                return False, "Connection timeout - camera may be offline or unreachable", None
            elif "connection refused" in error_msg.lower():
                return False, "Connection refused - check IP address and ONVIF port", None
            else:
                logger.error(f"ONVIF connection error: {e}")
                return False, f"Connection failed: {error_msg}", None
        
    async def connect(self) -> Tuple[bool, str, Optional[Dict]]:
        return await asyncio.to_thread(self._connect_sync)
    
    async def get_device_info(self) -> Optional[Dict]:
        if not self.camera:
            success, msg, info = await self.connect()
            if not success:
                return None
        return self.device_info
    
    async def get_profiles(self) -> list:
        if not self.camera:
            success, msg, info = await self.connect()
            if not success:
                return []
        return self.profiles
    
    def _get_snapshot_uri_sync(self, profile_token: Optional[str] = None) -> Optional[str]:
        try:
            if not self.media_service:
                return None
            
            if not profile_token and self.profiles:
                profile_token = self.profiles[0]["token"]
            
            if not profile_token:
                return None
                
            uri_response = self.media_service.GetSnapshotUri({'ProfileToken': profile_token})
            return uri_response.Uri
            
        except Exception as e:
            logger.error(f"Failed to get snapshot URI: {e}")
            return None
    
    async def get_snapshot_uri(self, profile_token: Optional[str] = None) -> Optional[str]:
        if not self.camera:
            success, msg, info = await self.connect()
            if not success:
                return None
        return await asyncio.to_thread(self._get_snapshot_uri_sync, profile_token)
    
    async def capture_snapshot(self, profile_token: Optional[str] = None) -> Optional[bytes]:
        try:
            snapshot_uri = await self.get_snapshot_uri(profile_token)
            if not snapshot_uri:
                return await self._capture_snapshot_isapi()
            
            auth = httpx.DigestAuth(self.username, self.password)
            async with httpx.AsyncClient(auth=auth, timeout=10.0) as client:
                response = await client.get(snapshot_uri)
                if response.status_code == 200:
                    return response.content
                    
            return await self._capture_snapshot_isapi()
            
        except Exception as e:
            logger.error(f"ONVIF snapshot failed: {e}")
            return await self._capture_snapshot_isapi()
    
    async def _capture_snapshot_isapi(self) -> Optional[bytes]:
        try:
            url = f"http://{self.ip_address}:{self.port if self.port != 80 else ''}/ISAPI/Streaming/channels/101/picture"
            if self.port == 80:
                url = f"http://{self.ip_address}/ISAPI/Streaming/channels/101/picture"
            
            auth = httpx.DigestAuth(self.username, self.password)
            async with httpx.AsyncClient(auth=auth, timeout=10.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    return response.content
            return None
        except Exception as e:
            logger.error(f"ISAPI snapshot failed: {e}")
            return None
    
    def _get_stream_uri_sync(self, profile_token: Optional[str] = None, protocol: str = "RTSP") -> Optional[str]:
        try:
            if not self.media_service:
                return None
            
            if not profile_token and self.profiles:
                profile_token = self.profiles[0]["token"]
            
            if not profile_token:
                return None
            
            stream_setup = {
                'Stream': 'RTP-Unicast',
                'Transport': {'Protocol': protocol}
            }
            
            uri_response = self.media_service.GetStreamUri({
                'StreamSetup': stream_setup,
                'ProfileToken': profile_token
            })
            return uri_response.Uri
            
        except Exception as e:
            logger.error(f"Failed to get stream URI: {e}")
            return None
    
    async def get_stream_uri(self, profile_token: Optional[str] = None, protocol: str = "RTSP") -> Optional[str]:
        if not self.camera:
            success, msg, info = await self.connect()
            if not success:
                return None
        return await asyncio.to_thread(self._get_stream_uri_sync, profile_token, protocol)
    
    def _ptz_move_sync(self, pan: float, tilt: float, zoom: float, profile_token: Optional[str] = None) -> bool:
        try:
            if not self.ptz_service:
                return False
            
            if not profile_token and self.profiles:
                profile_token = self.profiles[0]["token"]
            
            if not profile_token:
                return False
            
            request = self.ptz_service.create_type('ContinuousMove')
            request.ProfileToken = profile_token
            request.Velocity = {
                'PanTilt': {'x': pan, 'y': tilt},
                'Zoom': {'x': zoom}
            }
            
            self.ptz_service.ContinuousMove(request)
            return True
            
        except Exception as e:
            logger.error(f"PTZ move failed: {e}")
            return False
    
    async def ptz_move(self, pan: float, tilt: float, zoom: float, profile_token: Optional[str] = None) -> bool:
        if not self.camera:
            success, msg, info = await self.connect()
            if not success:
                return False
        return await asyncio.to_thread(self._ptz_move_sync, pan, tilt, zoom, profile_token)
    
    def _ptz_stop_sync(self, profile_token: Optional[str] = None) -> bool:
        try:
            if not self.ptz_service:
                return False
            
            if not profile_token and self.profiles:
                profile_token = self.profiles[0]["token"]
            
            request = self.ptz_service.create_type('Stop')
            request.ProfileToken = profile_token
            request.PanTilt = True
            request.Zoom = True
            
            self.ptz_service.Stop(request)
            return True
            
        except Exception as e:
            logger.error(f"PTZ stop failed: {e}")
            return False
    
    async def ptz_stop(self, profile_token: Optional[str] = None) -> bool:
        if not self.ptz_service:
            return False
        return await asyncio.to_thread(self._ptz_stop_sync, profile_token)
    
    def _get_ptz_status_sync(self, profile_token: Optional[str] = None) -> Optional[Dict]:
        try:
            if not self.ptz_service:
                return None
            
            if not profile_token and self.profiles:
                profile_token = self.profiles[0]["token"]
            
            status = self.ptz_service.GetStatus({'ProfileToken': profile_token})
            return {
                "position": {
                    "pan": status.Position.PanTilt.x if hasattr(status.Position, 'PanTilt') else 0,
                    "tilt": status.Position.PanTilt.y if hasattr(status.Position, 'PanTilt') else 0,
                    "zoom": status.Position.Zoom.x if hasattr(status.Position, 'Zoom') else 0
                } if status.Position else None,
                "moveStatus": str(status.MoveStatus) if hasattr(status, 'MoveStatus') else None
            }
            
        except Exception as e:
            logger.error(f"Get PTZ status failed: {e}")
            return None
    
    async def get_ptz_status(self, profile_token: Optional[str] = None) -> Optional[Dict]:
        if not self.ptz_service:
            return None
        return await asyncio.to_thread(self._get_ptz_status_sync, profile_token)
    
    async def get_capabilities(self) -> Dict[str, bool]:
        capabilities = {
            "ptz": self.ptz_service is not None,
            "media": self.media_service is not None,
            "snapshot": False,
            "streaming": False
        }
        
        if self.media_service and self.profiles:
            try:
                uri = await self.get_snapshot_uri()
                capabilities["snapshot"] = uri is not None
                
                stream_uri = await self.get_stream_uri()
                capabilities["streaming"] = stream_uri is not None
            except Exception as e:
                logger.warning(f"Error checking capabilities: {e}")
        
        return capabilities


async def test_onvif_connection(
    ip_address: str, 
    port: int, 
    username: str, 
    password: str
) -> Dict[str, Any]:
    service = OnvifService(ip_address, port, username, password)
    success, message, device_info = await service.connect()
    
    result = {
        "success": success,
        "message": message,
        "deviceInfo": device_info,
        "profiles": [],
        "capabilities": {},
        "streamUri": None,
        "snapshotAvailable": False
    }
    
    if success:
        result["profiles"] = await service.get_profiles()
        result["capabilities"] = await service.get_capabilities()
        result["streamUri"] = await service.get_stream_uri()
        result["snapshotAvailable"] = result["capabilities"].get("snapshot", False)
    
    return result
