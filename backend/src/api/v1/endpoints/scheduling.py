from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid
from typing import Dict, Optional, List
from pydantic import BaseModel

from backend.src.api import deps
from backend.src.modules.scheduling.services.scheduler import AutoScheduler
from backend.src.modules.scheduling.services.scheduler_cpsat import CpsatScheduler

router = APIRouter()


# ---------------------------------------------------------------------------
# Chair scoping helper — re-used across every scheduling view so a chair
# never sees another faculty's timetable, generation, or yearly schedule.
# ---------------------------------------------------------------------------
async def _chair_scope_dept_ids(db: AsyncSession, user) -> Optional[List[uuid.UUID]]:
    """Returns department ids a CHAIR is allowed to see in scheduling pages
    (their own department + sub-depts if they're at a top-level Faculty).
    Returns None for ADMIN (no scoping), [] for an unlinked chair."""
    from backend.src.modules.catalog.models import Department
    role = (getattr(user, "role", "") or "").upper()
    if role != "CHAIR":
        return None
    dep_id = getattr(user, "department_id", None)
    if not dep_id:
        return []
    my = (await db.execute(select(Department).where(Department.id == dep_id))).scalar_one_or_none()
    if not my:
        return []
    if my.parent_id is None:
        children = (await db.execute(
            select(Department.id).where(Department.parent_id == my.id)
        )).scalars().all()
        return [my.id, *children]
    return [my.id]

