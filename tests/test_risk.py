"""Unit tests for risk management modules."""

import pytest
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, Mock

from agent.risk.limits import (
    RiskLimits,
    RiskLimitChecker,
    TrailingStop,
)
from agent.risk.health import (
    HealthMonitor,
    HealthAction,
    HealthCheckResult,
    HS_SAFE,
    HS_WARNING,
    HS_LEVEL_1,
    HS_LEVEL_2,
    HS_LEVEL_3,
    HS_EMERGENCY,
)


class TestRiskLimits:
    """Test RiskLimits configuration."""

    def test_default_limits(self):
        """Test default limit values."""
        limits = RiskLimits()

        assert limits.stop_loss_percent == 15.0
        assert limits.take_profit_percent == 30.0
        assert limits.trailing_stop_percent == 10.0
        assert limits.daily_loss_limit_percent == 5.0
        assert limits.max_position_size_usdc == 10000.0

    def test_custom_limits(self):
        """Test custom limit configuration."""
        limits = RiskLimits(
            stop_loss_percent=20.0,
            take_profit_percent=40.0,
            trailing_stop_percent=15.0,
            daily_loss_limit_percent=3.0,
            max_position_size_usdc=5000.0,
        )

        assert limits.stop_loss_percent == 20.0
        assert limits.take_profit_percent == 40.0
        assert limits.trailing_stop_percent == 15.0
        assert limits.daily_loss_limit_percent == 3.0
        assert limits.max_position_size_usdc == 5000.0

    def test_validate_valid_limits(self):
        """Test validation passes for valid limits."""
        limits = RiskLimits()
        assert limits.validate()

    def test_validate_invalid_stop_loss(self):
        """Test validation fails for invalid stop loss."""
        limits = RiskLimits(stop_loss_percent=0)
        assert not limits.validate()

        limits = RiskLimits(stop_loss_percent=150)
        assert not limits.validate()

    def test_validate_invalid_daily_loss(self):
        """Test validation fails for invalid daily loss limit."""
        limits = RiskLimits(daily_loss_limit_percent=-1)
        assert not limits.validate()


class TestTrailingStop:
    """Test TrailingStop functionality."""

    def test_trailing_stop_long_update(self):
        """Test trailing stop updates for long position."""
        trailing = TrailingStop(
            entry_price=100.0,
            highest_price=100.0,
            trailing_percent=10.0,
            is_long=True,
        )

        # Price goes up
        trailing.update(110.0)
        assert trailing.highest_price == 110.0

        # Price goes down (doesn't update highest)
        trailing.update(105.0)
        assert trailing.highest_price == 110.0

    def test_trailing_stop_short_update(self):
        """Test trailing stop updates for short position."""
        trailing = TrailingStop(
            entry_price=100.0,
            highest_price=100.0,
            trailing_percent=10.0,
            is_long=False,
        )

        # Price goes down (good for short)
        trailing.update(90.0)
        assert trailing.highest_price == 90.0

        # Price goes up (doesn't update)
        trailing.update(95.0)
        assert trailing.highest_price == 90.0

    def test_trailing_stop_long_trigger(self):
        """Test trailing stop trigger for long position."""
        trailing = TrailingStop(
            entry_price=100.0,
            highest_price=120.0,
            trailing_percent=10.0,
            is_long=True,
        )

        # Price at 109 (9% below high) - should not trigger
        assert not trailing.should_trigger(109.0)

        # Price at 107 (10.8% below high) - should trigger
        assert trailing.should_trigger(107.0)

    def test_trailing_stop_short_trigger(self):
        """Test trailing stop trigger for short position."""
        trailing = TrailingStop(
            entry_price=100.0,
            highest_price=80.0,
            trailing_percent=10.0,
            is_long=False,
        )

        # Price at 87 (8.75% above low) - should not trigger
        assert not trailing.should_trigger(87.0)

        # Price at 89 (11.25% above low) - should trigger
        assert trailing.should_trigger(89.0)

    def test_stop_price_calculation_long(self):
        """Test stop price calculation for long."""
        trailing = TrailingStop(
            entry_price=100.0,
            highest_price=120.0,
            trailing_percent=10.0,
            is_long=True,
        )

        assert trailing.stop_price == 108.0  # 120 * 0.9

    def test_stop_price_calculation_short(self):
        """Test stop price calculation for short."""
        trailing = TrailingStop(
            entry_price=100.0,
            highest_price=80.0,
            trailing_percent=10.0,
            is_long=False,
        )

        assert trailing.stop_price == 88.0  # 80 * 1.1


