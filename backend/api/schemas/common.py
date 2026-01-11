from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import datetime

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token: str
    user: dict

class UserCreate(BaseModel):
    username: str
    password: str
    email: str
    fullName: str = Field(alias="full_name")
    role: str = "operator"
    isActive: bool = Field(default=True, alias="is_active")
    
    class Config:
        populate_by_name = True

class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    email: Optional[str] = None
    fullName: Optional[str] = Field(default=None, alias="full_name")
    role: Optional[str] = None
    isActive: Optional[bool] = Field(default=None, alias="is_active")
    
    class Config:
        populate_by_name = True

class CameraCreate(BaseModel):
    name: str
    location: str
    ipAddress: str = Field(alias="ip_address")
    username: str
    password: str
    rtspUrl: Optional[str] = Field(default=None, alias="rtsp_url")
    isapiUrl: Optional[str] = Field(default=None, alias="isapi_url")
    isActive: bool = Field(default=True, alias="is_active")
    status: str = "offline"
    siteId: Optional[str] = Field(default=None, alias="site_id")
    
    class Config:
        populate_by_name = True

class CameraUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    ipAddress: Optional[str] = Field(default=None, alias="ip_address")
    username: Optional[str] = None
    password: Optional[str] = None
    rtspUrl: Optional[str] = Field(default=None, alias="rtsp_url")
    isapiUrl: Optional[str] = Field(default=None, alias="isapi_url")
    isActive: Optional[bool] = Field(default=None, alias="is_active")
    status: Optional[str] = None
    siteId: Optional[str] = Field(default=None, alias="site_id")
    statusMessage: Optional[str] = Field(default=None, alias="status_message")
    
    class Config:
        populate_by_name = True

class BayCreate(BaseModel):
    name: str
    type: str
    cameraId: Optional[int] = Field(default=None, alias="camera_id")
    location: Optional[str] = None
    rules: Optional[Dict[str, Any]] = None
    isActive: bool = Field(default=True, alias="is_active")
    
    class Config:
        populate_by_name = True

class BayUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    cameraId: Optional[int] = Field(default=None, alias="camera_id")
    location: Optional[str] = None
    rules: Optional[Dict[str, Any]] = None
    isActive: Optional[bool] = Field(default=None, alias="is_active")
    
    class Config:
        populate_by_name = True

class ParkingSiteCreate(BaseModel):
    siteName: str = Field(alias="site_name")
    locationCode: Optional[str] = Field(default=None, alias="location_code")
    addressLine1: Optional[str] = Field(default=None, alias="address_line_1")
    addressLine2: Optional[str] = Field(default=None, alias="address_line_2")
    addressLine3: Optional[str] = Field(default=None, alias="address_line_3")
    addressLine4: Optional[str] = Field(default=None, alias="address_line_4")
    city: Optional[str] = None
    postcode: Optional[str] = None
    regulations: Optional[str] = None
    enforcer: Optional[str] = None
    totalBays: int = Field(default=0, alias="total_bays")
    disabledBays: int = Field(default=0, alias="disabled_bays")
    evBays: int = Field(default=0, alias="ev_bays")
    parentChildBays: int = Field(default=0, alias="parent_child_bays")
    isActive: bool = Field(default=True, alias="is_active")
    
    class Config:
        populate_by_name = True

class SiteRuleCreate(BaseModel):
    siteId: int = Field(alias="site_id")
    maxStayMinutes: Optional[int] = Field(default=None, alias="max_stay_minutes")
    graceEntryMinutes: int = Field(default=5, alias="grace_entry_minutes")
    graceExitMinutes: int = Field(default=5, alias="grace_exit_minutes")
    enforcementMode: str = Field(default="standard", alias="enforcement_mode")
    allowlists: Optional[Dict[str, Any]] = None
    denylists: Optional[Dict[str, Any]] = None
    isActive: bool = Field(default=True, alias="is_active")
    
    class Config:
        populate_by_name = True

class EnforcementCaseCreate(BaseModel):
    siteId: Optional[int] = Field(default=None, alias="site_id")
    vrm: Optional[str] = None
    bayType: Optional[str] = Field(default=None, alias="bay_type")
    status: str = "NEW"
    createdBy: Optional[str] = Field(default=None, alias="created_by")
    
    class Config:
        populate_by_name = True

class EvidenceCreate(BaseModel):
    type: str
    bundleId: Optional[int] = Field(default=None, alias="bundle_id")
    siteId: Optional[int] = Field(default=None, alias="site_id")
    cameraId: Optional[int] = Field(default=None, alias="camera_id")
    bayId: Optional[int] = Field(default=None, alias="bay_id")
    notes: Optional[str] = None
    
    class Config:
        populate_by_name = True

class ErrorResponse(BaseModel):
    error: str
    details: Optional[str] = None

class SuccessResponse(BaseModel):
    success: bool = True
    message: Optional[str] = None
