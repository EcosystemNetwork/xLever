"""
SQLAlchemy models for xLever backend.

Tables:
  users          — wallet addresses + preferences
  positions      — indexed on-chain positions (cached for fast queries)
  agent_runs     — AI agent execution history
  agent_actions  — individual actions within an agent run
  price_cache    — cached price data (replaces localStorage)
  alerts         — user-configured risk/price alerts
"""

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from .database import Base


# ─── Enums ──────────────────────────────────────────────────────

class PositionSide(str, enum.Enum):
    LONG = "long"
    SHORT = "short"


class PositionStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"
    LIQUIDATED = "liquidated"
    DELEVERAGED = "deleveraged"


class AgentStatus(str, enum.Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


class AlertType(str, enum.Enum):
    PRICE_ABOVE = "price_above"
    PRICE_BELOW = "price_below"
    HEALTH_BELOW = "health_below"
    PNL_TARGET = "pnl_target"
    PNL_STOP = "pnl_stop"
    FUNDING_RATE = "funding_rate"


class AlertStatus(str, enum.Enum):
    ACTIVE = "active"
    TRIGGERED = "triggered"
    DISMISSED = "dismissed"


class TrancheType(str, enum.Enum):
    SENIOR = "senior"
    JUNIOR = "junior"


# ─── Users ──────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    wallet_address = Column(String(42), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())
    last_seen = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Preferences stored as JSON
    preferences = Column(JSONB, default=dict)
    # e.g. {"default_asset": "QQQ", "theme": "dark", "notifications": true}

    # Relationships
    positions = relationship("Position", back_populates="user")
    agent_runs = relationship("AgentRun", back_populates="user")
    alerts = relationship("Alert", back_populates="user")


# ─── Positions ──────────────────────────────────────────────────

class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_address = Column(String(42), nullable=False, index=True)
    asset = Column(String(10), nullable=False)  # QQQ, SPY, etc.
    tranche = Column(Enum(TrancheType), nullable=False)

    # Position details
    deposit_amount = Column(Numeric(28, 6), nullable=False)  # USDC amount
    leverage_bps = Column(Integer, nullable=False)  # 20000 = 2.0x
    side = Column(Enum(PositionSide), nullable=False)
    entry_price = Column(Numeric(18, 8))  # TWAP at entry
    exit_price = Column(Numeric(18, 8))
    status = Column(Enum(PositionStatus), default=PositionStatus.OPEN, index=True)

    # PnL tracking
    realized_pnl = Column(Numeric(28, 6), default=0)
    fees_paid = Column(Numeric(28, 6), default=0)

    # On-chain reference
    tx_hash_open = Column(String(66))
    tx_hash_close = Column(String(66))
    block_number_open = Column(BigInteger)
    block_number_close = Column(BigInteger)

    # Timestamps
    opened_at = Column(DateTime, server_default=func.now())
    closed_at = Column(DateTime)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="positions")

    __table_args__ = (
        Index("ix_positions_wallet_status", "wallet_address", "status"),
        Index("ix_positions_asset_status", "asset", "status"),
    )


# ─── AI Agent Runs ──────────────────────────────────────────────

class AgentRun(Base):
    __tablename__ = "agent_runs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_address = Column(String(42), nullable=False, index=True)

    # Agent config
    strategy = Column(String(100), nullable=False)  # e.g. "momentum", "mean_reversion"
    config = Column(JSONB, default=dict)  # strategy parameters
    asset = Column(String(10), nullable=False)

    # Execution state
    status = Column(Enum(AgentStatus), default=AgentStatus.RUNNING, index=True)
    started_at = Column(DateTime, server_default=func.now())
    ended_at = Column(DateTime)

    # Results
    total_trades = Column(Integer, default=0)
    total_pnl = Column(Numeric(28, 6), default=0)
    max_drawdown = Column(Float)
    error_message = Column(Text)

    user = relationship("User", back_populates="agent_runs")
    actions = relationship("AgentAction", back_populates="run", order_by="AgentAction.executed_at")


class AgentAction(Base):
    __tablename__ = "agent_actions"

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("agent_runs.id"), nullable=False)

    # Action details
    action_type = Column(String(50), nullable=False)  # open, close, adjust, rebalance
    asset = Column(String(10))
    leverage = Column(Float)
    amount = Column(Numeric(28, 6))
    reason = Column(Text)  # AI reasoning for the action

    # Result
    success = Column(Boolean, default=True)
    tx_hash = Column(String(66))
    price_at_action = Column(Numeric(18, 8))
    error = Column(Text)

    executed_at = Column(DateTime, server_default=func.now())

    run = relationship("AgentRun", back_populates="actions")


# ─── Price Cache ────────────────────────────────────────────────

class PriceCache(Base):
    __tablename__ = "price_cache"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(10), nullable=False, index=True)
    interval = Column(String(5), nullable=False)  # 1d, 1h, 5m
    period = Column(String(10), nullable=False)  # 1y, 5y, max

    # Cached response from Yahoo Finance
    data = Column(JSONB, nullable=False)
    fetched_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_price_cache_lookup", "symbol", "interval", "period", unique=True),
    )


# ─── Alerts ─────────────────────────────────────────────────────

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_address = Column(String(42), nullable=False, index=True)

    alert_type = Column(Enum(AlertType), nullable=False)
    asset = Column(String(10))
    threshold = Column(Float, nullable=False)  # price, health factor, PnL %
    status = Column(Enum(AlertStatus), default=AlertStatus.ACTIVE, index=True)

    message = Column(Text)  # custom user message
    triggered_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", back_populates="alerts")
