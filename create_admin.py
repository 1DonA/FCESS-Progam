import asyncio
import uuid
import sys
import os

sys.path.append(os.getcwd())

from backend.src.core.database import AsyncSessionLocal
from backend.src.modules.auth.models import User
from backend.src.core.security import get_password_hash

async def create_admin():
    async with AsyncSessionLocal() as db:
        # Delete existing
        from sqlalchemy import delete
        stmt = delete(User).where(User.email == "admin@example.com")
        await db.execute(stmt)
        await db.commit()
        
        admin_user = User(
            id=uuid.uuid4(),
            email="admin@example.com",
            hashed_password=get_password_hash("password123"),
            is_active=True,
            role="ADMIN"
        )
        db.add(admin_user)
        await db.commit()
        print("Admin user created.")

if __name__ == "__main__":
    asyncio.run(create_admin())
