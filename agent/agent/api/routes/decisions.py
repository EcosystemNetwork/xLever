"""Decision routes for xLever AI Trading Agent API."""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

router = APIRouter()


# Response Models
class DecisionResponse(BaseModel):
    """Decision details response."""

    id: str = Field(description="Decision ID")
    action: str = Field(description="Action taken: OPEN_LONG, OPEN_SHORT, CLOSE, HOLD")
    asset: str = Field(description="Asset ticker")
    leverage_bps: int = Field(description="Leverage in basis points")
    size_usdc: float = Field(description="Position size in USDC")
    confidence: int = Field(description="Confidence score 0-100")
    reasoning: str = Field(description="Decision reasoning")
    urgency: str = Field(description="Urgency level: low, medium, high, critical")

    # Rule engine results
    blocked: bool = Field(default=False, description="Whether decision was blocked")
    block_reason: Optional[str] = Field(default=None, description="Reason for blocking")
    rules_applied: List[str] = Field(default_factory=list, description="Rules that were applied")
    rules_passed: List[str] = Field(default_factory=list, description="Rules that passed")
    rules_failed: List[str] = Field(default_factory=list, description="Rules that failed")

    # HITL status
    required_approval: bool = Field(default=False, description="Whether approval was required")
    approved: Optional[bool] = Field(default=None, description="Approval status")
    approved_by: Optional[str] = Field(default=None, description="Who approved")
    approval_note: Optional[str] = Field(default=None, description="Approval note")

    # Execution status
    executed: bool = Field(default=False, description="Whether decision was executed")
    execution_tx: Optional[str] = Field(default=None, description="Execution transaction hash")
    execution_error: Optional[str] = Field(default=None, description="Execution error if failed")

    # Market context at decision time
    market_price: Optional[float] = Field(default=None, description="Market price at decision")
    market_sentiment: Optional[str] = Field(default=None, description="Market sentiment")
    health_score: Optional[float] = Field(default=None, description="Health score at decision")

    # Timestamps
    created_at: datetime = Field(description="When decision was made")
    executed_at: Optional[datetime] = Field(default=None, description="When executed")


class DecisionStats(BaseModel):
    """Decision statistics."""

    total_decisions: int = Field(description="Total decisions made")
    executed_decisions: int = Field(description="Decisions that were executed")
    blocked_decisions: int = Field(description="Decisions blocked by rules")
    approval_pending: int = Field(description="Decisions awaiting approval")
    approval_rate: float = Field(description="Approval rate percentage")
    action_breakdown: dict = Field(description="Breakdown by action type")
    rule_block_breakdown: dict = Field(description="Breakdown by blocking rule")


# Mock database for decisions (in production, use actual DB)
_decisions_db: dict = {}


def get_decisions_db():
    """Get decisions database."""
    return _decisions_db


@router.get("", response_model=List[DecisionResponse])
async def list_decisions(
    action: Optional[str] = Query(default=None, description="Filter by action: OPEN_LONG, OPEN_SHORT, CLOSE, HOLD"),
    blocked: Optional[bool] = Query(default=None, description="Filter by blocked status"),
    executed: Optional[bool] = Query(default=None, description="Filter by executed status"),
    asset: Optional[str] = Query(default=None, description="Filter by asset"),
    start_date: Optional[datetime] = Query(default=None, description="Filter from date"),
    end_date: Optional[datetime] = Query(default=None, description="Filter to date"),
    limit: int = Query(default=50, ge=1, le=100, description="Maximum results"),
    offset: int = Query(default=0, ge=0, description="Results offset"),
):
    """List recent decisions with optional filtering.

    Supports filtering by action, status, asset, and date range.
    """
    try:
        decisions = list(get_decisions_db().values())

        # Apply filters
        if action:
            decisions = [d for d in decisions if d.get("action") == action]
        if blocked is not None:
            decisions = [d for d in decisions if d.get("blocked") == blocked]
        if executed is not None:
            decisions = [d for d in decisions if d.get("executed") == executed]
        if asset:
            decisions = [d for d in decisions if d.get("asset") == asset]
        if start_date:
            decisions = [d for d in decisions if d.get("created_at", datetime.min) >= start_date]
        if end_date:
            decisions = [d for d in decisions if d.get("created_at", datetime.max) <= end_date]

        # Sort by created_at descending
        decisions.sort(key=lambda x: x.get("created_at", datetime.min), reverse=True)

        # Apply pagination
        decisions = decisions[offset : offset + limit]

        return [DecisionResponse(**d) for d in decisions]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list decisions: {str(e)}",
        )


