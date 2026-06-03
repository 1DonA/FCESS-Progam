import uuid
from sqlalchemy import (
    Column, String, Boolean, DateTime, Numeric, Integer, ForeignKey,
    Enum, func, CheckConstraint, Uuid, UniqueConstraint,
)
from sqlalchemy.orm import relationship, column_property
from backend.src.core.base import Base


class Department(Base):
    """A Department row models *both* faculties (top-level) and the
    departments within them (sub-level).

      parent_id IS NULL  → this row is a Faculty (Faculty of Engineering)
      parent_id IS SET   → this row is a sub-department under that faculty
                           (Computer Engineering under Faculty of Engineering)
    """
    __tablename__ = 'departments'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(10), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    # Optional pointer to the parent Faculty (NULL = this row IS a faculty).
    parent_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('departments.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Faculty(Base):
    __tablename__ = 'faculties'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    department_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('departments.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    rank = Column(Enum("PROFESSOR", "LECTURER", "ASSISTANT", name="faculty_rank"), nullable=False)
    max_load_hours = Column(Numeric(4, 2), nullable=False)
    current_load_hours = Column(Numeric(4, 2), nullable=False, default=0.00)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    department = relationship("Department")


class Course(Base):
    __tablename__ = 'courses'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(20), unique=True, nullable=False, index=True)
    title = Column(String(200), nullable=False)
    credit_hours = Column(Numeric(3, 2), nullable=False)
    lecture_hours = Column(Integer, nullable=False)
    lab_hours = Column(Integer, nullable=False, default=0)
    tutorial_hours = Column(Integer, nullable=False, default=0, server_default='0')
    department_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('departments.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    curriculum_year = Column(Integer, nullable=False)
    # Semester within the year: 1 = Fall, 2 = Spring. Curriculum page groups
    # courses by (year, semester) so each year shows two columns.
    semester_in_year = Column(Integer, nullable=False, default=1, server_default='1')
    # Curriculum metadata
    course_type = Column(String(20), nullable=True)   # CORE | ELECTIVE | GENERAL
    workload = Column(Numeric(4, 2), nullable=True)   # weekly hours
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    requires_lab = column_property(lab_hours > 0)
    department = relationship("Department")

    __table_args__ = (
        CheckConstraint('lecture_hours >= 0 AND lab_hours >= 0', name='check_positive_hours'),
    )


class FacultyCourseAssignment(Base):
    """Links a lecturer to a course (with optional pinned room)."""
    __tablename__ = 'faculty_course_assignments'

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    faculty_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('faculties.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    course_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('courses.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    department_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('departments.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    # Optional pinned classroom. The /catalog/assignments endpoint validates
    # lab-vs-lecture room types against the course's lab_hours / lecture_hours
    # so lab courses cannot be paired with a lecture-only room and vice versa.
    room_id = Column(
        Uuid(as_uuid=True),
        ForeignKey('classrooms.id', ondelete='SET NULL'),
        nullable=True,
        index=True,
    )
    notes = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    faculty = relationship("Faculty")
    course = relationship("Course")
    department = relationship("Department")
    room = relationship("backend.src.modules.infrastructure.models.Classroom")

    __table_args__ = (
        UniqueConstraint('faculty_id', 'course_id', name='uq_faculty_course'),
    )
