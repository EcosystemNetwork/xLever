"""
External Agent API — registration, management, and trade execution for AI agents.

External agents (OpenClaw, AutoGPT, custom bots) authenticate via API key
and can submit trade actions on behalf of the wallet that registered them.
"""
import time
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    ExternalAgent, AgentRun, AgentAction, AgentStatus, AgentSource, User,
)
from ..schemas import (
    ExternalAgentCreate, ExternalAgentOut, ExternalAgentRegisterResponse,
    ExternalAgentUpdate, ExecuteActionRequest, ExecuteActionResponse,
    AgentRunOut,
)
from ..auth import (
    require_auth, require_agent_auth, AgentIdentity,
    generate_api_key, hash_api_key,
)
from ..webhooks import fire_webhook

logger = logging.getLogger("xlever.external_agents")

router = APIRouter(prefix="/external-agents", tags=["external-agents"])

# Per-agent rate limiting (in-memory, same pattern as agents.py)
_agent_action_timestamps: dict[int, list[float]] = {}


def _check_agent_rate_limit(agent_id: int, limit_per_minute: int):
    """Enforce per-agent rate limits."""
    now = time.time()
    timestamps = _agent_action_timestamps.get(agent_id, [])
    timestamps = [t for t in timestamps if now - t < 60]
    if len(timestamps) >= limit_per_minute:
        raise HTTPException(429, f"Rate limit: max {limit_per_minute} actions/minute for this agent")
    timestamps.append(now)
    _agent_action_timestamps[agent_id] = timestamps


def _validate_agent_permissions(
    permissions: dict,
    action_type: str,
    current_leverage: float | None,
    target_leverage: float | None,
):
    """Validate an action against the agent's scoped permissions."""
    if action_type in ("deleverage", "adjust"):
        if target_leverage is not None and current_leverage is not None:
            if target_leverage > current_leverage and not permissions.get("canIncreaseLeverage"):
                raise HTTPException(403, "BLOCKED: leverage increase not permitted for this agent")
            if target_leverage < current_leverage and not permissions.get("canReduceLeverage"):
                raise HTTPException(403, "BLOCKED: leverage reduction not permitted for this agent")
    elif action_type in ("close", "close-partial"):
        if not permissions.get("canClose"):
            raise HTTPException(403, "BLOCKED: close not permitted for this agent")
    elif action_type == "buy":
        if not permissions.get("canOpenNew"):
            raise HTTPException(403, "BLOCKED: new positions not permitted for this agent")
    elif action_type == "withdraw":
        if not permissions.get("canWithdraw"):
            raise HTTPException(403, "BLOCKED: withdraw not permitted for this agent")


# ═══════════════════════════════════════════════════════════════
# REGISTRATION (requires SIWE — wallet owner registers agents)
# ═══════════════════════════════════════════════════════════════


