from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from .config import settings

# Build the async engine. Postgres on Render needs a small pool and
# pool_pre_ping so dropped idle connections are detected.
_engine_kwargs = {
    "echo": False,        # was True; quieter on Render logs
    "future": True,
}
if settings.IS_POSTGRES:
    _engine_kwargs.update({
        "pool_size": 5,
        "max_overflow": 5,
        "pool_pre_ping": True,
        "pool_recycle": 1800,   # drop connections older than 30 min
    })

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)
