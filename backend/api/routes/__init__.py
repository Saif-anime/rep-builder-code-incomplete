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

__all__ = [
    "auth_router",
    "users_router",
    "cameras_router",
    "bays_router",
    "sites_router",
    "evidence_router",
    "cases_router",
    "parking_router",
    "signage_router",
    "dashboard_router",
]
