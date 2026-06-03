# FR-20, FR-21 compliance: Do not modify logic
import uuid
from typing import List
from backend.src.modules.catalog.models import Course
from backend.src.modules.scheduling.models import Session

def split_course_into_sessions(course: Course, semester_id: uuid.UUID) -> List[Session]:
    total_hours = course.lecture_hours + course.lab_hours
    sessions = []

    if total_hours <= 3:
        # FR-20
        session = Session(
            session_type="COMBINED",
            duration_minutes=total_hours * 60,
            semester_id=semester_id # Added to satisfy strict schema requirement from Phase 1
        )
        sessions.append(session)
    else:
        # FR-21
        session_lecture = Session(
            session_type="LECTURE",
            duration_minutes=course.lecture_hours * 60,
            semester_id=semester_id
        )
        session_lab = Session(
            session_type="LAB",
            duration_minutes=course.lab_hours * 60,
            semester_id=semester_id
        )
        sessions.append(session_lecture)
        sessions.append(session_lab)
    
    # section_id = None (caller will assign)
    return sessions

if __name__ == "__main__":
    from backend.src.modules.catalog.models import Course
    mock_course_1 = Course(lecture_hours=2, lab_hours=1)  # 3 hours -> 1 session
    # Mocking UUID for test
    mock_semester_id = uuid.uuid4()
    result_1 = split_course_into_sessions(mock_course_1, mock_semester_id)
    assert len(result_1) == 1, f"FR-20 failed: expected 1, got {len(result_1)}"
    assert result_1[0].session_type == "COMBINED"
    
    mock_course_2 = Course(lecture_hours=3, lab_hours=1)  # 4 hours -> 2 sessions
    result_2 = split_course_into_sessions(mock_course_2, mock_semester_id)
    assert len(result_2) == 2, f"FR-21 failed: expected 2, got {len(result_2)}"
    assert result_2[0].session_type == "LECTURE"
    assert result_2[1].session_type == "LAB"
    
    print("FR-20/21 Session Splitter: All assertions passed.")
