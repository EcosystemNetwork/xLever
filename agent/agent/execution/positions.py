"""Position manager for tracking and updating trading positions."""

import asyncio
from typing import Optional, List
from datetime import datetime
from sqlalchemy import select, and_
from loguru import logger

from agent.models.base import get_session
from agent.models.position import Position, PositionStatus, PositionDirection


class PositionManager:
    """Manages active trading positions with database persistence.

    Provides methods for:
    - Opening new positions
    - Tracking active positions
    - Calculating PnL (unrealized and realized)
    - Updating position state after transactions
    - Closing positions
    - Handling partial fills defensively
    """

    def __init__(self):
        """Initialize position manager."""
        logger.info("Position manager initialized")

    async def get_active_position(self, asset: str) -> Optional[Position]:
        """Get the currently active position for an asset.

        Args:
            asset: Asset ticker (wSPYx, wQQQx)

        Returns:
            Active position or None if no position open
        """
        async for session in get_session():
            result = await session.execute(
                select(Position).where(
                    and_(
                        Position.asset == asset,
                        Position.status == PositionStatus.OPEN
                    )
                ).limit(1)
            )
            position = result.scalar_one_or_none()

            if position:
                logger.debug(f"Found active position for {asset}: {position.id}")
            else:
                logger.debug(f"No active position for {asset}")

            return position

    async def get_all_active_positions(self) -> List[Position]:
        """Get all currently active positions.

        Returns:
            List of active positions
        """
        async for session in get_session():
            result = await session.execute(
                select(Position).where(Position.status == PositionStatus.OPEN)
            )
            positions = list(result.scalars().all())

            logger.debug(f"Found {len(positions)} active positions")
            return positions

    async def open_position(
        self,
        asset: str,
        direction: PositionDirection,
        entry_price: float,
        leverage_bps: int,
        size_usdc: float,
        vault_address: str,
        tx_hash: str,
        stop_loss_price: Optional[float] = None,
        take_profit_price: Optional[float] = None,
    ) -> Position:
        """Open a new position.

        Args:
            asset: Asset ticker
            direction: Long or short
            entry_price: Entry price for the position
            leverage_bps: Leverage in basis points (10000 = 1x)
            size_usdc: Position size in USDC
            vault_address: Euler vault address
            tx_hash: Opening transaction hash
            stop_loss_price: Optional stop loss price
            take_profit_price: Optional take profit price

        Returns:
            Created position record

        Raises:
            ValueError: If position already exists for asset
        """
        # Check for existing position
        existing = await self.get_active_position(asset)
        if existing:
            raise ValueError(
                f"Cannot open new position: active position already exists for {asset} (ID: {existing.id})"
            )

        async for session in get_session():
            position = Position(
                asset=asset,
                direction=direction,
                entry_price=entry_price,
                leverage_bps=leverage_bps,
                size_usdc=size_usdc,
                status=PositionStatus.OPEN,
                vault_address=vault_address,
                tx_hashes={"open": tx_hash},
                stop_loss_price=stop_loss_price,
                take_profit_price=take_profit_price,
            )

            session.add(position)
            await session.flush()
            await session.refresh(position)

            logger.success(
                f"Opened {direction.value.upper()} position for {asset}: "
                f"${size_usdc:.2f} @ ${entry_price:.2f} with {leverage_bps / 10000:.1f}x leverage "
                f"(ID: {position.id})"
            )

            return position

    async def update_position_pnl(
        self,
        position_id: int,
        current_price: float,
    ) -> tuple[float, float]:
        """Update position with current PnL.

        This updates unrealized PnL based on current market price.

        Args:
            position_id: Position ID
            current_price: Current market price

        Returns:
            Tuple of (pnl_usdc, pnl_pct)

        Raises:
            ValueError: If position not found
        """
        async for session in get_session():
            result = await session.execute(
                select(Position).where(Position.id == position_id)
            )
            position = result.scalar_one_or_none()

            if not position:
                raise ValueError(f"Position {position_id} not found")

            # Calculate PnL
            pnl_usdc, pnl_pct = position.calculate_pnl(current_price)

            # Update position (unrealized PnL for open positions)
            position.pnl = pnl_usdc
            position.pnl_pct = pnl_pct

            await session.commit()
            await session.refresh(position)

            logger.debug(
                f"Updated PnL for position {position_id}: ${pnl_usdc:.2f} ({pnl_pct:+.2f}%)"
            )

            return pnl_usdc, pnl_pct

    async def close_position(
        self,
        position_id: int,
        exit_price: float,
        tx_hash: str,
        exit_reason: str = "manual_close",
    ) -> Position:
        """Close an active position.

        Args:
            position_id: Position ID
            exit_price: Exit price
            tx_hash: Closing transaction hash
            exit_reason: Reason for closing (e.g., "manual_close", "stop_loss", "take_profit")

        Returns:
            Closed position record

        Raises:
            ValueError: If position not found or not open
        """
        async for session in get_session():
            result = await session.execute(
                select(Position).where(Position.id == position_id)
            )
            position = result.scalar_one_or_none()

            if not position:
                raise ValueError(f"Position {position_id} not found")

            if position.status != PositionStatus.OPEN:
                raise ValueError(
                    f"Position {position_id} is not open (status: {position.status.value})"
                )

            # Calculate final PnL
            pnl_usdc, pnl_pct = position.calculate_pnl(exit_price)

            # Update position
            position.status = PositionStatus.CLOSED
            position.exit_price = exit_price
            position.exit_reason = exit_reason
            position.closed_at = datetime.now()
            position.pnl = pnl_usdc
            position.pnl_pct = pnl_pct

            # Add closing tx hash
            tx_hashes = position.tx_hashes.copy()
            tx_hashes["close"] = tx_hash
            position.tx_hashes = tx_hashes

            await session.commit()
            await session.refresh(position)

            logger.success(
                f"Closed position {position_id}: {position.direction.value.upper()} {position.asset} "
                f"@ ${exit_price:.2f}, PnL: ${pnl_usdc:.2f} ({pnl_pct:+.2f}%), "
                f"reason: {exit_reason}"
            )

            return position

    async def mark_liquidated(
        self,
        position_id: int,
        liquidation_price: float,
        tx_hash: Optional[str] = None,
    ) -> Position:
        """Mark a position as liquidated.

        Args:
            position_id: Position ID
            liquidation_price: Liquidation price
            tx_hash: Liquidation transaction hash (if available)

        Returns:
            Updated position record

        Raises:
            ValueError: If position not found
        """
        async for session in get_session():
            result = await session.execute(
                select(Position).where(Position.id == position_id)
            )
            position = result.scalar_one_or_none()

            if not position:
                raise ValueError(f"Position {position_id} not found")

            # Calculate final PnL (usually close to -100% with leverage)
            pnl_usdc, pnl_pct = position.calculate_pnl(liquidation_price)

            # Update position
            position.status = PositionStatus.LIQUIDATED
            position.exit_price = liquidation_price
            position.exit_reason = "liquidated"
            position.closed_at = datetime.now()
            position.pnl = pnl_usdc
            position.pnl_pct = pnl_pct

            # Add liquidation tx hash if available
            if tx_hash:
                tx_hashes = position.tx_hashes.copy()
                tx_hashes["liquidation"] = tx_hash
                position.tx_hashes = tx_hashes

            await session.commit()
            await session.refresh(position)

            logger.error(
                f"Position {position_id} LIQUIDATED: {position.direction.value.upper()} {position.asset} "
                f"@ ${liquidation_price:.2f}, Loss: ${pnl_usdc:.2f} ({pnl_pct:.2f}%)"
            )

            return position

    async def update_position_transaction(
        self,
        position_id: int,
        tx_type: str,
        tx_hash: str,
    ) -> Position:
        """Update position with a new transaction hash.

        Useful for tracking partial fills or multiple transactions.

        Args:
            position_id: Position ID
            tx_type: Transaction type (e.g., "adjust", "partial_fill")
            tx_hash: Transaction hash

        Returns:
            Updated position

        Raises:
            ValueError: If position not found
        """
        async for session in get_session():
            result = await session.execute(
                select(Position).where(Position.id == position_id)
            )
            position = result.scalar_one_or_none()

            if not position:
                raise ValueError(f"Position {position_id} not found")

            # Add transaction hash
            tx_hashes = position.tx_hashes.copy()

            # Handle multiple transactions of same type
            if tx_type in tx_hashes:
                # Convert to list if single value
                if isinstance(tx_hashes[tx_type], str):
                    tx_hashes[tx_type] = [tx_hashes[tx_type]]
                tx_hashes[tx_type].append(tx_hash)
            else:
                tx_hashes[tx_type] = tx_hash

            position.tx_hashes = tx_hashes

            await session.commit()
            await session.refresh(position)

            logger.debug(f"Added {tx_type} transaction to position {position_id}: {tx_hash}")

            return position

    async def adjust_position_leverage(
        self,
        position_id: int,
        new_leverage_bps: int,
        tx_hash: str,
    ) -> Position:
        """Adjust leverage on an existing position.

        Args:
            position_id: Position ID
            new_leverage_bps: New leverage in basis points
            tx_hash: Adjustment transaction hash

        Returns:
            Updated position

        Raises:
            ValueError: If position not found or not open
        """
        async for session in get_session():
            result = await session.execute(
                select(Position).where(Position.id == position_id)
            )
            position = result.scalar_one_or_none()

            if not position:
                raise ValueError(f"Position {position_id} not found")

            if position.status != PositionStatus.OPEN:
                raise ValueError(
                    f"Cannot adjust leverage: position {position_id} is not open"
                )

            old_leverage = position.leverage_bps

            # Update leverage
            position.leverage_bps = new_leverage_bps

            # Add transaction hash
            tx_hashes = position.tx_hashes.copy()
            adjust_key = f"adjust_leverage_{datetime.now().isoformat()}"
            tx_hashes[adjust_key] = tx_hash
            position.tx_hashes = tx_hashes

            await session.commit()
            await session.refresh(position)

            logger.info(
                f"Adjusted leverage for position {position_id}: "
                f"{old_leverage / 10000:.1f}x -> {new_leverage_bps / 10000:.1f}x"
            )

            return position

    async def get_position_history(
        self,
        asset: Optional[str] = None,
        limit: int = 100,
        include_open: bool = False,
    ) -> List[Position]:
        """Get historical positions.

        Args:
            asset: Filter by asset (optional)
            limit: Maximum number of positions to return
            include_open: Include open positions in results

        Returns:
            List of positions ordered by closing time (most recent first)
        """
        async for session in get_session():
            query = select(Position)

            # Filter by asset if specified
            if asset:
                query = query.where(Position.asset == asset)

            # Filter by status
            if not include_open:
                query = query.where(Position.status != PositionStatus.OPEN)

            # Order by closed_at (most recent first), then created_at
            query = query.order_by(
                Position.closed_at.desc().nullsfirst(),
                Position.created_at.desc()
            ).limit(limit)

            result = await session.execute(query)
            positions = list(result.scalars().all())

            logger.debug(
                f"Retrieved {len(positions)} historical positions"
                + (f" for {asset}" if asset else "")
            )

            return positions

    async def get_position_by_id(self, position_id: int) -> Optional[Position]:
        """Get a position by its ID.

        Args:
            position_id: Position ID

        Returns:
            Position or None if not found
        """
        async for session in get_session():
            result = await session.execute(
                select(Position).where(Position.id == position_id)
            )
            position = result.scalar_one_or_none()

            return position

    async def get_daily_pnl(self) -> float:
        """Calculate total realized PnL for today.

        Returns:
            Total PnL in USDC for positions closed today
        """
        from datetime import datetime

        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        async for session in get_session():
            result = await session.execute(
                select(Position).where(
                    and_(
                        Position.closed_at >= today_start,
                        Position.status == PositionStatus.CLOSED,
                    )
                )
            )
            positions = list(result.scalars().all())

            total_pnl = sum(p.pnl for p in positions if p.pnl is not None)

            logger.debug(
                f"Daily PnL: ${total_pnl:.2f} from {len(positions)} closed positions"
            )

            return total_pnl
