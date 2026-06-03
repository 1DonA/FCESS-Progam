from datetime import timedelta
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.src.api import deps
from backend.src.core import security
from backend.src.modules.auth.models import User
from backend.src.core.config import settings
from pydantic import BaseModel, EmailStr

router = APIRouter()

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str = None
    role: str = "FACULTY"
    # Optional: if a Faculty row with this email already exists, the new account
    # is auto-linked to it so the lecturer can see "my schedule" etc.
    faculty_email: str | None = None
    # NEW — the user picks their faculty/department straight from a dropdown on
    # the signup page; this is the canonical link (no email-matching required).
    department_id: Any | None = None


class UserResponse(BaseModel):
    id: Any
    email: str
    full_name: str = None
    role: str
    is_active: bool
    faculty_id: Any | None = None
    department_id: Any | None = None

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str


class MeResponse(BaseModel):
    """Whoami payload — frontend uses this to gate menus + scope queries."""
    id: Any
    email: str
    full_name: str | None = None
    role: str
    is_active: bool
    faculty_id: Any | None = None
    department_id: Any | None = None
    # If linked to a Faculty row, expose their dept code/name for nicer UI
    department_code: str | None = None
    department_name: str | None = None
    faculty_first_name: str | None = None
    faculty_last_name: str | None = None

@router.post("/register", response_model=UserResponse)
async def register(
    user_in: UserCreate,
    db: AsyncSession = Depends(deps.get_db)
) -> Any:
    """Self-service signup.

    Anyone can create a FACULTY or CHAIR account. ADMIN is reserved — it has to
    be created via the seed script or promoted by an existing admin.
    If the new user's email (or supplied faculty_email) matches an existing
    Faculty row, the account is auto-linked to it so the lecturer can see
    their own schedule + department.
    """
    from backend.src.modules.catalog.models import Faculty as FacultyModel

    stmt = select(User).where(User.email == user_in.email)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="The user with this email already exists in the system.",
        )

    # Sanitise role — public signup is FACULTY or CHAIR only
    role = (user_in.role or "FACULTY").upper()
    if role not in ("FACULTY", "CHAIR"):
        role = "FACULTY"

    # Try to link to an existing Faculty row (lecturer record)
    lookup_email = (user_in.faculty_email or user_in.email).lower()
    fac_row = (await db.execute(
        select(FacultyModel).where(FacultyModel.email == lookup_email)
    )).scalar_one_or_none()

    # Resolve final department_id:
    #   1. Explicit department_id from signup form (canonical)
    #   2. Else inherit from linked Faculty row
    #   3. Else NULL
    import uuid as _uuid
    final_dep_id = None
    if user_in.department_id:
        try:
            final_dep_id = _uuid.UUID(str(user_in.department_id))
        except Exception:
            final_dep_id = None
    if not final_dep_id and fac_row:
        final_dep_id = fac_row.department_id

    user = User(
        email=user_in.email,
        hashed_password=security.get_password_hash(user_in.password),
        full_name=user_in.full_name,
        role=role,
        faculty_id=fac_row.id if fac_row else None,
        department_id=final_dep_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Admin-only roster of every account on the system, with the
    department/lecturer they're linked to. Powers the Account Mapping page."""
    from backend.src.modules.catalog.models import Faculty as FacultyModel, Department

    if (current_user.role or "").upper() != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin only.")

    users = (await db.execute(select(User))).scalars().all()
    depts = {d.id: d for d in (await db.execute(select(Department))).scalars().all()}
    facs  = {f.id: f for f in (await db.execute(select(FacultyModel))).scalars().all()}

    out = []
    for u in users:
        dep = depts.get(u.department_id) if u.department_id else None
        fac = facs.get(u.faculty_id) if u.faculty_id else None
        out.append({
            "id": str(u.id),
            "email": u.email,
            "full_name": u.full_name,
            "role": u.role,
            "is_active": u.is_active,
            "department_id": str(u.department_id) if u.department_id else None,
            "department_code": dep.code if dep else None,
            "department_name": dep.name if dep else None,
            "faculty_id": str(u.faculty_id) if u.faculty_id else None,
            "faculty_name": (f"{fac.first_name} {fac.last_name}") if fac else None,
        })
    out.sort(key=lambda x: ((x["role"] or 'Z'), (x["department_code"] or 'Z'), (x["email"] or '')))
    return out


@router.get("/me", response_model=MeResponse)
async def me(
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
):
    """Returns the logged-in user with role + scope. Frontend calls this on app
    boot to decide what menus and pages to show."""
    from backend.src.modules.catalog.models import Faculty as FacultyModel, Department

    dept_code = dept_name = None
    f_first = f_last = None
    if current_user.faculty_id:
        fac = (await db.execute(
            select(FacultyModel).where(FacultyModel.id == current_user.faculty_id)
        )).scalar_one_or_none()
        if fac:
            f_first, f_last = fac.first_name, fac.last_name
    if current_user.department_id:
        dep = (await db.execute(
            select(Department).where(Department.id == current_user.department_id)
        )).scalar_one_or_none()
        if dep:
            dept_code, dept_name = dep.code, dep.name

    return MeResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        faculty_id=current_user.faculty_id,
        department_id=current_user.department_id,
        department_code=dept_code,
        department_name=dept_name,
        faculty_first_name=f_first,
        faculty_last_name=f_last,
    )

