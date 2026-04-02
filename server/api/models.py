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
# Docstring documents the full table inventory for developers navigating this file

# enum stdlib provides Python-side enums that map to PostgreSQL ENUM columns
import enum
# datetime is needed for type hints on timestamp columns
from datetime import datetime

# Import all SQLAlchemy column types used across the six tables
from sqlalchemy import (
    BigInteger,   # For block numbers which can exceed 2^31
    Boolean,      # For success/failure flags on agent actions
    Column,       # Every field declaration needs Column
    DateTime,     # Timestamps for created_at, opened_at, etc.
    Enum,         # Maps Python enums to PostgreSQL ENUM types
    Float,        # For approximate values like max_drawdown where precision isn't critical
    ForeignKey,   # Enforces referential integrity between related tables
    Index,        # Composite indexes for common query patterns
    Integer,      # Standard auto-increment primary keys and counters
    Numeric,      # Fixed-precision decimals for financial amounts (avoids floating point errors)
    String,       # Variable-length text with max length constraint
    Text,         # Unbounded text for error messages and AI reasoning
    func,         # SQL functions like now() for server-side default timestamps
)
# JSON type works across SQLite and PostgreSQL — use instead of dialect-specific JSONB
from sqlalchemy import JSON as JSONB
# relationship defines ORM-level links between parent/child tables for eager/lazy loading
from sqlalchemy.orm import relationship

# Base is the declarative base all models inherit from — ties them to our async engine
from .database import Base


# ─── Enums ──────────────────────────────────────────────────────
# Python enums that map to PostgreSQL ENUM types — ensures only valid values are stored

# PositionSide constrains positions to long or short (the two directions in leveraged trading)
class PositionSide(str, enum.Enum):
    LONG = "long"    # Betting the asset price goes up
    SHORT = "short"  # Betting the asset price goes down


# PositionStatus tracks the lifecycle of a leveraged position through all possible end states
class PositionStatus(str, enum.Enum):
    OPEN = "open"               # Position is currently active
    CLOSED = "closed"           # User voluntarily exited the position
    LIQUIDATED = "liquidated"   # Position was forcibly closed due to insufficient collateral
    DELEVERAGED = "deleveraged" # Position was auto-deleveraged by the protocol to reduce risk


# AgentStatus tracks the lifecycle of an AI trading agent run
class AgentStatus(str, enum.Enum):
    RUNNING = "running"     # Agent is actively executing trades
    COMPLETED = "completed" # Agent finished its strategy successfully
    FAILED = "failed"       # Agent encountered an unrecoverable error
    STOPPED = "stopped"     # User manually stopped the agent


# AlertType defines all the conditions a user can monitor — covers price, health, and PnL
class AlertType(str, enum.Enum):
    PRICE_ABOVE = "price_above"     # Trigger when asset price exceeds threshold
    PRICE_BELOW = "price_below"     # Trigger when asset price drops below threshold
    HEALTH_BELOW = "health_below"   # Trigger when Euler vault health factor is dangerously low
    PNL_TARGET = "pnl_target"       # Trigger when profit-and-loss hits a take-profit level
    PNL_STOP = "pnl_stop"           # Trigger when PnL hits a stop-loss level
    FUNDING_RATE = "funding_rate"   # Trigger when funding rate deviates (relevant for perps)


# AlertStatus tracks whether an alert is still waiting, has fired, or was manually dismissed
class AlertStatus(str, enum.Enum):
    ACTIVE = "active"       # Alert is armed and being monitored
    TRIGGERED = "triggered" # Alert condition was met and notification sent
    DISMISSED = "dismissed" # User manually dismissed/deleted the alert


# AgentSource distinguishes browser-initiated runs from external agent API runs
class AgentSource(str, enum.Enum):
    BROWSER = "browser"     # Run created from the xLever frontend
    EXTERNAL = "external"   # Run created by an external agent via API key


# TrancheType maps to xLever's two-tranche vault structure on Euler V2
class TrancheType(str, enum.Enum):
    SENIOR = "senior" # Lower risk, lower return — gets paid first
    JUNIOR = "junior" # Higher risk, higher return — absorbs losses first


# ─── Users ──────────────────────────────────────────────────────

