"""
AutoScheduler  –  fixes applied
================================
Bug 1 (scheduler never assigned anyone):
    _load_resources initialised current_faculty_loads to 0 but never loaded
    *existing* sessions, so re-runs always ignored prior work and could exceed load.
    Fixed: query actual committed session hours for each faculty on init.

Bug 2 (FR-22 ignored – no day-off):
    _find_valid_slot tried every day for every faculty without checking whether
    the faculty already has sessions on all 5 days.  Added faculty_busy_days
    tracking and guard in _find_valid_slot.

Bug 3 (rooms_cache empty causes silent failure):
    Added early-exit log when no classrooms are configured.

Bug 4 (session_splitter returns ORM objects as session_req):
    Replaced with a lightweight SessionRequirement dataclass to avoid accidental
    DB flush of incomplete ORM objects.

Bug 5 (already-scheduled sections re-scheduled on re-run):
    _fetch_pending_sections now excludes sections that already have sessions.
"""

import uuid
import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple, Dict, Set
from datetime import time, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.src.modules.scheduling.models import Section, Session
from backend.src.modules.catalog.models import Course, Faculty
from backend.src.modules.infrastructure.models import Classroom
from backend.src.modules.scheduling.services.conflict_detector import ConflictDetector

logger = logging.getLogger(__name__)


@dataclass
class SessionRequirement:
    """Lightweight representation of a session to be scheduled."""
    session_type: str          # "LECTURE" | "LAB" | "COMBINED"
    duration_minutes: int


def _split_course(course: Course, section_kind: str = "COMBINED") -> List[SessionRequirement]:
    """FR-20/FR-21: split course hours into session requirements.

    The section's `kind` filters which pieces apply:
      • LECTURE  → only the lecture chunk
      • LAB      → only the lab chunk
      • TUTORIAL → treated as a 1-hour LECTURE-style block (no defined hours)
      • COMBINED (default) → both, or one combined block if total <= 3h.

    Zero-length pieces are dropped so the scheduler never sees a 0-min session.
    """
    lec = course.lecture_hours or 0
    lab = course.lab_hours or 0
    kind = (section_kind or "COMBINED").upper()

    if kind == "LECTURE":
        return [SessionRequirement("LECTURE", lec * 60)] if lec > 0 else []
    if kind == "LAB":
        return [SessionRequirement("LAB", lab * 60)] if lab > 0 else []
    if kind == "TUTORIAL":
        # Tutorials default to 1 hour if course doesn't specify
        return [SessionRequirement("LECTURE", 60)]

    # COMBINED: original behaviour.
    total = lec + lab
    if total <= 0:
        return []
    if total <= 3:
        return [SessionRequirement("COMBINED", total * 60)]
    out: List[SessionRequirement] = []
    if lec > 0:
        out.append(SessionRequirement("LECTURE", lec * 60))
    if lab > 0:
        out.append(SessionRequirement("LAB", lab * 60))
    return out