class TestRiskLimitChecker:
    """Test RiskLimitChecker functionality."""

    def test_initialization(self):
        """Test checker initialization."""
        limits = RiskLimits()
        checker = RiskLimitChecker(limits)

        assert checker.limits == limits
        assert checker.today_pnl == 0.0
        assert checker.active_trailing_stops == 0

    def test_initialization_validates_limits(self):
        """Test initialization validates limits."""
        invalid_limits = RiskLimits(stop_loss_percent=0)

        with pytest.raises(ValueError, match="Invalid risk limits"):
            RiskLimitChecker(invalid_limits)

    def test_stop_loss_trigger_long(self):
        """Test stop loss trigger for long position."""
        checker = RiskLimitChecker(RiskLimits(stop_loss_percent=15.0))

        # Entry at 100, current at 86 (14% loss) - should not trigger
        assert not checker.should_stop_loss(100.0, 86.0, is_long=True)

        # Current at 84 (16% loss) - should trigger
        assert checker.should_stop_loss(100.0, 84.0, is_long=True)

    def test_stop_loss_trigger_short(self):
        """Test stop loss trigger for short position."""
        checker = RiskLimitChecker(RiskLimits(stop_loss_percent=15.0))

        # Entry at 100, current at 114 (14% loss) - should not trigger
        assert not checker.should_stop_loss(100.0, 114.0, is_long=False)

        # Current at 116 (16% loss) - should trigger
        assert checker.should_stop_loss(100.0, 116.0, is_long=False)

    def test_take_profit_trigger_long(self):
        """Test take profit trigger for long position."""
        checker = RiskLimitChecker(RiskLimits(take_profit_percent=30.0))

        # Entry at 100, current at 128 (28% profit) - should not trigger
        assert not checker.should_take_profit(100.0, 128.0, is_long=True)

        # Current at 131 (31% profit) - should trigger
        assert checker.should_take_profit(100.0, 131.0, is_long=True)

    def test_take_profit_trigger_short(self):
        """Test take profit trigger for short position."""
        checker = RiskLimitChecker(RiskLimits(take_profit_percent=30.0))

        # Entry at 100, current at 72 (28% profit) - should not trigger
        assert not checker.should_take_profit(100.0, 72.0, is_long=False)

        # Current at 69 (31% profit) - should trigger
        assert checker.should_take_profit(100.0, 69.0, is_long=False)

    def test_create_trailing_stop(self):
        """Test creating and tracking trailing stop."""
        checker = RiskLimitChecker()

        trailing = checker.create_trailing_stop(
            position_id=1,
            entry_price=100.0,
            current_price=110.0,
            is_long=True,
        )

        assert trailing.entry_price == 100.0
        assert trailing.highest_price == 110.0
        assert trailing.is_long is True
        assert checker.active_trailing_stops == 1

    def test_update_trailing_stop(self):
        """Test updating trailing stop."""
        checker = RiskLimitChecker()

        checker.create_trailing_stop(
            position_id=1,
            entry_price=100.0,
            current_price=110.0,
            is_long=True,
        )

        # Update with higher price
        should_trigger = checker.update_trailing_stop(1, 120.0)
        assert not should_trigger

        # Update with price that triggers stop
        should_trigger = checker.update_trailing_stop(1, 105.0)
        assert should_trigger

    def test_update_nonexistent_trailing_stop(self):
        """Test updating non-existent trailing stop."""
        checker = RiskLimitChecker()

        should_trigger = checker.update_trailing_stop(999, 100.0)
        assert not should_trigger

    def test_remove_trailing_stop(self):
        """Test removing trailing stop."""
        checker = RiskLimitChecker()

        checker.create_trailing_stop(1, 100.0, 110.0, True)
        assert checker.active_trailing_stops == 1

        checker.remove_trailing_stop(1)
        assert checker.active_trailing_stops == 0

    def test_record_realized_pnl(self):
        """Test recording realized PnL."""
        checker = RiskLimitChecker()

        checker.record_realized_pnl(50.0)
        assert checker.today_pnl == 50.0

        checker.record_realized_pnl(-30.0)
        assert checker.today_pnl == 20.0

    def test_daily_loss_limit_not_exceeded(self):
        """Test daily loss limit not exceeded."""
        checker = RiskLimitChecker(RiskLimits(daily_loss_limit_percent=5.0))

        # Record small loss
        checker.record_realized_pnl(-200.0)

        # Check against capital of 10000
        assert not checker.is_daily_loss_exceeded(capital=10000.0)

    def test_daily_loss_limit_exceeded(self):
        """Test daily loss limit exceeded."""
        checker = RiskLimitChecker(RiskLimits(daily_loss_limit_percent=5.0))

        # Record large loss (6% of 10000)
        checker.record_realized_pnl(-600.0)

        # Check against capital of 10000
        assert checker.is_daily_loss_exceeded(capital=10000.0)

    def test_daily_loss_positive_pnl(self):
        """Test positive PnL doesn't trigger daily loss."""
        checker = RiskLimitChecker(RiskLimits(daily_loss_limit_percent=5.0))

        checker.record_realized_pnl(500.0)

        assert not checker.is_daily_loss_exceeded(capital=10000.0)

    def test_daily_reset(self):
        """Test daily PnL resets on new day."""
        checker = RiskLimitChecker()

        # Record loss
        checker.record_realized_pnl(-100.0)
        assert checker.today_pnl == -100.0

        # Simulate day change by manually resetting
        checker._today_date = date.today() - timedelta(days=1)

        # Record new PnL
        checker.record_realized_pnl(50.0)

        # Should have reset
        assert checker.today_pnl == 50.0

    def test_get_daily_pnl(self):
        """Test getting daily PnL."""
        checker = RiskLimitChecker()

        checker.record_realized_pnl(100.0)
        checker.record_realized_pnl(-50.0)

        today_pnl = checker.get_daily_pnl()
        assert today_pnl == 50.0

    def test_get_pnl_summary(self):
        """Test getting PnL summary."""
        checker = RiskLimitChecker()

        checker.record_realized_pnl(100.0)

        summary = checker.get_pnl_summary(days=7)

        assert isinstance(summary, dict)
        assert len(summary) <= 7
        assert date.today().isoformat() in summary


