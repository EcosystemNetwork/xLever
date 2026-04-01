"""
Admin analytics routes — platform-wide stats, user activity, session tracking,
system health, error logs, and debugging endpoints.
"""
import time
import logging
from collections import deque
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func, cast, Date, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import admin_api_key
from ..database import get_db, engine
from ..models import (
    User, Position, AgentRun, AgentAction, Alert, UserSession,
    PositionStatus, AgentStatus,
)
from ..schemas import (
    PlatformStats, UserDetail, SessionCreate, SessionOut,
    DailyActivity, HourlyActivity, SystemHealth, ErrorLogEntry,
    UserFullDetail, PositionOverview,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(admin_api_key)])

# ─── Server Uptime Tracking ───────────────────────────────────
_server_start_time = time.monotonic()

# ─── In-memory Error Log ──────────────────────────────────────
_error_log: deque[dict] = deque(maxlen=500)

logger = logging.getLogger("xlever.admin")


def record_error(source: str, message: str, details: str | None = None):
    """Record an error to the in-memory error log (called from middleware/handlers)."""
    _error_log.appendleft({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "message": message,
        "details": details,
    })


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
    limit: int = Query(50, ge=1, le=100),
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
    limit: int = Query(50, ge=1, le=100),
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


# ─── System Health ─────────────────────────────────────────────

@router.get("/health", response_model=SystemHealth)
async def system_health(db: AsyncSession = Depends(get_db)):
    """Comprehensive system health check — DB, RPC, uptime."""
    uptime_secs = time.monotonic() - _server_start_time
    hours = int(uptime_secs // 3600)
    minutes = int((uptime_secs % 3600) // 60)
    uptime_str = f"{hours}h {minutes}m" if hours else f"{minutes}m"

    # Database connectivity + latency
    db_status = "disconnected"
    db_latency = None
    try:
        t0 = time.monotonic()
        await db.execute(text("SELECT 1"))
        db_latency = round((time.monotonic() - t0) * 1000, 1)
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {e}"
        record_error("health", "Database check failed", str(e))

    # RPC connectivity (non-blocking check via config)
    rpc_status = "configured"
    try:
        from ..config import get_settings
        s = get_settings()
        rpc_status = "connected" if s.RPC_URL else "not configured"
    except Exception:
        rpc_status = "error"

    return SystemHealth(
        api="ok",
        database=db_status,
        rpc=rpc_status,
        uptime=uptime_str,
        uptime_seconds=round(uptime_secs, 1),
        db_latency_ms=db_latency,
    )


# ─── Error Logs ────────────────────────────────────────────────

@router.get("/errors", response_model=list[ErrorLogEntry])
async def get_error_logs(
    limit: int = Query(50, ge=1, le=500),
    source: str | None = Query(None),
):
    """Retrieve recent error log entries from in-memory buffer."""
    logs = list(_error_log)
    if source:
        logs = [l for l in logs if l["source"] == source]
    return logs[:limit]


@router.delete("/errors")
async def clear_error_logs():
    """Clear the in-memory error log."""
    count = len(_error_log)
    _error_log.clear()
    return {"cleared": count}


# ─── User Detail ───────────────────────────────────────────────

@router.get("/users/{user_id}", response_model=UserFullDetail)
async def get_user_detail(user_id: int, db: AsyncSession = Depends(get_db)):
    """Full detail view for a single user — all activity counts and PnL."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    sess_count = (await db.execute(
        select(func.count(UserSession.id)).where(UserSession.user_id == user.id)
    )).scalar() or 0
    total_pos = (await db.execute(
        select(func.count(Position.id)).where(Position.user_id == user.id)
    )).scalar() or 0
    open_pos = (await db.execute(
        select(func.count(Position.id)).where(
            Position.user_id == user.id, Position.status == PositionStatus.OPEN
        )
    )).scalar() or 0
    agent_count = (await db.execute(
        select(func.count(AgentRun.id)).where(AgentRun.user_id == user.id)
    )).scalar() or 0
    active_agents = (await db.execute(
        select(func.count(AgentRun.id)).where(
            AgentRun.user_id == user.id, AgentRun.status == AgentStatus.RUNNING
        )
    )).scalar() or 0
    alert_count = (await db.execute(
        select(func.count(Alert.id)).where(Alert.user_id == user.id)
    )).scalar() or 0
    total_pnl = (await db.execute(
        select(func.coalesce(func.sum(Position.realized_pnl), 0)).where(
            Position.user_id == user.id
        )
    )).scalar() or 0

    return UserFullDetail(
        id=user.id,
        wallet_address=user.wallet_address,
        created_at=user.created_at,
        last_seen=user.last_seen,
        preferences=user.preferences or {},
        total_sessions=sess_count,
        total_positions=total_pos,
        open_positions=open_pos,
        total_agent_runs=agent_count,
        active_agents=active_agents,
        total_alerts=alert_count,
        total_pnl=float(total_pnl),
    )


# ─── Position Overview ────────────────────────────────────────

@router.get("/positions/overview", response_model=PositionOverview)
async def position_overview(db: AsyncSession = Depends(get_db)):
    """Platform-wide position analytics — volume, PnL, leverage distribution."""
    total = (await db.execute(select(func.count(Position.id)))).scalar() or 0
    open_count = (await db.execute(
        select(func.count(Position.id)).where(Position.status == PositionStatus.OPEN)
    )).scalar() or 0

    volume = (await db.execute(
        select(func.coalesce(func.sum(Position.deposit_amount), 0))
    )).scalar() or 0
    pnl = (await db.execute(
        select(func.coalesce(func.sum(Position.realized_pnl), 0))
    )).scalar() or 0
    fees = (await db.execute(
        select(func.coalesce(func.sum(Position.fees_paid), 0))
    )).scalar() or 0
    avg_lev = (await db.execute(
        select(func.coalesce(func.avg(Position.leverage_bps), 0))
    )).scalar() or 0

    long_count = (await db.execute(
        select(func.count(Position.id)).where(Position.side == "long")
    )).scalar() or 0
    short_count = (await db.execute(
        select(func.count(Position.id)).where(Position.side == "short")
    )).scalar() or 0

    # Asset distribution
    asset_rows = (await db.execute(
        select(Position.asset, func.count(Position.id)).group_by(Position.asset)
    )).all()
    assets = {row[0]: row[1] for row in asset_rows}

    return PositionOverview(
        total_positions=total,
        open_positions=open_count,
        total_volume=float(volume),
        total_pnl=float(pnl),
        total_fees=float(fees),
        avg_leverage=round(float(avg_lev) / 10000, 2) if avg_lev else 0,
        long_count=long_count,
        short_count=short_count,
        assets=assets,
    )
