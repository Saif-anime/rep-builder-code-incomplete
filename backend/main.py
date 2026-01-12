import os
import sys
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
import uvicorn

from backend.config import settings
from backend.db import get_db_context
from backend. services.auth_service import create_default_admin

from backend.api.routes.auth import router as auth_router
from backend.api.routes.users import router as users_router
from backend.api.routes.cameras import router as cameras_router
from backend.api.routes.bays import router as bays_router
from backend.api.routes.sites import router as sites_router
from backend.api.routes.evidence import router as evidence_router
from backend.api.routes.cases import router as cases_router
from backend.api.routes.parking import router as parking_router
from backend.api.routes.signage import router as signage_router
from backend.api.routes.dashboard import router as dashboard_router
from backend.api.routes.site_intelligence import router as site_intelligence_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[FastAPI] Starting Euro Parking Services Python Backend")
    print(f"[FastAPI] Upload directory: {settings.UPLOAD_DIR}")
    
    with get_db_context() as db:
        await create_default_admin(db)
    
    yield
    
    print("[FastAPI] Shutting down...")

app = FastAPI(
    title="Euro Parking Services API",
    description="AI-Powered Parking Enforcement System",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = datetime.now()
    response = await call_next(request)
    duration = (datetime.now() - start_time).total_seconds() * 1000
    
    if request.url.path.startswith("/api"):
        formatted_time = datetime.now().strftime("%I:%M:%S %p")
        print(f"{formatted_time} [fastapi] {request.method} {request.url.path} {response.status_code} in {duration:.0f}ms")
    
    return response

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.detail if isinstance(exc.detail, dict) else {"message": exc.detail}
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    print(f"[FastAPI] Error: {exc}")
    return JSONResponse(
        status_code=500,
        content={"message": "Internal Server Error"}
    )

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(cameras_router)
app.include_router(bays_router)
app.include_router(sites_router)
app.include_router(evidence_router)
app.include_router(cases_router)
app.include_router(parking_router)
app.include_router(signage_router)
app.include_router(dashboard_router)
app.include_router(site_intelligence_router)

if os.path.exists(settings.UPLOAD_DIR):
    app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

DIST_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist", "public")
if os.path.exists(DIST_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "backend": "python", "version": "2.0.0"}

@app.get("/api/audit-logs")
async def get_audit_logs(limit: int = 50):
    from backend.db import get_db_context
    from backend.db.models import AuditLog
    
    with get_db_context() as db:
        logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
        return [{
            "id": log.id,
            "userId": log.user_id,
            "action": log.action,
            "entityType": log.entity_type,
            "entityId": log.entity_id,
            "details": log.details,
            "ipAddress": log.ip_address,
            "userAgent": log.user_agent,
            "createdAt": log.created_at.isoformat() if log.created_at else None
        } for log in logs]

@app.get("/api/ai-settings")
async def get_ai_settings():
    from backend.db import get_db_context
    from backend.db.models import AiSetting
    
    with get_db_context() as db:
        settings_list = db.query(AiSetting).all()
        result = {}
        for s in settings_list:
            result[s.setting_key] = s.setting_value
        return result

@app.get("/api/pcns")
async def get_pcns(status: str = None):
    from backend.db import get_db_context
    from backend.db.models import Pcn
    
    with get_db_context() as db:
        query = db.query(Pcn)
        if status:
            query = query.filter(Pcn.status == status)
        pcns = query.order_by(Pcn.created_at.desc()).all()
        return [{
            "id": p.id,
            "pcnNumber": p.pcn_number,
            "caseId": p.case_id,
            "siteId": p.site_id,
            "vrm": p.vrm,
            "status": p.status,
            "eligibility": p.eligibility,
            "amount": p.amount,
            "explanation": p.explanation,
            "issuedAt": p.issued_at.isoformat() if p.issued_at else None,
            "createdAt": p.created_at.isoformat() if p.created_at else None
        } for p in pcns]

@app.get("/api/recommendations")
async def get_recommendations():
    from backend.db import get_db_context
    from backend.db.models import PcnRecommendation
    
    with get_db_context() as db:
        recs = db.query(PcnRecommendation).order_by(PcnRecommendation.created_at.desc()).all()
        return [{
            "id": r.id,
            "sessionId": r.session_id,
            "siteId": r.site_id,
            "vrm": r.vrm,
            "action": r.action,
            "previousAction": r.previous_action,
            "source": r.source,
            "reason": r.reason,
            "reasonPlain": r.reason_plain,
            "confidence": r.confidence,
            "isOverride": r.is_override,
            "createdAt": r.created_at.isoformat() if r.created_at else None
        } for r in recs]

@app.get("/api/analysis-reports")
async def get_analysis_reports():
    from backend.db import get_db_context
    from backend.db.models import CaseAnalysis
    
    with get_db_context() as db:
        analyses = db.query(CaseAnalysis).all()
        return [{
            "id": a.id,
            "caseId": a.case_id,
            "summary": a.summary,
            "recommendation": a.recommendation,
            "confidenceScore": a.confidence_score,
            "generatedAt": a.generated_at.isoformat() if a.generated_at else None
        } for a in analyses]

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Serve the SPA for all non-API routes"""
    if full_path.startswith("api/") or full_path.startswith("uploads/"):
        raise HTTPException(status_code=404, detail="Not found")
    
    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    
    return JSONResponse(
        status_code=503,
        content={"message": "Frontend not built. Run 'npm run build' first."}
    )

if __name__ == "__main__":
    port = settings.PORT
    print(f"[FastAPI] Starting server on 0.0.0.0:{port}")
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )
