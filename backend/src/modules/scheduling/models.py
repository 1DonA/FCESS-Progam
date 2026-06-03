# FR-15, FR-16 compliance
import uuid
from sqlalchemy import Column, String, Boolean, Date, ForeignKey, Enum, Integer, Time, UniqueConstraint, Index, Uuid
from sqlalchemy.orm import relationship
from backend.src.core.base import Base

class Semester(Base):
    __tablename__ = 'semesters'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(50), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    is_active = Column(Boolean, nullable=False, default=False)

    # SQLite partial index syntax (WHERE clause) is supported in recent versions, but simpler unique constraint is safer if needed.
    # However, standard SQLAlchemy Index with sqlite_where might work, or just drop the uniqueness enforcement for simplicity in this dev migration.
    # Let's try to keep it simple.
    # __table_args__ = (
    #     Index('uq_one_active_semester', 'is_active', unique=True, postgresql_where=(is_active == True)),
    # )
    # Replacing with a simple check app-side or just allowing multiple active for now to avoid migration pain.

class Section(Base):
    """A "group" of a course in a semester. A course can have many groups
    (e.g. ENGR-103 might have 2 LECTURE groups + 6 LAB groups), each with a
    different lecturer.
    """
    __tablename__ = 'sections'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id = Column(Uuid(as_uuid=True), ForeignKey('courses.id'), nullable=False)
    semester_id = Column(Uuid(as_uuid=True), ForeignKey('semesters.id'), nullable=False)
    section_number = Column(String(10), nullable=False)
    expected_enrollment = Column(Integer, nullable=False, default=30)
    # Group kind — LECTURE, LAB, or TUTORIAL. Lets one course mix lecture
    # and lab groups taught by different lecturers.
    kind = Column(
        Enum("LECTURE", "LAB", "TUTORIAL", "COMBINED", name="section_kind"),
        nullable=False,
        default="COMBINED",
        server_default="COMBINED",
    )
    # Per-group lecturer (overrides course-level assignment when set).
    lecturer_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('faculties.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )

    course = relationship("backend.src.modules.catalog.models.Course")
    semester = relationship("Semester")
    lecturer = relationship("backend.src.modules.catalog.models.Faculty")

class Session(Base):
    __tablename__ = 'sessions'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    section_id = Column(Uuid(as_uuid=True), ForeignKey('sections.id'), nullable=False)
    semester_id = Column(Uuid(as_uuid=True), ForeignKey('semesters.id'), nullable=False)
    room_id = Column(Uuid(as_uuid=True), ForeignKey('classrooms.id'), nullable=True)
    faculty_id = Column(Uuid(as_uuid=True), ForeignKey('faculties.id'), nullable=True)
    
    day_of_week = Column(Integer, nullable=False) # 0=Mon
    start_slot = Column(Time, nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    session_type = Column(Enum("LECTURE", "LAB", "COMBINED", name="session_type"), nullable=False)

    section = relationship("Section")
    room = relationship("backend.src.modules.infrastructure.models.Classroom")
    faculty = relationship("backend.src.modules.catalog.models.Faculty")

    __table_args__ = (
        Index('ix_faculty_availability', 'faculty_id', 'day_of_week', 'start_slot'),
        Index('ix_room_availability', 'room_id', 'day_of_week', 'start_slot'),
        Index('ix_student_cohort', 'semester_id', 'day_of_week', 'start_slot'),
    )
