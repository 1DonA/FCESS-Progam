# Part 2: FR-1, FR-2, FR-3 compliance
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, Enum, Boolean, ForeignKey, CheckConstraint,
    UniqueConstraint, Uuid, Time, Text, DateTime, func,
)
from sqlalchemy.orm import relationship
from backend.src.core.base import Base


class Building(Base):
    __tablename__ = 'buildings'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    code = Column(String(20), unique=True, nullable=False)
    # Each building is owned by one department (the "host faculty"). When NULL
    # the building is treated as shared / common-use. Other departments who
    # need a room here have to file a RoomRequest that the owner accepts.
    department_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('departments.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )

class Classroom(Base):
    # Part 2: FR-1, FR-2, FR-3 compliance
    __tablename__ = 'classrooms'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_number = Column(String(20), nullable=False)
    building_id = Column(Uuid(as_uuid=True), ForeignKey('buildings.id'), nullable=False)
    capacity = Column(Integer, nullable=False)
    type = Column(Enum("LECTURE_HALL", "LAB", "SEMINAR", name="room_type"), nullable=False)
    is_active = Column(Boolean, default=True)
    
    building = relationship("Building")

    __table_args__ = (
        UniqueConstraint('building_id', 'room_number', name='uq_classroom_location'),
    )

class Prerequisite(Base):
    # FR-18 compliance
    __tablename__ = 'prerequisites'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id = Column(Uuid(as_uuid=True), ForeignKey('courses.id'), nullable=False, index=True)
    prerequisite_course_id = Column(Uuid(as_uuid=True), ForeignKey('courses.id'), nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint('course_id', 'prerequisite_course_id', name='uq_course_prerequisite'),
        CheckConstraint('course_id != prerequisite_course_id', name='check_no_self_reference'),
    )


class RoomRequest(Base):
    """Cross-department room booking request.

    When a department needs a room owned by another department (e.g. Engineering
    wants to borrow an Architecture studio), the requesting chair files one of
    these. The owning chair sees it in their inbox and can accept, reject, or
    counter-propose with a message.
    """
    __tablename__ = 'room_requests'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Department asking for the room
    requester_department_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('departments.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    # Department that owns the room (and must approve)
    owner_department_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('departments.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    room_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('classrooms.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    # Optional: which course/section needs the room
    course_id = Column(Uuid(as_uuid=True), ForeignKey('courses.id', ondelete='SET NULL'), nullable=True)
    section_id = Column(Uuid(as_uuid=True), ForeignKey('sections.id', ondelete='SET NULL'), nullable=True)
    semester_id = Column(Uuid(as_uuid=True), ForeignKey('semesters.id', ondelete='SET NULL'), nullable=True)

    # Requested slot
    day_of_week = Column(Integer, nullable=False)  # 0=Mon … 4=Fri
    start_slot = Column(Time, nullable=False)
    duration_minutes = Column(Integer, nullable=False, default=60)

    # Workflow
    status = Column(
        Enum("PENDING", "ACCEPTED", "REJECTED", "CANCELLED", name="room_request_status"),
        nullable=False,
        default="PENDING",
        index=True,
    )
    message = Column(Text, nullable=True)            # requester's note
    response_message = Column(Text, nullable=True)   # owner's reply
    help_offered = Column(Text, nullable=True)       # "what help they can render"
                                                     # e.g. "we can offer Lab 203 instead at 14:00"

    requester_user_id = Column(Uuid(as_uuid=True), nullable=True)  # who filed it
    responder_user_id = Column(Uuid(as_uuid=True), nullable=True)  # who accepted/rejected
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    responded_at = Column(DateTime(timezone=True), nullable=True)

    room = relationship("Classroom")
    requester_department = relationship("backend.src.modules.catalog.models.Department",
                                        foreign_keys=[requester_department_id])
    owner_department = relationship("backend.src.modules.catalog.models.Department",
                                    foreign_keys=[owner_department_id])
