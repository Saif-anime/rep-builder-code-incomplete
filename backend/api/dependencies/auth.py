from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import List

from backend.db import get_db
from backend.db.models import User
from backend.services.auth_service import verify_token, get_user_by_id

security = HTTPBearer(auto_error=False)

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Authentication required"}
        )
    
    token = credentials.credentials
    decoded = verify_token(token)
    
    if not decoded:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "Invalid or expired token"}
        )
    
    user = get_user_by_id(db, decoded["id"])
    
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "User not found or inactive"}
        )
    
    return user

def require_role(*roles: str):
    async def role_checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "Insufficient permissions"}
            )
        return user
    return role_checker

async def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User | None:
    if not credentials:
        return None
    
    token = credentials.credentials
    decoded = verify_token(token)
    
    if not decoded:
        return None
    
    user = get_user_by_id(db, decoded["id"])
    
    if not user or not user.is_active:
        return None
    
    return user
