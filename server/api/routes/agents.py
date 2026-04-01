# APIRouter groups agent endpoints; Depends injects DB; HTTPException for errors; Query validates params
from fastapi import APIRouter, Depends, HTTPException, Query
# select builds SQL queries for fetching agent runs and users
from sqlalchemy import select
# AsyncSession type for the injected DB session
from sqlalchemy.ext.asyncio import AsyncSession
# selectinload eagerly loads child actions in a single query to avoid N+1 problems
from sqlalchemy.orm import selectinload

# get_db yields a scoped async DB session per request
from ..database import get_db
# ORM models for agent runs, actions, status enum, and user lookup
from ..models import AgentRun, AgentAction, AgentStatus, User
# Request/response schemas for agent run creation and serialization
from ..schemas import AgentRunCreate, AgentRunOut

# Prefix all routes with /agents; tag groups them in Swagger docs
router = APIRouter(prefix="/agents", tags=["agents"])


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

    # Import func here to avoid circular import issues at module level
    from sqlalchemy import func
    # Transition the agent to stopped state
    run.status = AgentStatus.STOPPED
    # Record the stop time using server-side now() for consistency
    run.ended_at = func.now()
    # Persist the status change
    await db.commit()
    # Refresh to get the server-generated ended_at timestamp value
    await db.refresh(run)
    return run
