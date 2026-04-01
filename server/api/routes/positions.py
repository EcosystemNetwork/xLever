# APIRouter groups position endpoints; Depends injects dependencies; HTTPException for errors
# Query provides parameter validation (max limit, min offset) directly in the function signature
from fastapi import APIRouter, Depends, HTTPException, Query
# select builds queries; func provides SQL aggregates (count, sum) for the stats endpoint
from sqlalchemy import select, func
# AsyncSession type for the injected DB session
from sqlalchemy.ext.asyncio import AsyncSession

# get_db yields a scoped async DB session per request
from ..database import get_db
# Wallet address format validation and SIWE session auth
from ..auth import validate_wallet_address, require_auth, require_wallet_owner
# Position ORM model and PositionStatus enum for filtering queries
from ..models import Position, PositionStatus
# Response schemas that control what fields are serialized to the client
from ..schemas import PositionOut, PositionHistory

# Prefix all routes with /positions; tag groups them in Swagger docs
router = APIRouter(prefix="/positions", tags=["positions"])


# GET /api/positions/{wallet_address} — paginated position history for a wallet
@router.get("/{wallet_address}", response_model=PositionHistory)
async def get_positions(
    wallet_address: str,                    # Ethereum address from the URL path
    status: PositionStatus | None = None,   # Optional filter by position lifecycle state
    asset: str | None = None,               # Optional filter by asset ticker
    limit: int = Query(50, le=200),         # Page size capped at 200 to prevent huge queries
    offset: int = Query(0, ge=0),           # Pagination offset must be non-negative
    db: AsyncSession = Depends(get_db),     # Injected DB session
    authenticated_wallet: str = Depends(require_auth),  # SIWE session required
):
    """Get positions for a wallet, optionally filtered by status and asset."""
    # Verify the caller owns the requested wallet address
    addr = require_wallet_owner(wallet_address, authenticated_wallet)
    # Base query filters by wallet address — all positions belong to a specific wallet
    query = select(Position).where(Position.wallet_address == addr)

    # Apply optional status filter — e.g., show only open or only closed positions
    if status:
        query = query.where(Position.status == status)
    # Apply optional asset filter — uppercase to match stored format (QQQ not qqq)
    if asset:
        query = query.where(Position.asset == asset.upper())

    # Count total matching rows before pagination — needed for frontend page count display
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    # Apply sorting (newest first) and pagination to the actual data query
    query = query.order_by(Position.opened_at.desc()).offset(offset).limit(limit)
    # Execute the paginated query
    result = await db.execute(query)
    # Extract ORM objects from the result rows
    positions = result.scalars().all()

    # Return both the total count and the current page of positions
    return PositionHistory(total=total, positions=positions)


# GET /api/positions/{wallet_address}/active — shortcut for open positions only
@router.get("/{wallet_address}/active", response_model=list[PositionOut])
async def get_active_positions(
    wallet_address: str,
    db: AsyncSession = Depends(get_db),
    authenticated_wallet: str = Depends(require_auth),
):
    """Get all open positions for a wallet."""
    addr = require_wallet_owner(wallet_address, authenticated_wallet)
    # Query only open positions sorted by newest first — the dashboard's primary view
    result = await db.execute(
        select(Position)
        .where(Position.wallet_address == addr, Position.status == PositionStatus.OPEN)
        .order_by(Position.opened_at.desc())
    )
    # Return the list of open positions directly (no pagination needed — open positions are few)
    return result.scalars().all()


# GET /api/positions/stats/{wallet_address} — aggregate PnL and fee statistics
@router.get("/stats/{wallet_address}")
async def get_position_stats(
    wallet_address: str,
    db: AsyncSession = Depends(get_db),
    authenticated_wallet: str = Depends(require_auth),
):
    """Aggregate stats for a wallet's position history."""
    addr = require_wallet_owner(wallet_address, authenticated_wallet)
    # Single query computes all aggregates — avoids multiple round trips to the database
    result = await db.execute(
        select(
            # Total number of positions ever opened by this wallet
            func.count(Position.id).label("total_positions"),
            # Sum of all realized PnL — shows overall profitability
            func.sum(Position.realized_pnl).label("total_pnl"),
            # Sum of all fees paid — important for true cost accounting
            func.sum(Position.fees_paid).label("total_fees"),
            # Count of currently open positions — filtered aggregate using .filter()
            func.count(Position.id).filter(Position.status == PositionStatus.OPEN).label("open_count"),
        ).where(Position.wallet_address == addr)
    )
    # one() is safe here because aggregate queries always return exactly one row
    row = result.one()
    # Convert to dict with null-safe defaults — sum() returns None if no rows match
    return {
        "total_positions": row.total_positions or 0,
        "total_pnl": float(row.total_pnl or 0),
        "total_fees": float(row.total_fees or 0),
        "open_count": row.open_count or 0,
    }
