"""Pytest fixtures for xLever agent tests."""

import pytest
import pytest_asyncio
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock

from agent.config import Settings, AgentConfig, RiskConfig, BlockchainConfig, APIConfig
from agent.models.position import Position, PositionStatus, PositionDirection
from agent.intelligence.market import MarketState, PoolState, PriceData
from agent.strategy.llm_strategy import TradingDecision, DecisionAction, Urgency


@pytest.fixture
def mock_settings():
    """Provide test settings with safe defaults."""
    return Settings(
        blockchain=BlockchainConfig(
            rpc_url="https://rpc-gel-sepolia.inkonchain.com/",
            chain_id=763373,
            private_key="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        ),
        apis=APIConfig(
            perplexity_api_key="test_api_key",
        ),
        agent=AgentConfig(
            mode="simulation",
            loop_interval=300,
        ),
        risk=RiskConfig(
            max_leverage_bps=50000,
            max_position_usdc=1000.0,
            stop_loss_pct=10.0,
            take_profit_pct=20.0,
        ),
    )


@pytest.fixture
def sample_pool_state():
    """Provide sample pool state for testing."""
    return PoolState(
        net_exposure_long=50000.0,
        net_exposure_short=30000.0,
        junior_ratio=0.35,
        total_liquidity_usdc=100000.0,
        funding_rate_bps=500,
        health_score=1.6,
    )


@pytest.fixture
def sample_market_state(sample_pool_state):
    """Provide sample market state for testing."""
    return MarketState(
        asset="wSPYx",
        spot_price=550.0,
        twap_price=551.0,
        price_24h_change_pct=1.5,
        volatility_24h_pct=2.3,
        pool_state=sample_pool_state,
        divergence_bps=181,  # (550-551)/551 * 10000 ≈ -181 bps
        sentiment="bullish",
        sentiment_confidence=75,
        upcoming_events=["FOMC Meeting", "Jobs Report"],
        risk_factors=["High volatility", "Market uncertainty"],
        position_bias="long",
        timestamp=datetime.now(),
    )


@pytest.fixture
def sample_position_long():
    """Provide sample long position for testing."""
    return Position(
        id=1,
        asset="wSPYx",
        direction=PositionDirection.LONG,
        entry_price=540.0,
        leverage_bps=30000,  # 3x
        size_usdc=1000.0,
        status=PositionStatus.OPEN,
        vault_address="0x1234567890123456789012345678901234567890",
        created_at=datetime.now() - timedelta(hours=2),
        tx_hashes={"open_tx": "0xabcd...1234"},
    )


@pytest.fixture
def sample_position_short():
    """Provide sample short position for testing."""
    return Position(
        id=2,
        asset="wQQQx",
        direction=PositionDirection.SHORT,
        entry_price=460.0,
        leverage_bps=20000,  # 2x
        size_usdc=500.0,
        status=PositionStatus.OPEN,
        vault_address="0x1234567890123456789012345678901234567890",
        created_at=datetime.now() - timedelta(hours=1),
        tx_hashes={"open_tx": "0xefgh...5678"},
    )


@pytest.fixture
def sample_closed_position():
    """Provide sample closed position for testing."""
    return Position(
        id=3,
        asset="wSPYx",
        direction=PositionDirection.LONG,
        entry_price=530.0,
        leverage_bps=25000,  # 2.5x
        size_usdc=800.0,
        status=PositionStatus.CLOSED,
        exit_price=545.0,
        exit_reason="Take profit triggered",
        pnl=71.0,  # (545-530)/530 * 2.5 * 800 ≈ 71
        pnl_pct=8.87,
        vault_address="0x1234567890123456789012345678901234567890",
        created_at=datetime.now() - timedelta(days=1, hours=3),
        closed_at=datetime.now() - timedelta(days=1),
        tx_hashes={"open_tx": "0xijkl...9012", "close_tx": "0xmnop...3456"},
    )


@pytest.fixture
def sample_decision_open_long():
    """Provide sample OPEN_LONG decision for testing."""
    return TradingDecision(
        action=DecisionAction.OPEN_LONG,
        asset="wSPYx",
        leverage_bps=30000,  # 3x
        size_usdc=1000.0,
        confidence=80,
        reasoning="Strong bullish sentiment, positive technicals, favorable pool state",
        urgency=Urgency.MEDIUM,
    )


@pytest.fixture
def sample_decision_open_short():
    """Provide sample OPEN_SHORT decision for testing."""
    return TradingDecision(
        action=DecisionAction.OPEN_SHORT,
        asset="wQQQx",
        leverage_bps=20000,  # 2x
        size_usdc=500.0,
        confidence=70,
        reasoning="Bearish technicals, overbought conditions",
        urgency=Urgency.LOW,
    )


@pytest.fixture
def sample_decision_close():
    """Provide sample CLOSE decision for testing."""
    return TradingDecision(
        action=DecisionAction.CLOSE,
        asset="wSPYx",
        confidence=90,
        reasoning="Take profit target reached",
        urgency=Urgency.HIGH,
    )


@pytest.fixture
def sample_decision_hold():
    """Provide sample HOLD decision for testing."""
    return TradingDecision(
        action=DecisionAction.HOLD,
        asset="wSPYx",
        confidence=50,
        reasoning="Market conditions unclear, insufficient signal strength",
        urgency=Urgency.LOW,
    )


@pytest.fixture
def sample_decision_adjust_leverage():
    """Provide sample ADJUST_LEVERAGE decision for testing."""
    return TradingDecision(
        action=DecisionAction.ADJUST_LEVERAGE,
        asset="wSPYx",
        leverage_bps=25000,  # Adjust to 2.5x
        confidence=65,
        reasoning="Reducing leverage due to increased volatility",
        urgency=Urgency.MEDIUM,
    )


@pytest.fixture
def position_history():
    """Provide position history for testing locks and daily loss."""
    # Closed position from 5 hours ago - opposite direction
    old_pos = Position(
        id=10,
        asset="wSPYx",
        direction=PositionDirection.SHORT,
        entry_price=560.0,
        leverage_bps=20000,
        size_usdc=500.0,
        status=PositionStatus.CLOSED,
        exit_price=555.0,
        pnl=9.0,  # Small profit
        pnl_pct=1.79,
        vault_address="0x1234567890123456789012345678901234567890",
        created_at=datetime.now() - timedelta(hours=7),
        closed_at=datetime.now() - timedelta(hours=5),
        tx_hashes={},
    )

    # Closed position from 3 hours ago - opposite direction (for flip lock testing)
    recent_pos = Position(
        id=11,
        asset="wSPYx",
        direction=PositionDirection.SHORT,
        entry_price=550.0,
        leverage_bps=20000,
        size_usdc=600.0,
        status=PositionStatus.CLOSED,
        exit_price=545.0,
        pnl=10.9,  # (550-545)/550 * 2 * 600 ≈ 10.9
        pnl_pct=1.82,
        vault_address="0x1234567890123456789012345678901234567890",
        created_at=datetime.now() - timedelta(hours=5),
        closed_at=datetime.now() - timedelta(hours=3),
        tx_hashes={},
    )

    # Recent losing position from today (for daily loss testing)
    losing_pos_today = Position(
        id=12,
        asset="wQQQx",
        direction=PositionDirection.LONG,
        entry_price=470.0,
        leverage_bps=30000,
        size_usdc=800.0,
        status=PositionStatus.CLOSED,
        exit_price=455.0,
        pnl=-76.6,  # (455-470)/470 * 3 * 800 ≈ -76.6
        pnl_pct=-9.57,
        vault_address="0x1234567890123456789012345678901234567890",
        created_at=datetime.now() - timedelta(hours=2),
        closed_at=datetime.now() - timedelta(hours=1),
        tx_hashes={},
    )

    return [old_pos, recent_pos, losing_pos_today]


@pytest_asyncio.fixture
async def mock_perplexity_client():
    """Provide mock Perplexity client for testing."""
    client = AsyncMock()

    # Default response for trading decisions
    client.query.return_value = Mock(
        content='{"action": "HOLD", "confidence": 50, "reasoning": "Neutral conditions", "urgency": "low"}'
    )

    return client


@pytest_asyncio.fixture
async def mock_web3_client():
    """Provide mock Web3 client for testing."""
    client = AsyncMock()

    # Default responses
    client.get_block_number.return_value = 12345678
    client.get_balance.return_value = 1000.0
    client.is_connected.return_value = True

    return client


@pytest.fixture
def mock_price_data():
    """Provide mock price data for testing."""
    return PriceData(
        price=550.0,
        confidence=0.5,
        expo=-8,
        publish_time=datetime.now(),
    )