# ---------------------------------------------------------------------------
# Admin-only user management (delete, edit, reset password)
# ---------------------------------------------------------------------------
class UserPatch(BaseModel):
    full_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    department_id: Any | None = None


class PasswordReset(BaseModel):
    new_password: str


def _require_admin(current_user: User):
    if (current_user.role or "").upper() != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin only.")


@router.patch("/users/{user_id}", response_model=UserResponse)
async def patch_user(
    user_id: str,
    patch: UserPatch,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Admin: edit any user's full_name, role, is_active, or linked department."""
    _require_admin(current_user)
    user = (await db.execute(select(User).where(User.id == uuid.UUID(str(user_id))))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    data = patch.model_dump(exclude_unset=True)
    if "full_name" in data and data["full_name"] is not None:
        user.full_name = data["full_name"]
    if "role" in data and data["role"]:
        r = data["role"].upper()
        if r not in ("ADMIN", "CHAIR", "FACULTY"):
            raise HTTPException(status_code=400, detail="Role must be ADMIN, CHAIR or FACULTY.")
        user.role = r
    if "is_active" in data and data["is_active"] is not None:
        user.is_active = bool(data["is_active"])
    if "department_id" in data:
        if not data["department_id"]:
            user.department_id = None
        else:
            try:
                user.department_id = uuid.UUID(str(data["department_id"]))
            except Exception:
                raise HTTPException(status_code=400, detail="department_id must be a valid UUID.")
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Admin: delete a user account. Refuses to delete oneself."""
    _require_admin(current_user)
    target_id = uuid.UUID(str(user_id))
    if target_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't delete your own account.")
    user = (await db.execute(select(User).where(User.id == target_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    await db.delete(user)
    await db.commit()
    return None


@router.post("/users/{user_id}/password", status_code=200)
async def reset_user_password(
    user_id: str,
    body: PasswordReset,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Admin: set a new password for any user."""
    _require_admin(current_user)
    if not body.new_password or len(body.new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    user = (await db.execute(select(User).where(User.id == uuid.UUID(str(user_id))))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.hashed_password = security.get_password_hash(body.new_password)
    await db.commit()
    return {"ok": True, "email": user.email}


@router.post("/login", response_model=Token)
async def login_access_token(
    db: AsyncSession = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    stmt = select(User).where(User.email == form_data.username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    access_token = security.create_access_token(
        subject=user.id,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": access_token, "token_type": "bearer"}
