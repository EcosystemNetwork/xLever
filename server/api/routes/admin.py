"""
Admin analytics routes — platform-wide stats, user activity, session tracking.
"""
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select, func, case, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    User, Position, AgentRun, Alert, UserSession,
    PositionStatus, AgentStatus,
)
from ..schemas import (
    PlatformStats, UserDetail, SessionCreate, SessionOut,
    DailyActivity, HourlyActivity,
)

router = APIRouter(prefix="/admin", tags=["admin"])


# ─── Platform Overview ──────────────────────────────────────────

@router.get("/stats", response_model=PlatformStats)
async def get_platform_stats(db: AsyncSession = Depends(get_db)):
    """Aggregate platform-wide metrics for the admin dashboard."""
    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    total_sessions = (await db.execute(select(func.count(UserSession.id)))).scalar() or 0
    active_sessions = (await db.execute(
        select(func.count(UserSession.id)).where(UserSession.disconnected_at.is_(None))
    )).scalar() or 0
    total_positions = (await db.execute(select(func.count(Position.id)))).scalar() or 0
    open_positions = (await db.execute(
        select(func.count(Position.id)).where(Position.status == PositionStatus.OPEN)
    )).scalar() or 0
    total_agent_runs = (await db.execute(select(func.count(AgentRun.id)))).scalar() or 0
    active_agents = (await db.execute(
        select(func.count(AgentRun.id)).where(AgentRun.status == AgentStatus.RUNNING)
    )).scalar() or 0
    total_alerts = (await db.execute(select(func.count(Alert.id)))).scalar() or 0

    return PlatformStats(
        total_users=total_users,
        total_sessions=total_sessions,
        active_sessions=active_sessions,
        total_positions=total_positions,
        open_positions=open_positions,
        total_agent_runs=total_agent_runs,
        active_agents=active_agents,
        total_alerts=total_alerts,
    )


# ─── User List ──────────────────────────────────────────────────

@router.get("/users", response_model=list[UserDetail])
async def list_users(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    sort: str = Query("last_seen", pattern=r"^(last_seen|created_at|wallet_address)$"),
    db: AsyncSession = Depends(get_db),
):
    """Paginated user list with activity counts."""
    order_col = getattr(User, sort)
    # Descending for timestamps, ascending for wallet address
    order = order_col.asc() if sort == "wallet_address" else order_col.desc()

    result = await db.execute(
        select(User).order_by(order).limit(limit).offset(offset)
    )
    users = result.scalars().all()

    details = []
    for u in users:
        sess_count = (await db.execute(
            select(func.count(UserSession.id)).where(UserSession.user_id == u.id)
        )).scalar() or 0
        pos_count = (await db.execute(
            select(func.count(Position.id)).where(Position.user_id == u.id)
        )).scalar() or 0
        agent_count = (await db.execute(
            select(func.count(AgentRun.id)).where(AgentRun.user_id == u.id)
        )).scalar() or 0
        details.append(UserDetail(
            id=u.id,
            wallet_address=u.wallet_address,
            created_at=u.created_at,
            last_seen=u.last_seen,
            total_sessions=sess_count,
            total_positions=pos_count,
            total_agent_runs=agent_count,
        ))
    return details


# ─── Daily Activity (last N days) ───────────────────────────────

@router.get("/activity/daily", response_model=list[DailyActivity])
async def daily_activity(
    days: int = Query(30, le=90),
    db: AsyncSession = Depends(get_db),
):
    """Login counts and new user registrations per day."""
    # Sessions per day
    sessions_q = await db.execute(
        select(
            cast(UserSession.connected_at, Date).label("day"),
            func.count(UserSession.id).label("cnt"),
        )
        .where(UserSession.connected_at >= func.now() - func.cast(f"{days} days", type_=None))
        .group_by("day")
        .order_by("day")
    )
    sessions_by_day = {str(r.day): r.cnt for r in sessions_q}

    # New users per day
    users_q = await db.execute(
        select(
            cast(User.created_at, Date).label("day"),
            func.count(User.id).label("cnt"),
        )
        .where(User.created_at >= func.now() - func.cast(f"{days} days", type_=None))
        .group_by("day")
        .order_by("day")
    )
    users_by_day = {str(r.day): r.cnt for r in users_q}

    all_days = sorted(set(list(sessions_by_day.keys()) + list(users_by_day.keys())))
    return [
        DailyActivity(
            date=d,
            logins=sessions_by_day.get(d, 0),
            new_users=users_by_day.get(d, 0),
        )
        for d in all_days
    ]


# ─── Hourly Activity Distribution ───────────────────────────────

@router.get("/activity/hourly", response_model=list[HourlyActivity])
async def hourly_activity(db: AsyncSession = Depends(get_db)):
    """Session count by hour of day (0-23) — shows peak usage times."""
    result = await db.execute(
        select(
            func.extract("hour", UserSession.connected_at).label("hr"),
            func.count(UserSession.id).label("cnt"),
        )
        .group_by("hr")
        .order_by("hr")
    )
    hour_map = {int(r.hr): r.cnt for r in result}
    return [HourlyActivity(hour=h, sessions=hour_map.get(h, 0)) for h in range(24)]


# ─── Recent Sessions ────────────────────────────────────────────

@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Recent sessions ordered by connection time."""
    result = await db.execute(
        select(UserSession)
        .order_by(UserSession.connected_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()


# ─── Session Lifecycle (called by frontend) ─────────────────────

@router.post("/sessions", response_model=SessionOut)
async def create_session(
    body: SessionCreate, request: Request, db: AsyncSession = Depends(get_db),
):
    """Record a new session when a wallet connects."""
    addr = body.wallet_address.lower()
    # Look up user
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()

    session = UserSession(
        user_id=user.id if user else None,
        wallet_address=addr,
        page=body.page,
        referrer=body.referrer,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.patch("/sessions/{session_id}/disconnect", response_model=SessionOut)
async def disconnect_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """Mark a session as ended and compute duration."""
    result = await db.execute(
        select(UserSession).where(UserSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        from fastapi import HTTPException
        raise HTTPException(404, "Session not found")

    session.disconnected_at = func.now()
    # Compute duration in seconds
    await db.flush()
    await db.refresh(session)
    if session.connected_at and session.disconnected_at:
        delta = session.disconnected_at - session.connected_at
        session.duration_seconds = int(delta.total_seconds())
    await db.commit()
    await db.refresh(session)
    return session