# User model represents a connected wallet — the primary identity in a DeFi app
class User(Base):
    # Table name follows plural convention for PostgreSQL
    __tablename__ = "users"

    # Auto-incrementing surrogate key — wallet_address is the natural key but integers are faster for joins
    id = Column(Integer, primary_key=True)
    # Ethereum address is always 42 chars (0x + 40 hex); unique+indexed for fast lookup on login
    wallet_address = Column(String(42), unique=True, nullable=False, index=True)
    # Track when the user first connected their wallet
    created_at = Column(DateTime, server_default=func.now())
    # Auto-updates on every interaction — useful for identifying inactive users
    last_seen = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Flexible key-value store for user settings — avoids schema changes for new preferences
    preferences = Column(JSONB, default=dict)
    # e.g. {"default_asset": "QQQ", "theme": "dark", "notifications": true}

    # ORM relationships enable user.positions, user.agent_runs, user.alerts access patterns
    positions = relationship("Position", back_populates="user")
    agent_runs = relationship("AgentRun", back_populates="user")
    alerts = relationship("Alert", back_populates="user")
    sessions = relationship("UserSession", back_populates="user")
    external_agents = relationship("ExternalAgent", back_populates="owner")


# ─── Positions ──────────────────────────────────────────────────

# Position represents a leveraged tokenized asset position on xLever (backed by Euler V2 vaults)
class Position(Base):
    __tablename__ = "positions"

    # Surrogate PK — positions are also identifiable by tx_hash but int is better for pagination
    id = Column(Integer, primary_key=True)
    # FK to users table — every position belongs to a user
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Denormalized wallet address for direct queries without joining users table
    wallet_address = Column(String(42), nullable=False, index=True)
    # Ticker symbol of the underlying asset (QQQ, SPY, etc.) — short string for indexing
    asset = Column(String(10), nullable=False)  # QQQ, SPY, etc.
    # Which vault tranche the deposit went into — determines risk/return profile
    tranche = Column(Enum(TrancheType), nullable=False)

    # USDC deposit amount — Numeric(28,6) gives 22 integer digits + 6 decimals (USDC has 6)
    deposit_amount = Column(Numeric(28, 6), nullable=False)  # USDC amount
    # Leverage in basis points — 20000 = 2.0x; BPS avoids floating point for on-chain math
    leverage_bps = Column(Integer, nullable=False)  # 20000 = 2.0x
    # Long or short direction of the leveraged position
    side = Column(Enum(PositionSide), nullable=False)
    # TWAP entry price — Numeric(18,8) matches typical price feed precision
    entry_price = Column(Numeric(18, 8))  # TWAP at entry
    # Exit price recorded when position is closed — null while open
    exit_price = Column(Numeric(18, 8))
    # Current lifecycle state — indexed because most queries filter by open/closed status
    status = Column(Enum(PositionStatus), default=PositionStatus.OPEN, index=True)

    # Realized profit/loss in USDC — only set after position is closed
    realized_pnl = Column(Numeric(28, 6), default=0)
    # Cumulative fees paid (protocol fees, gas, etc.) — tracked for accurate PnL reporting
    fees_paid = Column(Numeric(28, 6), default=0)

    # On-chain tx hash for the opening transaction — 66 chars (0x + 64 hex)
    tx_hash_open = Column(String(66))
    # On-chain tx hash for the closing transaction — null while position is open
    tx_hash_close = Column(String(66))
    # Block number at open — BigInteger because block numbers grow indefinitely
    block_number_open = Column(BigInteger)
    # Block number at close — enables querying historical state at position close time
    block_number_close = Column(BigInteger)

    # When the position was opened — server-side default for consistency across timezones
    opened_at = Column(DateTime, server_default=func.now())
    # When the position was closed — null while open
    closed_at = Column(DateTime)
    # Auto-updated on any change — useful for cache invalidation and audit trails
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Back-reference to the User model for ORM navigation (position.user)
    user = relationship("User", back_populates="positions")

    # Composite indexes for the two most common query patterns in the positions API
    __table_args__ = (
        # Dashboard queries filter by wallet + status (e.g., "show me my open positions")
        Index("ix_positions_wallet_status", "wallet_address", "status"),
        # Analytics queries filter by asset + status (e.g., "all open QQQ positions")
        Index("ix_positions_asset_status", "asset", "status"),
    )


# ─── AI Agent Runs ──────────────────────────────────────────────

