"""Pydantic schemas for request/response validation."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ─── Users ──────────────────────────────────────────────────────

class UserCreate(BaseModel):
    wallet_address: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")


class UserPreferences(BaseModel):
    default_asset: str | None = None
    theme: str | None = None
    notifications: bool | None = None


class UserOut(BaseModel):
    id: int
    wallet_address: str
    preferences: dict[str, Any]
    created_at: datetime
    last_seen: datetime

    model_config = {"from_attributes": True}


# ─── Positions ──────────────────────────────────────────────────

class PositionOut(BaseModel):
    id: int
    asset: str
    tranche: str
    deposit_amount: float
    leverage_bps: int
    side: str
    entry_price: float | None
    exit_price: float | None
    status: str
    realized_pnl: float
    fees_paid: float
    tx_hash_open: str | None
    tx_hash_close: str | None
    opened_at: datetime
    closed_at: datetime | None

    model_config = {"from_attributes": True}


class PositionHistory(BaseModel):
    total: int
    positions: list[PositionOut]


# ─── Agent Runs ─────────────────────────────────────────────────

class AgentRunCreate(BaseModel):
    strategy: str
    asset: str
    config: dict[str, Any] = {}


class AgentActionOut(BaseModel):
    id: int
    action_type: str
    asset: str | None
    leverage: float | None
    amount: float | None
    reason: str | None
    success: bool
    tx_hash: str | None
    price_at_action: float | None
    executed_at: datetime

    model_config = {"from_attributes": True}


class AgentRunOut(BaseModel):
    id: int
    strategy: str
    asset: str
    config: dict[str, Any]
    status: str
    started_at: datetime
    ended_at: datetime | None
    total_trades: int
    total_pnl: float
    max_drawdown: float | None
    actions: list[AgentActionOut] = []

    model_config = {"from_attributes": True}


# ─── Alerts ─────────────────────────────────────────────────────

class AlertCreate(BaseModel):
    alert_type: str
    asset: str | None = None
    threshold: float
    message: str | None = None


class AlertOut(BaseModel):
    id: int
    alert_type: str
    asset: str | None
    threshold: float
    status: str
    message: str | None
    triggered_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Price Data ─────────────────────────────────────────────────

class PriceQuery(BaseModel):
    symbol: str
    period: str = "1y"
    interval: str = "1d"


class PriceResponse(BaseModel):
    symbol: str
    interval: str
    period: str
    data: dict[str, Any]
    cached: bool = False
