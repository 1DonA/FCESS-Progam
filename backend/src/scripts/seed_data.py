import asyncio
import uuid
import sys
import os
from datetime import date

# Add project root to path
sys.path.append(os.getcwd())

from backend.src.core.database import AsyncSessionLocal
from backend.src.modules.catalog.models import Department, Faculty, Course
from backend.src.modules.infrastructure.models import Classroom, Building
from backend.src.modules.scheduling.models import Semester, Section

async def seed():
    async with AsyncSessionLocal() as db:
        print("Seeding data...")
        


        # 2. Departments
        dept_cs = Department(id=uuid.uuid4(), code="CS", name="Computer Science")
        db.add(dept_cs)
        
        # Buildings & Rooms
        b_sc = Building(id=uuid.uuid4(), name="Science Center", code="SC")
        db.add(b_sc)
        await db.flush()
        
        room_101 = Classroom(id=uuid.uuid4(), room_number="101", building_id=b_sc.id, capacity=50, type="LECTURE_HALL", is_active=True)
        room_lab = Classroom(id=uuid.uuid4(), room_number="LAB1", building_id=b_sc.id, capacity=30, type="LAB", is_active=True)
        db.add_all([room_101, room_lab])
        await db.flush()
        
        # 3. Faculty


        # Faculty
        faculty1 = Faculty(
            id=uuid.uuid4(), 
            first_name="John", 
            last_name="Doe", 
            email="john.doe@uni.edu", 
            department_id=dept_cs.id,
            rank="PROFESSOR",
            max_load_hours=12
        )
        db.add(faculty1)
        
        # Courses
        cs101 = Course(
            id=uuid.uuid4(),
            code="CS101",
            title="Intro to CS",
            credit_hours=3,
            lecture_hours=3,
            lab_hours=0,
            department_id=dept_cs.id,
            curriculum_year=1
        )
        cs102 = Course(
            id=uuid.uuid4(),
            code="CS102",
            title="Programming Lab",
            credit_hours=1,
            lecture_hours=0,
            lab_hours=3,
            department_id=dept_cs.id,
            curriculum_year=1
        )
        db.add_all([cs101, cs102])
        await db.flush()
        
        # Semester
        sem = Semester(
            id=uuid.uuid4(), 
            name="Fall 2024", 
            start_date=date(2024, 8, 20), 
            end_date=date(2024, 12, 15),
            is_active=True
        )
        db.add(sem)
        await db.flush()
        
        # Sections
        sec1 = Section(id=uuid.uuid4(), course_id=cs101.id, semester_id=sem.id, section_number="01")
        sec2 = Section(id=uuid.uuid4(), course_id=cs102.id, semester_id=sem.id, section_number="01")
        db.add_all([sec1, sec2])

        await db.commit()
        print(f"Seeding complete. Use Semester ID: {sem.id}")

if __name__ == "__main__":
    asyncio.run(seed())
