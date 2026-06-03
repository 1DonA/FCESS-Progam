"""Cross-department room booking requests.

Workflow:
  1. Department A (requester) wants a room owned by Department B.
  2. A's chair POSTs /room-requests with the room, slot, optional course.
  3. B's chair sees it in GET /room-requests/incoming with a notification badge.
  4. B's chair POSTs /room-requests/{id}/respond  { action: "accept" | "reject",
     response_message, help_offered }. On accept the system can optionally
     create the Session immediately.
"""
from datetime import datetime, time as ttime
from typing import Any, Optional, List
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.src.api import deps
from backend.src.modules.infrastructure.models import RoomRequest, Classroom, Building
from backend.src.modules.catalog.models import Department, Course
from backend.src.modules.scheduling.models import Section, Session, Semester
from backend.src.modules.scheduling.services.conflict_detector import ConflictDetector

router = APIRouter()


async def _chair_subtree(db: AsyncSession, user) -> Optional[list]:
    """Return list of department ids visible to a CHAIR (their own + sub-depts
    if at top-level faculty). None for ADMIN (no scoping)."""
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


class RoomRequestCreate(BaseModel):
    requester_department_id: uuid.UUID
    room_id: uuid.UUID
    day_of_week: int                 # 0..4
    start_slot: str                  # "HH:MM" or "HH:MM:SS"
    duration_minutes: int = 60
    course_id: Optional[uuid.UUID] = None
    section_id: Optional[uuid.UUID] = None
    semester_id: Optional[uuid.UUID] = None
    message: Optional[str] = None


class RoomRequestResponse(BaseModel):
    action: str                      # "accept" | "reject"
    response_message: Optional[str] = None
    help_offered: Optional[str] = None
    auto_create_session: bool = True # on accept, also create the Session row


class RoomRequestOut(BaseModel):
    id: str
    status: str
    requester_department_id: str
    requester_department_code: Optional[str] = None
    requester_department_name: Optional[str] = None
    owner_department_id: str
    owner_department_code: Optional[str] = None
    owner_department_name: Optional[str] = None
    room_id: str
    room_number: Optional[str] = None
    building_name: Optional[str] = None
    course_id: Optional[str] = None
    course_code: Optional[str] = None
    section_id: Optional[str] = None
    semester_id: Optional[str] = None
    day_of_week: int
    start_slot: str
    duration_minutes: int
    message: Optional[str] = None
    response_message: Optional[str] = None
    help_offered: Optional[str] = None
    created_at: str
    responded_at: Optional[str] = None


def _parse_time(s: str) -> ttime:
    parts = s.split(":")
    if len(parts) < 2:
        raise HTTPException(400, "Bad start_slot. Use HH:MM.")
    return ttime(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) >= 3 else 0)


async def _enrich(db: AsyncSession, r: RoomRequest) -> dict:
    """Hydrate a RoomRequest with the names the UI shows."""
    room = (await db.execute(
        select(Classroom).options(selectinload(Classroom.building)).where(Classroom.id == r.room_id)
    )).scalar_one_or_none()
    req_dep = (await db.execute(
        select(Department).where(Department.id == r.requester_department_id)
    )).scalar_one_or_none()
    own_dep = (await db.execute(
        select(Department).where(Department.id == r.owner_department_id)
    )).scalar_one_or_none()
    course = None
    if r.course_id:
        course = (await db.execute(select(Course).where(Course.id == r.course_id))).scalar_one_or_none()
    return {
        "id": str(r.id),
        "status": r.status,
        "requester_department_id": str(r.requester_department_id),
        "requester_department_code": req_dep.code if req_dep else None,
        "requester_department_name": req_dep.name if req_dep else None,
        "owner_department_id": str(r.owner_department_id),
        "owner_department_code": own_dep.code if own_dep else None,
        "owner_department_name": own_dep.name if own_dep else None,
        "room_id": str(r.room_id),
        "room_number": room.room_number if room else None,
        "building_name": room.building.name if (room and room.building) else None,
        "course_id": str(r.course_id) if r.course_id else None,
        "course_code": course.code if course else None,
        "section_id": str(r.section_id) if r.section_id else None,
        "semester_id": str(r.semester_id) if r.semester_id else None,
        "day_of_week": r.day_of_week,
        "start_slot": r.start_slot.strftime("%H:%M:%S") if r.start_slot else "",
        "duration_minutes": r.duration_minutes,
        "message": r.message,
        "response_message": r.response_message,
        "help_offered": r.help_offered,
        "created_at": r.created_at.isoformat() if r.created_at else "",
        "responded_at": r.responded_at.isoformat() if r.responded_at else None,
    }


