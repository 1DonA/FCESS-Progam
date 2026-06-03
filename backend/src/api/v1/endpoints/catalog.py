"""Catalog endpoints: departments, faculty, courses, rooms, prerequisites,
lecturer-course assignments, sample CSV templates, search and bulk wipe.

All delete operations cascade to dependent rows (sessions, sections, assignments,
prerequisites, etc.) so the caller never gets a foreign-key error. Errors are
returned as plain {detail: "..."} payloads so the frontend can surface them
through its toast system.
"""
from __future__ import annotations

import io
import csv
import uuid
from typing import Any, List, Optional, Dict

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, delete, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.src.api import deps
from backend.src.modules.catalog.models import (
    Department,
    Course,
    Faculty,
    FacultyCourseAssignment,
)
from backend.src.modules.infrastructure.models import Building, Classroom, Prerequisite
from backend.src.modules.scheduling.models import Section, Session, Semester

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class DepartmentCreate(BaseModel):
    code: str
    name: str
    parent_id: Optional[uuid.UUID] = None    # NULL = this row IS a faculty


class DepartmentRead(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    parent_id: Optional[uuid.UUID] = None

    class Config:
        from_attributes = True


class CourseCreate(BaseModel):
    code: str
    title: str
    department_id: uuid.UUID
    credit_hours: float
    lecture_hours: int
    lab_hours: int = 0
    tutorial_hours: int = 0
    curriculum_year: int = 1
    semester_in_year: int = 1             # 1 = Fall, 2 = Spring
    course_type: Optional[str] = None     # UC/FC/AC/AE/FE/UE (or legacy CORE/ELECTIVE/GENERAL)
    workload: Optional[float] = None      # legacy — kept for backwards compat, ignored in UI


class CourseRead(BaseModel):
    id: uuid.UUID
    code: str
    title: str
    department_id: uuid.UUID
    credit_hours: float
    lecture_hours: int
    lab_hours: int
    tutorial_hours: int = 0
    curriculum_year: int
    semester_in_year: int = 1
    course_type: Optional[str] = None
    workload: Optional[float] = None

    class Config:
        from_attributes = True


class FacultyCreate(BaseModel):
    first_name: str
    last_name: str
    email: str
    department_id: uuid.UUID
    rank: str
    max_load_hours: float


class DepartmentUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    parent_id: Optional[uuid.UUID] = None    # supply to move to a different faculty


class CourseUpdate(BaseModel):
    code: Optional[str] = None
    title: Optional[str] = None
    department_id: Optional[uuid.UUID] = None
    credit_hours: Optional[float] = None
    lecture_hours: Optional[int] = None
    lab_hours: Optional[int] = None
    tutorial_hours: Optional[int] = None
    curriculum_year: Optional[int] = None
    semester_in_year: Optional[int] = None    # 1 = Fall, 2 = Spring
    course_type: Optional[str] = None
    workload: Optional[float] = None


class FacultyUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    department_id: Optional[uuid.UUID] = None
    rank: Optional[str] = None
    max_load_hours: Optional[float] = None


class AssignmentUpdate(BaseModel):
    room_id: Optional[uuid.UUID] = None
    notes: Optional[str] = None


class RoomUpdate(BaseModel):
    room_number: Optional[str] = None
    building_id: Optional[uuid.UUID] = None
    capacity: Optional[int] = None
    type: Optional[str] = None


class FacultyRead(BaseModel):
    id: uuid.UUID
    first_name: str
    last_name: str
    email: str
    rank: str
    department_id: uuid.UUID
    max_load_hours: float

    class Config:
        from_attributes = True


class AssignmentCreate(BaseModel):
    faculty_id: uuid.UUID
    course_id: uuid.UUID
    room_id: Optional[uuid.UUID] = None
    notes: Optional[str] = None


class AssignmentRead(BaseModel):
    id: uuid.UUID
    faculty_id: uuid.UUID
    course_id: uuid.UUID
    department_id: uuid.UUID
    room_id: Optional[uuid.UUID] = None
    notes: Optional[str] = None
    faculty_name: Optional[str] = None
    course_code: Optional[str] = None
    department_code: Optional[str] = None
    room_label: Optional[str] = None   # "Bldg A · 101 (LAB)"
    room_type: Optional[str] = None


# ---------------------------------------------------------------------------
# Department scoping helpers — chairs see only their own faculty subtree
# ---------------------------------------------------------------------------
async def _chair_dept_subtree(db: AsyncSession, user) -> Optional[list[uuid.UUID]]:
    """Return the list of department IDs a CHAIR is allowed to see (their own
    department + every sub-department under it, if they're a top-level Faculty
    chair). Returns None for ADMIN (= no scoping, see everything). Returns an
    empty list for a chair that isn't linked to a department yet."""
    role = (getattr(user, "role", "") or "").upper()
    if role != "CHAIR":
        return None
    dept_id = getattr(user, "department_id", None)
    if not dept_id:
        return []
    my = (await db.execute(select(Department).where(Department.id == dept_id))).scalar_one_or_none()
    if not my:
        return []
    # If the chair is at a top-level Faculty, include every direct sub-department too.
    if my.parent_id is None:
        children = (await db.execute(
            select(Department.id).where(Department.parent_id == my.id)
        )).scalars().all()
        return [my.id, *children]
    # Otherwise (chair of a sub-department), they see only themselves.
    return [my.id]


# ---------------------------------------------------------------------------
# Departments
# ---------------------------------------------------------------------------
@router.get("/departments", response_model=List[DepartmentRead])
async def read_departments(
    q: Optional[str] = Query(None, description="Search code or name"),
    skip: int = 0,
    limit: int = 500,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    stmt = select(Department)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Department.code).like(like),
                              func.lower(Department.name).like(like)))
    # CHAIR: only show their own faculty + its sub-departments. Admin sees all.
    subtree = await _chair_dept_subtree(db, current_user)
    if subtree is not None:
        if not subtree:
            return []
        stmt = stmt.where(Department.id.in_(subtree))
    stmt = stmt.order_by(Department.code).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/departments", response_model=DepartmentRead)
