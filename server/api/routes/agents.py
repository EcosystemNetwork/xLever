# APIRouter groups agent endpoints; Depends injects DB; HTTPException for errors; Query validates params
from fastapi import APIRouter, Depends, HTTPException, Query
# select builds SQL queries for fetching agent runs and users
from sqlalchemy import select, func
# AsyncSession type for the injected DB session
from sqlalchemy.ext.asyncio import AsyncSession
# selectinload eagerly loads child actions in a single query to avoid N+1 problems
from sqlalchemy.orm import selectinload
# Pydantic for request validation
from pydantic import BaseModel, Field
import time
import logging

# get_db yields a scoped async DB session per request
from ..database import get_db
# ORM models for agent runs, actions, status enum, and user lookup
from ..models import AgentRun, AgentAction, AgentStatus, User
# Request/response schemas for agent run creation and serialization
from ..schemas import AgentRunCreate, AgentRunOut
# Auth dependencies — wallet session for browser, API key for external agents
from ..auth import require_auth, require_auth_or_agent, AgentIdentity

logger = logging.getLogger("xlever.agents")

# Prefix all routes with /agents; tag groups them in Swagger docs
router = APIRouter(prefix="/agents", tags=["agents"])


# ═══════════════════════════════════════════════════════════════
# SERVER-SIDE PERMISSION ENFORCEMENT
# Mirrors the client-side PERMISSIONS from agent-executor.js
# so that a compromised frontend cannot bypass policy boundaries.
# ═══════════════════════════════════════════════════════════════

PERMISSIONS = {
    "safe": {
        "canIncreaseLeverage": False,
        "canOpenNew": False,
        "canWithdraw": False,
        "canReduceLeverage": True,
        "canClose": True,
    },
    "target": {
        "canIncreaseLeverage": True,
        "canOpenNew": False,
        "canWithdraw": False,
        "canReduceLeverage": True,
        "canClose": False,
    },
    "accumulate": {
        "canIncreaseLeverage": False,
        "canOpenNew": True,
        "canWithdraw": False,
        "canReduceLeverage": False,
        "canClose": False,
    },
}

# Rate limiting: max 6 actions per minute per wallet
_action_timestamps: dict[str, list[float]] = {}
MAX_ACTIONS_PER_MINUTE = 6
MIN_ACTION_INTERVAL_SEC = 5


def _check_rate_limit(wallet: str):
    """Enforce rate limits: max 6 actions/minute, min 5s between actions."""
    now = time.time()
    timestamps = _action_timestamps.get(wallet, [])
    # Remove timestamps older than 60s
    timestamps = [t for t in timestamps if now - t < 60]
    if len(timestamps) >= MAX_ACTIONS_PER_MINUTE:
        raise HTTPException(429, f"Rate limit: max {MAX_ACTIONS_PER_MINUTE} agent actions per minute")
    if timestamps and (now - timestamps[-1]) < MIN_ACTION_INTERVAL_SEC:
        raise HTTPException(429, f"Rate limit: min {MIN_ACTION_INTERVAL_SEC}s between agent actions")
    timestamps.append(now)
    _action_timestamps[wallet] = timestamps


def _validate_action_permissions(mode: str, action_type: str, current_leverage: float | None, target_leverage: float | None):
    """
    Server-side enforcement of policy permissions.
    Raises HTTPException if the action violates the policy mode's boundaries.
    """
    perms = PERMISSIONS.get(mode)
    if not perms:
        raise HTTPException(400, f"Unknown agent mode: {mode}")

    if action_type in ("deleverage", "adjust"):
        if target_leverage is not None and current_leverage is not None:
            if target_leverage > current_leverage and not perms["canIncreaseLeverage"]:
                raise HTTPException(
                    403,
                    f"BLOCKED: leverage increase not permitted in '{mode}' mode"
                )
            if target_leverage < current_leverage and not perms["canReduceLeverage"]:
                raise HTTPException(
                    403,
                    f"BLOCKED: leverage reduction not permitted in '{mode}' mode"
                )
    elif action_type == "close":
        if not perms["canClose"]:
            raise HTTPException(403, f"BLOCKED: close not permitted in '{mode}' mode")
    elif action_type == "buy":
        if not perms["canOpenNew"]:
            raise HTTPException(403, f"BLOCKED: new positions not permitted in '{mode}' mode")
    elif action_type == "withdraw":
        if not perms["canWithdraw"]:
            raise HTTPException(403, f"BLOCKED: withdraw not permitted in '{mode}' mode")


# ═══════════════════════════════════════════════════════════════
# AGENT ACTION SCHEMAS
# ═══════════════════════════════════════════════════════════════

class AgentActionRequest(BaseModel):
    """Request schema for submitting an agent action for server-side validation and recording."""
    action_type: str = Field(pattern=r"^(deleverage|adjust|close|buy|close-partial|withdraw)$")
    asset: str | None = None
    leverage: float | None = None
    target_leverage: float | None = None
    current_leverage: float | None = None
    amount: float | None = None
    reason: str = ""
    tx_hash: str | None = None
    price_at_action: float | None = None
    dry_run: bool = True