# AgentRun tracks a single execution of an AI trading strategy
class AgentRun(Base):
    __tablename__ = "agent_runs"

    # Surrogate PK for referencing specific runs in the API
    id = Column(Integer, primary_key=True)
    # FK to users — agents act on behalf of a user's wallet
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Denormalized for direct wallet-based queries without joining users
    wallet_address = Column(String(42), nullable=False, index=True)

    # Strategy name identifies the algorithm (momentum, mean_reversion, etc.)
    strategy = Column(String(100), nullable=False)  # e.g. "momentum", "mean_reversion"
    # JSONB config stores strategy parameters — flexible schema for different strategy types
    config = Column(JSONB, default=dict)  # strategy parameters
    # Which asset this agent run trades — agents are single-asset for simplicity
    asset = Column(String(10), nullable=False)

    # Optional link to an external agent (null for browser-initiated runs)
    external_agent_id = Column(Integer, ForeignKey("external_agents.id"), nullable=True)
    # Whether this run was created from the browser or via external agent API
    source = Column(Enum(AgentSource), default=AgentSource.BROWSER)

    # Current execution state — indexed because the UI frequently filters by running/completed
    status = Column(Enum(AgentStatus), default=AgentStatus.RUNNING, index=True)
    # When the agent started executing — server-side timestamp for consistency
    started_at = Column(DateTime, server_default=func.now())
    # When the agent finished — null while still running
    ended_at = Column(DateTime)

    # Running count of trades executed — avoids counting actions table on every request
    total_trades = Column(Integer, default=0)
    # Cumulative PnL across all trades in this run — Numeric for financial precision
    total_pnl = Column(Numeric(28, 6), default=0)
    # Worst peak-to-trough drawdown — Float is fine since this is a derived metric
    max_drawdown = Column(Float)
    # Error details if the agent failed — Text allows arbitrarily long stack traces
    error_message = Column(Text)

    # ORM link back to the user who owns this agent run
    user = relationship("User", back_populates="agent_runs")
    # Link to external agent (if this run was created via API key)
    external_agent = relationship("ExternalAgent", back_populates="runs")
    # Ordered child actions — order_by ensures chronological display in the UI
    actions = relationship("AgentAction", back_populates="run", order_by="AgentAction.executed_at")


# AgentAction records a single trade or adjustment made by an AI agent during a run
class AgentAction(Base):
    __tablename__ = "agent_actions"

    # Surrogate PK for each individual action
    id = Column(Integer, primary_key=True)
    # FK to the parent run — every action belongs to exactly one agent run
    run_id = Column(Integer, ForeignKey("agent_runs.id"), nullable=False)

    # Type of action taken — open, close, adjust, rebalance (extensible string, not enum)
    action_type = Column(String(50), nullable=False)  # open, close, adjust, rebalance
    # Which asset was traded — nullable because some actions (rebalance) may span assets
    asset = Column(String(10))
    # Leverage level applied — Float is acceptable since this is for display, not on-chain math
    leverage = Column(Float)
    # USDC amount involved in this action — Numeric for financial precision
    amount = Column(Numeric(28, 6))
    # AI-generated explanation of why this action was taken — key for strategy transparency
    reason = Column(Text)  # AI reasoning for the action

    # Whether the on-chain transaction succeeded — enables filtering failed actions
    success = Column(Boolean, default=True)
    # Transaction hash for on-chain verification — null if action was off-chain analysis
    tx_hash = Column(String(66))
    # Market price at the time of action — needed for PnL calculations
    price_at_action = Column(Numeric(18, 8))
    # Error message if the action failed — helps debug agent strategy issues
    error = Column(Text)

    # When this action was executed — server-side for consistency
    executed_at = Column(DateTime, server_default=func.now())

    # Back-reference to the parent AgentRun for ORM navigation (action.run)
    run = relationship("AgentRun", back_populates="actions")


# ─── Price Cache ────────────────────────────────────────────────

# PriceCache stores Yahoo Finance responses in PostgreSQL — replaces frontend localStorage caching
# so all clients benefit from the same cache and we reduce Yahoo Finance API calls
class PriceCache(Base):
    __tablename__ = "price_cache"

    # Surrogate PK (the real lookup key is the composite index below)
    id = Column(Integer, primary_key=True)
    # Ticker symbol (QQQ, SPY, etc.) — indexed for fast lookups
    symbol = Column(String(10), nullable=False, index=True)
    # Data interval granularity — determines the candle size (1d, 1h, 5m)
    interval = Column(String(5), nullable=False)  # 1d, 1h, 5m
    # Time period requested — determines how far back the data goes (1y, 5y, max)
    period = Column(String(10), nullable=False)  # 1y, 5y, max

    # Full Yahoo Finance JSON response stored as JSONB — avoids re-parsing on cache hits
    data = Column(JSONB, nullable=False)
    # When this cache entry was last fetched — compared against TTL to decide staleness
    fetched_at = Column(DateTime, server_default=func.now())

    # Unique composite index ensures one cache row per symbol+interval+period combination
    __table_args__ = (
        Index("ix_price_cache_lookup", "symbol", "interval", "period", unique=True),
    )


