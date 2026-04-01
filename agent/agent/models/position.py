"""Position model for tracking trading positions."""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, Float, Integer, DateTime, Enum as SQLEnum, JSON
from sqlalchemy.orm import Mapped, mapped_column
from enum import Enum
from agent.models.base import Base, TimestampMixin


class PositionStatus(str, Enum):
    """Status of a trading position."""

    OPEN = "open"
    CLOSED = "closed"
    LIQUIDATED = "liquidated"
    ERROR = "error"


class PositionDirection(str, Enum):
    """Direction of a trading position."""

    LONG = "long"
    SHORT = "short"


class Position(Base, TimestampMixin):
    """Trading position record.

    Tracks all opened positions with their parameters, status, and performance.
    """

    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Position parameters
    asset: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    direction: Mapped[PositionDirection] = mapped_column(
        SQLEnum(PositionDirection), nullable=False
    )
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    leverage_bps: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Leverage in basis points (5x = 50000)"
    )
    size_usdc: Mapped[float] = mapped_column(Float, nullable=False, comment="Position size in USDC")

    # Position status
    status: Mapped[PositionStatus] = mapped_column(
        SQLEnum(PositionStatus), nullable=False, default=PositionStatus.OPEN, index=True
    )

    # Exit information
    exit_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    exit_reason: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Performance
    pnl: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True, comment="Profit and loss in USDC"
    )
    pnl_pct: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True, comment="Profit and loss percentage"
    )

    # Blockchain data
    tx_hashes: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="Transaction hashes: open_tx, close_tx, etc.",
    )
    vault_address: Mapped[str] = mapped_column(String(42), nullable=False)

    # Risk management
    stop_loss_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    take_profit_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    def __repr__(self) -> str:
        return (
            f"<Position(id={self.id}, asset={self.asset}, direction={self.direction.value}, "
            f"size={self.size_usdc} USDC, status={self.status.value})>"
        )

    @property
    def is_open(self) -> bool:
        """Check if position is currently open."""
        return self.status == PositionStatus.OPEN

    def calculate_pnl(self, current_price: float) -> tuple[float, float]:
        """Calculate current PnL for the position.

        Args:
            current_price: Current market price of the asset

        Returns:
            Tuple of (pnl_usdc, pnl_pct)
        """
        if self.direction == PositionDirection.LONG:
            price_change = (current_price - self.entry_price) / self.entry_price
        else:  # SHORT
            price_change = (self.entry_price - current_price) / self.entry_price

        # Apply leverage effect
        leverage_multiplier = self.leverage_bps / 10000
        pnl_pct = price_change * leverage_multiplier * 100

        pnl_usdc = self.size_usdc * (pnl_pct / 100)

        return pnl_usdc, pnl_pct
