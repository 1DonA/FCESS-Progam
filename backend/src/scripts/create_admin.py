import asyncio
import sys
import os
import uuid

# Add project root to path
sys.path.append(os.getcwd())

from sqlalchemy import select
from backend.src.core.database import AsyncSessionLocal
from backend.src.modules.auth.models import User
from backend.src.core.security import get_password_hash

async def create_admin():
    async with AsyncSessionLocal() as db:
        admin_email = "admin@fcess.com"
        print(f"Creating admin user: {admin_email}")
        
        # Check if exists
        stmt = select(User).where(User.email == admin_email)
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        
        if existing:
            print("Admin user already exists.")
            return

        admin = User(
            id=uuid.uuid4(),
            email=admin_email,
            hashed_password=get_password_hash("admin123"),
            full_name="System Admin",
            role="ADMIN",
            is_active=True
        )
        db.add(admin)
        await db.commit()
        print("Admin user created successfully.")
        print("Email: admin@fcess.com")
        print("Password: admin123")

if __name__ == "__main__":
    asyncio.run(create_admin())
