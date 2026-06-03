"""
CP-SAT scheduler (Google OR-Tools) — fast variant.

The previous version enumerated every (day, start_half_hour, room, faculty)
combination as a boolean variable. For 100 courses that's ~500k variables
and the solver couldn't finish in a few seconds.

This version is much smaller because it uses two pre-computed inputs:

  • Faculty for a course is taken from `faculty_course_assignments` directly,
    rather than being chosen by the solver. If a course has no assignment we
    fall back to the first active faculty in the course's department.

  • Room for a course is the assignment's pinned room if any; otherwise the
    smallest classroom that fits the expected enrollment AND has the right
    type (LAB for lab sessions, LECTURE_HALL/SEMINAR for the rest).

That leaves only (day, start_slot) as the solver decision per session.
For 100 courses × ~2 sessions × 5 days × 9 hourly starts ≈ 9,000 variables —
solvable in milliseconds.

Hard constraints encoded:
  - Each session is placed exactly once on the timetable.
  - A room is not used by two sessions at the same time.
  - A faculty member is not in two places at the same time (FR-10/23).
  - Every faculty member has at least one day off (FR-22).
  - Faculty total weekly load ≤ max_load_hours (FR-7).
  - A course and its prerequisite cannot share the same lecturer at the same
    start slot inside the same semester (FR-18).
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import time
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.catalog.models import Course, Faculty, FacultyCourseAssignment
from backend.src.modules.infrastructure.models import Classroom, Prerequisite
from backend.src.modules.scheduling.models import Section, Session

logger = logging.getLogger(__name__)

DAY_COUNT = 5            # 0=Mon … 4=Fri
SLOT_MINUTES = 60        # ⏱ one-hour granularity to keep the model small
START_MINUTE = 8 * 60    # 08:00
END_MINUTE = 17 * 60     # 17:00
SLOTS_PER_DAY = (END_MINUTE - START_MINUTE) // SLOT_MINUTES   # 9


def _slot_to_time(slot_idx: int) -> time:
    minutes = START_MINUTE + slot_idx * SLOT_MINUTES
    return time(minutes // 60, minutes % 60, 0)


def _split_course(course: Course) -> List[Tuple[str, int]]:
    """Return [(session_type, length_in_slots)] for this course."""
    lec = course.lecture_hours or 0
    lab = course.lab_hours or 0
    total = lec + lab
    if total <= 0:
        return []
    if total <= 3:
        return [("COMBINED" if lec and lab else ("LAB" if lab else "LECTURE"), total)]
    out: List[Tuple[str, int]] = []
    if lec > 0:
        out.append(("LECTURE", lec))
    if lab > 0:
        out.append(("LAB", lab))
    return out


@dataclass
class _SessionTask:
    """One thing to schedule: (section, course, type, length_in_slots, faculty_id, room_id)."""
    section: Section
    course: Course
    session_type: str
    length_slots: int
    faculty_id: uuid.UUID
    room_id: uuid.UUID


class CpsatScheduler:
    def __init__(self, db: AsyncSession, time_limit_seconds: int = 8):
        self.db = db
        self.time_limit = time_limit_seconds

    async def generate(self, semester_id: uuid.UUID) -> dict:
        try:
            from ortools.sat.python import cp_model
        except ImportError:
            return {
                "ok": False,
                "engine": "cpsat",
                "error": "ortools is not installed. Run 'pip install ortools' and restart the server.",
            }

        # ── Load everything ─────────────────────────────────────────────────
        sections = (await self.db.execute(
            select(Section).where(Section.semester_id == semester_id)
        )).scalars().all()

        auto_created = 0
        if not sections:
            # Auto-create one section per active course so the demo works in one click.
            courses_all = (await self.db.execute(
                select(Course).where(Course.is_active == True)  # noqa: E712
            )).scalars().all()
            for c in courses_all:
                self.db.add(Section(
                    id=uuid.uuid4(),
                    course_id=c.id,
                    semester_id=semester_id,
                    section_number="01",
                    expected_enrollment=30,
                ))
                auto_created += 1
            if auto_created:
                await self.db.flush()
                sections = (await self.db.execute(
                    select(Section).where(Section.semester_id == semester_id)
                )).scalars().all()
        if not sections:
            return {"ok": True, "engine": "cpsat", "scheduled": 0, "message": "No courses to schedule."}

        # Skip already-scheduled sections
        existing_section_ids = {
            r[0] for r in (await self.db.execute(
                select(Session.section_id).where(Session.semester_id == semester_id)
            )).all()
        }
        sections = [s for s in sections if s.id not in existing_section_ids]
        if not sections:
            return {"ok": True, "engine": "cpsat", "scheduled": 0, "message": "Every section is already scheduled."}

        course_ids = {s.course_id for s in sections}
        courses = {
            c.id: c for c in (await self.db.execute(
                select(Course).where(Course.id.in_(course_ids))
            )).scalars()
        }
        rooms = (await self.db.execute(
            select(Classroom).where(Classroom.is_active == True)  # noqa: E712
        )).scalars().all()
        if not rooms:
            return {"ok": False, "engine": "cpsat", "error": "No active classrooms configured."}
        faculty = (await self.db.execute(
            select(Faculty).where(Faculty.is_active == True)  # noqa: E712
        )).scalars().all()
        if not faculty:
            return {"ok": False, "engine": "cpsat", "error": "No active faculty configured."}

        assignments = (await self.db.execute(select(FacultyCourseAssignment))).scalars().all()
        # Every lecturer assigned to a course is eligible to teach it.
        # When a course has 2+ assignments, the scheduler picks the lecturer
        # with the currently smallest load — which spreads the work and avoids
        # the per-lecturer conflicts/overload the user asked about.
        eligible_faculty_for_course: Dict[uuid.UUID, List[uuid.UUID]] = {}
        first_room_for_course: Dict[uuid.UUID, uuid.UUID] = {}
        for a in assignments:
            eligible_faculty_for_course.setdefault(a.course_id, []).append(a.faculty_id)
            if a.room_id is not None:
                first_room_for_course.setdefault(a.course_id, a.room_id)

        faculty_by_dept: Dict[uuid.UUID, List[uuid.UUID]] = {}
        for f in faculty:
            faculty_by_dept.setdefault(f.department_id, []).append(f.id)
        faculty_by_id = {f.id: f for f in faculty}
        rooms_by_id = {r.id: r for r in rooms}

        # ── Decide faculty & room for each session up-front ─────────────────
        tasks: List[_SessionTask] = []
        skipped_reason: List[str] = []
        # Running load tracker (in minutes) so we can spread tasks across the
        # ALL lecturers assigned to a course rather than dumping everything on one.
        running_load_min: Dict[uuid.UUID, int] = {f.id: 0 for f in faculty}
        for sect in sections:
            course = courses.get(sect.course_id)
            if not course:
                continue
            parts = _split_course(course)
            if not parts:
                continue

            # Determine the eligible lecturer pool. Multiple assignments => pick
            # the one with the lowest running load so the work is spread.
            assigned = eligible_faculty_for_course.get(course.id, [])
            pool = assigned or faculty_by_dept.get(course.department_id, [])
            if not pool:
                skipped_reason.append(f"{course.code}: no eligible faculty")
                continue
            fac_id = min(pool, key=lambda fid: running_load_min.get(fid, 0))

            # Room per session type
            enrollment = sect.expected_enrollment or 0
            pinned_room_id = first_room_for_course.get(course.id)
            for session_type, length_slots in parts:
                need_lab = (session_type == "LAB")
                if pinned_room_id and rooms_by_id.get(pinned_room_id):
                    pinned = rooms_by_id[pinned_room_id]
                    pinned_is_lab = (pinned.type == "LAB")
                    if pinned_is_lab == need_lab and pinned.capacity >= enrollment:
                        room_id = pinned.id
                    else:
                        room_id = self._pick_room(rooms, need_lab, enrollment)
                else:
                    room_id = self._pick_room(rooms, need_lab, enrollment)

                if room_id is None:
                    skipped_reason.append(
                        f"{course.code} {session_type}: no {'LAB' if need_lab else 'lecture/seminar'} "
                        f"room with capacity ≥ {enrollment}"
                    )
                    continue
                tasks.append(_SessionTask(
                    section=sect, course=course,
                    session_type=session_type, length_slots=length_slots,
                    faculty_id=fac_id, room_id=room_id,
                ))
                running_load_min[fac_id] = running_load_min.get(fac_id, 0) + length_slots * SLOT_MINUTES

        if not tasks:
            return {
                "ok": False, "engine": "cpsat",
                "error": "Nothing could be placed — see diagnostics.",
                "diagnostics": {
                    "sections": len(sections),
                    "rooms": len(rooms),
                    "faculty": len(faculty),
                    "assignments_defined": len(assignments),
                    "lab_rooms": sum(1 for r in rooms if r.type == "LAB"),
                    "lecture_rooms": sum(1 for r in rooms if r.type != "LAB"),
                    "skipped_reasons": skipped_reason[:10],
                },
            }

        # ── Build the CP-SAT model ──────────────────────────────────────────
        model = cp_model.CpModel()

        # For each task, create a bool var per (day, start) that fits.
        # task_vars[i] is dict[(day, start)] -> BoolVar
        task_vars: List[Dict[Tuple[int, int], "cp_model.IntVar"]] = []
        for i, t in enumerate(tasks):
            d_to_v: Dict[Tuple[int, int], "cp_model.IntVar"] = {}
            for day in range(DAY_COUNT):
                for start in range(SLOTS_PER_DAY - t.length_slots + 1):
                    v = model.NewBoolVar(f"x_{i}_{day}_{start}")
                    d_to_v[(day, start)] = v
            task_vars.append(d_to_v)
            # Every session is placed exactly once
            model.AddExactlyOne(list(d_to_v.values()))

        # Room occupancy: at most one task per (room, day, slot)
        room_busy: Dict[Tuple[uuid.UUID, int, int], list] = {}
        for i, t in enumerate(tasks):
            for (day, start), v in task_vars[i].items():
                for off in range(t.length_slots):
                    room_busy.setdefault((t.room_id, day, start + off), []).append(v)
        for occupants in room_busy.values():
            if len(occupants) > 1:
                model.Add(sum(occupants) <= 1)

        # Faculty occupancy + load + day-off
        fac_busy: Dict[Tuple[uuid.UUID, int, int], list] = {}
        fac_minutes: Dict[uuid.UUID, list] = {}
        fac_day_used: Dict[Tuple[uuid.UUID, int], list] = {}
        for i, t in enumerate(tasks):
            for (day, start), v in task_vars[i].items():
                for off in range(t.length_slots):
                    fac_busy.setdefault((t.faculty_id, day, start + off), []).append(v)
                fac_minutes.setdefault(t.faculty_id, []).append((v, t.length_slots * SLOT_MINUTES))
                fac_day_used.setdefault((t.faculty_id, day), []).append(v)
        for occupants in fac_busy.values():
            if len(occupants) > 1:
                model.Add(sum(occupants) <= 1)
        for fid, entries in fac_minutes.items():
            max_min = int(float(faculty_by_id[fid].max_load_hours) * 60)
            model.Add(sum(v * mins for v, mins in entries) <= max_min)
        # FR-22: at least one day off
        for fid in {t.faculty_id for t in tasks}:
            days_used_flags = []
            for d in range(DAY_COUNT):
                vs = fac_day_used.get((fid, d), [])
                if not vs:
                    continue
                flag = model.NewBoolVar(f"fac_{fid}_d{d}_used")
                model.AddMaxEquality(flag, vs)
                days_used_flags.append(flag)
            if days_used_flags:
                model.Add(sum(days_used_flags) <= DAY_COUNT - 1)

        # USER-RULE: at most 4 DISTINCT courses per (department, curriculum_year, day).
        # For each (dept, year, day) bucket, build a per-course flag that is 1 if
        # ANY of that course's sessions are on that day, then constrain the sum of
        # flags <= 4. This forces the timetable to spread courses across the week.
        MAX_COURSES_PER_DAY = 4
        # Group tasks by (dept, year, course_id)
        course_buckets: Dict[Tuple[uuid.UUID, int, uuid.UUID], list] = {}
        for i, t in enumerate(tasks):
            key = (t.course.department_id, int(t.course.curriculum_year or 0), t.course.id)
            course_buckets.setdefault(key, []).append(i)
        # For each (dept, year, day): build a flag per course = OR over its task_vars on that day
        dept_year_day_flags: Dict[Tuple[uuid.UUID, int, int], list] = {}
        for (dep_id, year, course_id), task_idxs in course_buckets.items():
            for d in range(DAY_COUNT):
                day_vars = []
                for ti in task_idxs:
                    for (day, _start), v in task_vars[ti].items():
                        if day == d:
                            day_vars.append(v)
                if not day_vars:
                    continue
                flag = model.NewBoolVar(f"yc_{dep_id}_{year}_{d}_{course_id}")
                # flag = 1 iff any of this course's sessions land on day d
                model.AddMaxEquality(flag, day_vars)
                dept_year_day_flags.setdefault((dep_id, year, d), []).append(flag)
        for (_dep, _year, _d), flags in dept_year_day_flags.items():
            if len(flags) > MAX_COURSES_PER_DAY:
                model.Add(sum(flags) <= MAX_COURSES_PER_DAY)

        # FR-18: prereq + course can't share lecturer at same start slot
        prereqs = (await self.db.execute(select(Prerequisite))).scalars().all()
        if prereqs:
            prereq_of: Dict[uuid.UUID, set] = {}
            for p in prereqs:
                prereq_of.setdefault(p.course_id, set()).add(p.prerequisite_course_id)
            # index task_vars by (course_id, faculty_id, day, start) for fast lookup
            by_keys: Dict[Tuple[uuid.UUID, uuid.UUID, int, int], list] = {}
            for i, t in enumerate(tasks):
                for (day, start), v in task_vars[i].items():
                    by_keys.setdefault((t.course.id, t.faculty_id, day, start), []).append(v)
            for cid, pids in prereq_of.items():
                for (a_cid, fid, d, s), avars in by_keys.items():
                    if a_cid != cid:
                        continue
                    for pid in pids:
                        bvars = by_keys.get((pid, fid, d, s)) or []
                        if not bvars:
                            continue
                        for av in avars:
                            for bv in bvars:
                                model.Add(av + bv <= 1)

        # Soft objective: pack the week early (small but meaningful)
        early = []
        for i, t in enumerate(tasks):
            for (day, start), v in task_vars[i].items():
                early.append(v * (day * SLOTS_PER_DAY + start))
        if early:
            model.Minimize(sum(early))

        # ── Solve in a worker thread so FastAPI stays responsive ───────────
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = float(self.time_limit)
        solver.parameters.num_search_workers = 1
        total_vars = sum(len(d) for d in task_vars)
        logger.info(
            "CP-SAT: starting solve (%d sessions, %d boolean vars, time_limit=%ss)",
            len(tasks), total_vars, self.time_limit,
        )
        status = await asyncio.to_thread(solver.Solve, model)
        logger.info("CP-SAT: solver finished in %.2fs", solver.WallTime())

        status_name = {
            cp_model.OPTIMAL: "OPTIMAL",
            cp_model.FEASIBLE: "FEASIBLE",
            cp_model.INFEASIBLE: "INFEASIBLE",
            cp_model.MODEL_INVALID: "MODEL_INVALID",
            cp_model.UNKNOWN: "UNKNOWN",
        }.get(status, "UNKNOWN")
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return {
                "ok": False, "engine": "cpsat", "status": status_name,
                "error": "Solver returned " + status_name + ". Try a longer time_limit or relax constraints.",
                "diagnostics": {
                    "tasks": len(tasks),
                    "variables": total_vars,
                    "rooms": len(rooms),
                    "faculty": len(faculty),
                    "skipped_reasons": skipped_reason[:10],
                },
            }

        # ── Materialise placements ──────────────────────────────────────────
        created = 0
        for i, t in enumerate(tasks):
            for (day, start), v in task_vars[i].items():
                if solver.Value(v) == 1:
                    self.db.add(Session(
                        id=uuid.uuid4(),
                        section_id=t.section.id,
                        semester_id=semester_id,
                        session_type=t.session_type,
                        day_of_week=day,
                        start_slot=_slot_to_time(start),
                        duration_minutes=t.length_slots * SLOT_MINUTES,
                        room_id=t.room_id,
                        faculty_id=t.faculty_id,
                    ))
                    created += 1
                    break
        await self.db.commit()
        return {
            "ok": True, "engine": "cpsat", "status": status_name,
            "scheduled": created,
            "solve_seconds": round(solver.WallTime(), 2),
            "auto_created_sections": auto_created,
            "skipped_in_setup": len(skipped_reason),
        }

    @staticmethod
    def _pick_room(rooms: List[Classroom], need_lab: bool, enrollment: int) -> Optional[uuid.UUID]:
        """Smallest classroom that fits."""
        candidates = [
            r for r in rooms
            if ((r.type == "LAB") == need_lab) and r.capacity >= enrollment
        ]
        if not candidates:
            # Fallback: ignore capacity if absolutely nothing fits
            candidates = [r for r in rooms if (r.type == "LAB") == need_lab]
        if not candidates:
            return None
        candidates.sort(key=lambda r: r.capacity)
        return candidates[0].id
