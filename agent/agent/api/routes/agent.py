"""Agent control routes for xLever AI Trading Agent API."""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

router = APIRouter()


# Request/Response Models
class AgentStatus(BaseModel):
    """Agent status response."""

    running: bool = Field(description="Whether agent is running")
    mode: str = Field(description="Current HITL mode")
    paper_mode: bool = Field(description="Whether in paper trading mode")
    uptime_seconds: float = Field(description="Time since agent started")
    last_decision_at: Optional[datetime] = Field(default=None, description="Last decision timestamp")
    current_position: Optional[str] = Field(default=None, description="Current position if any")
    health_score: Optional[float] = Field(default=None, description="Current health score")
    total_decisions: int = Field(default=0, description="Total decisions made")
    total_trades: int = Field(default=0, description="Total trades executed")


class SetModeRequest(BaseModel):
    """Request to set HITL mode."""

    mode: str = Field(description="HITL mode: autonomous, approval_required, approval_above_threshold, notifications_only")
    threshold_usdc: Optional[float] = Field(default=None, description="Threshold for approval_above_threshold mode")


class PendingDecision(BaseModel):
    """Pending decision awaiting approval."""

    id: str = Field(description="Decision ID")
    action: str = Field(description="Proposed action")
    asset: str = Field(description="Asset ticker")
    leverage_bps: int = Field(description="Leverage in basis points")
    size_usdc: float = Field(description="Position size in USDC")
    confidence: int = Field(description="Confidence 0-100")
    reasoning: str = Field(description="Decision reasoning")
    urgency: str = Field(description="Urgency level")
    created_at: datetime = Field(description="When decision was created")
    timeout_at: datetime = Field(description="When decision times out")


class ApprovalRequest(BaseModel):
    """Request to approve or modify a decision."""

    approved: bool = Field(description="Whether to approve")
    modified_leverage_bps: Optional[int] = Field(default=None, description="Modified leverage if any")
    modified_size_usdc: Optional[float] = Field(default=None, description="Modified size if any")
    note: Optional[str] = Field(default=None, description="Approval note")


class RejectionRequest(BaseModel):
    """Request to reject a decision."""

    reason: str = Field(description="Rejection reason")


# Global agent instance (set by server startup)
_agent = None


def set_agent(agent):
    """Set the global agent instance."""
    global _agent
    _agent = agent


def get_agent():
    """Get the global agent instance."""
    if _agent is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Agent not initialized",
        )
    return _agent


@router.get("/status", response_model=AgentStatus)
async def get_status():
    """Get current agent status and health.

    Returns comprehensive status including:
    - Running state and mode
    - Paper trading status
    - Health metrics
    - Decision/trade counts
    """
    try:
        agent = get_agent()

        return AgentStatus(
            running=agent.running,
            mode=agent.hitl.mode.value if hasattr(agent, 'hitl') else "unknown",
            paper_mode=agent.paper_mode,
            uptime_seconds=(datetime.now() - agent.start_time).total_seconds() if hasattr(agent, 'start_time') else 0,
            last_decision_at=agent.last_decision_at if hasattr(agent, 'last_decision_at') else None,
            current_position=str(agent.current_position) if hasattr(agent, 'current_position') and agent.current_position else None,
            health_score=agent.last_health_score if hasattr(agent, 'last_health_score') else None,
            total_decisions=agent.total_decisions if hasattr(agent, 'total_decisions') else 0,
            total_trades=agent.total_trades if hasattr(agent, 'total_trades') else 0,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get status: {str(e)}",
        )


@router.post("/mode", response_model=AgentStatus)
async def set_mode(request: SetModeRequest):
    """Set the HITL (Human-in-the-Loop) mode.

    Available modes:
    - autonomous: Agent trades without approval
    - approval_required: All trades need approval
    - approval_above_threshold: Trades above threshold need approval
    - notifications_only: Agent notifies but doesn't trade
    """
    agent = get_agent()

    valid_modes = ["autonomous", "approval_required", "approval_above_threshold", "notifications_only"]
    if request.mode not in valid_modes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid mode. Must be one of: {valid_modes}",
        )

    try:
        from agent.hitl.controller import HITLMode
        agent.hitl.mode = HITLMode(request.mode)

        if request.threshold_usdc is not None:
            agent.hitl.threshold_usdc = request.threshold_usdc

        return await get_status()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to set mode: {str(e)}",
        )


@router.get("/pending", response_model=List[PendingDecision])
async def get_pending_decisions():
    """List all pending decisions awaiting approval.

    Returns decisions that require human approval based on current HITL mode.
    """
    agent = get_agent()

    try:
        pending = []
        for decision_id, pending_decision in agent.hitl.pending.items():
            pending.append(PendingDecision(
                id=decision_id,
                action=pending_decision.decision.action,
                asset=pending_decision.decision.asset if hasattr(pending_decision.decision, 'asset') else "unknown",
                leverage_bps=pending_decision.decision.leverage_bps,
                size_usdc=pending_decision.decision.size_usdc,
                confidence=pending_decision.decision.confidence,
                reasoning=pending_decision.decision.reasoning,
                urgency=pending_decision.urgency.value,
                created_at=pending_decision.created_at,
                timeout_at=pending_decision.timeout_at,
            ))

        return pending
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get pending decisions: {str(e)}",
        )


@router.post("/approve/{decision_id}")
async def approve_decision(decision_id: str, request: ApprovalRequest):
    """Approve a pending decision.

    Optionally modify leverage or size before approval.
    """
    agent = get_agent()

    if decision_id not in agent.hitl.pending:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Decision {decision_id} not found or already processed",
        )

    try:
        if request.approved:
            # Apply modifications if any
            if request.modified_leverage_bps is not None:
                agent.hitl.pending[decision_id].decision.leverage_bps = request.modified_leverage_bps
            if request.modified_size_usdc is not None:
                agent.hitl.pending[decision_id].decision.size_usdc = request.modified_size_usdc

            success = agent.hitl.approve(decision_id)
        else:
            success = agent.hitl.reject(decision_id, request.note or "Rejected via API")

        return {"success": success, "decision_id": decision_id, "approved": request.approved}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process approval: {str(e)}",
        )


@router.post("/reject/{decision_id}")
async def reject_decision(decision_id: str, request: RejectionRequest):
    """Reject a pending decision.

    Requires a reason for rejection.
    """
    agent = get_agent()

    if decision_id not in agent.hitl.pending:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Decision {decision_id} not found or already processed",
        )

    try:
        success = agent.hitl.reject(decision_id, request.reason)
        return {"success": success, "decision_id": decision_id, "reason": request.reason}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reject decision: {str(e)}",
        )


@router.post("/start")
async def start_agent():
    """Start the trading agent."""
    agent = get_agent()

    if agent.running:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Agent is already running",
        )

    try:
        import asyncio
        asyncio.create_task(agent.run())
        return {"success": True, "message": "Agent started"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start agent: {str(e)}",
        )


@router.post("/stop")
async def stop_agent():
    """Stop the trading agent gracefully."""
    agent = get_agent()

    if not agent.running:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Agent is not running",
        )

    try:
        await agent.shutdown()
        return {"success": True, "message": "Agent stopped"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stop agent: {str(e)}",
        )
