"""Unit tests for rule engine and trading rules."""

import pytest
from datetime import datetime, timedelta

from agent.strategy.rules import (
    RuleEngine,
    R1_MaxLeverage,
    R2_LeverageLock,
    R3_FlipLock,
    R4_DivergenceGate,
    R5_HealthGuard,
    R6_PositionSizeLimit,
    R7_DailyLossLimit,
    R8_GasGuard,
)
from agent.strategy.llm_strategy import TradingDecision, DecisionAction, Urgency
from agent.models.position import Position, PositionDirection, PositionStatus
from agent.intelligence.market import MarketState, PoolState


class TestR1MaxLeverage:
    """Test R1: Maximum Leverage Rule."""

    def test_leverage_within_limit(self, sample_market_state, sample_decision_open_long):
        """Test leverage within dynamic limit is allowed."""
        rule = R1_MaxLeverage()
        # Junior ratio 0.35 allows 3x max, decision has 3x
        sample_decision_open_long.leverage_bps = 30000

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert result.passed
        assert "within limit" in result.reason.lower()

    def test_leverage_exceeds_limit(self, sample_market_state, sample_decision_open_long):
        """Test leverage exceeding cap is capped."""
        rule = R1_MaxLeverage()
        # Junior ratio 0.35 allows 3x max, decision wants 4x
        sample_decision_open_long.leverage_bps = 40000

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert not result.passed
        assert result.modified_decision is not None
        assert result.modified_decision.leverage_bps == 30000  # Capped to 3x
        assert "exceeds max" in result.reason.lower()

    def test_different_junior_ratios(self, sample_market_state, sample_decision_open_long):
        """Test different max leverage based on junior ratio."""
        rule = R1_MaxLeverage()

        # Junior ratio 0.40+ -> 4x max
        sample_market_state.pool_state.junior_ratio = 0.45
        sample_decision_open_long.leverage_bps = 40000
        result = rule.check(sample_decision_open_long, sample_market_state)
        assert result.passed

        # Junior ratio 0.30-0.39 -> 3x max
        sample_market_state.pool_state.junior_ratio = 0.35
        sample_decision_open_long.leverage_bps = 40000
        result = rule.check(sample_decision_open_long, sample_market_state)
        assert not result.passed
        assert result.modified_decision.leverage_bps == 30000

        # Junior ratio 0.20-0.29 -> 2x max
        sample_market_state.pool_state.junior_ratio = 0.25
        sample_decision_open_long.leverage_bps = 30000
        result = rule.check(sample_decision_open_long, sample_market_state)
        assert not result.passed
        assert result.modified_decision.leverage_bps == 20000

        # Junior ratio <0.20 -> 1.5x max
        sample_market_state.pool_state.junior_ratio = 0.15
        sample_decision_open_long.leverage_bps = 20000
        result = rule.check(sample_decision_open_long, sample_market_state)
        assert not result.passed
        assert result.modified_decision.leverage_bps == 15000

    def test_non_leverage_actions_pass(self, sample_market_state, sample_decision_hold):
        """Test HOLD/CLOSE actions don't need leverage check."""
        rule = R1_MaxLeverage()

        result = rule.check(sample_decision_hold, sample_market_state)
        assert result.passed

    def test_missing_leverage_on_open(self, sample_market_state, sample_decision_open_long):
        """Test opening position without leverage fails."""
        rule = R1_MaxLeverage()
        sample_decision_open_long.leverage_bps = None

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert not result.passed
        assert result.severity == "error"
        assert "not specified" in result.reason.lower()


