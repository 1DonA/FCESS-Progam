"""
CSV Import Endpoint  (/api/v1/import)
Supports bulk-loading of the curriculum entities from CSV files.

Expected CSV columns per entity:
  departments : code, name
  faculty     : first_name, last_name, email, department_code, rank, max_load_hours
  courses     : code, title, department_code, credit_hours, lecture_hours, lab_hours,
                curriculum_year [, course_type, workload, prerequisites]
                  - course_type   CORE | ELECTIVE | GENERAL                (optional)
                  - workload      total weekly workload in hours           (optional)
                  - prerequisites semi-colon separated course codes        (optional)
  rooms       : building_code, building_name, room_number, capacity, type
  semesters   : name, start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), is_active (true/false)
  sections    : course_code, semester_name, section_number, expected_enrollment
"""

import csv
import io
import uuid
import logging
from typing import List, Dict, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.src.api import deps
from backend.src.modules.catalog.models import Department, Faculty, Course, FacultyCourseAssignment
from backend.src.modules.infrastructure.models import Building, Classroom, Prerequisite
from backend.src.modules.scheduling.models import Semester, Section

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _parse_csv(content: bytes) -> List[Dict[str, str]]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = [row for row in reader]
    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty or has no data rows")
    return rows


def _require_cols(rows: List[Dict], required: List[str], entity: str):
    actual = set(rows[0].keys())
    missing = set(required) - actual
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV for '{entity}' is missing columns: {sorted(missing)}",
        )


