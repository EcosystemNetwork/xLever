"""Metrics model for tracking agent performance and system health."""

from datetime import datetime
from sqlalchemy import String, Float, Integer, DateTime, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column
from agent.models.base import Base


class Metrics(Base):
    """System and performance metrics.

    Stores time-series metrics for monitoring agent performance, system health,
    and trading statistics.
    """

    __tablename__ = "metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Metric identification
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    metric_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    # Metric value
    value: Mapped[float] = mapped_column(Float, nullable=False)

    # Additional context
    labels: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="Additional labels: asset, action, etc.",
    )

    # Composite index for efficient queries
    __table_args__ = (
        Index("idx_metrics_name_timestamp", "metric_name", "timestamp"),
        Index("idx_metrics_timestamp", "timestamp"),
    )

    def __repr__(self) -> str:
        return f"<Metrics(name={self.metric_name}, value={self.value}, timestamp={self.timestamp})>"


# Common metric names (for reference)
class MetricNames:
    """Standard metric names used throughout the agent."""

    # Performance metrics
    TOTAL_PNL = "total_pnl_usdc"
    WIN_RATE = "win_rate_pct"
    SHARPE_RATIO = "sharpe_ratio"
    MAX_DRAWDOWN = "max_drawdown_pct"

    # Position metrics
    POSITIONS_OPENED = "positions_opened"
    POSITIONS_CLOSED = "positions_closed"
    POSITIONS_LIQUIDATED = "positions_liquidated"
    AVERAGE_POSITION_SIZE = "avg_position_size_usdc"
    AVERAGE_LEVERAGE = "avg_leverage_bps"

    # Decision metrics
    DECISIONS_MADE = "decisions_made"
    DECISIONS_APPROVED = "decisions_approved"
    DECISIONS_EXECUTED = "decisions_executed"
    AVERAGE_CONFIDENCE = "avg_confidence"

    # System health metrics
    API_RESPONSE_TIME = "api_response_time_ms"
    TRANSACTION_GAS_COST = "tx_gas_cost_wei"
    BALANCE_USDC = "balance_usdc"
    HEALTH_SCORE = "health_score"

    # Market metrics
    ASSET_PRICE = "asset_price_usd"
    VOLATILITY = "volatility_pct"
    SENTIMENT_SCORE = "sentiment_score"
