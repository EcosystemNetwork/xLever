"""Signal merger for combining multiple decision sources."""

from typing import List
from loguru import logger

from agent.strategy.llm_strategy import TradingDecision, DecisionAction
from agent.strategy.rules import RuleResult


class SignalMerger:
    """Merges signals from multiple sources into final decision.

    Currently handles:
    - LLM decision (primary)
    - Rule engine modifications
    - Emergency overrides

    Future: Could integrate technical indicators, sentiment scores, etc.
    """

    @staticmethod
    def merge(
        llm_decision: TradingDecision,
        rule_results: List[RuleResult],
        emergency_action: DecisionAction = None,
    ) -> TradingDecision:
        """Merge signals into final decision.

        Args:
            llm_decision: Primary decision from LLM
            rule_results: Results from rule engine validation
            emergency_action: Override action for emergencies

        Returns:
            Final merged decision
        """
        # Emergency override takes precedence
        if emergency_action:
            logger.critical(f"Emergency override: forcing {emergency_action.value}")
            llm_decision.action = emergency_action
            llm_decision.urgency = "high"
            llm_decision.reasoning = f"EMERGENCY OVERRIDE: {llm_decision.reasoning}"

        # Apply rule violations to decision
        violations = [r for r in rule_results if not r.passed and r.severity in ["error", "critical"]]
        if violations:
            llm_decision.rule_violations = [r.rule_name for r in violations]

        # Log final decision
        logger.info(
            f"Final decision: {llm_decision.action.value} "
            f"(confidence: {llm_decision.confidence}%, blocked: {llm_decision.blocked})"
        )

        return llm_decision

    @staticmethod
    def should_execute(decision: TradingDecision) -> bool:
        """Determine if decision should be executed.

        Args:
            decision: Trading decision

        Returns:
            True if should execute, False otherwise
        """
        # HOLD never executes
        if decision.action == DecisionAction.HOLD:
            return False

        # Blocked decisions don't execute
        if decision.blocked:
            logger.warning(f"Decision blocked: {decision.block_reason}")
            return False

        # Very low confidence decisions should be questioned
        if decision.confidence < 30:
            logger.warning(f"Very low confidence decision: {decision.confidence}%")
            # Still allow but log warning
            return True

        return True