@router.get("/stats", response_model=DecisionStats)
async def get_decision_stats(
    start_date: Optional[datetime] = Query(default=None, description="Stats from date"),
    end_date: Optional[datetime] = Query(default=None, description="Stats to date"),
):
    """Get decision statistics.

    Returns aggregated stats including action breakdown and rule blocking analysis.
    """
    try:
        decisions = list(get_decisions_db().values())

        # Apply date filters
        if start_date:
            decisions = [d for d in decisions if d.get("created_at", datetime.min) >= start_date]
        if end_date:
            decisions = [d for d in decisions if d.get("created_at", datetime.max) <= end_date]

        if not decisions:
            return DecisionStats(
                total_decisions=0,
                executed_decisions=0,
                blocked_decisions=0,
                approval_pending=0,
                approval_rate=0.0,
                action_breakdown={},
                rule_block_breakdown={},
            )

        executed = [d for d in decisions if d.get("executed")]
        blocked = [d for d in decisions if d.get("blocked")]
        required_approval = [d for d in decisions if d.get("required_approval")]
        approved = [d for d in required_approval if d.get("approved")]
        pending = [d for d in required_approval if d.get("approved") is None]

        # Action breakdown
        action_counts = {}
        for d in decisions:
            action = d.get("action", "UNKNOWN")
            action_counts[action] = action_counts.get(action, 0) + 1

        # Rule block breakdown
        rule_block_counts = {}
        for d in blocked:
            for rule in d.get("rules_failed", []):
                rule_block_counts[rule] = rule_block_counts.get(rule, 0) + 1

        return DecisionStats(
            total_decisions=len(decisions),
            executed_decisions=len(executed),
            blocked_decisions=len(blocked),
            approval_pending=len(pending),
            approval_rate=(len(approved) / len(required_approval) * 100) if required_approval else 100.0,
            action_breakdown=action_counts,
            rule_block_breakdown=rule_block_counts,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get stats: {str(e)}",
        )


@router.get("/recent", response_model=List[DecisionResponse])
async def get_recent_decisions(
    limit: int = Query(default=10, ge=1, le=50, description="Number of recent decisions"),
):
    """Get the most recent decisions.

    Quick endpoint for dashboard display.
    """
    try:
        decisions = list(get_decisions_db().values())
        decisions.sort(key=lambda x: x.get("created_at", datetime.min), reverse=True)
        decisions = decisions[:limit]

        return [DecisionResponse(**d) for d in decisions]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get recent decisions: {str(e)}",
        )


@router.get("/{decision_id}", response_model=DecisionResponse)
async def get_decision(decision_id: str):
    """Get details of a specific decision.

    Returns full decision information including rule results and execution status.
    """
    decisions_db = get_decisions_db()

    if decision_id not in decisions_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Decision {decision_id} not found",
        )

    try:
        return DecisionResponse(**decisions_db[decision_id])
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get decision: {str(e)}",
        )


@router.get("/{decision_id}/rules")
async def get_decision_rules(decision_id: str):
    """Get detailed rule evaluation results for a decision.

    Shows which rules passed, failed, and why.
    """
    decisions_db = get_decisions_db()

    if decision_id not in decisions_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Decision {decision_id} not found",
        )

    decision = decisions_db[decision_id]

    return {
        "decision_id": decision_id,
        "rules_applied": decision.get("rules_applied", []),
        "rules_passed": decision.get("rules_passed", []),
        "rules_failed": decision.get("rules_failed", []),
        "blocked": decision.get("blocked", False),
        "block_reason": decision.get("block_reason"),
        "rule_details": decision.get("rule_details", {}),
    }