async def create_department(
    dept_in: DepartmentCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    code = dept_in.code.strip().upper()
    name = dept_in.name.strip()
    if not code or not name:
        raise HTTPException(status_code=400, detail="Department code and name are required.")
    existing = await db.execute(select(Department).where(Department.code == code))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Department '{code}' already exists.")
    dept = Department(id=uuid.uuid4(), code=code, name=name, parent_id=dept_in.parent_id)
    db.add(dept)
    await db.commit()
    await db.refresh(dept)
    return dept


@router.delete("/departments/{dept_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_department(
    dept_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Cascade-delete a department and everything that depends on it."""
    dept = (await db.execute(select(Department).where(Department.id == dept_id))).scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found.")

    course_ids = [
        c.id for c in (await db.execute(select(Course).where(Course.department_id == dept_id))).scalars()
    ]
    faculty_ids = [
        f.id for f in (await db.execute(select(Faculty).where(Faculty.department_id == dept_id))).scalars()
    ]
    if course_ids:
        section_ids = [
            s.id for s in (await db.execute(select(Section).where(Section.course_id.in_(course_ids)))).scalars()
        ]
        if section_ids:
            await db.execute(delete(Session).where(Session.section_id.in_(section_ids)))
            await db.execute(delete(Section).where(Section.id.in_(section_ids)))
        await db.execute(delete(Prerequisite).where(
            or_(Prerequisite.course_id.in_(course_ids),
                Prerequisite.prerequisite_course_id.in_(course_ids))
        ))
        await db.execute(delete(FacultyCourseAssignment).where(
            FacultyCourseAssignment.course_id.in_(course_ids)
        ))
        await db.execute(delete(Course).where(Course.id.in_(course_ids)))

    if faculty_ids:
        await db.execute(delete(Session).where(Session.faculty_id.in_(faculty_ids)))
        await db.execute(delete(FacultyCourseAssignment).where(
            FacultyCourseAssignment.faculty_id.in_(faculty_ids)
        ))
        await db.execute(delete(Faculty).where(Faculty.id.in_(faculty_ids)))

    await db.execute(delete(FacultyCourseAssignment).where(
        FacultyCourseAssignment.department_id == dept_id
    ))
    await db.delete(dept)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Courses
# ---------------------------------------------------------------------------
@router.get("/courses", response_model=List[CourseRead])
async def read_courses(
    q: Optional[str] = Query(None, description="Search code or title"),
    department_id: Optional[uuid.UUID] = None,
    skip: int = 0,
    limit: int = 1000,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    stmt = select(Course)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Course.code).like(like),
                              func.lower(Course.title).like(like)))
    # CHAIR: scope to their faculty subtree (faculty + sub-departments). Admin sees all.
    subtree = await _chair_dept_subtree(db, current_user)
    if subtree is not None:
        if not subtree:
            return []
        stmt = stmt.where(Course.department_id.in_(subtree))
    elif department_id:
        stmt = stmt.where(Course.department_id == department_id)
    stmt = stmt.order_by(Course.code).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/courses", response_model=CourseRead)
async def create_course(
    course_in: CourseCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    code = course_in.code.strip().upper()
    if not code or not course_in.title.strip():
        raise HTTPException(status_code=400, detail="Course code and title are required.")
    existing = await db.execute(select(Course).where(Course.code == code))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Course '{code}' already exists.")
    dept = await db.get(Department, course_in.department_id)
    if not dept:
        raise HTTPException(status_code=400, detail="Selected department does not exist.")
    sem = course_in.semester_in_year if course_in.semester_in_year in (1, 2) else 1
    course = Course(
        id=uuid.uuid4(),
        code=code,
        title=course_in.title.strip(),
        department_id=course_in.department_id,
        credit_hours=course_in.credit_hours,
        lecture_hours=course_in.lecture_hours,
        lab_hours=course_in.lab_hours,
        tutorial_hours=course_in.tutorial_hours,
        curriculum_year=course_in.curriculum_year,
        semester_in_year=sem,
        course_type=(course_in.course_type or "").strip().upper() or None,
        workload=course_in.workload,
    )
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return course


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Cascade-delete a course (prereqs, sections, sessions, assignments)."""
    course = (await db.execute(select(Course).where(Course.id == course_id))).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")

    section_ids = [
        s.id for s in (await db.execute(select(Section).where(Section.course_id == course_id))).scalars()
    ]
    if section_ids:
        await db.execute(delete(Session).where(Session.section_id.in_(section_ids)))
        await db.execute(delete(Section).where(Section.id.in_(section_ids)))
    await db.execute(delete(Prerequisite).where(
        or_(Prerequisite.course_id == course_id,
            Prerequisite.prerequisite_course_id == course_id)
    ))
    await db.execute(delete(FacultyCourseAssignment).where(
        FacultyCourseAssignment.course_id == course_id
    ))
    await db.delete(course)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Faculty (lecturers)
# ---------------------------------------------------------------------------
@router.get("/faculty", response_model=List[FacultyRead])
async def read_faculty(
    q: Optional[str] = Query(None, description="Search name or email"),
    department_id: Optional[uuid.UUID] = None,
    skip: int = 0,
    limit: int = 1000,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    stmt = select(Faculty)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            func.lower(Faculty.first_name).like(like),
            func.lower(Faculty.last_name).like(like),
            func.lower(Faculty.email).like(like),
        ))
    # CHAIR: scope to their faculty subtree. Admin sees all.
    subtree = await _chair_dept_subtree(db, current_user)
    if subtree is not None:
        if not subtree:
            return []
        stmt = stmt.where(Faculty.department_id.in_(subtree))
    elif department_id:
        stmt = stmt.where(Faculty.department_id == department_id)
    stmt = stmt.order_by(Faculty.last_name).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/faculty", response_model=FacultyRead)
async def create_faculty(
    fac_in: FacultyCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    if fac_in.rank.upper() not in {"PROFESSOR", "LECTURER", "ASSISTANT"}:
        raise HTTPException(status_code=400, detail="Rank must be PROFESSOR, LECTURER or ASSISTANT.")
    dept = await db.get(Department, fac_in.department_id)
    if not dept:
        raise HTTPException(status_code=400, detail="Department does not exist.")
    email = fac_in.email.strip().lower()
    existing = await db.execute(select(Faculty).where(Faculty.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"A lecturer with email '{email}' already exists.")
    faculty = Faculty(
        id=uuid.uuid4(),
        first_name=fac_in.first_name.strip(),
        last_name=fac_in.last_name.strip(),
        email=email,
        department_id=fac_in.department_id,
        rank=fac_in.rank.upper(),
        max_load_hours=fac_in.max_load_hours,
    )
    db.add(faculty)
    await db.commit()
    await db.refresh(faculty)
    return faculty


@router.delete("/faculty/{faculty_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_faculty(
    faculty_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    fac = (await db.execute(select(Faculty).where(Faculty.id == faculty_id))).scalar_one_or_none()
    if not fac:
        raise HTTPException(status_code=404, detail="Lecturer not found.")
    await db.execute(delete(Session).where(Session.faculty_id == faculty_id))
    await db.execute(delete(FacultyCourseAssignment).where(
        FacultyCourseAssignment.faculty_id == faculty_id
    ))
    await db.delete(fac)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Lecturer to Course assignments (FR-13)
# ---------------------------------------------------------------------------
@router.get("/assignments", response_model=List[AssignmentRead])
async def list_assignments(
    q: Optional[str] = Query(None, description="Search lecturer, course or department"),
    faculty_id: Optional[uuid.UUID] = None,
    course_id: Optional[uuid.UUID] = None,
    department_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    stmt = select(FacultyCourseAssignment).options(
        selectinload(FacultyCourseAssignment.faculty),
        selectinload(FacultyCourseAssignment.course),
        selectinload(FacultyCourseAssignment.department),
        selectinload(FacultyCourseAssignment.room).selectinload(Classroom.building),
    )
    if faculty_id:
        stmt = stmt.where(FacultyCourseAssignment.faculty_id == faculty_id)
    if course_id:
        stmt = stmt.where(FacultyCourseAssignment.course_id == course_id)
    # CHAIR: scope assignments to their faculty subtree. Admin sees all.
    subtree = await _chair_dept_subtree(db, current_user)
    if subtree is not None:
        if not subtree:
            return []
        stmt = stmt.where(FacultyCourseAssignment.department_id.in_(subtree))
    elif department_id:
        stmt = stmt.where(FacultyCourseAssignment.department_id == department_id)
    rows = (await db.execute(stmt)).scalars().all()

    out: List[AssignmentRead] = []
    for a in rows:
        fac_name = f"{a.faculty.first_name} {a.faculty.last_name}" if a.faculty else None
        course_code = a.course.code if a.course else None
        dept_code = a.department.code if a.department else None
        room_label = None
        room_type = None
        if a.room:
            bld = (a.room.building.code if a.room.building else "") or ""
            room_label = (f"{bld} · " if bld else "") + a.room.room_number
            room_type = a.room.type
        if q:
            ql = q.lower()
            haystack = " ".join(filter(None, [fac_name, course_code, dept_code, room_label])).lower()
            if ql not in haystack:
                continue
        out.append(AssignmentRead(
            id=a.id,
            faculty_id=a.faculty_id,
            course_id=a.course_id,
            department_id=a.department_id,
            room_id=a.room_id,
            notes=a.notes,
            faculty_name=fac_name,
            course_code=course_code,
            department_code=dept_code,
            room_label=room_label,
            room_type=room_type,
        ))
    return out


@router.post("/assignments", response_model=AssignmentRead, status_code=201)
async def create_assignment(
    a_in: AssignmentCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    fac = await db.get(Faculty, a_in.faculty_id)
    if not fac:
        raise HTTPException(status_code=400, detail="Lecturer does not exist.")
    course = await db.get(Course, a_in.course_id)
    if not course:
        raise HTTPException(status_code=400, detail="Course does not exist.")

    existing = await db.execute(
        select(FacultyCourseAssignment).where(
            FacultyCourseAssignment.faculty_id == a_in.faculty_id,
            FacultyCourseAssignment.course_id == a_in.course_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="This lecturer is already assigned to that course.")

    # Optional room — validate lab vs lecture against the course profile.
    room_obj: Optional[Classroom] = None
    if a_in.room_id is not None:
        room_obj = await db.get(Classroom, a_in.room_id)
        if not room_obj:
            raise HTTPException(status_code=400, detail="Selected room does not exist.")
        _validate_room_for_course(course, room_obj)

    assignment = FacultyCourseAssignment(
        id=uuid.uuid4(),
        faculty_id=a_in.faculty_id,
        course_id=a_in.course_id,
        department_id=fac.department_id,
        room_id=a_in.room_id,
        notes=(a_in.notes or None),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    dept = await db.get(Department, fac.department_id)
    room_label = None
    room_type = None
    if room_obj is not None:
        bld = await db.get(Building, room_obj.building_id)
        bld_code = bld.code if bld else ""
        room_label = (f"{bld_code} · " if bld_code else "") + room_obj.room_number
        room_type = room_obj.type
    return AssignmentRead(
        id=assignment.id,
        faculty_id=assignment.faculty_id,
        course_id=assignment.course_id,
        department_id=assignment.department_id,
        room_id=assignment.room_id,
        notes=assignment.notes,
        faculty_name=f"{fac.first_name} {fac.last_name}",
        course_code=course.code,
        department_code=dept.code if dept else None,
        room_label=room_label,
        room_type=room_type,
    )


def _validate_room_for_course(course: Course, room: Classroom) -> None:
    """Reject obviously-wrong room/course pairings.

    Rules:
    - If the course has lab_hours > 0 and zero lecture_hours, the room MUST be a LAB.
    - If the course has lecture_hours > 0 and zero lab_hours, the room MUST NOT be a LAB.
    - Mixed lecture+lab courses accept any room type (the scheduler may split sessions).
    """
    has_lec = (course.lecture_hours or 0) > 0
    has_lab = (course.lab_hours or 0) > 0
    rtype = (room.type or "").upper()
    if has_lab and not has_lec and rtype != "LAB":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Course {course.code} is a lab course — please pick a LAB room "
                f"(picked room is {rtype})."
            ),
        )
    if has_lec and not has_lab and rtype == "LAB":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Course {course.code} is a lecture-only course — labs cannot be used "
                f"(picked room is a LAB)."
            ),
        )


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(
    assignment_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    a = await db.get(FacultyCourseAssignment, assignment_id)
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    await db.delete(a)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
@router.get("/prerequisites")
async def list_prerequisites(
    course_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    stmt = select(Prerequisite)
    if course_id:
        stmt = stmt.where(Prerequisite.course_id == course_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [{
        "id": str(p.id),
        "course_id": str(p.course_id),
        "prerequisite_course_id": str(p.prerequisite_course_id),
    } for p in rows]


# ---------------------------------------------------------------------------
# Bulk wipe - one-button delete-everything
# ---------------------------------------------------------------------------
@router.post("/wipe", status_code=status.HTTP_200_OK)
async def wipe_catalog(
    scope: str = Query(
        "all",
        description="What to wipe: 'all' | 'courses' | 'faculty' | 'departments' | 'assignments' | 'rooms'",
    ),
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Danger! Delete in bulk. The frontend wraps this in a confirmation modal."""
    scope = (scope or "all").lower().strip()
    deleted: Dict[str, int] = {}

    async def _wipe_assignments():
        r = await db.execute(delete(FacultyCourseAssignment))
        deleted["assignments"] = r.rowcount or 0

    async def _wipe_sessions():
        r = await db.execute(delete(Session))
        deleted["sessions"] = r.rowcount or 0

    async def _wipe_sections():
        r = await db.execute(delete(Section))
        deleted["sections"] = r.rowcount or 0

    async def _wipe_prerequisites():
        r = await db.execute(delete(Prerequisite))
        deleted["prerequisites"] = r.rowcount or 0

    async def _wipe_courses():
        await _wipe_sessions()
        await _wipe_sections()
        await _wipe_prerequisites()
        await _wipe_assignments()
        r = await db.execute(delete(Course))
        deleted["courses"] = r.rowcount or 0

    async def _wipe_faculty():
        await _wipe_sessions()
        await _wipe_assignments()
        r = await db.execute(delete(Faculty))
        deleted["faculty"] = r.rowcount or 0

    async def _wipe_rooms():
        await _wipe_sessions()
        r = await db.execute(delete(Classroom))
        deleted["rooms"] = r.rowcount or 0
        r = await db.execute(delete(Building))
        deleted["buildings"] = r.rowcount or 0

    async def _wipe_departments():
        await _wipe_courses()
        await _wipe_faculty()
        r = await db.execute(delete(Department))
        deleted["departments"] = r.rowcount or 0

    try:
        if scope == "assignments":
            await _wipe_assignments()
        elif scope == "prerequisites":
            await _wipe_prerequisites()
        elif scope == "courses":
            await _wipe_courses()
        elif scope == "faculty":
            await _wipe_faculty()
        elif scope == "rooms":
            await _wipe_rooms()
        elif scope == "departments":
            await _wipe_departments()
        elif scope == "all":
            await _wipe_departments()
            await _wipe_rooms()
        else:
            raise HTTPException(status_code=400, detail=f"Unknown wipe scope '{scope}'.")
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Wipe failed: {exc}") from exc

    return {"scope": scope, "deleted": deleted}


# ---------------------------------------------------------------------------
# Sample CSV templates - downloadable so the user doesn't have to guess columns
# ---------------------------------------------------------------------------
SAMPLE_TEMPLATES: Dict[str, tuple] = {
    "departments": (
        # Faculties (top-level) leave parent_code BLANK.
        # Sub-departments set parent_code = the faculty's code (e.g. ENGR for the
        # Faculty of Engineering). All FIU-style faculties are listed first, then
        # a couple of sub-departments to demonstrate the two-level hierarchy.
        ["code", "name", "parent_code"],
        [
            # ---- Faculties (parent_code intentionally empty) ----
            ["ENGR", "Faculty of Engineering",                 ""],
            ["ARCH", "Faculty of Architecture",                ""],
            ["BUSI", "Faculty of Business and Economics",      ""],
            ["ARTS", "Faculty of Arts and Sciences",           ""],
            ["EDUC", "Faculty of Education",                   ""],
            ["COMM", "Faculty of Communication",               ""],
            ["LAW",  "Faculty of Law",                         ""],
            ["HEAL", "Faculty of Health Sciences",             ""],
            ["TOUR", "Faculty of Tourism",                     ""],
            ["FINE", "Faculty of Fine Arts and Design",        ""],
            # ---- Sub-departments under their parent faculty ----
            ["CMPE", "Computer Engineering",                   "ENGR"],
            ["SFWE", "Software Engineering",                   "ENGR"],
            ["ELEE", "Electrical and Electronics Engineering", "ENGR"],
            ["CIVL", "Civil Engineering",                      "ENGR"],
            ["ARCD", "Department of Architecture",             "ARCH"],
            ["BUSA", "Business Administration",                "BUSI"],
        ],
    ),
    "faculty": (
        ["first_name", "last_name", "email", "department_code", "rank", "max_load_hours"],
        [
            ["Ada",  "Lovelace", "ada@uni.edu",  "CS",   "PROFESSOR", "12"],
            ["Alan", "Turing",   "alan@uni.edu", "CS",   "LECTURER",  "16"],
            ["Carl", "Gauss",    "carl@uni.edu", "MATH", "ASSISTANT", "18"],
        ],
    ),
    "courses": (
        ["code", "title", "department_code", "credit_hours", "lecture_hours",
         "tutorial_hours", "lab_hours", "curriculum_year", "course_type", "workload", "prerequisites"],
        [
            # course_type uses FIU's 6-letter system:
            #   UC=University Core, FC=Faculty Core, AC=Area Core,
            #   AE=Area Elective, FE=Faculty Elective, UE=University Elective
            ["MATH121",  "Calculus I",                  "ENGR", "4.00", "3", "2", "0", "1", "FC", "", ""],
            ["ENGR103",  "Computer Programming I",      "ENGR", "3.00", "2", "0", "2", "1", "FC", "", ""],
            ["CMPE215",  "Algorithms and Data Structures","ENGR","3.00","3", "0", "1", "2", "AC", "", "ENGR103"],
            ["CMPE464",  "Artificial Intelligence",     "ENGR", "3.00", "3", "0", "0", "4", "AE", "", ""],
            ["ENGL121",  "English I",                   "ENGR", "3.00", "3", "0", "0", "1", "UC", "", ""],
        ],
    ),
    "rooms": (
        ["building_code", "building_name", "room_number", "capacity", "type", "department_code"],
        [
            ["BLDG_A", "Main Hall",    "101", "60", "LECTURE_HALL", "ENGR"],
            ["BLDG_A", "Main Hall",    "102", "30", "SEMINAR",      "ENGR"],
            ["BLDG_B", "Science Wing", "L01", "24", "LAB",          "ARTS"],
            ["SHARED", "Shared Hall",  "201", "80", "LECTURE_HALL", ""],
        ],
    ),
    "semesters": (
        ["name", "start_date", "end_date", "is_active"],
        [
            ["Fall 2026",   "2026-09-01", "2026-12-20", "true"],
            ["Spring 2027", "2027-01-15", "2027-05-10", "false"],
        ],
    ),
    "assignments": (
        ["faculty_email", "course_code", "room_number"],
        [
            ["ada@uni.edu",  "CS101", "101"],
            ["alan@uni.edu", "CS201", "L01"],
            ["carl@uni.edu", "MA101", "102"],
        ],
    ),
    "prerequisites": (
        ["course_code", "prerequisite_code"],
        [
            ["CS201", "CS101"],
            ["CS305", "CS201"],
            ["CS305", "MA101"],
        ],
    ),
    "sections": (
        ["course_code", "semester_name", "section_number", "expected_enrollment"],
        [
            ["CS101", "Fall 2026", "01", "40"],
            ["CS101", "Fall 2026", "02", "40"],
            ["CS201", "Fall 2026", "01", "35"],
        ],
    ),
}


@router.get("/templates/{entity}.csv")
async def download_template(entity: str):
    """Public endpoint - anyone can grab the sample CSV templates."""
    entity = entity.lower()
    if entity not in SAMPLE_TEMPLATES:
        raise HTTPException(status_code=404, detail=f"No sample template for '{entity}'.")
    headers, rows = SAMPLE_TEMPLATES[entity]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{entity}_sample.csv"',
            "Cache-Control": "no-store",
        },
    )


# ---------------------------------------------------------------------------
# Buildings & Rooms
# ---------------------------------------------------------------------------
class BuildingCreate(BaseModel):
    name: str
    code: str
    department_id: Optional[uuid.UUID] = None


class BuildingUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    department_id: Optional[uuid.UUID] = None  # null clears the owner


class BuildingRead(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    department_id: Optional[uuid.UUID] = None

    class Config:
        from_attributes = True


class RoomCreate(BaseModel):
    room_number: str
    building_id: uuid.UUID
    capacity: int
    type: str


class RoomRead(BaseModel):
    id: uuid.UUID
    room_number: str
    building_id: uuid.UUID
    capacity: int
    type: str
    building: Optional[BuildingRead] = None

    class Config:
        from_attributes = True


@router.get("/buildings", response_model=List[BuildingRead])
async def read_buildings(
    q: Optional[str] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    stmt = select(Building)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Building.code).like(like),
                              func.lower(Building.name).like(like)))
    result = await db.execute(stmt.order_by(Building.code))
    return result.scalars().all()


@router.post("/buildings", response_model=BuildingRead)
async def create_building(
    b_in: BuildingCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    bd = Building(
        id=uuid.uuid4(),
        name=b_in.name.strip(),
        code=b_in.code.strip().upper(),
        department_id=b_in.department_id,
    )
    db.add(bd)
    await db.commit()
    await db.refresh(bd)
    return bd


@router.patch("/buildings/{building_id}", response_model=BuildingRead)
async def update_building(
    building_id: uuid.UUID,
    patch: BuildingUpdate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Update a building. Setting department_id to null clears the owning dept
    (treats the building as shared / common-use). Setting a UUID assigns
    ownership — rooms inside will then require RoomRequest approval when used
    by other departments."""
    bd = await db.get(Building, building_id)
    if not bd:
        raise HTTPException(404, "Building not found.")
    if patch.name is not None:        bd.name = patch.name.strip()
    if patch.code is not None:        bd.code = patch.code.strip().upper()
    # department_id present as a field (even if None) means clear the owner.
    fields_set = patch.model_dump(exclude_unset=True)
    if "department_id" in fields_set:
        bd.department_id = patch.department_id
    await db.commit()
    await db.refresh(bd)
    return bd


@router.delete("/buildings/{building_id}", status_code=204)
async def delete_building(
    building_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    bd = await db.get(Building, building_id)
    if not bd:
        raise HTTPException(404, "Building not found.")
    await db.delete(bd)
    await db.commit()
    return None


@router.get("/rooms", response_model=List[RoomRead])
async def read_rooms(
    q: Optional[str] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    stmt = select(Classroom).options(selectinload(Classroom.building))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            func.lower(Classroom.room_number).like(like),
            func.lower(Classroom.type).like(like),
        ))
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/rooms", response_model=RoomRead)
async def create_room(
    r_in: RoomCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    room = Classroom(
        id=uuid.uuid4(),
        room_number=r_in.room_number.strip(),
        building_id=r_in.building_id,
        capacity=r_in.capacity,
        type=r_in.type.upper(),
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)
    stmt = select(Classroom).options(selectinload(Classroom.building)).where(Classroom.id == room.id)
    return (await db.execute(stmt)).scalar_one()


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    room = (await db.execute(select(Classroom).where(Classroom.id == room_id))).scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    await db.execute(delete(Session).where(Session.room_id == room_id))
    await db.delete(room)
    await db.commit()
    return None



# ---------------------------------------------------------------------------
# PATCH endpoints — edit any field on departments/courses/faculty/rooms
# (added so users can correct typos without re-creating rows)
# ---------------------------------------------------------------------------
@router.patch("/departments/{dept_id}", response_model=DepartmentRead)
async def update_department(
    dept_id: uuid.UUID,
    patch: DepartmentUpdate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    dept = (await db.execute(select(Department).where(Department.id == dept_id))).scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found.")
    if patch.code is not None:
        new_code = patch.code.strip().upper()
        if new_code and new_code != dept.code:
            existing = await db.execute(select(Department).where(Department.code == new_code))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=409, detail=f"Department '{new_code}' already exists.")
            dept.code = new_code
    if patch.name is not None and patch.name.strip():
        dept.name = patch.name.strip()
    # Allow moving a sub-department to a different faculty, or clearing the
    # link to make this row a top-level faculty.
    fields_set = patch.model_dump(exclude_unset=True)
    if "parent_id" in fields_set:
        if patch.parent_id == dept.id:
            raise HTTPException(400, "A department cannot be its own parent.")
        dept.parent_id = patch.parent_id
    await db.commit()
    await db.refresh(dept)
    return dept


@router.patch("/courses/{course_id}", response_model=CourseRead)
async def update_course(
    course_id: uuid.UUID,
    patch: CourseUpdate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    course = (await db.execute(select(Course).where(Course.id == course_id))).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")
    if patch.code is not None:
        new_code = patch.code.strip().upper()
        if new_code and new_code != course.code:
            existing = await db.execute(select(Course).where(Course.code == new_code))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=409, detail=f"Course '{new_code}' already exists.")
            course.code = new_code
    if patch.title is not None and patch.title.strip():
        course.title = patch.title.strip()
    if patch.department_id is not None:
        dept = await db.get(Department, patch.department_id)
        if not dept:
            raise HTTPException(status_code=400, detail="Selected department does not exist.")
        course.department_id = patch.department_id
    if patch.credit_hours is not None:
        course.credit_hours = patch.credit_hours
    if patch.lecture_hours is not None:
        course.lecture_hours = patch.lecture_hours
    if patch.lab_hours is not None:
        course.lab_hours = patch.lab_hours
    if patch.tutorial_hours is not None:
        course.tutorial_hours = patch.tutorial_hours
    if patch.curriculum_year is not None:
        course.curriculum_year = patch.curriculum_year
    if patch.semester_in_year is not None and patch.semester_in_year in (1, 2):
        course.semester_in_year = patch.semester_in_year
    if patch.course_type is not None:
        course.course_type = (patch.course_type.strip().upper() or None) if patch.course_type else None
    if patch.workload is not None:
        course.workload = patch.workload
    await db.commit()
    await db.refresh(course)
    return course


@router.patch("/faculty/{faculty_id}", response_model=FacultyRead)
async def update_faculty(
    faculty_id: uuid.UUID,
    patch: FacultyUpdate,
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    fac = (await db.execute(select(Faculty).where(Faculty.id == faculty_id))).scalar_one_or_none()
    if not fac:
        raise HTTPException(status_code=404, detail="Lecturer not found.")
    if patch.first_name is not None and patch.first_name.strip():
        fac.first_name = patch.first_name.strip()
    if patch.last_name is not None and patch.last_name.strip():
        fac.last_name = patch.last_name.strip()
    if patch.email is not None:
        new_email = patch.email.strip().lower()
        if new_email and new_email != fac.email:
            existing = await db.execute(select(Faculty).where(Faculty.email == new_email))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=409, detail=f"A lecturer with email '{new_email}' already exists.")
            fac.email = new_email
    if patch.department_id is not None:
        dep = await db.get(Department, patch.department_id)
        if not dep:
            raise HTTPException(status_code=400, detail="Department does not exist.")
        fac.department_id = patch.department_id
    if patch.rank is not None:
        r = patch.rank.strip().upper()
        if r not in {"PROFESSOR", "LECTURER", "ASSISTANT"}:
            raise HTTPException(status_code=400, detail="Rank must be PROFESSOR, LECTURER or ASSISTANT.")
        fac.rank = r
    if patch.max_load_hours is not None:
        fac.max_load_hours = patch.max_load_hours
    await db.commit()
    await db.refresh(fac)
    return fac
