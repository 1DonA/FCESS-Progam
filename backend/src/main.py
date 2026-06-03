import os
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.src.api.v1.api import api_router

app = FastAPI(title="FCESS v3 API", version="0.2.0")

# CORS — wide open for the bundled SPA + local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


# --- Static SPA (single-page admin UI) ---------------------------------------
_STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_STATIC_DIR):
    app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")

    @app.get("/", response_class=HTMLResponse)
    async def root_index():
        return FileResponse(os.path.join(_STATIC_DIR, "index.html"))


# --- TEMP seed admin endpoint (handy when the DB is empty) -------------------
from backend.src.core.database import AsyncSessionLocal
from backend.src.modules.auth.models import User
from backend.src.core.security import get_password_hash
from sqlalchemy import select


@app.post("/seed_admin")
async def seed_admin_endpoint():
    async with AsyncSessionLocal() as db:
        admin_email = "admin@fcess.com"
        stmt = select(User).where(User.email == admin_email)
        result = await db.execute(stmt)
        if result.scalar_one_or_none():
            return {"message": "Admin already exists"}

        admin = User(
            id=uuid.uuid4(),
            email=admin_email,
            hashed_password=get_password_hash("admin123"),
            full_name="System Admin",
            role="ADMIN",
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        return {"message": "Admin created", "email": admin_email}


@app.get("/health")
def health_check():
    return {"status": "ok"}


# --- Lightweight startup migration ------------------------------------------
# Creates any new tables added since the DB was last touched (e.g. room_requests)
# and patches in new columns that older SQLite databases don't yet have
# (e.g. buildings.department_id). Safe to call repeatedly.
@app.on_event("startup")
async def _ensure_schema():
    from backend.src.core.base import Base
    from backend.src.core.database import engine
    # Import every model module so SQLAlchemy registers them on Base.metadata.
    import backend.src.modules.auth.models            # noqa: F401
    import backend.src.modules.catalog.models         # noqa: F401
    import backend.src.modules.infrastructure.models  # noqa: F401
    import backend.src.modules.scheduling.models      # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Dialect-aware ALTERs for columns added after release.
        # On Postgres we use information_schema; on SQLite we use PRAGMA.
        from backend.src.core.config import settings as _settings
        IS_SQLITE = _settings.IS_SQLITE

        def _patch(sync_conn):
            from sqlalchemy import text
            def add_if_missing(table, col, sqlite_ddl, postgres_ddl=None):
                try:
                    if IS_SQLITE:
                        cols = sync_conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
                        names = {c[1] for c in cols}
                        if col not in names:
                            sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {sqlite_ddl}"))
                    else:
                        # Postgres: information_schema lookup
                        ddl = postgres_ddl or sqlite_ddl
                        # CHAR(36) -> UUID isn't safe to assume; we just keep nullable.
                        ddl = (ddl.replace("CHAR(36)", "VARCHAR(36)")
                                  .replace(" NULL", ""))
                        exists = sync_conn.execute(text(
                            "SELECT 1 FROM information_schema.columns "
                            "WHERE table_name = :t AND column_name = :c"
                        ), {"t": table, "c": col}).first()
                        if not exists:
                            sync_conn.execute(text(
                                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {ddl}"
                            ))
                except Exception:
                    pass

            add_if_missing("buildings", "department_id", "CHAR(36) NULL")
            add_if_missing("sections",  "kind",          "VARCHAR(20) DEFAULT 'COMBINED'")
            add_if_missing("sections",  "lecturer_id",   "CHAR(36) NULL")
            add_if_missing("departments", "parent_id",   "CHAR(36) NULL")
            add_if_missing("courses",    "tutorial_hours", "INTEGER DEFAULT 0")
            add_if_missing("courses",    "semester_in_year", "INTEGER DEFAULT 1")
            # Heuristic backfill: existing rows where semester_in_year is at
            # default (1) get their value from the LAST DIGIT of the course
            # code: odd -> Fall (1), even -> Spring (2). Matches FIU
            # convention (MATH121=Fall, MATH122=Spring; CMPE315=Fall,
            # CMPE316=Spring; etc.)
            # Heuristic backfill of semester_in_year using the last digit of the
            # course code. SQL flavors differ - try the SQLite form first, then
            # Postgres if that errored.
            try:
                if IS_SQLITE:
                    sync_conn.execute(text(
                        "UPDATE courses SET semester_in_year = "
                        "  CASE WHEN CAST(substr(code, length(code), 1) AS INTEGER) % 2 = 0 THEN 2 ELSE 1 END "
                        "WHERE semester_in_year = 1"
                    ))
                else:
                    sync_conn.execute(text(
                        "UPDATE courses SET semester_in_year = "
                        "  CASE WHEN CAST(right(code, 1) AS INTEGER) % 2 = 0 THEN 2 ELSE 1 END "
                        "WHERE semester_in_year = 1"
                    ))
            except Exception:
                pass
        await conn.run_sync(_patch)
