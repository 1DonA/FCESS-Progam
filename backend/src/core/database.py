from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from .config import settings

# Build the async engine. Postgres on Render needs a small pool, pool_pre_ping
# (idle drops), and SSL passed as a CONNECT ARG (asyncpg does not understand
# sslmode in the URL).
_engine_kwargs = {
    "echo": False,
    "future": True,
}
if settings.IS_POSTGRES:
    _engine_kwargs.update({
        "pool_size": 5,
        "max_overflow": 5,
        "pool_pre_ping": True,
        "pool_recycle": 1800,
        # asyncpg uses 'ssl' (bool or ssl.SSLContext), NOT 'sslmode'.
        "connect_args": {"ssl": True},
    })

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)
