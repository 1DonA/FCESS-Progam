import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Keep these for reference but ignore them for SQLite
    DB_USER: str = os.getenv("DB_USER", "postgres")
    DB_PASS: str = os.getenv("DB_PASS", "postgres")
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: str = os.getenv("DB_PORT", "5432")
    DB_NAME: str = os.getenv("DB_NAME", "fcess_v3")
    
    SECRET_KEY: str = os.getenv("JWT_SECRET", "supersecretkeyshouldbechanged")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Force SQLite for local dev ease
    @property
    def DATABASE_URL(self) -> str:
        return "sqlite+aiosqlite:///./fcess.db"

    class Config:
        env_file = ".env"

settings = Settings()
