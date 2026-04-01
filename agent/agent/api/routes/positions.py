"""Position routes for xLever AI Trading Agent API."""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

router = APIRouter()


# Response Models
class PositionResponse(BaseModel):
    """Position details response."""

    id: str = Field(description="Position ID")
    asset: str = Field(description="Asset ticker (wSPYx, wQQQx)")
    direction: str = Field(description="Position direction (long, short)")
    leverage_bps: int = Field(description="Leverage in basis points")
    size_usdc: float = Field(description="Position size in USDC")
    entry_price: float = Field(description="Entry price")
    current_price: Optional[float] = Field(default=None, description="Current market price")
    unrealized_pnl: Optional[float] = Field(default=None, description="Unrealized P&L in USDC")
    unrealized_pnl_pct: Optional[float] = Field(default=None, description="Unrealized P&L percentage")
    health_score: Optional[float] = Field(default=None, description="Position health score")
    status: str = Field(description="Position status (open, closed, liquidated)")
    opened_at: datetime = Field(description="When position was opened")
    closed_at: Optional[datetime] = Field(default=None, description="When position was closed")
    realized_pnl: Optional[float] = Field(default=None, description="Realized P&L if closed")
    tx_hash: Optional[str] = Field(default=None, description="Opening transaction hash")
    close_tx_hash: Optional[str] = Field(default=None, description="Closing transaction hash")


class PositionSummary(BaseModel):
    """Summary of all positions."""

    total_positions: int = Field(description="Total positions (open + closed)")
    active_positions: int = Field(description="Currently open positions")
    total_pnl: float = Field(description="Total realized P&L")
    unrealized_pnl: float = Field(description="Total unrealized P&L")
    win_rate: float = Field(description="Win rate percentage")
    avg_leverage: float = Field(description="Average leverage used")


# Mock database for positions (in production, use actual DB)
_positions_db: dict = {}


def get_positions_db():
    """Get positions database."""
    return _positions_db


@router.get("", response_model=List[PositionResponse])
async def list_positions(
    status: Optional[str] = Query(default=None, description="Filter by status: open, closed, liquidated"),
    asset: Optional[str] = Query(default=None, description="Filter by asset: wSPYx, wQQQx"),
    limit: int = Query(default=50, ge=1, le=100, description="Maximum results"),
    offset: int = Query(default=0, ge=0, description="Results offset"),
):
    """List all positions with optional filtering.

    Supports filtering by status and asset, with pagination.
    """
    try:
        positions = list(get_positions_db().values())

        # Apply filters
        if status:
            positions = [p for p in positions if p.get("status") == status]
        if asset:
            positions = [p for p in positions if p.get("asset") == asset]

        # Sort by opened_at descending
        positions.sort(key=lambda x: x.get("opened_at", datetime.min), reverse=True)

        # Apply pagination
        positions = positions[offset : offset + limit]

        return [PositionResponse(**p) for p in positions]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list positions: {str(e)}",
        )


@router.get("/active", response_model=List[PositionResponse])
async def list_active_positions():
    """List all currently active (open) positions.

    Returns only positions with status='open'.
    """
    try:
        positions = [
            PositionResponse(**p)
            for p in get_positions_db().values()
            if p.get("status") == "open"
        ]

        # Sort by unrealized PnL descending
        positions.sort(key=lambda x: x.unrealized_pnl or 0, reverse=True)

        return positions
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list active positions: {str(e)}",
        )


@router.get("/summary", response_model=PositionSummary)
async def get_positions_summary():
    """Get summary statistics for all positions.

    Includes totals, P&L, win rate, and average leverage.
    """
    try:
        positions = list(get_positions_db().values())

        if not positions:
            return PositionSummary(
                total_positions=0,
                active_positions=0,
                total_pnl=0.0,
                unrealized_pnl=0.0,
                win_rate=0.0,
                avg_leverage=0.0,
            )

        active = [p for p in positions if p.get("status") == "open"]
        closed = [p for p in positions if p.get("status") in ("closed", "liquidated")]

        total_realized_pnl = sum(p.get("realized_pnl", 0) or 0 for p in closed)
        total_unrealized_pnl = sum(p.get("unrealized_pnl", 0) or 0 for p in active)

        wins = len([p for p in closed if (p.get("realized_pnl") or 0) > 0])
        win_rate = (wins / len(closed) * 100) if closed else 0.0

        avg_leverage = (
            sum(p.get("leverage_bps", 0) for p in positions) / len(positions) / 10000
            if positions else 0.0
        )

        return PositionSummary(
            total_positions=len(positions),
            active_positions=len(active),
            total_pnl=total_realized_pnl,
            unrealized_pnl=total_unrealized_pnl,
            win_rate=win_rate,
            avg_leverage=avg_leverage,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get summary: {str(e)}",
        )


@router.get("/{position_id}", response_model=PositionResponse)
async def get_position(position_id: str):
    """Get details of a specific position.

    Returns full position information including current P&L.
    """
    positions_db = get_positions_db()

    if position_id not in positions_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Position {position_id} not found",
        )

    try:
        return PositionResponse(**positions_db[position_id])
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get position: {str(e)}",
        )


@router.get("/{position_id}/history")
async def get_position_history(position_id: str):
    """Get historical data for a position.

    Returns price history, P&L over time, and events.
    """
    positions_db = get_positions_db()

    if position_id not in positions_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Position {position_id} not found",
        )

    # In production, this would fetch from time-series database
    return {
        "position_id": position_id,
        "price_history": [],
        "pnl_history": [],
        "events": [],
    }
