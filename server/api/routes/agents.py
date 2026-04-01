from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import AgentRun, AgentAction, AgentStatus, User
from ..schemas import AgentRunCreate, AgentRunOut

router = APIRouter(prefix="/agents", tags=["agents"])


@router.post("/{wallet_address}/runs", response_model=AgentRunOut)
async def create_agent_run(
    wallet_address: str, body: AgentRunCreate, db: AsyncSession = Depends(get_db)
):
    """Start a new AI agent run."""
    addr = wallet_address.lower()
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found — connect wallet first")

    run = AgentRun(
        user_id=user.id,
        wallet_address=addr,
        strategy=body.strategy,
        asset=body.asset.upper(),
        config=body.config,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


@router.get("/{wallet_address}/runs", response_model=list[AgentRunOut])
async def get_agent_runs(
    wallet_address: str,
    status: AgentStatus | None = None,
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List agent runs for a wallet."""
    addr = wallet_address.lower()
    query = (
        select(AgentRun)
        .where(AgentRun.wallet_address == addr)
        .options(selectinload(AgentRun.actions))
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
    )
    if status:
        query = query.where(AgentRun.status == status)

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/runs/{run_id}", response_model=AgentRunOut)
async def get_agent_run(run_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific agent run with all actions."""
    result = await db.execute(
        select(AgentRun)
        .where(AgentRun.id == run_id)
        .options(selectinload(AgentRun.actions))
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Agent run not found")
    return run


@router.post("/runs/{run_id}/stop", response_model=AgentRunOut)
async def stop_agent_run(run_id: int, db: AsyncSession = Depends(get_db)):
    """Stop a running agent."""
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Agent run not found")
    if run.status != AgentStatus.RUNNING:
        raise HTTPException(400, f"Agent is {run.status}, not running")

    from sqlalchemy import func
    run.status = AgentStatus.STOPPED
    run.ended_at = func.now()
    await db.commit()
    await db.refresh(run)
    return run