# ---------------------------------------------------------------------------
# departments
# ---------------------------------------------------------------------------
@router.post("/departments", status_code=status.HTTP_200_OK)
async def import_departments(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Upload a CSV to bulk-create departments. Skips rows where `code` already exists.

    Required columns: code, name
    Optional column:  parent_code — the code of the parent Faculty. Rows with a
                      parent_code become sub-departments under that faculty.
                      Faculties (top-level) have an empty parent_code.

    Trick to make the import order-independent: we do two passes. The first pass
    creates every row with parent_id NULL. The second pass resolves parent_code
    references and patches in parent_id. That way you can list parents and
    children in any order within the same CSV.
    """
    rows = _parse_csv(await file.read())
    _require_cols(rows, ["code", "name"], "departments")

    created, skipped = 0, 0
    # PASS 1 — create every row (parent_id deferred)
    pending: list[tuple[str, str]] = []   # (child_code, parent_code) pairs to resolve
    for i, row in enumerate(rows, start=2):
        code = row["code"].strip().upper()
        name = row["name"].strip()
        parent_code = (row.get("parent_code") or "").strip().upper()
        if not code or not name:
            logger.warning(f"Row {i}: empty code or name - skipped")
            skipped += 1
            continue

        existing = await db.execute(select(Department).where(Department.code == code))
        if existing.scalar_one_or_none():
            skipped += 1
            if parent_code:
                pending.append((code, parent_code))
            continue

        db.add(Department(id=uuid.uuid4(), code=code, name=name))
        created += 1
        if parent_code:
            pending.append((code, parent_code))

    await db.commit()

    # PASS 2 — resolve parent_code → parent_id (now every row exists)
    resolved = 0
    for child_code, parent_code in pending:
        child = (await db.execute(select(Department).where(Department.code == child_code))).scalar_one_or_none()
        parent = (await db.execute(select(Department).where(Department.code == parent_code))).scalar_one_or_none()
        if child and parent and child.id != parent.id and child.parent_id != parent.id:
            child.parent_id = parent.id
            resolved += 1
    await db.commit()

    return {"created": created, "skipped": skipped, "parent_links_resolved": resolved}


# ---------------------------------------------------------------------------
# faculty
# ---------------------------------------------------------------------------
VALID_RANKS = {"PROFESSOR", "LECTURER", "ASSISTANT"}


@router.post("/faculty", status_code=status.HTTP_200_OK)
async def import_faculty(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Upload a CSV to bulk-create faculty members."""
    rows = _parse_csv(await file.read())
    _require_cols(
        rows,
        ["first_name", "last_name", "email", "department_code", "rank", "max_load_hours"],
        "faculty",
    )

    dept_res = await db.execute(select(Department))
    dept_map: Dict[str, uuid.UUID] = {d.code: d.id for d in dept_res.scalars()}

    created, skipped, errors = 0, 0, []
    for i, row in enumerate(rows, start=2):
        email = row["email"].strip().lower()
        dept_code = row["department_code"].strip().upper()
        rank = row["rank"].strip().upper()

        if rank not in VALID_RANKS:
            errors.append(f"Row {i}: invalid rank '{rank}' (must be one of {sorted(VALID_RANKS)})")
            skipped += 1
            continue

        if dept_code not in dept_map:
            errors.append(f"Row {i}: department '{dept_code}' not found - import departments first")
            skipped += 1
            continue

        existing = await db.execute(select(Faculty).where(Faculty.email == email))
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        try:
            max_load = float(row["max_load_hours"])
        except ValueError:
            errors.append(f"Row {i}: invalid max_load_hours '{row['max_load_hours']}'")
            skipped += 1
            continue

        db.add(Faculty(
            id=uuid.uuid4(),
            first_name=row["first_name"].strip(),
            last_name=row["last_name"].strip(),
            email=email,
            department_id=dept_map[dept_code],
            rank=rank,
            max_load_hours=max_load,
        ))
        created += 1

    await db.commit()
    result: Dict[str, Any] = {"created": created, "skipped": skipped}
    if errors:
        result["errors"] = errors
    return result


# ---------------------------------------------------------------------------
# courses (with optional course_type, workload, prerequisites)
# ---------------------------------------------------------------------------
# Accept BOTH the FIU 6-category system (UC/FC/AC/AE/FE/UE) and the legacy
# CORE/ELECTIVE/GENERAL labels — so older CSVs and the new per-faculty seed
# CSVs both import cleanly.
VALID_COURSE_TYPES = {
    "UC", "FC", "AC", "AE", "FE", "UE",      # FIU canonical
    "CORE", "ELECTIVE", "GENERAL",            # legacy
    "",                                       # empty = unset, allowed
}

# Full-name aliases coming out of the PDF parser get normalised to the FIU
# 2-letter codes so the import accepts them without complaint.
COURSE_TYPE_ALIASES = {
    "UNIVERSITY CORE":     "UC",
    "FACULTY CORE":        "FC",
    "AREA CORE":           "AC",
    "AREA ELECTIVE":       "AE",
    "FACULTY ELECTIVE":    "FE",
    "UNIVERSITY ELECTIVE": "UE",
}

def _normalize_course_type(raw: str) -> str:
    """Map free-text course-type values (PDF full names, mixed case) to the
    canonical FIU 2-letter code. Returns '' for empty/unknown."""
    if not raw:
        return ""
    s = raw.strip().upper()
    if s in VALID_COURSE_TYPES:
        return s
    return COURSE_TYPE_ALIASES.get(s, s)


@router.post("/courses", status_code=status.HTTP_200_OK)
async def import_courses(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Upload a CSV to bulk-create courses.

    Optional columns (curriculum metadata):
      - course_type    CORE | ELECTIVE | GENERAL
      - workload       total weekly workload in hours
      - prerequisites  semi-colon separated list of prerequisite course codes
    """
    rows = _parse_csv(await file.read())
    _require_cols(
        rows,
        ["code", "title", "department_code", "credit_hours", "lecture_hours", "lab_hours", "curriculum_year"],
        "courses",
    )

    dept_res = await db.execute(select(Department))
    dept_map: Dict[str, uuid.UUID] = {d.code: d.id for d in dept_res.scalars()}

    pending_prereqs: List[tuple] = []
    created, skipped, errors = 0, 0, []
    for i, row in enumerate(rows, start=2):
        code = row["code"].strip().upper()
        dept_code = row["department_code"].strip().upper()

        if dept_code not in dept_map:
            errors.append(f"Row {i}: department '{dept_code}' not found")
            skipped += 1
            continue

        existing = await db.execute(select(Course).where(Course.code == code))
        if existing.scalar_one_or_none():
            skipped += 1
            prereq_raw = (row.get("prerequisites") or "").strip()
            if prereq_raw:
                for pc in (p.strip().upper() for p in prereq_raw.replace(",", ";").split(";") if p.strip()):
                    pending_prereqs.append((code, pc, i))
            continue

        course_type_raw = _normalize_course_type(row.get("course_type") or "")
        if course_type_raw and course_type_raw not in VALID_COURSE_TYPES:
            errors.append(f"Row {i}: invalid course_type '{course_type_raw}'")
            skipped += 1
            continue

        workload_raw = (row.get("workload") or "").strip()
        try:
            workload_val = float(workload_raw) if workload_raw else None
        except ValueError:
            errors.append(f"Row {i}: invalid workload '{workload_raw}'")
            skipped += 1
            continue

        try:
            # tutorial_hours is optional — default to 0 if column missing or blank
            try:
                tut = int((row.get("tutorial_hours") or "0").strip() or "0")
            except ValueError:
                tut = 0
            # semester_in_year (1=Fall, 2=Spring): accept either "semester" or
            # "semester_in_year" column. Heuristic fallback when absent/blank:
            # last digit of the code is odd → Fall, even → Spring.
            sem_raw = (row.get("semester_in_year") or row.get("semester") or "").strip()
            try:
                sem = int(sem_raw) if sem_raw else 0
            except ValueError:
                sem = 0
            if sem not in (1, 2):
                last = next((ch for ch in reversed(code) if ch.isdigit()), '1')
                sem = 2 if (int(last) % 2 == 0) else 1
            db.add(Course(
                id=uuid.uuid4(),
                code=code,
                title=row["title"].strip(),
                department_id=dept_map[dept_code],
                credit_hours=float(row["credit_hours"]),
                lecture_hours=int(row["lecture_hours"]),
                lab_hours=int(row["lab_hours"]),
                tutorial_hours=tut,
                curriculum_year=int(row["curriculum_year"]),
                semester_in_year=sem,
                course_type=course_type_raw or None,
                workload=workload_val,
            ))
            created += 1
        except (ValueError, KeyError) as exc:
            errors.append(f"Row {i}: {exc}")
            skipped += 1
            continue

        prereq_raw = (row.get("prerequisites") or "").strip()
        if prereq_raw:
            for pc in (p.strip().upper() for p in prereq_raw.replace(",", ";").split(";") if p.strip()):
                pending_prereqs.append((code, pc, i))

    await db.flush()

    prereq_added = 0
    if pending_prereqs:
        course_res = await db.execute(select(Course))
        course_map: Dict[str, uuid.UUID] = {c.code: c.id for c in course_res.scalars()}
        for course_code, prereq_code, row_num in pending_prereqs:
            if course_code == prereq_code:
                errors.append(f"Row {row_num}: course '{course_code}' cannot be its own prerequisite")
                continue
            cid = course_map.get(course_code)
            pid = course_map.get(prereq_code)
            if not cid or not pid:
                errors.append(
                    f"Row {row_num}: prerequisite '{prereq_code}' for '{course_code}' could not be linked"
                )
                continue
            existing_link = await db.execute(
                select(Prerequisite).where(
                    Prerequisite.course_id == cid,
                    Prerequisite.prerequisite_course_id == pid,
                )
            )
            if existing_link.scalar_one_or_none():
                continue
            db.add(Prerequisite(id=uuid.uuid4(), course_id=cid, prerequisite_course_id=pid))
            prereq_added += 1

    await db.commit()
    result: Dict[str, Any] = {"created": created, "skipped": skipped}
    if pending_prereqs:
        result["prerequisites_linked"] = prereq_added
    if errors:
        result["errors"] = errors
    return result


# ---------------------------------------------------------------------------
# rooms (buildings are auto-created if missing)
# ---------------------------------------------------------------------------
@router.post("/rooms", status_code=status.HTTP_200_OK)
async def import_rooms(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Upload a CSV to bulk-create buildings and classrooms.

    Required columns: building_code, building_name, room_number, capacity, type
    Optional column:  department_code — assigns the building to that owning
                      department (so cross-dept room requests are required).
    """
    rows = _parse_csv(await file.read())
    _require_cols(rows, ["building_code", "building_name", "room_number", "capacity", "type"], "rooms")

    VALID_TYPES = {"LECTURE_HALL", "LAB", "SEMINAR"}

    bld_res = await db.execute(select(Building))
    bld_map: Dict[str, uuid.UUID] = {b.code: b.id for b in bld_res.scalars()}

    # Pull departments so we can look up department_code if the column is present.
    from backend.src.modules.catalog.models import Department as _Dept
    dep_rows = (await db.execute(select(_Dept))).scalars().all()
    dep_by_code: Dict[str, uuid.UUID] = {d.code: d.id for d in dep_rows}

    created, skipped, errors = 0, 0, []
    for i, row in enumerate(rows, start=2):
        bld_code = row["building_code"].strip().upper()
        room_type = row["type"].strip().upper()
        dep_code = (row.get("department_code") or "").strip().upper()
        dep_id   = dep_by_code.get(dep_code) if dep_code else None

        if room_type not in VALID_TYPES:
            errors.append(f"Row {i}: invalid type '{room_type}'")
            skipped += 1
            continue

        if bld_code not in bld_map:
            new_bld = Building(
                id=uuid.uuid4(),
                code=bld_code,
                name=row["building_name"].strip() or bld_code,
                department_id=dep_id,
            )
            db.add(new_bld)
            await db.flush()
            bld_map[bld_code] = new_bld.id
        elif dep_id:
            # Building already exists — update its owner if the CSV specifies one
            existing_bld = (await db.execute(
                select(Building).where(Building.id == bld_map[bld_code])
            )).scalar_one_or_none()
            if existing_bld and existing_bld.department_id != dep_id:
                existing_bld.department_id = dep_id

        bld_id = bld_map[bld_code]
        room_number = row["room_number"].strip()

        existing = await db.execute(
            select(Classroom).where(
                Classroom.building_id == bld_id,
                Classroom.room_number == room_number,
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        try:
            db.add(Classroom(
                id=uuid.uuid4(),
                room_number=room_number,
                building_id=bld_id,
                capacity=int(row["capacity"]),
                type=room_type,
            ))
            created += 1
        except ValueError as exc:
            errors.append(f"Row {i}: {exc}")
            skipped += 1

    await db.commit()
    result: Dict[str, Any] = {"created": created, "skipped": skipped}
    if errors:
        result["errors"] = errors
    return result


# ---------------------------------------------------------------------------
# semesters
# ---------------------------------------------------------------------------
@router.post("/semesters", status_code=status.HTTP_200_OK)
async def import_semesters(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Upload a CSV to bulk-create semesters."""
    from datetime import date

    rows = _parse_csv(await file.read())
    _require_cols(rows, ["name", "start_date", "end_date", "is_active"], "semesters")

    created, skipped, errors = 0, 0, []
    for i, row in enumerate(rows, start=2):
        name = row["name"].strip()
        existing = await db.execute(select(Semester).where(Semester.name == name))
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        try:
            start = date.fromisoformat(row["start_date"].strip())
            end = date.fromisoformat(row["end_date"].strip())
        except ValueError as exc:
            errors.append(f"Row {i}: bad date - {exc}")
            skipped += 1
            continue

        is_active = row["is_active"].strip().lower() in {"true", "1", "yes"}
        db.add(Semester(id=uuid.uuid4(), name=name, start_date=start, end_date=end, is_active=is_active))
        created += 1

    await db.commit()
    result: Dict[str, Any] = {"created": created, "skipped": skipped}
    if errors:
        result["errors"] = errors
    return result


# ---------------------------------------------------------------------------
# sections
# ---------------------------------------------------------------------------
@router.post("/sections", status_code=status.HTTP_200_OK)
async def import_sections(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Upload a CSV to bulk-create course sections for a semester."""
    rows = _parse_csv(await file.read())
    _require_cols(
        rows,
        ["course_code", "semester_name", "section_number", "expected_enrollment"],
        "sections",
    )

    course_res = await db.execute(select(Course))
    course_map: Dict[str, uuid.UUID] = {c.code: c.id for c in course_res.scalars()}

    sem_res = await db.execute(select(Semester))
    sem_map: Dict[str, uuid.UUID] = {s.name: s.id for s in sem_res.scalars()}

    created, skipped, errors = 0, 0, []
    for i, row in enumerate(rows, start=2):
        course_code = row["course_code"].strip().upper()
        sem_name = row["semester_name"].strip()
        section_number = row["section_number"].strip()

        if course_code not in course_map:
            errors.append(f"Row {i}: course '{course_code}' not found")
            skipped += 1
            continue
        if sem_name not in sem_map:
            errors.append(f"Row {i}: semester '{sem_name}' not found")
            skipped += 1
            continue

        course_id = course_map[course_code]
        sem_id = sem_map[sem_name]

        existing = await db.execute(
            select(Section).where(
                Section.course_id == course_id,
                Section.semester_id == sem_id,
                Section.section_number == section_number,
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        try:
            db.add(Section(
                id=uuid.uuid4(),
                course_id=course_id,
                semester_id=sem_id,
                section_number=section_number,
                expected_enrollment=int(row["expected_enrollment"]),
            ))
            created += 1
        except ValueError as exc:
            errors.append(f"Row {i}: {exc}")
            skipped += 1

    await db.commit()
    result: Dict[str, Any] = {"created": created, "skipped": skipped}
    if errors:
        result["errors"] = errors
    return result


# ---------------------------------------------------------------------------
# prerequisites
# ---------------------------------------------------------------------------
@router.post("/prerequisites", status_code=status.HTTP_200_OK)
async def import_prerequisites(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Upload a CSV to bulk-link prerequisites between courses.

    Expected columns:
      course_code           the course that has the prerequisite
      prerequisite_code     the course required first
    """
    rows = _parse_csv(await file.read())
    _require_cols(rows, ["course_code", "prerequisite_code"], "prerequisites")

    course_res = await db.execute(select(Course))
    course_map: Dict[str, uuid.UUID] = {c.code: c.id for c in course_res.scalars()}

    created, skipped, errors = 0, 0, []
    for i, row in enumerate(rows, start=2):
        cc = row["course_code"].strip().upper()
        pc = row["prerequisite_code"].strip().upper()
        if cc == pc:
            errors.append(f"Row {i}: '{cc}' cannot be its own prerequisite")
            skipped += 1
            continue
        cid = course_map.get(cc)
        pid = course_map.get(pc)
        if not cid:
            errors.append(f"Row {i}: course '{cc}' not found")
            skipped += 1
            continue
        if not pid:
            errors.append(f"Row {i}: prerequisite course '{pc}' not found")
            skipped += 1
            continue
        existing = await db.execute(
            select(Prerequisite).where(
                Prerequisite.course_id == cid,
                Prerequisite.prerequisite_course_id == pid,
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue
        db.add(Prerequisite(
            id=uuid.uuid4(),
            course_id=cid,
            prerequisite_course_id=pid,
        ))
        created += 1

    await db.commit()
    result: Dict[str, Any] = {"created": created, "skipped": skipped}
    if errors:
        result["errors"] = errors
    return result


# ---------------------------------------------------------------------------
# assignments (lecturer ↔ course, optional room pinning)
# ---------------------------------------------------------------------------
@router.post("/assignments", status_code=status.HTTP_200_OK)
async def import_assignments(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(deps.get_db),
    current_user=Depends(deps.get_current_user),
):
    """Upload a CSV linking lecturers to the courses they teach.

    Expected columns:
      faculty_email   the lecturer's email
      course_code     the course they teach
      room_number     (optional) — the room they usually use for the course
    """
    rows = _parse_csv(await file.read())
    _require_cols(rows, ["faculty_email", "course_code"], "assignments")

    fac_res = await db.execute(select(Faculty))
    fac_map = {(f.email or "").lower(): f for f in fac_res.scalars()}

    course_res = await db.execute(select(Course))
    course_map = {c.code: c for c in course_res.scalars()}

    room_res = await db.execute(select(Classroom))
    rooms_by_number: Dict[str, uuid.UUID] = {}
    for r in room_res.scalars():
        rooms_by_number.setdefault(r.room_number, r.id)

    existing_res = await db.execute(select(FacultyCourseAssignment))
    existing_keys = {(a.faculty_id, a.course_id) for a in existing_res.scalars()}

    created, skipped, errors = 0, 0, []
    for i, row in enumerate(rows, start=2):
        em = (row.get("faculty_email") or "").strip().lower()
        cc = (row.get("course_code") or "").strip().upper()
        rn = (row.get("room_number") or "").strip()
        fac = fac_map.get(em)
        crs = course_map.get(cc)
        if not fac:
            errors.append(f"Row {i}: faculty '{em}' not found"); skipped += 1; continue
        if not crs:
            errors.append(f"Row {i}: course '{cc}' not found");   skipped += 1; continue
        if (fac.id, crs.id) in existing_keys:
            skipped += 1; continue
        room_id = rooms_by_number.get(rn) if rn else None
        db.add(FacultyCourseAssignment(
            id=uuid.uuid4(),
            faculty_id=fac.id,
            course_id=crs.id,
            department_id=crs.department_id,
            room_id=room_id,
        ))
        existing_keys.add((fac.id, crs.id))
        created += 1

    await db.commit()
    result: Dict[str, Any] = {"created": created, "skipped": skipped}
    if errors:
        result["errors"] = errors
    return result