@router.post("", response_model=RoomRequestOut)
async def create_request(
    body: RoomRequestCreate,
    db: AsyncSession = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
):
    # Look up the room's owning department via Building.department_id
    room = (await db.execute(
        select(Classroom).options(selectinload(Classroom.building)).where(Classroom.id == body.room_id)
    )).scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Room not found.")
    owner_dept_id = room.building.department_id if room.building else None
    if not owner_dept_id:
        raise HTTPException(400, "This room has no owning department — no approval needed; book it directly.")
    if owner_dept_id == body.requester_department_id:
        raise HTTPException(400, "This room already belongs to your department — no request needed.")

    new = RoomRequest(
        id=uuid.uuid4(),
        requester_department_id=body.requester_department_id,
        owner_department_id=owner_dept_id,
        room_id=body.room_id,
        course_id=body.course_id,
        section_id=body.section_id,
        semester_id=body.semester_id,
        day_of_week=body.day_of_week,
        start_slot=_parse_time(body.start_slot),
        duration_minutes=body.duration_minutes,
        message=body.message,
        status="PENDING",
        requester_user_id=current_user.id,
    )
    db.add(new)
    await db.commit()
    await db.refresh(new)
    return await _enrich(db, new)


@router.get("/incoming")
async def list_incoming(
    department_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
):
    """Requests addressed to my department(s) (the room owner).
    For a top-level Faculty chair, returns requests addressed to ANY of their
    sub-departments too."""
    subtree = await _chair_subtree(db, current_user)
    if subtree is not None:
        if not subtree:
            return []
        stmt = select(RoomRequest).where(RoomRequest.owner_department_id.in_(subtree))
    else:
        dept = department_id or current_user.department_id
        if not dept:
            return []
        stmt = select(RoomRequest).where(RoomRequest.owner_department_id == dept)
    if status:
        stmt = stmt.where(RoomRequest.status == status.upper())
    stmt = stmt.order_by(RoomRequest.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [await _enrich(db, r) for r in rows]


@router.get("/outgoing")
async def list_outgoing(
    department_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
):
    """Requests my department(s) have sent to other departments."""
    subtree = await _chair_subtree(db, current_user)
    if subtree is not None:
        if not subtree:
            return []
        stmt = select(RoomRequest).where(RoomRequest.requester_department_id.in_(subtree))
    else:
        dept = department_id or current_user.department_id
        if not dept:
            return []
        stmt = select(RoomRequest).where(RoomRequest.requester_department_id == dept)
    if status:
        stmt = stmt.where(RoomRequest.status == status.upper())
    stmt = stmt.order_by(RoomRequest.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [await _enrich(db, r) for r in rows]


@router.get("/all")
async def list_all(
    status: Optional[str] = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
):
    """Admin view of every request."""
    if (current_user.role or "").upper() != "ADMIN":
        raise HTTPException(403, "Admin only.")
    stmt = select(RoomRequest)
    if status:
        stmt = stmt.where(RoomRequest.status == status.upper())
    stmt = stmt.order_by(RoomRequest.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [await _enrich(db, r) for r in rows]


@router.get("/notifications/count")
async def notification_count(
    db: AsyncSession = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
):
    """Number of PENDING incoming requests for my department + pending updates
    on my outgoing requests. Used to render the bell badge."""
    dept = current_user.department_id
    if not dept:
        # Admin sees system-wide pending count
        if (current_user.role or "").upper() == "ADMIN":
            n = (await db.execute(
                select(RoomRequest).where(RoomRequest.status == "PENDING")
            )).scalars().all()
            return {"pending_incoming": len(n), "recent_responses": 0}
        return {"pending_incoming": 0, "recent_responses": 0}

    incoming = (await db.execute(
        select(RoomRequest).where(
            RoomRequest.owner_department_id == dept,
            RoomRequest.status == "PENDING",
        )
    )).scalars().all()
    # Outgoing requests that got accepted/rejected in the last 24h
    recent = (await db.execute(
        select(RoomRequest).where(
            RoomRequest.requester_department_id == dept,
            RoomRequest.status.in_(("ACCEPTED", "REJECTED")),
        )
    )).scalars().all()
    return {"pending_incoming": len(incoming), "recent_responses": len(recent)}


@router.post("/{request_id}/respond", response_model=RoomRequestOut)
async def respond(
    request_id: uuid.UUID,
    body: RoomRequestResponse,
    db: AsyncSession = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
):
    req = (await db.execute(
        select(RoomRequest).where(RoomRequest.id == request_id)
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Request not found.")
    if req.status != "PENDING":
        raise HTTPException(400, f"Request already {req.status.lower()}.")
    # Only the owner department's chair (or admin) can respond
    role = (current_user.role or "").upper()
    if role != "ADMIN" and current_user.department_id != req.owner_department_id:
        raise HTTPException(403, "Only the owning department can respond.")

    action = body.action.lower()
    if action not in ("accept", "reject"):
        raise HTTPException(400, "action must be 'accept' or 'reject'.")

    req.responded_at = datetime.utcnow()
    req.responder_user_id = current_user.id
    req.response_message = body.response_message
    req.help_offered = body.help_offered

    if action == "reject":
        req.status = "REJECTED"
        await db.commit()
        await db.refresh(req)
        return await _enrich(db, req)

    # === ACCEPT ===
    req.status = "ACCEPTED"

    if body.auto_create_session and req.section_id and req.semester_id:
        # Validate the slot is still free + create a Session
        detector = ConflictDetector(db)
        if await detector.check_room_conflict(
            req.room_id, req.day_of_week, req.start_slot, req.duration_minutes, req.semester_id
        ):
            req.status = "PENDING"  # revert and report
            await db.commit()
            raise HTTPException(409, "Room now has a conflict at that slot — please reject or pick another time.")
        # Pick the section's course to figure out session_type
        sec = (await db.execute(select(Section).where(Section.id == req.section_id))).scalar_one_or_none()
        course = (await db.execute(select(Course).where(Course.id == sec.course_id))).scalar_one_or_none() if sec else None
        stype = "COMBINED"
        if course:
            lec = course.lecture_hours or 0
            lab = course.lab_hours or 0
            if lec + lab > 3:
                stype = "LAB" if lab >= lec else "LECTURE"
        new_sess = Session(
            id=uuid.uuid4(),
            section_id=req.section_id,
            semester_id=req.semester_id,
            room_id=req.room_id,
            faculty_id=None,           # the requesting dept will pick the lecturer
            day_of_week=req.day_of_week,
            start_slot=req.start_slot,
            duration_minutes=req.duration_minutes,
            session_type=stype,
        )
        db.add(new_sess)

    await db.commit()
    await db.refresh(req)
    return await _enrich(db, req)


@router.delete("/{request_id}", status_code=204)
async def cancel_request(
    request_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
):
    """Requester can cancel a pending request."""
    req = (await db.execute(
        select(RoomRequest).where(RoomRequest.id == request_id)
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Request not found.")
    role = (current_user.role or "").upper()
    if role != "ADMIN" and current_user.department_id != req.requester_department_id:
        raise HTTPException(403, "Only the requester can cancel.")
    if req.status != "PENDING":
        raise HTTPException(400, f"Cannot cancel a {req.status.lower()} request.")
    req.status = "CANCELLED"
    req.responded_at = datetime.utcnow()
    await db.commit()
    return None