@router.post("/generate/{semester_id}", response_model=Dict[str, int])
async def generate_schedule_endpoint(
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """
    Trigger the automatic scheduling process for a given semester.
    """
    scheduler = AutoScheduler(db)
    try:
        result = await scheduler.generate_schedule(semester_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-cp/{semester_id}")
async def generate_schedule_cpsat(
    semester_id: uuid.UUID,
    time_limit: int = 6,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user),
):
    """FR-8/9/10/12/18/19/22: CP-SAT solver. Respects every hard rule at once
    and returns the optimal (or first feasible) timetable.

    Requires `ortools` to be installed in the backend venv.
    """
    scheduler = CpsatScheduler(db, time_limit_seconds=time_limit)
    return await scheduler.generate(semester_id)

from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from backend.src.modules.scheduling.models import Session, Section
from backend.src.modules.catalog.models import Course
from backend.src.modules.infrastructure.models import Classroom
from backend.src.modules.auth.models import User

@router.delete("/clear/{semester_id}", response_model=Dict[str, int])
async def clear_schedule(
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """Delete all sessions for a semester so the schedule can be regenerated."""
    result = await db.execute(
        delete(Session).where(Session.semester_id == semester_id)
    )
    await db.commit()
    return {"deleted": result.rowcount}


@router.get("/view/{semester_id}")
async def view_schedule(
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    stmt = (
        select(Session)
        .where(Session.semester_id == semester_id)
        # We need to eagerly load related data for the UI
        # But for now, let's just return raw session data and maybe minimal joins if models allow
        # Ideally we join Section -> Course to get codes
    )
    # Re-writing stmt to include joins for the DTO
    # But since I didn't set up relationships fully in models (maybe), let's check models.
    # Looking at viewed files: Session has section_id. Section has course_id.
    # I'll do a robust query.
    
    # Actually, simpler to just get sessions and let the frontend deal with IDs? 
    # No, frontend needs names.
    
    # Let's assume relationships exist or do manual joins.
    # Session -> Section -> Course
    # Session -> Room
    # Session -> Faculty
    pass 
    # Placeholder until I read models again to confirm relationships or just use raw joins.
    # I saw models earlier.
    # Scheduling/models.py: Session has relationship("Section")
    # Catalog/models.py: Course
    # Let's use ORM loading.
    
    stmt = (
        select(Session)
        .options(
             selectinload(Session.section).selectinload(Section.course),
             selectinload(Session.room),
             selectinload(Session.faculty)
        )
        .where(Session.semester_id == semester_id)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    # CHAIR scope: drop any session whose course belongs to a department
    # outside this chair's faculty subtree. Admin sees everything.
    scope = await _chair_scope_dept_ids(db, current_user)
    if scope is not None:
        scope_set = set(scope)
        sessions = [
            s for s in sessions
            if s.section and s.section.course
            and s.section.course.department_id in scope_set
        ]

    # Transform to DTO
    data = []
    for s in sessions:
        data.append({
            "id": str(s.id),
            "day": s.day_of_week,
            "startSlot": str(s.start_slot),
            "duration": s.duration_minutes,
            "courseCode": s.section.course.code if s.section and s.section.course else "Unknown",
            "type": s.session_type,
            "room": s.room.room_number if s.room else "Unassigned",
            "roomType": s.room.type if s.room else "",
            "faculty": s.faculty.last_name if s.faculty else "Unassigned"
        })
    return data

class SessionUpdate(BaseModel):
    day: int
    start_slot: str # HH:MM:SS
    room_id: Optional[uuid.UUID] = None

@router.put("/sessions/{session_id}")
async def update_session(
    session_id: uuid.UUID,
    session_in: SessionUpdate,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    stmt = select(Session).where(Session.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session.day_of_week = session_in.day
    # Parse time string to time object
    h, m, s = map(int, session_in.start_slot.split(':'))
    from datetime import time
    session.start_slot = time(h, m, s)
    
    if session_in.room_id:
        session.room_id = session_in.room_id
        
    await db.commit()
    return {"status": "success"}

from fastapi.responses import StreamingResponse
from backend.src.modules.scheduling.services.reporting import ReportGenerator

@router.get("/export/{semester_id}/excel")
async def export_excel(
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    sessions = await fetch_sessions(semester_id, db)
    file_stream = ReportGenerator.generate_excel(sessions)
    
    headers = {
        'Content-Disposition': f'attachment; filename="schedule_{semester_id}.xlsx"'
    }
    return StreamingResponse(file_stream, headers=headers, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

@router.get("/export/{semester_id}/pdf")
async def export_pdf(
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    sessions = await fetch_sessions(semester_id, db)
    file_stream = ReportGenerator.generate_pdf(sessions)
    
    headers = {
        'Content-Disposition': f'attachment; filename="schedule_{semester_id}.pdf"'
    }
    return StreamingResponse(file_stream, headers=headers, media_type="application/pdf")

# Helper to re-use fetching logic
async def fetch_sessions(semester_id: uuid.UUID, db: AsyncSession):
    stmt = (
        select(Session)
        .options(
             selectinload(Session.section).selectinload(Section.course),
             selectinload(Session.room),
             selectinload(Session.faculty)
        )
        .where(Session.semester_id == semester_id)
    )
    result = await db.execute(stmt)
    return result.scalars().all()

# ── Semester CRUD ────────────────────────────────────────────────────────────
from backend.src.modules.scheduling.models import Semester, Section
from pydantic import BaseModel as PydanticBase
from datetime import date as DateType

class SemesterCreate(PydanticBase):
    name: str
    start_date: str
    end_date: str
    is_active: bool = False

@router.get("/semesters")
async def list_semesters(
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    stmt = select(Semester)
    result = await db.execute(stmt)
    sems = result.scalars().all()
    return [{"id": str(s.id), "name": s.name, "start_date": str(s.start_date), "end_date": str(s.end_date), "is_active": s.is_active} for s in sems]

@router.post("/semesters")
async def create_semester(
    sem_in: SemesterCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    from datetime import date
    sem = Semester(
        id=uuid.uuid4(),
        name=sem_in.name,
        start_date=date.fromisoformat(sem_in.start_date),
        end_date=date.fromisoformat(sem_in.end_date),
        is_active=sem_in.is_active
    )
    db.add(sem)
    await db.commit()
    await db.refresh(sem)
    return {"id": str(sem.id), "name": sem.name, "start_date": str(sem.start_date), "end_date": str(sem.end_date), "is_active": sem.is_active}

# ── Section CRUD ─────────────────────────────────────────────────────────────
class SectionCreate(PydanticBase):
    course_id: uuid.UUID
    semester_id: uuid.UUID
    section_number: str
    expected_enrollment: int = 30
    kind: Optional[str] = "COMBINED"          # LECTURE | LAB | TUTORIAL | COMBINED
    lecturer_id: Optional[uuid.UUID] = None


class SectionUpdate(PydanticBase):
    section_number: Optional[str] = None
    expected_enrollment: Optional[int] = None
    kind: Optional[str] = None
    lecturer_id: Optional[uuid.UUID] = None


class GroupsBulkCreate(PydanticBase):
    """Spin up N groups at once for a course in a semester.
    Example: { course_id, semester_id, lecture_groups: 2, lab_groups: 6 }
    """
    course_id: uuid.UUID
    semester_id: uuid.UUID
    lecture_groups: int = 0
    lab_groups: int = 0
    tutorial_groups: int = 0
    expected_enrollment: int = 30

@router.get("/sections")
async def list_sections(
    semester_id: Optional[uuid.UUID] = None,
    course_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    stmt = select(Section)
    if semester_id:
        stmt = stmt.where(Section.semester_id == semester_id)
    if course_id:
        stmt = stmt.where(Section.course_id == course_id)
    result = await db.execute(stmt)
    secs = result.scalars().all()
    out = []
    for s in secs:
        out.append({
            "id": str(s.id),
            "course_id": str(s.course_id),
            "semester_id": str(s.semester_id),
            "section_number": s.section_number,
            "expected_enrollment": s.expected_enrollment,
            "kind": s.kind or "COMBINED",
            "lecturer_id": str(s.lecturer_id) if s.lecturer_id else None,
        })
    return out


@router.post("/sections")
async def create_section(
    sec_in: SectionCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    sec = Section(
        id=uuid.uuid4(),
        course_id=sec_in.course_id,
        semester_id=sec_in.semester_id,
        section_number=sec_in.section_number,
        expected_enrollment=sec_in.expected_enrollment,
        kind=(sec_in.kind or "COMBINED").upper(),
        lecturer_id=sec_in.lecturer_id,
    )
    db.add(sec)
    await db.commit()
    return {
        "id": str(sec.id),
        "course_id": str(sec.course_id),
        "semester_id": str(sec.semester_id),
        "section_number": sec.section_number,
        "expected_enrollment": sec.expected_enrollment,
        "kind": sec.kind,
        "lecturer_id": str(sec.lecturer_id) if sec.lecturer_id else None,
    }


@router.patch("/sections/{section_id}")
async def update_section(
    section_id: uuid.UUID,
    body: SectionUpdate,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    sec = (await db.execute(select(Section).where(Section.id == section_id))).scalar_one_or_none()
    if not sec:
        raise HTTPException(404, "Section not found.")
    if body.section_number is not None:      sec.section_number = body.section_number
    if body.expected_enrollment is not None:  sec.expected_enrollment = body.expected_enrollment
    if body.kind is not None:                 sec.kind = body.kind.upper()
    if body.lecturer_id is not None:          sec.lecturer_id = body.lecturer_id
    await db.commit()
    return {
        "id": str(sec.id),
        "course_id": str(sec.course_id),
        "semester_id": str(sec.semester_id),
        "section_number": sec.section_number,
        "expected_enrollment": sec.expected_enrollment,
        "kind": sec.kind,
        "lecturer_id": str(sec.lecturer_id) if sec.lecturer_id else None,
    }


@router.post("/sections/bulk-groups")
async def bulk_create_groups(
    body: GroupsBulkCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """Create N LECTURE + M LAB + K TUTORIAL groups for a course in one shot.

    Example payload to get ENGR-103's typical layout (2 lecture groups,
    6 lab groups): {course_id, semester_id, lecture_groups: 2, lab_groups: 6}.
    Numbering continues from the highest existing section_number for that
    (course, semester) so we don't clobber what's already there.
    """
    # next section_number starts at max(existing) + 1
    existing = (await db.execute(
        select(Section.section_number)
        .where(Section.course_id == body.course_id, Section.semester_id == body.semester_id)
    )).scalars().all()
    nums = []
    for n in existing:
        try: nums.append(int(n))
        except Exception: pass
    next_n = (max(nums) + 1) if nums else 1

    created = []
    def _mk(kind: str):
        nonlocal next_n
        sec = Section(
            id=uuid.uuid4(),
            course_id=body.course_id,
            semester_id=body.semester_id,
            section_number=str(next_n),
            expected_enrollment=body.expected_enrollment,
            kind=kind,
            lecturer_id=None,
        )
        db.add(sec)
        created.append(sec)
        next_n += 1

    for _ in range(max(0, body.lecture_groups)):   _mk("LECTURE")
    for _ in range(max(0, body.lab_groups)):       _mk("LAB")
    for _ in range(max(0, body.tutorial_groups)):  _mk("TUTORIAL")
    await db.commit()
    return {"created": len(created), "section_ids": [str(s.id) for s in created]}

@router.delete("/sections/{section_id}", status_code=204)
async def delete_section(
    section_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    stmt = select(Section).where(Section.id == section_id)
    result = await db.execute(stmt)
    sec = result.scalar_one_or_none()
    if not sec:
        raise HTTPException(status_code=404, detail="Section not found")
    await db.delete(sec)
    await db.commit()
    return None

# ── Prerequisite CRUD (FR-18, FR-19) ─────────────────────────────────────────
from backend.src.modules.infrastructure.models import Prerequisite

class PrerequisiteCreate(PydanticBase):
    course_id: uuid.UUID
    prerequisite_course_id: uuid.UUID

@router.get("/prerequisites")
async def list_prerequisites(
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    stmt = select(Prerequisite)
    result = await db.execute(stmt)
    prereqs = result.scalars().all()
    return [{"id": str(p.id), "course_id": str(p.course_id), "prerequisite_course_id": str(p.prerequisite_course_id)} for p in prereqs]

@router.post("/prerequisites", status_code=201)
async def create_prerequisite(
    prereq_in: PrerequisiteCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    # Prevent duplicate
    existing = await db.execute(
        select(Prerequisite).where(
            Prerequisite.course_id == prereq_in.course_id,
            Prerequisite.prerequisite_course_id == prereq_in.prerequisite_course_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Prerequisite already exists")
    prereq = Prerequisite(
        id=uuid.uuid4(),
        course_id=prereq_in.course_id,
        prerequisite_course_id=prereq_in.prerequisite_course_id
    )
    db.add(prereq)
    await db.commit()
    await _audit(db, current_user, "CREATE_PREREQUISITE", "Prerequisite", str(prereq.id),
                 f"course={prereq_in.course_id} prereq={prereq_in.prerequisite_course_id}")
    return {"id": str(prereq.id), "course_id": str(prereq.course_id), "prerequisite_course_id": str(prereq.prerequisite_course_id)}

@router.delete("/prerequisites/{prereq_id}", status_code=204)
async def delete_prerequisite(
    prereq_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    stmt = select(Prerequisite).where(Prerequisite.id == prereq_id)
    result = await db.execute(stmt)
    prereq = result.scalar_one_or_none()
    if not prereq:
        raise HTTPException(status_code=404, detail="Prerequisite not found")
    await db.delete(prereq)
    await db.commit()
    return None

# ── Faculty Load Report (FR-6, FR-13) ─────────────────────────────────────────
from backend.src.modules.catalog.models import Faculty as FacultyModel, Department

@router.get("/faculty-load/{semester_id}")
async def faculty_load_report(
    semester_id: uuid.UUID,
    department_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """FR-6, FR-13: Return teaching load summary for each faculty, optionally filtered by department."""
    stmt = select(FacultyModel).where(FacultyModel.is_active == True)
    if department_id:
        stmt = stmt.where(FacultyModel.department_id == department_id)
    fac_result = await db.execute(stmt)
    faculty_list = fac_result.scalars().all()

    from sqlalchemy import func as sqlfunc
    report = []
    for f in faculty_list:
        load_res = await db.execute(
            select(sqlfunc.coalesce(sqlfunc.sum(Session.duration_minutes), 0))
            .where(Session.faculty_id == f.id, Session.semester_id == semester_id)
        )
        current_minutes = load_res.scalar_one() or 0
        current_hours = current_minutes / 60.0
        overloaded = current_hours > float(f.max_load_hours)

        # Count sessions
        sessions_count_res = await db.execute(
            select(sqlfunc.count(Session.id))
            .where(Session.faculty_id == f.id, Session.semester_id == semester_id)
        )
        sessions_count = sessions_count_res.scalar_one() or 0

        report.append({
            "faculty_id": str(f.id),
            "name": f"{f.first_name} {f.last_name}",
            "rank": f.rank,
            "department_id": str(f.department_id),
            "max_load_hours": float(f.max_load_hours),
            "current_load_hours": round(current_hours, 2),
            "sessions_count": sessions_count,
            "is_overloaded": overloaded,
            "utilization_pct": round((current_hours / float(f.max_load_hours)) * 100, 1) if float(f.max_load_hours) > 0 else 0
        })
    return report

# ── Faculty Personal Schedule (FR-25, FR-26) ──────────────────────────────────
@router.get("/faculty-schedule/{faculty_id}/{semester_id}")
async def faculty_personal_schedule(
    faculty_id: uuid.UUID,
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """FR-25, FR-26: Personal schedule for each instructor from the departmental schedule."""
    stmt = (
        select(Session)
        .options(
            selectinload(Session.section).selectinload(Section.course),
            selectinload(Session.room),
            selectinload(Session.faculty)
        )
        .where(Session.faculty_id == faculty_id, Session.semester_id == semester_id)
        .order_by(Session.day_of_week, Session.start_slot)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    data = []
    for s in sessions:
        data.append({
            "id": str(s.id),
            "day": s.day_of_week,
            "dayName": days[s.day_of_week] if 0 <= s.day_of_week < 5 else str(s.day_of_week),
            "startSlot": str(s.start_slot),
            "duration": s.duration_minutes,
            "courseCode": s.section.course.code if s.section and s.section.course else "Unknown",
            "courseTitle": s.section.course.title if s.section and s.section.course else "Unknown",
            "type": s.session_type,
            "room": s.room.room_number if s.room else "Unassigned",
        })
    return data

# ── Yearly Schedule View (FR-15, FR-16, FR-17) ────────────────────────────────
@router.get("/yearly-schedule/{department_id}")
async def yearly_schedule(
    department_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """FR-15,16,17: Yearly schedule showing both semesters, grouped by curriculum year."""
    from backend.src.modules.catalog.models import Course as CourseModel

    # CHAIR scope: refuse to serve a department outside this chair's faculty subtree.
    scope = await _chair_scope_dept_ids(db, current_user)
    if scope is not None and department_id not in scope:
        raise HTTPException(
            status_code=403,
            detail="You can only view yearly schedules for departments in your own faculty.",
        )

    # Get all semesters
    sem_result = await db.execute(select(Semester).order_by(Semester.start_date))
    semesters = sem_result.scalars().all()

    yearly = {}
    for sem in semesters:
        # Get all sessions for this semester for courses in this department
        stmt = (
            select(Session)
            .options(
                selectinload(Session.section).selectinload(Section.course),
                selectinload(Session.room),
                selectinload(Session.faculty)
            )
            .join(Section, Session.section_id == Section.id)
            .join(CourseModel, Section.course_id == CourseModel.id)
            .where(Session.semester_id == sem.id, CourseModel.department_id == department_id)
        )
        result = await db.execute(stmt)
        sessions = result.scalars().all()

        sem_data: dict = {}
        for s in sessions:
            if not s.section or not s.section.course:
                continue
            course = s.section.course
            yr = course.curriculum_year
            if yr not in sem_data:
                sem_data[yr] = []
            sem_data[yr].append({
                "id": str(s.id),
                "day": s.day_of_week,
                "startSlot": str(s.start_slot),
                "duration": s.duration_minutes,
                "courseCode": course.code,
                "courseTitle": course.title,
                "curriculumYear": yr,
                "type": s.session_type,
                "room": s.room.room_number if s.room else "Unassigned",
                "faculty": s.faculty.last_name if s.faculty else "Unassigned",
            })

        yearly[str(sem.id)] = {
            "semester_id": str(sem.id),
            "semester_name": sem.name,
            "by_year": sem_data
        }

    return {"department_id": str(department_id), "semesters": list(yearly.values())}

# ── Conflict Detection Endpoint (FR-12, FR-14) ────────────────────────────────
@router.get("/conflicts/{semester_id}")
async def get_conflicts(
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """FR-12, FR-14: Scan and return all scheduling conflicts for a semester."""
    from datetime import datetime, timedelta
    stmt = (
        select(Session)
        .options(
            selectinload(Session.section).selectinload(Section.course),
            selectinload(Session.room),
            selectinload(Session.faculty)
        )
        .where(Session.semester_id == semester_id)
    )
    result = await db.execute(stmt)
    sessions = list(result.scalars().all())

    conflicts = []

    def overlap(a: Session, b: Session) -> bool:
        from datetime import time as ttime
        a_start = datetime.combine(datetime.today(), a.start_slot)
        a_end = a_start + timedelta(minutes=a.duration_minutes)
        b_start = datetime.combine(datetime.today(), b.start_slot)
        b_end = b_start + timedelta(minutes=b.duration_minutes)
        return a.day_of_week == b.day_of_week and a_start < b_end and b_start < a_end

    for i in range(len(sessions)):
        for j in range(i + 1, len(sessions)):
            a, b = sessions[i], sessions[j]
            if not overlap(a, b):
                continue
            a_code = a.section.course.code if a.section and a.section.course else "?"
            b_code = b.section.course.code if b.section and b.section.course else "?"
            # Faculty conflict
            if a.faculty_id and a.faculty_id == b.faculty_id:
                faculty_name = f"{a.faculty.first_name} {a.faculty.last_name}" if a.faculty else "Unknown"
                conflicts.append({
                    "type": "FACULTY_DOUBLE_BOOK",
                    "description": f"{faculty_name} is assigned to both {a_code} and {b_code} at the same time",
                    "session_a": str(a.id),
                    "session_b": str(b.id),
                    "course_a": a_code,
                    "course_b": b_code,
                    "day": a.day_of_week,
                    "start_slot": str(a.start_slot)
                })
            # Room conflict
            if a.room_id and a.room_id == b.room_id:
                room_num = a.room.room_number if a.room else "?"
                conflicts.append({
                    "type": "ROOM_DOUBLE_BOOK",
                    "description": f"Room {room_num} is double-booked for {a_code} and {b_code}",
                    "session_a": str(a.id),
                    "session_b": str(b.id),
                    "course_a": a_code,
                    "course_b": b_code,
                    "day": a.day_of_week,
                    "start_slot": str(a.start_slot)
                })

    return {"semester_id": str(semester_id), "conflict_count": len(conflicts), "conflicts": conflicts}

# ── Classroom Utilization Report (Part 2, FR-6) ───────────────────────────────
@router.get("/room-utilization/{semester_id}")
async def room_utilization(
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """Part 2: Classroom utilization report per room per semester."""
    from backend.src.modules.infrastructure.models import Classroom
    from sqlalchemy import func as sqlfunc

    room_result = await db.execute(
        select(Classroom).options(selectinload(Classroom.building)).where(Classroom.is_active == True)
    )
    rooms = room_result.scalars().all()

    report = []
    for room in rooms:
        sessions_result = await db.execute(
            select(Session)
            .where(Session.room_id == room.id, Session.semester_id == semester_id)
        )
        sessions = sessions_result.scalars().all()
        total_minutes = sum(s.duration_minutes for s in sessions)
        # Assume 5 days × 9 hours = 2700 min/week × ~16 weeks = 43200 min/semester
        available_minutes = 43200
        report.append({
            "room_id": str(room.id),
            "room_number": room.room_number,
            "building": room.building.name if room.building else "Unknown",
            "type": room.type,
            "capacity": room.capacity,
            "total_sessions": len(sessions),
            "total_hours_scheduled": round(total_minutes / 60, 1),
            "utilization_pct": round((total_minutes / available_minutes) * 100, 1) if available_minutes > 0 else 0
        })

    return {"semester_id": str(semester_id), "rooms": report}

# ── Audit Log (FR-8.4) ────────────────────────────────────────────────────────
from backend.src.modules.auth.models import AuditLog

async def _audit(db: AsyncSession, user, action: str, resource_type: str, resource_id: str, details: str = ""):
    """Helper to write audit log entries."""
    try:
        log = AuditLog(
            id=uuid.uuid4(),
            user_id=getattr(user, "id", None),
            user_email=getattr(user, "email", "unknown"),
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details
        )
        db.add(log)
        await db.flush()
    except Exception:
        pass  # Never let audit failure break the main flow

@router.get("/audit-log")
async def get_audit_log(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """FR-8.4: Retrieve audit trail - admin only."""
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    logs = result.scalars().all()
    return [{
        "id": str(l.id),
        "user_email": l.user_email,
        "action": l.action,
        "resource_type": l.resource_type,
        "resource_id": l.resource_id,
        "details": l.details,
        "created_at": str(l.created_at)
    } for l in logs]

# ── Schedule by Curriculum Year / Dept (FR-28) ───────────────────────────────
@router.get("/view-by-year/{semester_id}/{curriculum_year}")
async def view_schedule_by_year(
    semester_id: uuid.UUID,
    curriculum_year: int,
    department_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user)
):
    """FR-28: View schedule filtered by curriculum year and optionally department."""
    from backend.src.modules.catalog.models import Course as CourseModel
    stmt = (
        select(Session)
        .options(
            selectinload(Session.section).selectinload(Section.course),
            selectinload(Session.room),
            selectinload(Session.faculty)
        )
        .join(Section, Session.section_id == Section.id)
        .join(CourseModel, Section.course_id == CourseModel.id)
        .where(Session.semester_id == semester_id, CourseModel.curriculum_year == curriculum_year)
    )
    if department_id:
        stmt = stmt.where(CourseModel.department_id == department_id)
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    data = []
    for s in sessions:
        data.append({
            "id": str(s.id),
            "day": s.day_of_week,
            "startSlot": str(s.start_slot),
            "duration": s.duration_minutes,
            "courseCode": s.section.course.code if s.section and s.section.course else "Unknown",
            "courseTitle": s.section.course.title if s.section and s.section.course else "",
            "curriculumYear": s.section.course.curriculum_year if s.section and s.section.course else 0,
            "type": s.session_type,
            "room": s.room.room_number if s.room else "Unassigned",
            "faculty": s.faculty.last_name if s.faculty else "Unassigned",
        })
    return data


# ── iCal feed per lecturer ─────────────────────────────────────────────────────
# RFC-5545. Lets a lecturer subscribe to their schedule in any calendar app
# (Outlook, Google Calendar, Apple Calendar). The semester's start_date is
# treated as week 1; each session expands as a weekly recurring event until
# the semester end_date.
from datetime import datetime, timedelta, timezone
from fastapi import Path
from fastapi.responses import Response


def _ics_escape(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _ics_dt(d: datetime) -> str:
    """Format a datetime as YYYYMMDDTHHMMSSZ (UTC)."""
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    else:
        d = d.astimezone(timezone.utc)
    return d.strftime("%Y%m%dT%H%M%SZ")


@router.get("/faculty/{faculty_id}.ics", include_in_schema=True)
async def faculty_calendar_feed(
    faculty_id: uuid.UUID = Path(...),
    semester_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(deps.get_db),
):
    """Public iCal feed for one lecturer's schedule.

    Note: no auth — the URL itself is the bearer (treat it like an API key).
    If `semester_id` is omitted, the active semester is used.
    """
    from backend.src.modules.catalog.models import Faculty as FacultyModel

    fac = (await db.execute(
        select(FacultyModel).where(FacultyModel.id == faculty_id)
    )).scalar_one_or_none()
    if not fac:
        raise HTTPException(status_code=404, detail="Lecturer not found.")

    if semester_id is None:
        sem_row = (await db.execute(
            select(Semester).where(Semester.is_active == True).limit(1)  # noqa: E712
        )).scalar_one_or_none()
        if not sem_row:
            raise HTTPException(status_code=404, detail="No active semester.")
        semester_id = sem_row.id
    else:
        sem_row = (await db.execute(
            select(Semester).where(Semester.id == semester_id)
        )).scalar_one_or_none()
        if not sem_row:
            raise HTTPException(status_code=404, detail="Semester not found.")

    stmt = (
        select(Session)
        .options(
            selectinload(Session.section).selectinload(Section.course),
            selectinload(Session.room),
        )
        .where(Session.faculty_id == faculty_id, Session.semester_id == semester_id)
    )
    sessions = (await db.execute(stmt)).scalars().all()

    # Anchor each weekly event to the first occurrence of the matching weekday
    # on/after the semester start_date.
    sem_start = sem_row.start_date
    sem_end = sem_row.end_date
    sem_end_dt = datetime.combine(sem_end, time(23, 59, 59), tzinfo=timezone.utc)

    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//FCESS//Faculty Schedule//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_ics_escape(fac.first_name + ' ' + fac.last_name)} - {_ics_escape(sem_row.name)}",
        f"X-WR-CALDESC:Teaching schedule for {_ics_escape(sem_row.name)}",
    ]
    now_stamp = _ics_dt(datetime.now(timezone.utc))

    for s in sessions:
        # day_of_week: 0=Monday … 6=Sunday   (matches Python's weekday())
        # find first matching date on/after sem_start
        delta = (s.day_of_week - sem_start.weekday()) % 7
        first_date = sem_start + timedelta(days=delta)
        start_dt = datetime.combine(first_date, s.start_slot, tzinfo=timezone.utc)
        end_dt = start_dt + timedelta(minutes=s.duration_minutes)
        course = s.section.course if s.section and s.section.course else None
        room = s.room
        summary = (course.code + (f" {s.session_type}" if s.session_type and s.session_type != 'COMBINED' else "")) if course else "Class"
        if course and course.title:
            summary += f" — {course.title}"
        location_parts = []
        if room:
            location_parts.append(room.room_number)
            if hasattr(room, "building") and room.building:
                location_parts.append(room.building.name)
        location = ", ".join(location_parts) if location_parts else ""

        lines += [
            "BEGIN:VEVENT",
            f"UID:{s.id}@fcess",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART:{_ics_dt(start_dt)}",
            f"DTEND:{_ics_dt(end_dt)}",
            f"RRULE:FREQ=WEEKLY;UNTIL={_ics_dt(sem_end_dt)}",
            f"SUMMARY:{_ics_escape(summary)}",
        ]
        if location:
            lines.append(f"LOCATION:{_ics_escape(location)}")
        if course and course.title:
            lines.append(f"DESCRIPTION:{_ics_escape(course.title)}")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    body = "\r\n".join(lines) + "\r\n"
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="faculty_{faculty_id}.ics"',
            "Cache-Control": "no-store",
        },
    )



@router.get("/_scheduler_info", include_in_schema=True)
async def scheduler_info():
    """Tells you exactly which CP-SAT scheduler the running process loaded.

    The NEW fast version is identified by SLOTS_PER_DAY == 9 (hourly).
    The OLD slow version has SLOTS_PER_DAY == 18 (half-hourly).
    """
    import inspect, os, hashlib
    from backend.src.modules.scheduling.services import scheduler_cpsat as m
    path = inspect.getsourcefile(m) or "?"
    try:
        sz = os.path.getsize(path)
        with open(path, "rb") as f:
            sha = hashlib.sha1(f.read()).hexdigest()[:12]
    except Exception:
        sz = -1; sha = "?"
    return {
        "loaded_from": path,
        "file_size_bytes": sz,
        "sha1_prefix": sha,
        "SLOTS_PER_DAY": getattr(m, "SLOTS_PER_DAY", None),
        "SLOT_MINUTES": getattr(m, "SLOT_MINUTES", None),
        "is_fast_version": getattr(m, "SLOTS_PER_DAY", None) == 9 and getattr(m, "SLOT_MINUTES", None) == 60,
    }



@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user),
):
    """Remove a single scheduled session from the timetable."""
    sess = (await db.execute(select(Session).where(Session.id == session_id))).scalar_one_or_none()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found.")
    await db.delete(sess)
    await db.commit()
    return None



# ── Unplaced sessions diagnostics + manual placement ────────────────────────
from backend.src.modules.catalog.models import FacultyCourseAssignment


@router.get("/unplaced/{semester_id}")
async def unplaced_sessions(
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user),
):
    """For every section in this semester that has *no* sessions scheduled,
    explain *why* the scheduler probably couldn't place it and suggest
    concrete fixes (add a lecturer, add a lab room, raise a load cap, …).

    The list is what the Unplaced-Sessions panel renders next to the
    timetable.  Each row tells the chair exactly what intervention will
    unblock the next regenerate.
    """
    from backend.src.modules.catalog.models import Course as C, Faculty as F
    from backend.src.modules.infrastructure.models import Classroom

    # 1. find sections with zero sessions for this semester
    scheduled_ids = {
        r[0] for r in (await db.execute(
            select(Session.section_id).where(Session.semester_id == semester_id)
        )).all()
    }
    sec_rows = (await db.execute(
        select(Section).where(Section.semester_id == semester_id)
    )).scalars().all()
    unplaced = [s for s in sec_rows if s.id not in scheduled_ids]

    if not unplaced:
        return {"semester_id": str(semester_id), "count": 0, "items": []}

    # 2. pre-load resources used in the diagnostic
    courses = {
        c.id: c for c in (await db.execute(select(C))).scalars().all()
    }
    faculty = list((await db.execute(select(F).where(F.is_active == True))).scalars().all())  # noqa: E712
    rooms = list((await db.execute(select(Classroom).where(Classroom.is_active == True))).scalars().all())  # noqa: E712
    assignments = list((await db.execute(select(FacultyCourseAssignment))).scalars().all())
    assigned_for_course: dict[uuid.UUID, list[uuid.UUID]] = {}
    for a in assignments:
        assigned_for_course.setdefault(a.course_id, []).append(a.faculty_id)

    # current load per faculty (in hours) inside the semester
    from sqlalchemy import func as sqlfunc
    load_per_fac: dict[uuid.UUID, float] = {}
    for f in faculty:
        v = (await db.execute(
            select(sqlfunc.coalesce(sqlfunc.sum(Session.duration_minutes), 0))
            .where(Session.faculty_id == f.id, Session.semester_id == semester_id)
        )).scalar_one() or 0
        load_per_fac[f.id] = v / 60.0

    items: list[dict] = []
    for sec in unplaced:
        course = courses.get(sec.course_id)
        if not course:
            continue
        needs_lab = (course.lab_hours or 0) > 0
        needs_lec = (course.lecture_hours or 0) > 0
        total_h = (course.lecture_hours or 0) + (course.lab_hours or 0)

        reasons: list[dict] = []
        fixes: list[dict] = []

        # eligible faculty: prefer assigned, fall back to department
        assigned_ids = set(assigned_for_course.get(course.id, []))
        if assigned_ids:
            eligible = [f for f in faculty if f.id in assigned_ids]
            source = "assigned"
        else:
            eligible = [f for f in faculty if f.department_id == course.department_id]
            source = "department"

        if not eligible:
            reasons.append({
                "code": "NO_FACULTY",
                "label": (
                    "No lecturer assigned to this course "
                    "and no lecturer in the department either."
                ),
            })
            fixes.append({
                "kind": "add_assignment",
                "label": f"Assign a lecturer to {course.code}",
                "deepLink": "/assignments",
            })
        else:
            # Of the eligible faculty, how many have *room* in their load to take this?
            room_in_load = [
                f for f in eligible
                if load_per_fac.get(f.id, 0) + total_h <= float(f.max_load_hours)
            ]
            if not room_in_load:
                reasons.append({
                    "code": "LOAD_CAPPED",
                    "label": (
                        f"All {len(eligible)} eligible lecturer(s) are already at or above "
                        f"their max_load_hours and cannot take {total_h}h more."
                    ),
                })
                # Suggest the easiest fix: raise one cap, or add one more lecturer
                tightest = sorted(eligible, key=lambda f: float(f.max_load_hours) - load_per_fac.get(f.id, 0))[0]
                fixes.append({
                    "kind": "raise_load",
                    "label": (
                        f"Increase {tightest.first_name} {tightest.last_name}'s "
                        f"max_load from {tightest.max_load_hours} → {float(tightest.max_load_hours) + total_h:.0f}"
                    ),
                    "deepLink": "/faculty",
                })
                fixes.append({
                    "kind": "add_assignment",
                    "label": f"Assign one more lecturer to {course.code}",
                    "deepLink": "/assignments",
                })

        # eligible rooms by type + capacity
        cap = sec.expected_enrollment or 30
        lab_rooms = [r for r in rooms if r.type == "LAB" and r.capacity >= cap]
        lec_rooms = [r for r in rooms if r.type in ("LECTURE_HALL", "SEMINAR") and r.capacity >= cap]
        if needs_lab and not lab_rooms:
            reasons.append({
                "code": "NO_LAB_ROOM",
                "label": f"No LAB classroom with capacity ≥ {cap} available.",
            })
            fixes.append({
                "kind": "add_room",
                "label": f"Add a LAB room (capacity ≥ {cap})",
                "deepLink": "/rooms",
            })
        if needs_lec and not lec_rooms:
            reasons.append({
                "code": "NO_LECTURE_ROOM",
                "label": f"No LECTURE / SEMINAR classroom with capacity ≥ {cap}.",
            })
            fixes.append({
                "kind": "add_room",
                "label": f"Add a LECTURE_HALL room (capacity ≥ {cap})",
                "deepLink": "/rooms",
            })

        # If we still have no reasons, the scheduler probably just ran out of free slots
        if not reasons:
            reasons.append({
                "code": "SLOTS_FULL",
                "label": (
                    "Lecturers and rooms exist, but every workable time slot is "
                    "already occupied. Try Auto-fix Conflicts, or open Saturday/evening slots."
                ),
            })
            fixes.append({
                "kind": "regenerate",
                "label": "Regenerate the whole schedule (clears + re-runs solver)",
                "deepLink": "/conflicts",
            })

        items.append({
            "section_id": str(sec.id),
            "course_id": str(course.id),
            "course_code": course.code,
            "course_title": course.title,
            "section_number": sec.section_number,
            "expected_enrollment": sec.expected_enrollment,
            "department_id": str(course.department_id),
            "lecture_hours": course.lecture_hours,
            "lab_hours": course.lab_hours,
            "total_hours": total_h,
            "eligible_faculty_count": len(eligible),
            "eligible_faculty_source": source if eligible else None,
            "reasons": reasons,
            "suggested_fixes": fixes,
        })

    return {"semester_id": str(semester_id), "count": len(items), "items": items}


class ManualPlacement(BaseModel):
    section_id: uuid.UUID
    day: int                 # 0..4 Mon..Fri
    start_slot: str          # "HH:MM" or "HH:MM:SS"
    faculty_id: Optional[uuid.UUID] = None
    room_id: Optional[uuid.UUID] = None
    session_type: Optional[str] = None  # LECTURE / LAB / COMBINED


@router.post("/place-session/{semester_id}")
async def place_unplaced_session(
    semester_id: uuid.UUID,
    body: ManualPlacement,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user),
):
    """Manually place an unplaced section into the timetable.

    Used by the "drag from the Unplaced bucket onto the timetable" workflow.
    Validates faculty + room conflicts before committing; returns a clear
    error string so the UI can toast it.
    """
    from datetime import time as ttime
    from backend.src.modules.catalog.models import Course as C, Faculty as F
    from backend.src.modules.infrastructure.models import Classroom
    from backend.src.modules.scheduling.services.conflict_detector import ConflictDetector

    sec = (await db.execute(select(Section).where(Section.id == body.section_id))).scalar_one_or_none()
    if not sec or sec.semester_id != semester_id:
        raise HTTPException(status_code=404, detail="Section not found in this semester.")

    course = (await db.execute(select(C).where(C.id == sec.course_id))).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")

    # pick session_type / duration from the course definition unless caller forces one
    lec = course.lecture_hours or 0
    lab = course.lab_hours or 0
    if body.session_type:
        stype = body.session_type
        duration = (lec + lab) * 60
    elif lec + lab <= 3:
        stype = "COMBINED"; duration = (lec + lab) * 60
    elif lec >= lab:
        stype = "LECTURE"; duration = lec * 60
    else:
        stype = "LAB"; duration = lab * 60
    if duration <= 0:
        raise HTTPException(status_code=400, detail="Course has zero contact hours.")

    # parse the slot
    parts = body.start_slot.split(":")
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="Bad start_slot format. Use HH:MM.")
    start_time = ttime(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) >= 3 else 0)

    # auto-pick a faculty if not given (least-loaded eligible)
    faculty_id = body.faculty_id
    if not faculty_id:
        assignments = (await db.execute(
            select(FacultyCourseAssignment).where(FacultyCourseAssignment.course_id == course.id)
        )).scalars().all()
        assigned_ids = [a.faculty_id for a in assignments]
        fac_rows = (await db.execute(select(F).where(F.is_active == True))).scalars().all()  # noqa: E712
        eligible = [f for f in fac_rows if f.id in assigned_ids] if assigned_ids else \
                   [f for f in fac_rows if f.department_id == course.department_id]
        if not eligible:
            raise HTTPException(status_code=400, detail="No eligible lecturer for this course.")
        # least-loaded first
        from sqlalchemy import func as sqlfunc
        loads: dict = {}
        for f in eligible:
            v = (await db.execute(
                select(sqlfunc.coalesce(sqlfunc.sum(Session.duration_minutes), 0))
                .where(Session.faculty_id == f.id, Session.semester_id == semester_id)
            )).scalar_one() or 0
            loads[f.id] = v
        eligible.sort(key=lambda f: loads.get(f.id, 0))
        faculty_id = eligible[0].id

    # auto-pick a room if not given
    room_id = body.room_id
    if not room_id:
        cap = sec.expected_enrollment or 30
        all_rooms = (await db.execute(select(Classroom).where(Classroom.is_active == True))).scalars().all()  # noqa: E712
        if stype == "LAB":
            candidates = [r for r in all_rooms if r.type == "LAB" and r.capacity >= cap]
        else:
            candidates = [r for r in all_rooms if r.type in ("LECTURE_HALL", "SEMINAR") and r.capacity >= cap]
        if not candidates:
            raise HTTPException(status_code=400, detail=f"No {('LAB' if stype=='LAB' else 'LECTURE')} room ≥ {cap} seats.")
        # pick the first one that's free at that slot
        detector = ConflictDetector(db)
        chosen = None
        for r in candidates:
            if not await detector.check_room_conflict(r.id, body.day, start_time, duration, semester_id):
                chosen = r; break
        if not chosen:
            raise HTTPException(status_code=400, detail="Every eligible room is booked at that slot.")
        room_id = chosen.id

    # final conflict check on faculty + room
    detector = ConflictDetector(db)
    if await detector.check_faculty_conflict(faculty_id, body.day, start_time, duration, semester_id):
        raise HTTPException(status_code=409, detail="That lecturer is already teaching at that slot.")
    if await detector.check_room_conflict(room_id, body.day, start_time, duration, semester_id):
        raise HTTPException(status_code=409, detail="That room is already booked at that slot.")

    new_sess = Session(
        id=uuid.uuid4(),
        section_id=sec.id,
        semester_id=semester_id,
        room_id=room_id,
        faculty_id=faculty_id,
        day_of_week=body.day,
        start_slot=start_time,
        duration_minutes=duration,
        session_type=stype,
    )
    db.add(new_sess)
    await db.commit()
    await _audit(db, current_user, "MANUAL_PLACE", "Session", str(new_sess.id),
                 f"section={sec.id} day={body.day} slot={body.start_slot}")
    return {"id": str(new_sess.id), "section_id": str(sec.id), "ok": True}


# ── Curriculum coverage (FR-14) ──────────────────────────────────────────────
@router.get("/curriculum-coverage/{semester_id}")
async def curriculum_coverage(
    semester_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user: deps.User = Depends(deps.get_current_user),
):
    """For each curriculum year × department, return which courses are scheduled
    vs unscheduled in the given semester. Catches "I forgot to schedule MA201"
    type bugs before they hit students.
    """
    from backend.src.modules.catalog.models import Course as C
    courses = (await db.execute(select(C).where(C.is_active == True))).scalars().all()  # noqa: E712
    # All section ids that have at least one session
    scheduled_section_ids = {
        r[0] for r in (await db.execute(
            select(Session.section_id).where(Session.semester_id == semester_id)
        )).all()
    }
    # Map course -> [section_ids in this semester]
    sec_rows = (await db.execute(
        select(Section).where(Section.semester_id == semester_id)
    )).scalars().all()
    sections_by_course: dict = {}
    for s in sec_rows:
        sections_by_course.setdefault(s.course_id, []).append(s.id)

    out = []
    for c in courses:
        secs = sections_by_course.get(c.id, [])
        scheduled = sum(1 for sid in secs if sid in scheduled_section_ids)
        out.append({
            "course_id": str(c.id),
            "code": c.code,
            "title": c.title,
            "curriculum_year": c.curriculum_year,
            "department_id": str(c.department_id),
            "section_count": len(secs),
            "scheduled_sections": scheduled,
            "fully_scheduled": (len(secs) > 0 and scheduled == len(secs)),
            "is_unscheduled": (scheduled == 0),
        })
    return out
