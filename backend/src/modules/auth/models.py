import uuid
from sqlalchemy import Column, String, Boolean, Enum, Uuid, DateTime, Text, func
from backend.src.core.base import Base

class User(Base):
    __tablename__ = 'users'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    # FR-8.1/8.2/8.3: Three roles - ADMIN, CHAIR (Department Chair/Scheduler), FACULTY
    role = Column(Enum("ADMIN", "CHAIR", "FACULTY", name="user_role"), default="FACULTY", nullable=False)
    # Link faculty user to their faculty record (optional)
    faculty_id = Column(Uuid(as_uuid=True), nullable=True)
    # Link chair user to their department (optional)
    department_id = Column(Uuid(as_uuid=True), nullable=True)

class AuditLog(Base):
    """FR-8.4: Audit trail - log all scheduling changes for accountability."""
    __tablename__ = 'audit_logs'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), nullable=True)
    user_email = Column(String, nullable=True)
    action = Column(String(100), nullable=False)   # e.g. "CREATE_SESSION", "DELETE_SECTION"
    resource_type = Column(String(50), nullable=False)   # e.g. "Session", "Section"
    resource_id = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
