from fastapi import APIRouter
from backend.src.api.v1.endpoints import auth, scheduling, catalog, import_csv, room_requests

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(scheduling.router, prefix="/scheduling", tags=["scheduling"])
api_router.include_router(catalog.router, prefix="/catalog", tags=["catalog"])
api_router.include_router(import_csv.router, prefix="/import", tags=["import"])
api_router.include_router(room_requests.router, prefix="/room-requests", tags=["room-requests"])