class TestHealthMonitor:
    """Test HealthMonitor functionality."""

    @pytest_asyncio.fixture
    async def mock_web3_client(self):
        """Mock Web3 client."""
        client = AsyncMock()
        return client

    @pytest_asyncio.fixture
    async def health_monitor(self, mock_web3_client):
        """Create health monitor for testing."""
        monitor = HealthMonitor(
            web3_client=mock_web3_client,
            vault_address="0x1234567890123456789012345678901234567890",
            poll_interval=60,
        )
        return monitor

    @pytest.mark.asyncio
    async def test_get_health_score(self, health_monitor):
        """Test fetching health score."""
        # Currently returns mock value
        health_score = await health_monitor.get_health_score()

        assert isinstance(health_score, float)
        assert health_score > 0

    def test_get_action_for_emergency_health(self, health_monitor):
        """Test emergency health action."""
        result = health_monitor.get_action_for_health_score(1.03)

        assert result.action == HealthAction.EMERGENCY_EXIT
        assert result.severity == "critical"
        assert "EMERGENCY" in result.message

    def test_get_action_for_level_3_health(self, health_monitor):
        """Test level 3 health action."""
        result = health_monitor.get_action_for_health_score(1.09)

        assert result.action == HealthAction.REDUCE_TO_1_5X
        assert result.severity == "critical"

    def test_get_action_for_level_2_health(self, health_monitor):
        """Test level 2 health action."""
        result = health_monitor.get_action_for_health_score(1.19)

        assert result.action == HealthAction.REDUCE_50_PERCENT
        assert result.severity == "critical"

    def test_get_action_for_level_1_health(self, health_monitor):
        """Test level 1 health action."""
        result = health_monitor.get_action_for_health_score(1.29)

        assert result.action == HealthAction.REDUCE_25_PERCENT
        assert result.severity == "warning"

    def test_get_action_for_warning_health(self, health_monitor):
        """Test warning health action."""
        result = health_monitor.get_action_for_health_score(1.45)

        assert result.action == HealthAction.ALERT_WARNING
        assert result.severity == "warning"

    def test_get_action_for_safe_health(self, health_monitor):
        """Test safe health action."""
        result = health_monitor.get_action_for_health_score(1.6)

        assert result.action == HealthAction.NONE
        assert result.severity == "info"

    @pytest.mark.asyncio
    async def test_check_and_act(self, health_monitor):
        """Test check and act."""
        result = await health_monitor.check_and_act()

        assert isinstance(result, HealthCheckResult)
        assert result.health_score > 0
        assert result.action in HealthAction

    def test_requires_immediate_action_true(self, health_monitor):
        """Test requires immediate action returns true for critical levels."""
        result = health_monitor.get_action_for_health_score(1.15)

        assert result.requires_immediate_action

    def test_requires_immediate_action_false(self, health_monitor):
        """Test requires immediate action returns false for safe levels."""
        result = health_monitor.get_action_for_health_score(1.6)

        assert not result.requires_immediate_action

    def test_last_health_score_tracking(self, health_monitor):
        """Test last health score is tracked."""
        assert health_monitor.last_health_score is None

        health_monitor._last_health_score = 1.5
        assert health_monitor.last_health_score == 1.5

    def test_is_healthy_property(self, health_monitor):
        """Test is_healthy property."""
        # No health score recorded
        assert not health_monitor.is_healthy

        # Healthy score
        health_monitor._last_health_score = 1.5
        assert health_monitor.is_healthy

        # Unhealthy score
        health_monitor._last_health_score = 1.3
        assert not health_monitor.is_healthy

    @pytest.mark.asyncio
    async def test_start_stop_monitoring(self, health_monitor):
        """Test starting and stopping monitoring."""
        # Start monitoring
        await health_monitor.start_monitoring()

        # Should be running
        assert health_monitor._running

        # Stop monitoring
        await health_monitor.stop_monitoring()

        # Should not be running
        assert not health_monitor._running
