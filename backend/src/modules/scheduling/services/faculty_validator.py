# FR-6, FR-7, FR-22 compliance
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from backend.src.modules.catalog.models import Faculty, Course
from backend.src.modules.scheduling.models import Session, Section

class FacultyLoadValidator:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def validate_load_limit(self, faculty_id: uuid.UUID, additional_credits: float) -> bool:
        stmt = select(Faculty.current_load_hours, Faculty.max_load_hours).where(Faculty.id == faculty_id)
        result = await self.db.execute(stmt)
        faculty = result.first()
        
        if not faculty:
            return False # Or raise error
            
        current_load = faculty.current_load_hours
        max_load = faculty.max_load_hours
        
        new_load = float(current_load) + float(additional_credits)
        return new_load <= float(max_load)

    async def get_current_load(self, faculty_id: uuid.UUID, active_semester_id: uuid.UUID) -> float:
        stmt = (
            select(func.sum(Course.credit_hours))
            .join(Section, Course.id == Section.course_id)
            .join(Session, Section.id == Session.section_id)
            .where(Session.faculty_id == faculty_id)
            .where(Section.semester_id == active_semester_id)
        )
        result = await self.db.execute(stmt)
        load = result.scalar()
        return float(load) if load else 0.00

    async def validate_one_day_off(self, faculty_id: uuid.UUID, semester_id: uuid.UUID) -> bool:
        # Query all day_of_week values (0-4) for faculty's sessions in semester
        stmt = (
            select(Session.day_of_week)
            .join(Section, Session.section_id == Section.id)
            .where(Session.faculty_id == faculty_id)
            .where(Section.semester_id == semester_id)
        )
        result = await self.db.execute(stmt)
        scheduled_days = set(result.scalars().all())
        
        # Return: len(scheduled_days) < 5 (FR-22: at least one day off)
        return len(scheduled_days) < 5
