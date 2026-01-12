from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from backend.db import get_db
from backend.db.models import AiSetting, User
from backend.api.dependencies import get_current_user

router = APIRouter(prefix="/api/settings", tags=["settings"])

class AiSettingsResponse(BaseModel):
    detectionThreshold: int
    anprThreshold: int
    autoAnalyze: bool
    autoPcn: bool

class AiSettingsUpdate(BaseModel):
    detectionThreshold: Optional[int] = None
    anprThreshold: Optional[int] = None
    autoAnalyze: Optional[bool] = None
    autoPcn: Optional[bool] = None

def get_ai_setting(db: Session, key: str, default=None):
    setting = db.query(AiSetting).filter(AiSetting.setting_key == key).first()
    if setting and setting.setting_value is not None:
        return setting.setting_value
    return default

def set_ai_setting(db: Session, key: str, value, description: str = None):
    setting = db.query(AiSetting).filter(AiSetting.setting_key == key).first()
    if setting:
        setting.setting_value = value
    else:
        setting = AiSetting(setting_key=key, setting_value=value, description=description)
        db.add(setting)
    db.commit()

@router.get("/ai", response_model=AiSettingsResponse)
async def get_ai_settings(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    return AiSettingsResponse(
        detectionThreshold=get_ai_setting(db, "detection_threshold", 85),
        anprThreshold=get_ai_setting(db, "anpr_threshold", 80),
        autoAnalyze=get_ai_setting(db, "auto_analyze", True),
        autoPcn=get_ai_setting(db, "auto_pcn", False)
    )

@router.patch("/ai", response_model=AiSettingsResponse)
async def update_ai_settings(
    settings: AiSettingsUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    if settings.detectionThreshold is not None:
        set_ai_setting(db, "detection_threshold", settings.detectionThreshold, "Object detection confidence threshold")
    if settings.anprThreshold is not None:
        set_ai_setting(db, "anpr_threshold", settings.anprThreshold, "ANPR confidence threshold")
    if settings.autoAnalyze is not None:
        set_ai_setting(db, "auto_analyze", settings.autoAnalyze, "Auto-analyze evidence on upload")
    if settings.autoPcn is not None:
        set_ai_setting(db, "auto_pcn", settings.autoPcn, "Auto-generate PCN for high-confidence violations")
    
    return AiSettingsResponse(
        detectionThreshold=get_ai_setting(db, "detection_threshold", 85),
        anprThreshold=get_ai_setting(db, "anpr_threshold", 80),
        autoAnalyze=get_ai_setting(db, "auto_analyze", True),
        autoPcn=get_ai_setting(db, "auto_pcn", False)
    )
