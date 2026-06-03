import os
import re
from pydantic_settings import BaseSettings


def _strip_ssl_params(url: str) -> str:
    """Remove sslmode / channel_binding / any SSL query-string params that
    asyncpg refuses. Also handles them sitting after both '?' and '&'."""
    # remove ?sslmode=xxx or &sslmode=xxx (any position)
    url = re.sub(r"[?&](sslmode|channel_binding|sslcert|sslkey|sslrootcert)=[^&]*", "", url)
    # collapse any leftover '?&' or trailing '?'/'&'
    url = url.replace("?&", "?")
    if url.endswith("?") or url.endswith("&"):
        url = url[:-1]
    return url


def _normalise_database_url(raw: str) -> str:
    """Make any DATABASE_URL safe for SQLAlchemy 2.0 async."""
    if not raw:
        return "sqlite+aiosqlite:///./fcess.db"

    url = raw.strip()

    # SQLite local file
    if url.startswith("sqlite:///") and "aiosqlite" not in url:
        return url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if url.startswith("sqlite+aiosqlite:///") or url.startswith("sqlite+aiosqlite://"):
        return url

    # postgres://...  ->  postgresql+asyncpg://...
    if url.startswith("postgresql://fcess_db_user:521UVr0eMbVo42TzRn3HQkOGEhLkYhsB@dpg-d8fr2qeq1p3s73clgpe0-a/fcess_db"):
        url = "postgresql+asyncpg://" + url[len("postgresql://fcess_db_user:521UVr0eMbVo42TzRn3HQkOGEhLkYhsB@dpg-d8fr2qeq1p3s73clgpe0-a/fcess_db"):]
    elif url.startswith("postgresql://fcess_db_user:521UVr0eMbVo42TzRn3HQkOGEhLkYhsB@dpg-d8fr2qeq1p3s73clgpe0-a/fcess_db"):
        url = "postgresql+asyncpg://" + url[len("postgresql://fcess_db_user:521UVr0eMbVo42TzRn3HQkOGEhLkYhsB@dpg-d8fr2qeq1p3s73clgpe0-a/fcess_db"):]

    # CRITICAL: strip ALL ssl params - asyncpg gets SSL via connect_args, not URL.
    url = _strip_ssl_params(url)
    # And as a final safety net, strip everything after '?' (we don't need any params).
    if "?" in url:
        url = url.split("?", 1)[0]

    return url


# Read the DATABASE_URL env var DIRECTLY at module import time. No pydantic
# wrapper - it's the source of confusion. We just print it (masked) on startup.
_RAW_DB_URL = os.getenv("DATABASE_URL", "").strip()
_FINAL_DB_URL = _normalise_database_url(_RAW_DB_URL)


def _mask(u: str) -> str:
    """Hide password between ':' and '@' so logs don't leak credentials."""
    if "://" not in u:
        return u
    scheme, rest = u.split("://", 1)
    if "@" in rest and ":" in rest.split("@")[0]:
        userpart, hostpart = rest.split("@", 1)
        user, _ = userpart.split(":", 1)
        return f"{scheme}://{user}:***@{hostpart}"
    return u


# Print on boot so we can verify in Render logs what URL is in effect.
print(f"[FCESS] DATABASE_URL (raw, masked):   {_mask(_RAW_DB_URL) or '(empty - using SQLite)'}", flush=True)
print(f"[FCESS] DATABASE_URL (final, masked): {_mask(_FINAL_DB_URL)}", flush=True)


class Settings(BaseSettings):
    SECRET_KEY: str = os.getenv("JWT_SECRET", "supersecretkeyshouldbechanged")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    @property
    def DATABASE_URL(self) -> str:
        return _FINAL_DB_URL

    @property
    def IS_SQLITE(self) -> bool:
        return _FINAL_DB_URL.startswith("sqlite")

    @property
    def IS_POSTGRES(self) -> bool:
        return "postgresql" in _FINAL_DB_URL

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