class AgentActionResponse(BaseModel):
    """Response after validating and recording an agent action."""
    permitted: bool
    action_id: int | None = None
    message: str
    dry_run: bool


# GET /api/agents/runs/{run_id} — get a specific agent run with all its actions
# IMPORTANT: This route MUST be defined before /{wallet_address}/runs to avoid
# "runs" being captured as a wallet_address by the wildcard route below.
@router.get("/runs/{run_id}", response_model=AgentRunOut)
async def get_agent_run(run_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific agent run with all actions."""
    # Fetch the run by ID with eagerly loaded actions for the detail view
    result = await db.execute(
        select(AgentRun)
        .where(AgentRun.id == run_id)
        .options(selectinload(AgentRun.actions))
    )
    run = result.scalar_one_or_none()
    # 404 if the run doesn't exist — prevents confusing null responses
    if not run:
        raise HTTPException(404, "Agent run not found")
    return run


# POST /api/agents/{wallet_address}/runs — start a new AI agent run for a wallet
@router.post("/{wallet_address}/runs", response_model=AgentRunOut)
async def create_agent_run(
    wallet_address: str, body: AgentRunCreate, db: AsyncSession = Depends(get_db)
):
    """Start a new AI agent run."""
    # Normalize to lowercase because wallet addresses are stored in lowercase
    addr = wallet_address.lower()
    # Look up the user — agents must be tied to a registered wallet
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()
    # Require wallet registration before creating agent runs (enforces user existence)
    if not user:
        raise HTTPException(404, "User not found — connect wallet first")

    # Create the agent run record with all fields from the request body
    run = AgentRun(
        user_id=user.id,              # Link to the user's surrogate key
        wallet_address=addr,           # Denormalized for direct wallet queries
        strategy=body.strategy,        # Algorithm name from the request
        asset=body.asset.upper(),      # Normalize asset to uppercase for consistency
        config=body.config,            # Strategy parameters stored as JSONB
    )
    # Add the new run to the session for insertion
    db.add(run)
    # Persist to the database so it gets an auto-generated ID
    await db.commit()
    # Refresh to load server-generated fields (id, started_at, defaults)
    await db.refresh(run)
    # Return the newly created run — FastAPI serializes it via AgentRunOut schema
    return run


# GET /api/agents/{wallet_address}/runs — list agent runs for a wallet
@router.get("/{wallet_address}/runs", response_model=list[AgentRunOut])
async def get_agent_runs(
    wallet_address: str,
    status: AgentStatus | None = None,   # Optional filter by run status
    limit: int = Query(20, le=100),      # Page size capped at 100 to keep responses reasonable
    db: AsyncSession = Depends(get_db),
):
    """List agent runs for a wallet."""
    # Normalize to lowercase for consistent DB lookups
    addr = wallet_address.lower()
    # Build query with eager loading of actions to avoid N+1 when serializing
    query = (
        select(AgentRun)
        .where(AgentRun.wallet_address == addr)
        # selectinload fetches all actions in a second query instead of one per run
        .options(selectinload(AgentRun.actions))
        # Most recent runs first — users want to see their latest agent activity
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
    )
    # Apply optional status filter — e.g., show only running or only completed agents
    if status:
        query = query.where(AgentRun.status == status)

    # Execute and return all matching runs
    result = await db.execute(query)
    return result.scalars().all()


# POST /api/agents/runs/{run_id}/stop — manually stop a running agent
@router.post("/runs/{run_id}/stop", response_model=AgentRunOut)
async def stop_agent_run(run_id: int, db: AsyncSession = Depends(get_db)):
    """Stop a running agent."""
    # Fetch the run without eager loading — we only need to update status fields
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    # 404 if run doesn't exist
    if not run:
        raise HTTPException(404, "Agent run not found")
    # Only running agents can be stopped — prevents invalid state transitions
    if run.status != AgentStatus.RUNNING:
        raise HTTPException(400, f"Agent is {run.status}, not running")

    # Transition the agent to stopped state
    run.status = AgentStatus.STOPPED
    # Record the stop time using server-side now() for consistency
    run.ended_at = func.now()
    # Persist the status change
    await db.commit()
    # Refresh to get the server-generated ended_at timestamp value
    await db.refresh(run)
    return run


# ═══════════════════════════════════════════════════════════════
# AGENT ACTION SUBMISSION — Server-side permission enforcement
# ═══════════════════════════════════════════════════════════════


@router.post("/runs/{run_id}/actions", response_model=AgentActionResponse)
async def submit_agent_action(
    run_id: int,
    body: AgentActionRequest,
    auth: str | AgentIdentity = Depends(require_auth_or_agent),
    db: AsyncSession = Depends(get_db),
):
    """
    Validate and record an agent action with server-side permission enforcement.
    Accepts both SIWE sessions (browser) and API keys (external agents).
    """
    # Determine wallet from auth type
    is_external = isinstance(auth, AgentIdentity)
    wallet = auth.owner_wallet if is_external else auth

    # Fetch the run and verify ownership
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Agent run not found")
    if run.wallet_address != wallet:
        raise HTTPException(403, "You can only submit actions for your own agent runs")
    if run.status != AgentStatus.RUNNING:
        raise HTTPException(400, f"Agent run is {run.status}, not running — cannot submit actions")

    if is_external:
        # External agent: use scoped permissions from the agent's registration
        from .external_agents import _check_agent_rate_limit, _validate_agent_permissions
        _check_agent_rate_limit(auth.agent_id, auth.rate_limit_per_minute)
        _validate_agent_permissions(
            permissions=auth.permissions,
            action_type=body.action_type,
            current_leverage=body.current_leverage,
            target_leverage=body.target_leverage,
        )
    else:
        # Browser: use mode-based permissions from the run config
        mode = (run.config or {}).get("mode", run.strategy)
        if mode not in PERMISSIONS:
            raise HTTPException(400, f"Unknown agent mode '{mode}' — must be safe, target, or accumulate")
        _check_rate_limit(wallet)
        _validate_action_permissions(
            mode=mode,
            action_type=body.action_type,
            current_leverage=body.current_leverage,
            target_leverage=body.target_leverage,
        )

    # If dry-run, return permitted without recording
    if body.dry_run:
        return AgentActionResponse(
            permitted=True,
            action_id=None,
            message=f"Action '{body.action_type}' permitted by '{mode}' policy (dry-run)",
            dry_run=True,
        )

    # Record the action in the database
    action = AgentAction(
        run_id=run_id,
        action_type=body.action_type,
        asset=body.asset or run.asset,
        leverage=body.target_leverage or body.leverage,
        amount=body.amount,
        reason=body.reason,
        success=True,
        tx_hash=body.tx_hash,
        price_at_action=body.price_at_action,
    )
    db.add(action)

    # Update run counters
    run.total_trades = (run.total_trades or 0) + 1
    await db.commit()
    await db.refresh(action)

    logger.info(f"Agent action recorded: run={run_id} type={body.action_type} wallet={wallet[:10]}...")

    return AgentActionResponse(
        permitted=True,
        action_id=action.id,
        message=f"Action '{body.action_type}' validated and recorded",
        dry_run=False,
    )


@router.post("/runs/{run_id}/actions/{action_id}/result")
async def update_action_result(
    run_id: int,
    action_id: int,
    success: bool = True,
    tx_hash: str | None = None,
    error: str | None = None,
    pnl: float | None = None,
    auth: str | AgentIdentity = Depends(require_auth_or_agent),
    db: AsyncSession = Depends(get_db),
):
    """
    Update an action with its on-chain result (success/failure, tx hash, PnL).
    Accepts both SIWE sessions (browser) and API keys (external agents).
    """
    wallet = auth.owner_wallet if isinstance(auth, AgentIdentity) else auth

    result = await db.execute(
        select(AgentAction).where(AgentAction.id == action_id, AgentAction.run_id == run_id)
    )
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(404, "Action not found")

    # Verify ownership via the parent run
    run_result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = run_result.scalar_one_or_none()
    if not run or run.wallet_address != wallet:
        raise HTTPException(403, "Not authorized")

    action.success = success
    if tx_hash:
        action.tx_hash = tx_hash
    if error:
        action.error = error

    # Update run PnL if provided
    if pnl is not None and run:
        run.total_pnl = float(run.total_pnl or 0) + pnl

    await db.commit()
    return {"updated": True, "action_id": action_id}


# ═══════════════════════════════════════════════════════════════
# PERMISSION CHECK ENDPOINT — Pre-flight validation
# ═══════════════════════════════════════════════════════════════


class PermissionCheckRequest(BaseModel):
    mode: str = Field(pattern=r"^(safe|target|accumulate)$")
    action_type: str = Field(pattern=r"^(deleverage|adjust|close|buy|close-partial|withdraw)$")
    current_leverage: float | None = None
    target_leverage: float | None = None


@router.post("/permissions/check")
async def check_permissions(body: PermissionCheckRequest):
    """
    Pre-flight permission check without recording anything.
    Returns whether an action would be allowed under the given policy mode.
    Used by the frontend to grey out buttons and show explanations.
    """
    try:
        _validate_action_permissions(
            mode=body.mode,
            action_type=body.action_type,
            current_leverage=body.current_leverage,
            target_leverage=body.target_leverage,
        )
        return {
            "permitted": True,
            "mode": body.mode,
            "action_type": body.action_type,
            "permissions": PERMISSIONS[body.mode],
        }
    except HTTPException as e:
        return {
            "permitted": False,
            "mode": body.mode,
            "action_type": body.action_type,
            "reason": e.detail,
            "permissions": PERMISSIONS[body.mode],
        }
