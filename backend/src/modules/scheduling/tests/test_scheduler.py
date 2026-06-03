import pytest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import time

from modules.scheduling.services.scheduler import AutoScheduler
from modules.catalog.models import Course
from modules.scheduling.models import Section, Session
from modules.infrastructure.models import Classroom

@pytest.mark.asyncio
async def test_scheduler_success_flow():
    # Setup Mocks
    mock_db = AsyncMock()
    
    # Mock Data
    semester_id = uuid.uuid4()
    course_id = uuid.uuid4()
    section_id = uuid.uuid4()
    
    mock_section = Section(id=section_id, course_id=course_id, semester_id=semester_id, section_number="1")
    # Course needs 3 hours (Lecture 2, Lab 1) -> SessionSplitter logic
    # Mocking SessionSplitter return would be easier, but let's just mock the Course object
    mock_course = Course(id=course_id, code="CS101", lecture_hours=2, lab_hours=1, credit_hours=3)
    
    mock_room = Classroom(id=uuid.uuid4(), room_number="101", room_type="LECTURE_HALL")
    mock_lab = Classroom(id=uuid.uuid4(), room_number="LAB1", room_type="LAB")

    # Mock DB Execute Results
    # 1. _fetch_pending_sections -> [mock_section]
    # 2. select(Course) -> mock_course
    # 3. _get_compatible_rooms -> [mock_room] or [mock_lab]
    # 4. _find_free_room -> checks conflict_detector -> returns room
    
    # We need to carefully mock the sequence of execute calls
    # OR we can mock the internal helper methods of AutoScheduler to test the main loop
    
    scheduler = AutoScheduler(mock_db)
    
    # Mocking internal helpers to simplify test of the 'generate_schedule' orchestration
    scheduler._fetch_pending_sections = AsyncMock(return_value=[mock_section])
    scheduler._get_compatible_rooms = AsyncMock(side_effect=lambda type: [mock_lab] if type == "LAB" else [mock_room])
    
    # Mock conflict detector attached to scheduler
    scheduler.conflict_detector.check_room_conflict = AsyncMock(return_value=False)
    
    # Mock the query for Course inside the loop
    # We can't easily mock `db.execute` for different queries distinguished by args without complex side_effects
    # So we'll patch `db.execute` to return a ScalarResult mock
    
    async def db_execute_side_effect(stmt):
        # Extremely simplified matching based on string representation of statement or structure
        # In a real app this is fragile, but for this smoke test:
        stmt_str = str(stmt)
        mock_result = MagicMock()
        if "FROM sections" in stmt_str or "modules.scheduling.models.Section" in stmt_str:
            mock_result.scalars.return_value.all.return_value = [mock_section]
        elif "FROM courses" in stmt_str:
            mock_result.scalar_one.return_value = mock_course
        elif "FROM classrooms" in stmt_str:
             # Handled by _get_compatible_rooms override, but if called:
             mock_result.scalars.return_value.all.return_value = [mock_room]
        return mock_result

    # Fix add_all to be synchronous mock
    mock_db.add_all = MagicMock()
    mock_db.commit = AsyncMock()

    # Re-instantiate to use the db mock side effect if we didn't override helpers
    # But overriding helpers is safer.
    
    # Let's override the Course fetch specifically by mocking the `db.execute` just for that, 
    # since we already overrode _fetch_pending and _get_compatible
    
    mock_result_course = MagicMock()
    mock_result_course.scalar_one.return_value = mock_course
    mock_db.execute.return_value = mock_result_course

    # Run
    result = await scheduler.generate_schedule(semester_id)
    
    # Verify
    assert result["success"] == 1
    assert result["failed"] == 0
    assert mock_db.commit.called
    assert mock_db.add_all.called
    
    # Verify add_all call args
    args = mock_db.add_all.call_args[0][0]
    assert len(args) == 1 # Total 3 hours -> <=3 is Combined (1 session)
    # logic: if <=3: Combined (1 session). if >3: Split.
    # mock_course total = 2+1=3. So 1 session.
    # Wait, check session_splitter.py:
    # if total_hours <= 3: 1 session (COMBINED) -> CORRECT.
    # So we expect 1 session.
    
    assert len(args) == 1
    session = args[0]
    assert session.session_type == "COMBINED"
    assert session.room_id == mock_room.id # Should pick Lecture Hall for Combined? Or Lab?
    # Logic in compatible rooms: "COMBINED" -> LECTURE_HALL or SEMINAR.
    # Only mock_room (LECTURE_HALL) was returned by mock.
    
    print("\nTest Passed: Scheduler successfully scheduled 1 section.")

if __name__ == "__main__":
    # Allow running directly
    import asyncio
    asyncio.run(test_scheduler_success_flow())
