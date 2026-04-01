"""Pydantic schemas for request/response validation."""
# Schemas live separately from models to decouple API contract from DB structure

# datetime is needed for timestamp fields in response schemas
from datetime import datetime
# Any is used for flexible dict values (preferences, config, price data)
from typing import Any

# BaseModel is the foundation for all Pydantic schemas; Field adds validation constraints
from pydantic import BaseModel, Field


# ─── Users ──────────────────────────────────────────────────────

# Schema for wallet registration — validates Ethereum address format before hitting the DB
class UserCreate(BaseModel):
    # Regex enforces valid Ethereum address format (0x prefix + 40 hex chars) at the API boundary
    wallet_address: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")


# Schema for updating user preferences — all fields optional so partial updates work
class UserPreferences(BaseModel):
    # Preferred default asset for the backtester (e.g., "QQQ") — optional for partial patches
    default_asset: str | None = None
    # UI theme preference — stored server-side so it persists across devices
    theme: str | None = None
    # Whether the user wants push/email notifications for alerts
    notifications: bool | None = None


# Response schema for user data — controls what the API exposes (no internal fields leak)
class UserOut(BaseModel):
    # Surrogate ID for API references
    id: int
    # Wallet address — the user's primary identity
    wallet_address: str
    # Flexible preferences dict — mirrors the JSONB column in the users table
    preferences: dict[str, Any]
    # When the user first connected — useful for "member since" display
    created_at: datetime
    # Last interaction timestamp — useful for activity tracking
    last_seen: datetime

    # from_attributes=True allows constructing this schema directly from an ORM model instance
    model_config = {"from_attributes": True}


# ─── Positions ──────────────────────────────────────────────────

# Response schema for a single position — exposes all fields the frontend needs for the portfolio view
class PositionOut(BaseModel):
    # Position ID for API references
    id: int
    # Underlying asset ticker (QQQ, SPY, etc.)
    asset: str
    # Vault tranche (senior/junior) — determines risk profile
    tranche: str
    # USDC amount deposited into the position
    deposit_amount: float
    # Leverage in basis points (20000 = 2x) — frontend converts for display
    leverage_bps: int
    # Long or short direction
    side: str
    # TWAP price when position was opened — null if not yet recorded
    entry_price: float | None
    # Price when position was closed — null while still open
    exit_price: float | None
    # Current lifecycle status (open, closed, liquidated, deleveraged)
    status: str
    # Cumulative realized profit/loss in USDC
    realized_pnl: float
    # Cumulative fees paid in USDC
    fees_paid: float
    # Opening transaction hash for block explorer links — null if pending
    tx_hash_open: str | None
    # Closing transaction hash — null while position is open
    tx_hash_close: str | None
    # When the position was opened
    opened_at: datetime
    # When the position was closed — null while still open
    closed_at: datetime | None

    # Enable ORM model -> schema conversion
    model_config = {"from_attributes": True}


# Wrapper schema for paginated position lists — includes total count for frontend pagination
class PositionHistory(BaseModel):
    # Total matching positions (before limit/offset) so the frontend can compute page count
    total: int
    # The actual page of position records
    positions: list[PositionOut]


# ─── Agent Runs ─────────────────────────────────────────────────

# Request schema for starting a new AI agent run — minimal required fields
class AgentRunCreate(BaseModel):
    # Strategy algorithm name (momentum, mean_reversion, etc.)
    strategy: str
    # Which asset the agent should trade
    asset: str
    # Strategy-specific parameters — empty dict default allows simple strategies with no config
    config: dict[str, Any] = {}


# Response schema for a single agent action — represents one trade/decision by the AI
class AgentActionOut(BaseModel):
    # Action ID for referencing specific actions
    id: int
    # What the agent did (open, close, adjust, rebalance)
    action_type: str
    # Which asset was involved — null for non-asset-specific actions
    asset: str | None
    # Leverage level used — null for close actions
    leverage: float | None
    # USDC amount involved — null for analysis-only actions
    amount: float | None
    # AI's explanation for why it took this action — key for strategy transparency
    reason: str | None
    # Whether the on-chain transaction succeeded
    success: bool
    # Transaction hash for verification — null if action was off-chain
    tx_hash: str | None
    # Market price when the action was taken — needed for PnL display
    price_at_action: float | None
    # Timestamp of execution
    executed_at: datetime

    # Enable ORM model -> schema conversion
    model_config = {"from_attributes": True}


# Response schema for an agent run including its child actions
class AgentRunOut(BaseModel):
    # Run ID for API references
    id: int
    # Strategy algorithm name
    strategy: str
    # Asset being traded
    asset: str
    # Strategy configuration parameters
    config: dict[str, Any]
    # Current execution state (running, completed, failed, stopped)
    status: str
    # When the agent started
    started_at: datetime
    # When the agent finished — null while still running
    ended_at: datetime | None
    # Number of trades executed so far
    total_trades: int
    # Cumulative PnL across all trades
    total_pnl: float
    # Worst drawdown percentage — null if not yet computed
    max_drawdown: float | None
    # Nested list of all actions taken during this run — empty list default for runs with no actions yet
    actions: list[AgentActionOut] = []

    # Enable ORM model -> schema conversion
    model_config = {"from_attributes": True}


# ─── Alerts ─────────────────────────────────────────────────────

# Request schema for creating a new alert — validates user input before DB insert
class AlertCreate(BaseModel):
    # Which condition type to monitor (price_above, health_below, etc.)
    alert_type: str
    # Optional asset filter — null means the alert is global (e.g., portfolio health)
    asset: str | None = None
    # Numeric threshold that triggers the alert
    threshold: float
    # Optional custom message displayed when the alert fires
    message: str | None = None


# Response schema for alert data — controls what the API returns
class AlertOut(BaseModel):
    # Alert ID for API references (used in DELETE endpoint)
    id: int
    # Condition type being monitored
    alert_type: str
    # Asset filter — null if the alert is global
    asset: str | None
    # Trigger threshold value
    threshold: float
    # Current lifecycle state (active, triggered, dismissed)
    status: str
    # User's custom message
    message: str | None
    # When the condition was met — null until triggered
    triggered_at: datetime | None
    # When the alert was created
    created_at: datetime

    # Enable ORM model -> schema conversion
    model_config = {"from_attributes": True}


# ─── Price Data ─────────────────────────────────────────────────

# Request schema for price data queries — provides sensible defaults for the backtester
class PriceQuery(BaseModel):
    # Ticker symbol to fetch (QQQ, SPY, etc.)
    symbol: str
    # Time range — 1 year is the default backtesting window
    period: str = "1y"
    # Candle interval — daily is the default for backtesting (1d, 1h, 5m available)
    interval: str = "1d"


# Response schema for price data — wraps Yahoo Finance JSON with cache metadata
class PriceResponse(BaseModel):
    # Echo back the requested symbol for client-side correlation
    symbol: str
    # Echo back the interval so the client knows the data granularity
    interval: str
    # Echo back the period so the client knows the time range
    period: str
    # Raw Yahoo Finance chart response — kept as dict to avoid coupling to Yahoo's schema
    data: dict[str, Any]
    # Tells the client whether this came from cache or a fresh Yahoo Finance fetch
    cached: bool = False