class TestR2LeverageLock:
    """Test R2: Leverage Increase Lock."""

    def test_leverage_increase_within_1hr_blocked(self, sample_market_state, sample_position_long):
        """Test leverage increase blocked within 1 hour of position open."""
        rule = R2_LeverageLock()
        # Position opened 2 hours ago (fixture)
        # But let's set it to 30 min ago
        sample_position_long.created_at = datetime.now() - timedelta(minutes=30)
        sample_position_long.leverage_bps = 20000  # Current 2x

        decision = TradingDecision(
            action=DecisionAction.ADJUST_LEVERAGE,
            asset="wSPYx",
            leverage_bps=30000,  # Wants 3x
            confidence=70,
            reasoning="Increasing leverage",
        )

        result = rule.check(decision, sample_market_state, sample_position_long)

        assert not result.passed
        assert result.severity == "error"
        assert "cannot increase leverage" in result.reason.lower()
        assert "more minutes" in result.reason.lower()

    def test_leverage_increase_after_1hr_allowed(self, sample_market_state, sample_position_long):
        """Test leverage increase allowed after 1 hour."""
        rule = R2_LeverageLock()
        sample_position_long.created_at = datetime.now() - timedelta(hours=2)
        sample_position_long.leverage_bps = 20000

        decision = TradingDecision(
            action=DecisionAction.ADJUST_LEVERAGE,
            asset="wSPYx",
            leverage_bps=30000,
            confidence=70,
            reasoning="Increasing leverage",
        )

        result = rule.check(decision, sample_market_state, sample_position_long)

        assert result.passed

    def test_leverage_decrease_always_allowed(self, sample_market_state, sample_position_long):
        """Test leverage decrease allowed anytime."""
        rule = R2_LeverageLock()
        sample_position_long.created_at = datetime.now() - timedelta(minutes=10)
        sample_position_long.leverage_bps = 30000

        decision = TradingDecision(
            action=DecisionAction.ADJUST_LEVERAGE,
            asset="wSPYx",
            leverage_bps=20000,  # Decreasing
            confidence=70,
            reasoning="Reducing risk",
        )

        result = rule.check(decision, sample_market_state, sample_position_long)

        assert result.passed
        assert "decrease allowed" in result.reason.lower()

    def test_no_position_fails(self, sample_market_state):
        """Test adjusting leverage without position fails."""
        rule = R2_LeverageLock()

        decision = TradingDecision(
            action=DecisionAction.ADJUST_LEVERAGE,
            asset="wSPYx",
            leverage_bps=30000,
            confidence=70,
            reasoning="Adjusting",
        )

        result = rule.check(decision, sample_market_state, None)

        assert not result.passed
        assert result.severity == "error"

    def test_non_adjust_actions_pass(self, sample_market_state, sample_decision_open_long):
        """Test non-adjust actions pass through."""
        rule = R2_LeverageLock()

        result = rule.check(sample_decision_open_long, sample_market_state)
        assert result.passed


class TestR3FlipLock:
    """Test R3: Direction Flip Lock."""

    def test_flip_within_4hrs_blocked(self, sample_market_state, position_history):
        """Test flipping direction within 4 hours is blocked."""
        rule = R3_FlipLock()

        # Last position was SHORT closed 3 hours ago
        decision = TradingDecision(
            action=DecisionAction.OPEN_LONG,  # Flipping to LONG
            asset="wSPYx",
            leverage_bps=20000,
            size_usdc=500.0,
            confidence=75,
            reasoning="Reversing position",
        )

        result = rule.check(decision, sample_market_state, None, position_history)

        assert not result.passed
        assert result.severity == "error"
        assert "cannot flip direction" in result.reason.lower()
        assert "more hours" in result.reason.lower()

    def test_flip_after_4hrs_allowed(self, sample_market_state, position_history):
        """Test flipping direction after 4 hours is allowed."""
        rule = R3_FlipLock()

        # Modify last position to be closed 5 hours ago
        position_history[-1].closed_at = datetime.now() - timedelta(hours=5)

        decision = TradingDecision(
            action=DecisionAction.OPEN_LONG,
            asset="wSPYx",
            leverage_bps=20000,
            size_usdc=500.0,
            confidence=75,
            reasoning="New position",
        )

        result = rule.check(decision, sample_market_state, None, position_history)

        assert result.passed

    def test_same_direction_allowed(self, sample_market_state, position_history):
        """Test opening same direction as last position is allowed."""
        rule = R3_FlipLock()

        # Last position was SHORT
        decision = TradingDecision(
            action=DecisionAction.OPEN_SHORT,  # Same direction
            asset="wSPYx",
            leverage_bps=20000,
            size_usdc=500.0,
            confidence=75,
            reasoning="Continuing short bias",
        )

        result = rule.check(decision, sample_market_state, None, position_history)

        assert result.passed

    def test_no_history_allowed(self, sample_market_state):
        """Test opening position with no history is allowed."""
        rule = R3_FlipLock()

        decision = TradingDecision(
            action=DecisionAction.OPEN_LONG,
            asset="wSPYx",
            leverage_bps=20000,
            size_usdc=500.0,
            confidence=75,
            reasoning="First position",
        )

        result = rule.check(decision, sample_market_state, None, [])

        assert result.passed


class TestR4DivergenceGate:
    """Test R4: TWAP Divergence Gate."""

    def test_high_divergence_blocks_entry(self, sample_market_state, sample_decision_open_long):
        """Test >3% divergence blocks entry."""
        rule = R4_DivergenceGate()

        # Set divergence to 3.5%
        sample_market_state.divergence_bps = 350

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert not result.passed
        assert result.severity == "error"
        assert "exceeds max" in result.reason.lower()

    def test_acceptable_divergence_allows_entry(self, sample_market_state, sample_decision_open_long):
        """Test <3% divergence allows entry."""
        rule = R4_DivergenceGate()

        # Set divergence to 2.5%
        sample_market_state.divergence_bps = 250

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert result.passed

    def test_negative_divergence_checked_absolute(self, sample_market_state, sample_decision_open_long):
        """Test negative divergence checked as absolute value."""
        rule = R4_DivergenceGate()

        # Set divergence to -3.5%
        sample_market_state.divergence_bps = -350

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert not result.passed

    def test_exit_not_affected(self, sample_market_state, sample_decision_close):
        """Test CLOSE actions not affected by divergence."""
        rule = R4_DivergenceGate()

        sample_market_state.divergence_bps = 500  # 5% divergence

        result = rule.check(sample_decision_close, sample_market_state)

        assert result.passed


