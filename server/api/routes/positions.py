from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Position, PositionStatus
from ..schemas import PositionOut, PositionHistory

router = APIRouter(prefix="/positions", tags=["positions"])


@router.get("/{wallet_address}", response_model=PositionHistory)
async def get_positions(
    wallet_address: str,
    status: PositionStatus | None = None,
    asset: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Get positions for a wallet, optionally filtered by status and asset."""
    addr = wallet_address.lower()
    query = select(Position).where(Position.wallet_address == addr)

    if status:
        query = query.where(Position.status == status)
    if asset:
        query = query.where(Position.asset == asset.upper())

    # Count total
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    # Fetch page
    query = query.order_by(Position.opened_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    positions = result.scalars().all()

    return PositionHistory(total=total, positions=positions)


@router.get("/{wallet_address}/active", response_model=list[PositionOut])
async def get_active_positions(wallet_address: str, db: AsyncSession = Depends(get_db)):
    """Get all open positions for a wallet."""
    addr = wallet_address.lower()
    result = await db.execute(
        select(Position)
        .where(Position.wallet_address == addr, Position.status == PositionStatus.OPEN)
        .order_by(Position.opened_at.desc())
    )
    return result.scalars().all()


@router.get("/stats/{wallet_address}")
async def get_position_stats(wallet_address: str, db: AsyncSession = Depends(get_db)):
    """Aggregate stats for a wallet's position history."""
    addr = wallet_address.lower()
    result = await db.execute(
        select(
            func.count(Position.id).label("total_positions"),
            func.sum(Position.realized_pnl).label("total_pnl"),
            func.sum(Position.fees_paid).label("total_fees"),
            func.count(Position.id).filter(Position.status == PositionStatus.OPEN).label("open_count"),
        ).where(Position.wallet_address == addr)
    )
    row = result.one()
    return {
        "total_positions": row.total_positions or 0,
        "total_pnl": float(row.total_pnl or 0),
        "total_fees": float(row.total_fees or 0),
        "open_count": row.open_count or 0,
    }
