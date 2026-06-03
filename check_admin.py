import asyncio
from backend.src.core.database import AsyncSessionLocal
from backend.src.modules.auth.models import User
from sqlalchemy import select

async def check_admin():
    async with AsyncSessionLocal() as db:
        stmt = select(User).where(User.email == "admin@example.com")
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        if user:
            print(f"User found: {user.email}, Role: {user.role}, Is Active: {user.is_active}")
        else:
            print("User NOT found")

if __name__ == "__main__":
    asyncio.run(check_admin())