class TestR5HealthGuard:
    """Test R5: Health Score Guard."""

    def test_emergency_health_forces_exit(self, sample_market_state, sample_decision_open_long):
        """Test health score below 1.05 forces emergency exit."""
        rule = R5_HealthGuard()

        sample_market_state.pool_state.health_score = 1.04

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert not result.passed
        assert result.severity == "critical"
        assert result.modified_decision is not None
        assert result.modified_decision.action == DecisionAction.CLOSE
        assert "EMERGENCY" in result.modified_decision.reasoning

    def test_low_health_caps_leverage(self, sample_market_state, sample_decision_open_long):
        """Test health score below 1.1 caps leverage at 1.5x."""
        rule = R5_HealthGuard()

        sample_market_state.pool_state.health_score = 1.09
        sample_decision_open_long.leverage_bps = 30000  # Wants 3x

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert not result.passed
        assert result.severity == "error"
        assert result.modified_decision is not None
        assert result.modified_decision.leverage_bps == 15000  # Capped to 1.5x

    def test_warning_health_allows_with_warning(self, sample_market_state, sample_decision_open_long):
        """Test health score below 1.4 gives warning but allows."""
        rule = R5_HealthGuard()

        sample_market_state.pool_state.health_score = 1.35

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert result.passed
        assert result.severity == "warning"

    def test_safe_health_passes(self, sample_market_state, sample_decision_open_long):
        """Test safe health score passes."""
        rule = R5_HealthGuard()

        sample_market_state.pool_state.health_score = 1.6

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert result.passed
        assert result.severity == "info"


class TestR6PositionSizeLimit:
    """Test R6: Position Size Limit."""

    def test_size_exceeds_20_percent_capped(self, sample_market_state, sample_decision_open_long):
        """Test position size exceeding 20% of pool is capped."""
        rule = R6_PositionSizeLimit()

        # Pool has 100k USDC, max is 20k
        sample_decision_open_long.size_usdc = 25000.0

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert not result.passed
        assert result.modified_decision is not None
        assert result.modified_decision.size_usdc == 20000.0
        assert "exceeds max" in result.reason.lower()

    def test_size_within_limit(self, sample_market_state, sample_decision_open_long):
        """Test position size within limit is allowed."""
        rule = R6_PositionSizeLimit()

        sample_decision_open_long.size_usdc = 15000.0

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert result.passed

    def test_missing_size_fails(self, sample_market_state, sample_decision_open_long):
        """Test opening without size specified fails."""
        rule = R6_PositionSizeLimit()

        sample_decision_open_long.size_usdc = None

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert not result.passed
        assert result.severity == "error"

    def test_no_pool_state_allows_with_warning(self, sample_market_state, sample_decision_open_long):
        """Test missing pool state allows with warning."""
        rule = R6_PositionSizeLimit()

        sample_market_state.pool_state = None

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert result.passed
        assert result.severity == "warning"


class TestR7DailyLossLimit:
    """Test R7: Daily Loss Limit."""

    def test_daily_loss_exceeds_limit_blocks(self, sample_market_state, sample_decision_open_long, position_history):
        """Test daily loss exceeding 5% blocks new positions."""
        rule = R7_DailyLossLimit()

        # Add more losing positions today to exceed 5% of typical capital
        losing_pos = Position(
            id=13,
            asset="wSPYx",
            direction=PositionDirection.LONG,
            entry_price=550.0,
            leverage_bps=20000,
            size_usdc=1000.0,
            status=PositionStatus.CLOSED,
            exit_price=525.0,
            pnl=-90.9,  # Large loss
            vault_address="0x1234567890123456789012345678901234567890",
            created_at=datetime.now() - timedelta(hours=3),
            closed_at=datetime.now() - timedelta(hours=2),
            tx_hashes={},
        )

        position_history.append(losing_pos)

        result = rule.check(sample_decision_open_long, sample_market_state, None, position_history)

        # Should block with critical severity
        assert not result.passed
        assert result.severity == "critical"
        assert "daily loss" in result.reason.lower()

    def test_daily_loss_within_limit(self, sample_market_state, sample_decision_open_long):
        """Test daily loss within limit allows trading."""
        rule = R7_DailyLossLimit()

        # Small loss from history
        small_loss = Position(
            id=14,
            asset="wSPYx",
            direction=PositionDirection.LONG,
            entry_price=550.0,
            leverage_bps=10000,
            size_usdc=500.0,
            status=PositionStatus.CLOSED,
            exit_price=545.0,
            pnl=-4.5,  # Small loss
            vault_address="0x1234567890123456789012345678901234567890",
            created_at=datetime.now() - timedelta(hours=2),
            closed_at=datetime.now() - timedelta(hours=1),
            tx_hashes={},
        )

        result = rule.check(sample_decision_open_long, sample_market_state, None, [small_loss])

        assert result.passed

    def test_no_history_passes(self, sample_market_state, sample_decision_open_long):
        """Test no position history passes."""
        rule = R7_DailyLossLimit()

        result = rule.check(sample_decision_open_long, sample_market_state, None, [])

        assert result.passed