class AutoScheduler:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.conflict_detector = ConflictDetector(db)
        self.start_hour = 8
        self.end_hour = 17

        self.faculty_cache: Dict[uuid.UUID, Faculty] = {}
        self.current_faculty_loads: Dict[uuid.UUID, float] = {}
        self.faculty_busy_days: Dict[uuid.UUID, Set[int]] = {}
        self.rooms_cache: List[Classroom] = []

        # Daily course cap (user-rule):
        #   For any given (department_id, curriculum_year), a single weekday cannot
        #   carry more than 4 DISTINCT courses. Forces the semester schedule to
        #   spread courses across the week rather than piling them on one day.
        self.MAX_COURSES_PER_DAY = 4
        # key = (department_id, curriculum_year, day_of_week) -> set of course_ids
        self.daily_course_sets: Dict[
            tuple, Set[uuid.UUID]
        ] = {}

    async def generate_schedule(self, semester_id: uuid.UUID) -> dict:
        logger.info(f"Starting schedule generation for semester {semester_id}")

        await self._load_resources(semester_id)

        if not self.rooms_cache:
            logger.error("No active classrooms found")
            return {"success": 0, "failed": 0, "error": "No active classrooms configured"}

        # Convenience: if the chair never created sections, spin up one per course.
        auto_created = await self._auto_create_sections(semester_id)
        if auto_created:
            logger.info("Auto-created %d default sections for the semester", auto_created)

        sections = await self._fetch_pending_sections(semester_id)
        if not sections:
            logger.warning("No unscheduled sections found for this semester")
            return {"success": 0, "failed": 0}

        # Sort hardest-to-schedule first (most contact hours)
        sections_with_meta = []
        for section in sections:
            res = await self.db.execute(select(Course).where(Course.id == section.course_id))
            course = res.scalar_one()
            sections_with_meta.append((section, course, course.lecture_hours + course.lab_hours))
        sections_with_meta.sort(key=lambda x: x[2], reverse=True)

        scheduled_count = 0
        failed_count = 0

        for section, course, _ in sections_with_meta:
            required_sessions = _split_course(course, getattr(section, "kind", "COMBINED"))
            section_success = True
            section_sessions: List[Session] = []

            for session_req in required_sessions:
                slot = await self._find_valid_slot(session_req, section, course, semester_id)
                if slot:
                    day, start_time, room_id, faculty_id = slot
                    new_session = Session(
                        id=uuid.uuid4(),
                        section_id=section.id,
                        semester_id=semester_id,
                        session_type=session_req.session_type,
                        day_of_week=day,
                        start_slot=start_time,
                        duration_minutes=session_req.duration_minutes,
                        room_id=room_id,
                        faculty_id=faculty_id,
                    )
                    section_sessions.append(new_session)
                    if faculty_id:
                        self.current_faculty_loads[faculty_id] += session_req.duration_minutes / 60.0
                        self.faculty_busy_days[faculty_id].add(day)
                    # Track for the 4-per-day rule
                    day_key = (course.department_id, course.curriculum_year, day)
                    self.daily_course_sets.setdefault(day_key, set()).add(course.id)
                else:
                    logger.warning(
                        f"No slot found for {course.code} "
                        f"({session_req.session_type} {session_req.duration_minutes}min)"
                    )
                    section_success = False
                    break

            if section_success:
                self.db.add_all(section_sessions)
                await self.db.flush()
                scheduled_count += 1
            else:
                # Roll back in-memory caches for this failed section
                for s in section_sessions:
                    if s.faculty_id:
                        self.current_faculty_loads[s.faculty_id] -= s.duration_minutes / 60.0
                failed_count += 1

        await self.db.commit()
        logger.info(f"Done. Scheduled={scheduled_count} Failed={failed_count}")
        return {"success": scheduled_count, "failed": failed_count}

    async def _load_resources(self, semester_id: uuid.UUID):
        # Faculty
        fac_res = await self.db.execute(select(Faculty).where(Faculty.is_active == True))
        for f in fac_res.scalars():
            self.faculty_cache[f.id] = f

            # Seed load from already-committed sessions (Bug 1 fix)
            load_res = await self.db.execute(
                select(func.coalesce(func.sum(Session.duration_minutes), 0))
                .join(Section, Session.section_id == Section.id)
                .where(Session.faculty_id == f.id, Session.semester_id == semester_id)
            )
            self.current_faculty_loads[f.id] = (load_res.scalar_one() or 0) / 60.0

            # Seed busy days (Bug 2 fix)
            days_res = await self.db.execute(
                select(Session.day_of_week)
                .where(Session.faculty_id == f.id, Session.semester_id == semester_id)
                .distinct()
            )
            self.faculty_busy_days[f.id] = set(days_res.scalars().all())

        # Faculty assignments (course → eligible lecturer ids)
        from backend.src.modules.catalog.models import FacultyCourseAssignment as _FCA
        asg_res = await self.db.execute(select(_FCA))
        self.assigned_faculty_for_course: Dict[uuid.UUID, List[uuid.UUID]] = {}
        for a in asg_res.scalars():
            self.assigned_faculty_for_course.setdefault(a.course_id, []).append(a.faculty_id)

        # Rooms
        room_res = await self.db.execute(select(Classroom).where(Classroom.is_active == True))
        self.rooms_cache = list(room_res.scalars().all())
        logger.info(f"Resources: {len(self.faculty_cache)} faculty, {len(self.rooms_cache)} rooms")

        # Seed daily-course-count map from already-committed sessions, so we
        # respect the 4-per-day rule across multiple scheduler runs.
        existing_rows = await self.db.execute(
            select(Session.day_of_week, Course.department_id, Course.curriculum_year, Course.id)
            .join(Section, Session.section_id == Section.id)
            .join(Course, Section.course_id == Course.id)
            .where(Session.semester_id == semester_id)
        )
        self.daily_course_sets = {}
        for day, dep_id, year, course_id in existing_rows.all():
            key = (dep_id, year, day)
            self.daily_course_sets.setdefault(key, set()).add(course_id)


    async def _auto_create_sections(self, semester_id: uuid.UUID) -> int:
        """Create one default section per active course if the semester has none.
        Returns how many were created. Gives the demo a one-click experience —
        the chair can still add or edit sections manually later.
        """
        # Skip if any sections already exist for the semester
        existing = await self.db.execute(
            select(Section).where(Section.semester_id == semester_id).limit(1)
        )
        if existing.scalar_one_or_none() is not None:
            return 0
        courses_res = await self.db.execute(
            select(Course).where(Course.is_active == True)  # noqa: E712
        )
        created = 0
        for course in courses_res.scalars():
            self.db.add(Section(
                id=uuid.uuid4(),
                course_id=course.id,
                semester_id=semester_id,
                section_number="01",
                expected_enrollment=30,
            ))
            created += 1
        if created:
            await self.db.flush()
        return created

    async def _fetch_pending_sections(self, semester_id: uuid.UUID) -> List[Section]:
        # Bug 5 fix: skip sections that already have sessions
        already_scheduled = select(Session.section_id).where(Session.semester_id == semester_id)
        stmt = select(Section).where(
            Section.semester_id == semester_id,
            Section.id.not_in(already_scheduled),
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def _find_valid_slot(
        self,
        session_req: SessionRequirement,
        section: Section,
        course: Course,
        semester_id: uuid.UUID,
    ) -> Optional[Tuple[int, time, uuid.UUID, uuid.UUID]]:

        valid_rooms = [
            r for r in self.rooms_cache
            if self._is_room_compatible(r, session_req.session_type, section.expected_enrollment)
        ]
        # Priority 1 — if this Section pins a lecturer, USE that lecturer only.
        # (Each group of a course can have its own dedicated lecturer.)
        pinned_lecturer = getattr(section, "lecturer_id", None)
        if pinned_lecturer and pinned_lecturer in self.faculty_cache:
            valid_faculty = [self.faculty_cache[pinned_lecturer]]
        else:
            # Priority 2 — course-level lecturer assignments (FR-5).
            # Fall back to the whole-department pool if no assignments are set.
            assigned_ids = set(getattr(self, "assigned_faculty_for_course", {}).get(course.id, []))
            if assigned_ids:
                valid_faculty = [f for f in self.faculty_cache.values() if f.id in assigned_ids]
            else:
                valid_faculty = [
                    f for f in self.faculty_cache.values()
                    if f.department_id == course.department_id
                ]

        if not valid_rooms:
            logger.warning(f"No compatible room for {course.code} {session_req.session_type}")
            return None
        if not valid_faculty:
            logger.warning(f"No faculty for dept of {course.code}")
            return None

        duration_hours = session_req.duration_minutes / 60.0
        time_slots = self._generate_time_slots(self.start_hour, self.end_hour)

        # Sort faculty by current load ascending so least-loaded faculty are tried first,
        # which spreads the schedule evenly across all faculty (and therefore all days).
        valid_faculty = sorted(valid_faculty, key=lambda f: self.current_faculty_loads[f.id])

        # Shuffle days so sessions are spread across the whole week instead of
        # always piling on Monday first.  We rotate the starting day based on
        # the section's hash so different sections start on different days.
        # Rotate starting day per section so sections spread across Mon–Fri.
        # Use section hash XOR load state so the rotation changes as the schedule fills.
        busy_day_counts = [
            sum(1 for fac in valid_faculty if d in self.faculty_busy_days[fac.id])
            for d in range(5)
        ]
        # Start from the least-occupied day among valid faculty
        least_busy_day = busy_day_counts.index(min(busy_day_counts))
        day_rotation = (hash(str(section.id)) + least_busy_day) % 5
        days = [(day_rotation + d) % 5 for d in range(5)]

        GREEDY_MAX_TRIES = 6000  # safety net so the inner loop cannot run unboundedly
        tries = 0
        for day in days:
            # USER-RULE: at most 4 distinct courses per (department, year, day).
            # If this day is already saturated AND this course isn't already on
            # the day, skip the whole day — forces a spread across the week.
            day_key = (course.department_id, course.curriculum_year, day)
            day_courses = self.daily_course_sets.get(day_key, set())
            if course.id not in day_courses and len(day_courses) >= self.MAX_COURSES_PER_DAY:
                continue

            for start_time in time_slots:
                for faculty in valid_faculty:
                    tries += 1
                    if tries > GREEDY_MAX_TRIES:
                        logger.warning("greedy hit GREEDY_MAX_TRIES, giving up on this session"); return None
                    busy_days = self.faculty_busy_days[faculty.id]

                    # FR-22: faculty must keep at least 1 day off per 5-day week.
                    if day not in busy_days and len(busy_days) >= 4:
                        continue  # Adding this day removes the last free day

                    # Load cap
                    if (self.current_faculty_loads[faculty.id] + duration_hours) > float(faculty.max_load_hours):
                        continue

                    # Time conflict
                    if await self.conflict_detector.check_faculty_conflict(
                        faculty.id, day, start_time, session_req.duration_minutes, semester_id
                    ):
                        continue

                    # Room search
                    for room in valid_rooms:
                        if not await self.conflict_detector.check_room_conflict(
                            room.id, day, start_time, session_req.duration_minutes, semester_id
                        ):
                            return (day, start_time, room.id, faculty.id)

        # Second pass: relax FR-22 (day-off rule) for sections that could not be
        # placed at all.  Better to schedule with a tight faculty week than to
        # leave a section entirely unscheduled.
        logger.warning(
            f"Relaxing FR-22 day-off rule for {course.code} {session_req.session_type} "
            f"– no slot found in first pass."
        )
        for day in days:
            for start_time in time_slots:
                for faculty in valid_faculty:
                    if (self.current_faculty_loads[faculty.id] + duration_hours) > float(faculty.max_load_hours):
                        continue
                    if await self.conflict_detector.check_faculty_conflict(
                        faculty.id, day, start_time, session_req.duration_minutes, semester_id
                    ):
                        continue
                    for room in valid_rooms:
                        if not await self.conflict_detector.check_room_conflict(
                            room.id, day, start_time, session_req.duration_minutes, semester_id
                        ):
                            return (day, start_time, room.id, faculty.id)

        return None

    def _is_room_compatible(self, room: Classroom, session_type: str, enrollment: int) -> bool:
        if room.capacity < enrollment:
            return False
        if session_type == "LAB":
            return room.type == "LAB"
        return room.type in ("LECTURE_HALL", "SEMINAR")

    def _generate_time_slots(self, start_h: int, end_h: int) -> List[time]:
        slots = []
        current = timedelta(hours=start_h)
        end = timedelta(hours=end_h)
        step = timedelta(minutes=30)
        while current < end:
            secs = current.total_seconds()
            slots.append(time(hour=int(secs // 3600), minute=int((secs % 3600) // 60)))
            current += step
        return slots