# ─── Alerts ─────────────────────────────────────────────────────

# Alert lets users set conditions (price, health, PnL) that trigger notifications
class Alert(Base):
    __tablename__ = "alerts"

    # Surrogate PK for API references (DELETE /alerts/{alert_id})
    id = Column(Integer, primary_key=True)
    # FK to users — alerts belong to a user
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Denormalized wallet address for direct queries without user table join
    wallet_address = Column(String(42), nullable=False, index=True)

    # Which condition to monitor — maps to the AlertType enum defined above
    alert_type = Column(Enum(AlertType), nullable=False)
    # Optional asset filter — null means the alert applies globally (e.g., health_below)
    asset = Column(String(10))
    # The numeric threshold that triggers the alert (price level, health factor, PnL %)
    threshold = Column(Float, nullable=False)  # price, health factor, PnL %
    # Current lifecycle state — indexed because most queries filter for active alerts only
    status = Column(Enum(AlertStatus), default=AlertStatus.ACTIVE, index=True)

    # Optional user-provided note displayed when the alert fires
    message = Column(Text)  # custom user message
    # When the alert condition was met — null until triggered
    triggered_at = Column(DateTime)
    # When the alert was created — for display ordering in the UI
    created_at = Column(DateTime, server_default=func.now())

    # Back-reference to User for ORM navigation (alert.user)
    user = relationship("User", back_populates="alerts")


# ─── User Sessions ─────────────────────────────────────────────

# UserSession tracks each wallet connection event for admin analytics
class UserSession(Base):
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wallet_address = Column(String(42), nullable=False, index=True)

    # When the session started (wallet connected)
    connected_at = Column(DateTime, server_default=func.now())
    # When the session ended (wallet disconnected or tab closed) — null if still active
    disconnected_at = Column(DateTime)
    # Duration in seconds — computed on disconnect for fast aggregation queries
    duration_seconds = Column(Integer)

    # Client metadata for analytics
    ip_address = Column(String(45))  # IPv6 max length
    user_agent = Column(Text)
    referrer = Column(Text)
    # Page the user was on when they connected
    page = Column(String(100))
    # Country/region derived from IP (populated by backend)
    country = Column(String(100))

    user = relationship("User", back_populates="sessions")


# ─── External Agents ───────────────────────────────────────────

# ExternalAgent represents a registered AI agent (OpenClaw, AutoGPT, custom bot)
# that can trade on behalf of a wallet owner via API key authentication.
class ExternalAgent(Base):
    __tablename__ = "external_agents"

    id = Column(Integer, primary_key=True)
    # SHA-256 hash of the API key — plaintext is never stored
    api_key_hash = Column(String(64), unique=True, nullable=False, index=True)
    # Human-readable agent name for display ("OpenClaw v2", "My Arb Bot")
    name = Column(String(100), nullable=False)
    # The wallet that registered this agent — only wallet owners can register agents
    owner_wallet = Column(String(42), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Scoped permission flags — same keys as PERMISSIONS in agents.py
    # e.g. {"canClose": true, "canReduceLeverage": true, "canOpenNew": false, ...}
    permissions = Column(JSONB, nullable=False, default=dict)
    # Asset whitelist — empty means all assets allowed
    allowed_assets = Column(JSONB, default=list)
    # Webhook URL for event notifications (action success/fail, position changes)
    webhook_url = Column(String(500), nullable=True)
    # HMAC secret for signing webhook payloads
    webhook_secret = Column(String(64), nullable=True)
    # Per-agent rate limit — owner can tune this
    rate_limit_per_minute = Column(Integer, default=10)

    # Soft kill switch — set to False to disable without deleting
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    last_used_at = Column(DateTime, nullable=True)

    # ORM relationships
    owner = relationship("User", back_populates="external_agents")
    runs = relationship("AgentRun", back_populates="external_agent")


# ─── Webhook Events ────────────────────────────────────────────

# WebhookEvent logs delivery attempts for debugging webhook integrations
class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id = Column(Integer, primary_key=True)
    agent_id = Column(Integer, ForeignKey("external_agents.id"), nullable=False)
    # Event type: "action_recorded", "action_success", "action_failed", "run_stopped"
    event_type = Column(String(50), nullable=False)
    # Full JSON payload that was sent
    payload = Column(JSONB, nullable=False)
    # HTTP status code from the webhook URL — null if delivery failed
    status_code = Column(Integer, nullable=True)
    # When the webhook was delivered (or attempted)
    delivered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