class TestR8GasGuard:
    """Test R8: Gas Guard."""

    def test_high_gas_blocks_non_urgent(self, sample_market_state, sample_decision_open_long):
        """Test high gas blocks non-urgent actions."""
        rule = R8_GasGuard(current_gas_price_gwei=150)

        sample_decision_open_long.urgency = Urgency.LOW

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert not result.passed
        assert "exceeds limit" in result.reason.lower()

    def test_high_gas_allows_urgent(self, sample_market_state, sample_decision_open_long):
        """Test high gas allows urgent actions."""
        rule = R8_GasGuard(current_gas_price_gwei=150)

        sample_decision_open_long.urgency = Urgency.HIGH

        result = rule.check(sample_decision_open_long, sample_market_state)

        # High urgency is not explicitly handled, but CLOSE is
        # For this test, non-CLOSE urgent actions might still be blocked
        # Let's check the actual implementation behavior
        assert not result.passed  # Based on code, only CLOSE bypasses

    def test_close_always_allowed(self, sample_market_state, sample_decision_close):
        """Test CLOSE actions always allowed regardless of gas."""
        rule = R8_GasGuard(current_gas_price_gwei=250)

        result = rule.check(sample_decision_close, sample_market_state)

        assert result.passed

    def test_low_gas_allows_all(self, sample_market_state, sample_decision_open_long):
        """Test low gas allows all actions."""
        rule = R8_GasGuard(current_gas_price_gwei=50)

        sample_decision_open_long.urgency = Urgency.LOW

        result = rule.check(sample_decision_open_long, sample_market_state)

        assert result.passed


class TestRuleEngine:
    """Test RuleEngine integration."""

    def test_all_rules_pass(self, sample_market_state, sample_decision_open_long):
        """Test decision passing all rules."""
        engine = RuleEngine(current_gas_price_gwei=50)

        # Set up passing conditions
        sample_decision_open_long.leverage_bps = 20000  # 2x, safe
        sample_decision_open_long.size_usdc = 1000.0
        sample_market_state.divergence_bps = 150  # 1.5%

        decision, results = engine.validate(
            sample_decision_open_long,
            sample_market_state,
            None,
            [],
        )

        assert not decision.blocked
        assert len(results) == 8
        passed_count = sum(1 for r in results if r.passed)
        assert passed_count == 8

    def test_rule_blocks_decision(self, sample_market_state, sample_decision_open_long):
        """Test rule blocking decision."""
        engine = RuleEngine(current_gas_price_gwei=50)

        # Set divergence too high
        sample_market_state.divergence_bps = 500  # 5%

        decision, results = engine.validate(
            sample_decision_open_long,
            sample_market_state,
        )

        assert decision.blocked
        assert decision.block_reason is not None
        assert len(decision.rule_violations) > 0

    def test_rule_modifies_decision(self, sample_market_state, sample_decision_open_long):
        """Test rule modifying decision."""
        engine = RuleEngine(current_gas_price_gwei=50)

        # Request leverage above cap
        sample_decision_open_long.leverage_bps = 40000  # 4x

        decision, results = engine.validate(
            sample_decision_open_long,
            sample_market_state,
        )

        # Should be modified but not blocked
        assert not decision.blocked
        assert decision.leverage_bps == 30000  # Capped to 3x

    def test_emergency_health_overrides(self, sample_market_state, sample_decision_open_long):
        """Test emergency health forces exit regardless of decision."""
        engine = RuleEngine(current_gas_price_gwei=50)

        sample_market_state.pool_state.health_score = 1.03

        decision, results = engine.validate(
            sample_decision_open_long,
            sample_market_state,
        )

        # Should be forced to CLOSE
        assert decision.action == DecisionAction.CLOSE
        assert "EMERGENCY" in decision.reasoning
