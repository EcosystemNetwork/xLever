"""Decision model for tracking agent decisions."""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, Float, Integer, Boolean, DateTime, Enum as SQLEnum, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column
from enum import Enum
from agent.models.base import Base, TimestampMixin


class DecisionAction(str, Enum):
    """Type of trading action decided."""

    OPEN_LONG = "open_long"
    OPEN_SHORT = "open_short"
    CLOSE_POSITION = "close_position"
    HOLD = "hold"
    EMERGENCY_EXIT = "emergency_exit"


class Decision(Base, TimestampMixin):
    """Agent decision record.

    Tracks all decisions made by the agent including reasoning, confidence,
    and whether they were approved and executed.
    """

    __tablename__ = "decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Decision details
    action: Mapped[DecisionAction] = mapped_column(SQLEnum(DecisionAction), nullable=False)
    asset: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    confidence: Mapped[float] = mapped_column(
        Float, nullable=False, comment="Confidence score 0-1"
    )

    # Reasoning and context
    reasoning: Mapped[str] = mapped_column(Text, nullable=False, comment="AI-generated reasoning")
    market_context: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="Market data at decision time: prices, sentiment, etc.",
    )
    rule_checks: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="Results of safety rule checks",
    )

    # Position parameters (if opening position)
    direction: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    leverage_bps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    size_usdc: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Execution tracking
    approved: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, comment="Whether decision passed safety checks"
    )
    approval_notes: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="Notes from approval process"
    )

    executed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, comment="Whether decision was executed on-chain"
    )
    executed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    execution_tx_hash: Mapped[Optional[str]] = mapped_column(String(66), nullable=True)
    execution_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Related position
    position_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    def __repr__(self) -> str:
        return (
            f"<Decision(id={self.id}, action={self.action.value}, "
            f"asset={self.asset}, confidence={self.confidence:.2f}, "
            f"approved={self.approved}, executed={self.executed})>"
        )

    @property
    def is_position_action(self) -> bool:
        """Check if this decision involves opening a position."""
        return self.action in [DecisionAction.OPEN_LONG, DecisionAction.OPEN_SHORT]

    @property
    def requires_blockchain(self) -> bool:
        """Check if this decision requires blockchain execution."""
        return self.action != DecisionAction.HOLD