@router.post("/register", response_model=ExternalAgentRegisterResponse)
async def register_agent(
    body: ExternalAgentCreate,
    wallet: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Register a new external agent. Returns the API key exactly once.
    Only the wallet owner can register agents for their wallet.
    """
    # Look up the user
    result = await db.execute(select(User).where(User.wallet_address == wallet))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found — connect wallet first")

    # Generate API key
    plaintext_key, key_hash = generate_api_key()

    # Generate webhook secret if webhook_url is provided
    import secrets as _secrets
    webhook_secret = _secrets.token_urlsafe(32) if body.webhook_url else None

    agent = ExternalAgent(
        api_key_hash=key_hash,
        name=body.name,
        owner_wallet=wallet,
        owner_id=user.id,
        permissions=body.permissions,
        allowed_assets=[a.upper() for a in body.allowed_assets],
        webhook_url=body.webhook_url,
        webhook_secret=webhook_secret,
        rate_limit_per_minute=body.rate_limit_per_minute,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    logger.info(f"External agent registered: id={agent.id} name={body.name} wallet={wallet[:10]}...")

    return ExternalAgentRegisterResponse(
        agent_id=agent.id,
        api_key=plaintext_key,
        name=agent.name,
    )


@router.get("/", response_model=list[ExternalAgentOut])
async def list_agents(
    wallet: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List all external agents registered by the authenticated wallet."""
    result = await db.execute(
        select(ExternalAgent)
        .where(ExternalAgent.owner_wallet == wallet)
        .order_by(ExternalAgent.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{agent_id}", response_model=ExternalAgentOut)
async def get_agent(
    agent_id: int,
    wallet: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific external agent. Must be the owner."""
    result = await db.execute(
        select(ExternalAgent).where(ExternalAgent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.owner_wallet != wallet:
        raise HTTPException(403, "Not your agent")
    return agent


@router.patch("/{agent_id}", response_model=ExternalAgentOut)
async def update_agent(
    agent_id: int,
    body: ExternalAgentUpdate,
    wallet: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Update an external agent's config. Must be the owner."""
    result = await db.execute(
        select(ExternalAgent).where(ExternalAgent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.owner_wallet != wallet:
        raise HTTPException(403, "Not your agent")

    if body.name is not None:
        agent.name = body.name
    if body.permissions is not None:
        agent.permissions = body.permissions
    if body.allowed_assets is not None:
        agent.allowed_assets = [a.upper() for a in body.allowed_assets]
    if body.webhook_url is not None:
        agent.webhook_url = body.webhook_url
    if body.rate_limit_per_minute is not None:
        agent.rate_limit_per_minute = body.rate_limit_per_minute
    if body.is_active is not None:
        agent.is_active = body.is_active

    await db.commit()
    await db.refresh(agent)
    return agent


@router.delete("/{agent_id}")
async def deactivate_agent(
    agent_id: int,
    wallet: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Deactivate an external agent (soft delete). Must be the owner."""
    result = await db.execute(
        select(ExternalAgent).where(ExternalAgent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.owner_wallet != wallet:
        raise HTTPException(403, "Not your agent")

    agent.is_active = False
    await db.commit()
    return {"deactivated": True, "agent_id": agent_id}


@router.post("/{agent_id}/rotate-key")
async def rotate_api_key(
    agent_id: int,
    wallet: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Rotate an agent's API key. Returns the new key exactly once."""
    result = await db.execute(
        select(ExternalAgent).where(ExternalAgent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.owner_wallet != wallet:
        raise HTTPException(403, "Not your agent")

    plaintext_key, key_hash = generate_api_key()
    agent.api_key_hash = key_hash
    await db.commit()

    return {"agent_id": agent_id, "api_key": plaintext_key}


# ═══════════════════════════════════════════════════════════════
# EXECUTION (requires API key — external agents submit actions)
# ═══════════════════════════════════════════════════════════════


@router.post("/execute", response_model=ExecuteActionResponse)
async def execute_action(
    body: ExecuteActionRequest,
    agent: AgentIdentity = Depends(require_agent_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Submit a trade action as an external agent.
    Combines run management + action submission into one call.

    The server validates permissions and records the action.
    The agent (or relayer) is responsible for on-chain execution.
    """
    asset = body.asset.upper()

    # Check asset whitelist
    if agent.allowed_assets and asset not in agent.allowed_assets:
        raise HTTPException(
            403,
            f"Asset {asset} not in allowed list: {agent.allowed_assets}"
        )

    # Enforce rate limit
    _check_agent_rate_limit(agent.agent_id, agent.rate_limit_per_minute)

    # Validate permissions
    _validate_agent_permissions(
        permissions=agent.permissions,
        action_type=body.action_type,
        current_leverage=body.current_leverage,
        target_leverage=body.target_leverage,
    )

    # Find or create a running AgentRun for this agent + asset
    result = await db.execute(
        select(AgentRun).where(
            AgentRun.external_agent_id == agent.agent_id,
            AgentRun.asset == asset,
            AgentRun.status == AgentStatus.RUNNING,
        )
    )
    run = result.scalar_one_or_none()

    if not run:
        # Look up the owner user
        user_result = await db.execute(
            select(User).where(User.wallet_address == agent.owner_wallet)
        )
        user = user_result.scalar_one_or_none()
        if not user:
            raise HTTPException(404, "Agent owner wallet not registered")

        run = AgentRun(
            user_id=user.id,
            wallet_address=agent.owner_wallet,
            strategy="external",
            asset=asset,
            config={"agent_name": agent.name, "agent_id": agent.agent_id},
            external_agent_id=agent.agent_id,
            source=AgentSource.EXTERNAL,
        )
        db.add(run)
        await db.flush()  # get the run ID without committing

    # Record the action
    action = AgentAction(
        run_id=run.id,
        action_type=body.action_type,
        asset=asset,
        leverage=body.target_leverage or body.leverage,
        amount=body.amount,
        reason=body.reason,
        success=True,
        tx_hash=body.tx_hash,
        price_at_action=body.price_at_action,
    )
    db.add(action)
    run.total_trades = (run.total_trades or 0) + 1

    await db.commit()
    await db.refresh(action)
    await db.refresh(run)

    logger.info(
        f"External agent action: agent={agent.name} run={run.id} "
        f"type={body.action_type} asset={asset}"
    )

    # Fire webhook notification
    agent_result = await db.execute(
        select(ExternalAgent).where(ExternalAgent.id == agent.agent_id)
    )
    agent_obj = agent_result.scalar_one_or_none()
    if agent_obj and agent_obj.webhook_url:
        fire_webhook(db, agent_obj, "action_recorded", {
            "run_id": run.id,
            "action_id": action.id,
            "action_type": body.action_type,
            "asset": asset,
            "tx_hash": body.tx_hash,
        })

    return ExecuteActionResponse(
        permitted=True,
        action_id=action.id,
        run_id=run.id,
        message=f"Action '{body.action_type}' on {asset} validated and recorded",
    )


@router.get("/runs", response_model=list[AgentRunOut])
async def list_agent_runs(
    agent: AgentIdentity = Depends(require_agent_auth),
    status: AgentStatus | None = None,
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List runs created by this external agent."""
    query = (
        select(AgentRun)
        .where(AgentRun.external_agent_id == agent.agent_id)
        .options(selectinload(AgentRun.actions))
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
    )
    if status:
        query = query.where(AgentRun.status == status)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/permissions/check")
async def check_agent_permissions(
    body: ExecuteActionRequest,
    agent: AgentIdentity = Depends(require_agent_auth),
):
    """Pre-flight permission check for an external agent (no recording)."""
    asset = body.asset.upper()

    # Check asset whitelist
    if agent.allowed_assets and asset not in agent.allowed_assets:
        return {
            "permitted": False,
            "reason": f"Asset {asset} not in allowed list: {agent.allowed_assets}",
            "permissions": agent.permissions,
        }

    try:
        _validate_agent_permissions(
            permissions=agent.permissions,
            action_type=body.action_type,
            current_leverage=body.current_leverage,
            target_leverage=body.target_leverage,
        )
        return {
            "permitted": True,
            "agent": agent.name,
            "action_type": body.action_type,
            "asset": asset,
            "permissions": agent.permissions,
        }
    except HTTPException as e:
        return {
            "permitted": False,
            "reason": e.detail,
            "permissions": agent.permissions,
        }
