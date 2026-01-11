from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from datetime import datetime

from backend.db import get_db
from backend.db.models import User, AuditLog
from backend.services.auth_service import (
    verify_password, 
    generate_token, 
    get_user_by_username,
    hash_password
)
from backend.api.schemas import LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/login")
async def login(
    request: Request,
    body: LoginRequest,
    db: Session = Depends(get_db)
):
    if not body.username or not body.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Username and password required"}
        )
    
    user = get_user_by_username(db, body.username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid credentials"}
        )
    
    if not verify_password(body.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Invalid credentials"}
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "Account is disabled"}
        )
    
    user.last_login = datetime.utcnow()
    db.commit()
    
    token = generate_token(user)
    
    audit_log = AuditLog(
        user_id=user.id,
        action="login",
        entity_type="user",
        entity_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent")
    )
    db.add(audit_log)
    db.commit()
    
    return {
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "fullName": user.full_name,
            "role": user.role,
            "isActive": user.is_active,
            "createdAt": user.created_at.isoformat() if user.created_at else None,
            "lastLogin": user.last_login.isoformat() if user.last_login else None
        }
    }
