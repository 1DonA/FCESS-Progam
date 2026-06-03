import os
from pydantic_settings import BaseSettings


def _normalise_database_url(raw: str) -> str:
    """Make any DATABASE_URL safe for SQLAlchemy 2.0 async.

    - SQLite gets the aiosqlite driver.
    - Render gives Postgres URLs starting with `postgres://`; SQLAlchemy
      rejects those — convert to `postgresql+asyncpg://`.
    - All query-string parameters (sslmode, etc.) are STRIPPED.
      asyncpg does not understand sslmode; SSL is configured in
      database.py via connect_args={"ssl": True} instead.
    """
    if not raw:
        return "sqlite+aiosqlite:///./fcess.db"

    url = raw.strip()

    # SQLite local file
    if url.startswith("sqlite:///") and "aiosqlite" not in url:
        return url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if url.startswith("sqlite+aiosqlite:///") or url.startswith("sqlite+aiosqlite://"):
        return url

    # Render: postgres://...  ->  postgresql+asyncpg://...
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]

    # STRIP ALL QUERY PARAMS - asyncpg doesn't accept sslmode/channel_binding/etc.
    # SSL is configured in database.py via connect_args.
    if "?" in url:
        url = url.split("?", 1)[0]

    return url


class Settings(BaseSettings):
    # Legacy parts (kept so old .env files still parse; not used directly)
    DB_USER: str = os.getenv("DB_USER", "postgres")
    DB_PASS: str = os.getenv("DB_PASS", "postgres")
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: str = os.getenv("DB_PORT", "5432")
    DB_NAME: str = os.getenv("DB_NAME", "fcess_v3")

    SECRET_KEY: str = os.getenv("JWT_SECRET", "supersecretkeyshouldbechanged")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Read DATABASE_URL from env. Empty/missing -> local SQLite.
    DATABASE_URL_RAW: str = os.getenv("DATABASE_URL", "")

    @property
    def DATABASE_URL(self) -> str:
        return _normalise_database_url(self.DATABASE_URL_RAW)

    @property
    def IS_SQLITE(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def IS_POSTGRES(self) -> bool:
        return "postgresql" in self.DATABASE_URL

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
