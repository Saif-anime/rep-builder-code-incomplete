from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from backend.db import get_db
from backend.db.models import User, AuditLog
from backend.api.dependencies import get_current_user, require_role
from backend.services.auth_service import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])

def user_to_dict(user: User):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "fullName": user.full_name,
        "role": user.role,
        "isActive": user.is_active,
        "createdAt": user.created_at.isoformat() if user.created_at else None,
        "lastLogin": user.last_login.isoformat() if user.last_login else None
    }

@router.get("")
async def get_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    users = db.query(User).all()
    return [user_to_dict(u) for u in users]

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    hashed_password = hash_password(body.get("password", ""))
    
    user = User(
        username=body.get("username"),
        password=hashed_password,
        email=body.get("email"),
        full_name=body.get("fullName") or body.get("full_name"),
        role=body.get("role", "operator"),
        is_active=body.get("isActive", True) if body.get("isActive") is not None else body.get("is_active", True)
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="create",
        entity_type="user",
        entity_id=user.id,
        details={"username": user.username, "role": user.role}
    )
    db.add(audit_log)
    db.commit()
    
    return user_to_dict(user)

@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    
    if "password" in body and body["password"]:
        body["password"] = hash_password(body["password"])
    
    for key, value in body.items():
        if key == "fullName":
            setattr(user, "full_name", value)
        elif key == "isActive":
            setattr(user, "is_active", value)
        elif hasattr(user, key):
            setattr(user, key, value)
    
    db.commit()
    db.refresh(user)
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="update",
        entity_type="user",
        entity_id=user_id
    )
    db.add(audit_log)
    db.commit()
    
    return user_to_dict(user)

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Cannot delete your own account"}
        )
    
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        db.delete(user)
        db.commit()
    
    audit_log = AuditLog(
        user_id=current_user.id,
        action="delete",
        entity_type="user",
        entity_id=user_id
    )
    db.add(audit_log)
    db.commit()
    
    return None
