"""Rule engine for validating trading decisions with safety guardrails."""

from typing import Optional, Protocol
from dataclasses import dataclass
from datetime import datetime, timedelta
from loguru import logger

from agent.strategy.llm_strategy import TradingDecision, DecisionAction
from agent.intelligence.market import MarketState
from agent.models.position import Position, PositionDirection


# Protocol constraints
MIN_LEVERAGE_BPS = 10000  # 1x
MAX_LEVERAGE_BPS = 40000  # 4x
LEVERAGE_INCREASE_LOCK = 3600  # 1 hour in seconds
DIRECTION_FLIP_LOCK = 14400  # 4 hours in seconds
MAX_DIVERGENCE_BPS = 300  # 3%
HS_SAFE = 1.5
HS_WARNING = 1.4
HS_LEVEL_1 = 1.3
HS_LEVEL_2 = 1.2
HS_LEVEL_3 = 1.1
HS_EMERGENCY = 1.05


@dataclass
class RuleResult:
    """Result of a rule check."""

    passed: bool
    rule_name: str
    reason: str
    severity: str = "info"  # "info", "warning", "error", "critical"
    modified_decision: Optional[TradingDecision] = None

    def to_dict(self):
        """Convert to dictionary."""
        return {
            "passed": self.passed,
            "rule_name": self.rule_name,
            "reason": self.reason,
            "severity": self.severity,
            "modified": self.modified_decision is not None,
        }


