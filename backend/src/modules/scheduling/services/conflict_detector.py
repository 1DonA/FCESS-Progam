# FR-10, FR-12, FR-18 compliance
import uuid
from datetime import time, datetime, timedelta
from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from backend.src.modules.scheduling.models import Session, Section
from backend.src.modules.catalog.models import Course
from backend.src.modules.infrastructure.models import Prerequisite

class ConflictDetector:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def check_faculty_conflict(self, faculty_id: uuid.UUID, day_of_week: int, start_slot: time, duration_minutes: int, semester_id: uuid.UUID) -> List[Dict[str, Any]]:
        # Calculate proposed interval
        start_dt = datetime.combine(datetime.today(), start_slot)
        end_dt = start_dt + timedelta(minutes=duration_minutes)
        proposed_start = start_dt
        proposed_end = end_dt

        # Query all sessions for this faculty on this day
        stmt = (
            select(Session, Course.code.label("course_code"))
            .join(Section, Session.section_id == Section.id)
            .join(Course, Section.course_id == Course.id)
            .where(Session.faculty_id == faculty_id)
            .where(Session.day_of_week == day_of_week)
            .where(Section.semester_id == semester_id)
        )

        result = await self.db.execute(stmt)
        conflicts = []
        for row in result:
            session = row[0]
            course_code = row[1]
            
            # Check overlap
            sess_start = datetime.combine(datetime.today(), session.start_slot)
            sess_end = sess_start + timedelta(minutes=session.duration_minutes)
            
            # Overlap logic: StartA < EndB and StartB < EndA
            if proposed_start < sess_end and sess_start < proposed_end:
                conflicts.append({
                    "conflict_type": "FACULTY_DOUBLE_BOOK",
                    "existing_course_code": course_code,
                    "existing_start_slot": session.start_slot,
                    "existing_duration": session.duration_minutes
                })
        return conflicts

    async def check_room_conflict(self, room_id: uuid.UUID, day_of_week: int, start_slot: time, duration_minutes: int, semester_id: uuid.UUID) -> bool:
        start_dt = datetime.combine(datetime.today(), start_slot)
        end_dt = start_dt + timedelta(minutes=duration_minutes)
        proposed_start = start_dt
        proposed_end = end_dt
        
        stmt = (
            select(Session)
            .join(Section, Session.section_id == Section.id)
            .where(Session.room_id == room_id)
            .where(Session.day_of_week == day_of_week)
            .where(Section.semester_id == semester_id)
        )
        
        result = await self.db.execute(stmt)
        for session in result.scalars():
             sess_start = datetime.combine(datetime.today(), session.start_slot)
             sess_end = sess_start + timedelta(minutes=session.duration_minutes)
             
             if proposed_start < sess_end and sess_start < proposed_end:
                 return True
        return False

    async def check_prerequisite_conflict(self, course_id: uuid.UUID, faculty_id: uuid.UUID, day_of_week: int, start_slot: time, semester_id: uuid.UUID) -> bool:
        # 1. Get prerequisites
        stmt_prereq = select(Prerequisite.prerequisite_course_id).where(Prerequisite.course_id == course_id)
        result_prereq = await self.db.execute(stmt_prereq)
        prereq_ids = result_prereq.scalars().all()
        
        if not prereq_ids:
            return False
            
        # 2. Check for sessions of prereq courses at same time
        stmt = (
            select(Session)
            .join(Section, Session.section_id == Section.id)
            .where(Section.course_id.in_(prereq_ids))
            .where(Session.day_of_week == day_of_week)
            .where(Section.semester_id == semester_id)
        )
        
        result = await self.db.execute(stmt)
        proposed_start = datetime.combine(datetime.today(), start_slot)
        # Assuming fixed duration for slot check or exact match?
        # Requirement was "same... start_slot". Let's stick to start_slot exact match for simplicity OR overlap.
        # But if we want to be robust, overlap.
        # The previous code filtered strict `Session.start_slot == start_slot`.
        # Let's keep strict equality check to match spec/previous logic unless simple overlap is better.
        # Overlap is better.
        # But for valid refactor of previous logic:
        for session in result.scalars():
             if session.start_slot == start_slot:
                 return True
        return False