class Rule(Protocol):
    """Protocol for trading rules."""

    def check(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> RuleResult:
        """Check if decision passes rule.

        Args:
            decision: Trading decision to validate
            market_state: Current market conditions
            current_position: Active position if any
            position_history: Historical positions for locks

        Returns:
            Rule check result
        """
        ...


class R1_MaxLeverage:
    """R1: Maximum Leverage Rule.

    Ensures leverage does not exceed dynamic cap based on junior ratio.
    """

    @staticmethod
    def get_max_leverage(junior_ratio: float) -> int:
        """Calculate max leverage based on junior ratio.

        Args:
            junior_ratio: Junior LP ratio (0-1)

        Returns:
            Max leverage in basis points
        """
        if junior_ratio >= 0.40:
            return 40000  # 4x
        elif junior_ratio >= 0.30:
            return 30000  # 3x
        elif junior_ratio >= 0.20:
            return 20000  # 2x
        else:
            return 15000  # 1.5x

    def check(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> RuleResult:
        """Check max leverage constraint."""
        # Only check for actions that set leverage
        if decision.action not in [
            DecisionAction.OPEN_LONG,
            DecisionAction.OPEN_SHORT,
            DecisionAction.ADJUST_LEVERAGE,
        ]:
            return RuleResult(
                passed=True,
                rule_name="R1_MaxLeverage",
                reason="Action does not require leverage check",
            )

        if not decision.leverage_bps:
            return RuleResult(
                passed=False,
                rule_name="R1_MaxLeverage",
                reason="Leverage not specified for position action",
                severity="error",
            )

        # Get dynamic max leverage
        junior_ratio = market_state.pool_state.junior_ratio if market_state.pool_state else 0.35
        max_allowed = self.get_max_leverage(junior_ratio)

        if decision.leverage_bps > max_allowed:
            # Modify decision to use max allowed
            modified = TradingDecision(
                action=decision.action,
                asset=decision.asset,
                leverage_bps=max_allowed,
                size_usdc=decision.size_usdc,
                confidence=decision.confidence,
                reasoning=f"{decision.reasoning} [ADJUSTED: leverage capped at {max_allowed / 10000:.1f}x]",
                urgency=decision.urgency,
            )

            return RuleResult(
                passed=False,
                rule_name="R1_MaxLeverage",
                reason=f"Leverage {decision.leverage_bps / 10000:.1f}x exceeds max {max_allowed / 10000:.1f}x for junior ratio {junior_ratio * 100:.1f}%",
                severity="warning",
                modified_decision=modified,
            )

        return RuleResult(
            passed=True,
            rule_name="R1_MaxLeverage",
            reason=f"Leverage {decision.leverage_bps / 10000:.1f}x within limit {max_allowed / 10000:.1f}x",
        )


class R2_LeverageLock:
    """R2: Leverage Increase Lock.

    Prevents leverage increases within 1 hour of last increase.
    """

    def check(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> RuleResult:
        """Check leverage increase lock."""
        if decision.action != DecisionAction.ADJUST_LEVERAGE:
            return RuleResult(
                passed=True,
                rule_name="R2_LeverageLock",
                reason="Not a leverage adjustment",
            )

        if not current_position:
            return RuleResult(
                passed=False,
                rule_name="R2_LeverageLock",
                reason="Cannot adjust leverage without active position",
                severity="error",
            )

        # Check if leverage is increasing
        if decision.leverage_bps <= current_position.leverage_bps:
            return RuleResult(
                passed=True,
                rule_name="R2_LeverageLock",
                reason="Leverage decrease allowed anytime",
            )

        # Check time since position opened
        time_since_open = (datetime.now() - current_position.created_at).total_seconds()

        if time_since_open < LEVERAGE_INCREASE_LOCK:
            remaining = LEVERAGE_INCREASE_LOCK - time_since_open
            return RuleResult(
                passed=False,
                rule_name="R2_LeverageLock",
                reason=f"Cannot increase leverage for {remaining / 60:.1f} more minutes (1h lock)",
                severity="error",
            )

        return RuleResult(
            passed=True,
            rule_name="R2_LeverageLock",
            reason="Leverage increase allowed (>1h since open)",
        )


class R3_FlipLock:
    """R3: Direction Flip Lock.

    Prevents flipping from long to short (or vice versa) within 4 hours.
    """

    def check(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> RuleResult:
        """Check direction flip lock."""
        if decision.action not in [DecisionAction.OPEN_LONG, DecisionAction.OPEN_SHORT]:
            return RuleResult(
                passed=True,
                rule_name="R3_FlipLock",
                reason="Not opening a new position",
            )

        # No current position - check history
        if not current_position and position_history:
            # Find most recent closed position
            recent_positions = sorted(
                [p for p in position_history if p.status.value != "open"],
                key=lambda p: p.closed_at or p.created_at,
                reverse=True,
            )

            if recent_positions:
                last_position = recent_positions[0]
                time_since_close = (
                    datetime.now() - (last_position.closed_at or last_position.created_at)
                ).total_seconds()

                # Check if flipping direction
                new_direction = (
                    PositionDirection.LONG
                    if decision.action == DecisionAction.OPEN_LONG
                    else PositionDirection.SHORT
                )

                if (
                    new_direction != last_position.direction
                    and time_since_close < DIRECTION_FLIP_LOCK
                ):
                    remaining = DIRECTION_FLIP_LOCK - time_since_close
                    return RuleResult(
                        passed=False,
                        rule_name="R3_FlipLock",
                        reason=f"Cannot flip direction for {remaining / 3600:.1f} more hours (4h lock)",
                        severity="error",
                    )

        return RuleResult(
            passed=True,
            rule_name="R3_FlipLock",
            reason="Direction flip allowed or not applicable",
        )


class R4_DivergenceGate:
    """R4: TWAP Divergence Gate.

    Blocks entries when TWAP divergence exceeds 3%.
    """

    def check(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> RuleResult:
        """Check divergence gate."""
        # Only applies to entry actions
        if decision.action not in [DecisionAction.OPEN_LONG, DecisionAction.OPEN_SHORT]:
            return RuleResult(
                passed=True,
                rule_name="R4_DivergenceGate",
                reason="Exit/hold actions not affected by divergence",
            )

        divergence_abs = abs(market_state.divergence_bps)

        if divergence_abs > MAX_DIVERGENCE_BPS:
            return RuleResult(
                passed=False,
                rule_name="R4_DivergenceGate",
                reason=f"TWAP divergence {divergence_abs / 100:.2f}% exceeds max {MAX_DIVERGENCE_BPS / 100:.1f}%",
                severity="error",
            )

        return RuleResult(
            passed=True,
            rule_name="R4_DivergenceGate",
            reason=f"Divergence {divergence_abs / 100:.2f}% within acceptable range",
        )


class R5_HealthGuard:
    """R5: Health Score Guard.

    Forces leverage reduction when health score drops below thresholds.
    """

    def check(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> RuleResult:
        """Check health score and force actions if needed."""
        if not market_state.pool_state:
            return RuleResult(
                passed=True,
                rule_name="R5_HealthGuard",
                reason="No pool state available",
                severity="warning",
            )

        health_score = market_state.pool_state.health_score

        # Emergency exit
        if health_score < HS_EMERGENCY:
            modified = TradingDecision(
                action=DecisionAction.CLOSE,
                asset=decision.asset,
                confidence=100,
                reasoning="EMERGENCY: Health score below 1.05, forcing exit",
                urgency="high",
            )

            return RuleResult(
                passed=False,
                rule_name="R5_HealthGuard",
                reason=f"Health score {health_score:.2f} below emergency threshold {HS_EMERGENCY}",
                severity="critical",
                modified_decision=modified,
            )

        # Force max 1.5x leverage
        if health_score < HS_LEVEL_3 and decision.leverage_bps and decision.leverage_bps > 15000:
            modified = TradingDecision(
                action=decision.action,
                asset=decision.asset,
                leverage_bps=15000,
                size_usdc=decision.size_usdc,
                confidence=decision.confidence,
                reasoning=f"{decision.reasoning} [FORCED: leverage reduced to 1.5x due to health score]",
                urgency="high",
            )

            return RuleResult(
                passed=False,
                rule_name="R5_HealthGuard",
                reason=f"Health score {health_score:.2f} requires max 1.5x leverage",
                severity="error",
                modified_decision=modified,
            )

        # Warning for low health
        if health_score < HS_WARNING:
            return RuleResult(
                passed=True,
                rule_name="R5_HealthGuard",
                reason=f"Health score {health_score:.2f} below warning threshold {HS_WARNING}",
                severity="warning",
            )

        return RuleResult(
            passed=True,
            rule_name="R5_HealthGuard",
            reason=f"Health score {health_score:.2f} safe",
        )


class R6_PositionSizeLimit:
    """R6: Position Size Limit.

    Prevents positions exceeding 20% of pool to avoid concentration risk.
    """

    MAX_POOL_CONCENTRATION = 0.20  # 20%

    def check(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> RuleResult:
        """Check position size limit."""
        if decision.action not in [DecisionAction.OPEN_LONG, DecisionAction.OPEN_SHORT]:
            return RuleResult(
                passed=True,
                rule_name="R6_PositionSizeLimit",
                reason="Not opening a new position",
            )

        if not decision.size_usdc:
            return RuleResult(
                passed=False,
                rule_name="R6_PositionSizeLimit",
                reason="Position size not specified",
                severity="error",
            )

        if not market_state.pool_state:
            logger.warning("No pool state, cannot check concentration")
            return RuleResult(
                passed=True,
                rule_name="R6_PositionSizeLimit",
                reason="Pool state unavailable, allowing position",
                severity="warning",
            )

        max_size = market_state.pool_state.total_liquidity_usdc * self.MAX_POOL_CONCENTRATION

        if decision.size_usdc > max_size:
            # Modify to max allowed size
            modified = TradingDecision(
                action=decision.action,
                asset=decision.asset,
                leverage_bps=decision.leverage_bps,
                size_usdc=max_size,
                confidence=decision.confidence,
                reasoning=f"{decision.reasoning} [ADJUSTED: size capped at {self.MAX_POOL_CONCENTRATION * 100:.0f}% of pool]",
                urgency=decision.urgency,
            )

            return RuleResult(
                passed=False,
                rule_name="R6_PositionSizeLimit",
                reason=f"Position size ${decision.size_usdc:.2f} exceeds max ${max_size:.2f} (20% of pool)",
                severity="warning",
                modified_decision=modified,
            )

        return RuleResult(
            passed=True,
            rule_name="R6_PositionSizeLimit",
            reason=f"Position size ${decision.size_usdc:.2f} within limit ${max_size:.2f}",
        )


class R7_DailyLossLimit:
    """R7: Daily Loss Limit.

    Pauses trading if daily realized losses exceed 5% of capital.
    """

    MAX_DAILY_LOSS_PCT = 0.05  # 5%

    def check(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> RuleResult:
        """Check daily loss limit."""
        if not position_history:
            return RuleResult(
                passed=True,
                rule_name="R7_DailyLossLimit",
                reason="No position history",
            )

        # Calculate total losses from positions closed today
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        daily_losses = sum(
            p.pnl
            for p in position_history
            if p.closed_at
            and p.closed_at >= today_start
            and p.pnl is not None
            and p.pnl < 0
        )

        # Estimate total capital (rough calculation)
        total_capital = sum(p.size_usdc for p in position_history[-5:]) / 5 if position_history else 10000

        loss_pct = abs(daily_losses) / total_capital if total_capital > 0 else 0

        if loss_pct > self.MAX_DAILY_LOSS_PCT:
            # Block all new positions
            if decision.action in [DecisionAction.OPEN_LONG, DecisionAction.OPEN_SHORT]:
                return RuleResult(
                    passed=False,
                    rule_name="R7_DailyLossLimit",
                    reason=f"Daily loss {loss_pct * 100:.2f}% exceeds limit {self.MAX_DAILY_LOSS_PCT * 100:.0f}%, trading paused",
                    severity="critical",
                )

        return RuleResult(
            passed=True,
            rule_name="R7_DailyLossLimit",
            reason=f"Daily loss {loss_pct * 100:.2f}% within limit",
        )


class R8_GasGuard:
    """R8: Gas Guard.

    Delays non-urgent transactions when gas is too high.
    """

    MAX_GAS_GWEI = 100
    CRITICAL_MAX_GAS_GWEI = 200

    def __init__(self, current_gas_price_gwei: float = 50):
        """Initialize with current gas price."""
        self.current_gas_price = current_gas_price_gwei

    def check(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> RuleResult:
        """Check gas price."""
        # Always allow CLOSE for safety
        if decision.action == DecisionAction.CLOSE:
            if self.current_gas_price > self.CRITICAL_MAX_GAS_GWEI:
                return RuleResult(
                    passed=True,
                    rule_name="R8_GasGuard",
                    reason=f"Gas ${self.current_gas_price:.0f} gwei very high but allowing close",
                    severity="warning",
                )
            return RuleResult(
                passed=True,
                rule_name="R8_GasGuard",
                reason="Close actions always allowed",
            )

        # Check urgency for other actions
        if decision.urgency != "high" and self.current_gas_price > self.MAX_GAS_GWEI:
            return RuleResult(
                passed=False,
                rule_name="R8_GasGuard",
                reason=f"Gas {self.current_gas_price:.0f} gwei exceeds limit {self.MAX_GAS_GWEI} for non-urgent action",
                severity="warning",
            )

        return RuleResult(
            passed=True,
            rule_name="R8_GasGuard",
            reason=f"Gas {self.current_gas_price:.0f} gwei acceptable",
        )


class RuleEngine:
    """Engine for applying all trading rules to decisions.

    Applies rules in order and accumulates results. Can modify
    decisions or block them entirely based on rule outcomes.
    """

    def __init__(self, current_gas_price_gwei: float = 50):
        """Initialize rule engine.

        Args:
            current_gas_price_gwei: Current gas price for gas guard
        """
        self.rules: list[Rule] = [
            R1_MaxLeverage(),
            R2_LeverageLock(),
            R3_FlipLock(),
            R4_DivergenceGate(),
            R5_HealthGuard(),
            R6_PositionSizeLimit(),
            R7_DailyLossLimit(),
            R8_GasGuard(current_gas_price_gwei),
        ]

        logger.info(f"Rule engine initialized with {len(self.rules)} rules")

    def validate(
        self,
        decision: TradingDecision,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        position_history: list[Position] = None,
    ) -> tuple[TradingDecision, list[RuleResult]]:
        """Validate decision against all rules.

        Args:
            decision: Trading decision to validate
            market_state: Current market state
            current_position: Active position if any
            position_history: Position history for locks

        Returns:
            Tuple of (modified_decision, rule_results)
        """
        results = []
        current_decision = decision

        logger.info(f"Validating decision: {decision.action.value}")

        for rule in self.rules:
            result = rule.check(
                decision=current_decision,
                market_state=market_state,
                current_position=current_position,
                position_history=position_history or [],
            )

            results.append(result)

            # Log result
            if not result.passed:
                logger.warning(f"❌ {result.rule_name}: {result.reason}")
            else:
                logger.debug(f"✓ {result.rule_name}: {result.reason}")

            # Apply modifications or blocks
            if not result.passed:
                if result.modified_decision:
                    # Rule modified the decision
                    current_decision = result.modified_decision
                    logger.info(f"Decision modified by {result.rule_name}")
                elif result.severity in ["error", "critical"]:
                    # Rule blocks the decision
                    current_decision.blocked = True
                    current_decision.block_reason = result.reason
                    current_decision.rule_violations.append(result.rule_name)
                    logger.warning(f"Decision blocked by {result.rule_name}")

        # Summary
        violations = [r for r in results if not r.passed]
        if violations:
            logger.warning(f"Decision validation: {len(violations)} violations")
        else:
            logger.success("Decision validation: all rules passed")

        return current_decision, results
