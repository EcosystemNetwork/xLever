"""LLM-powered trading strategy decision engine."""

import json
import re
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum
from loguru import logger

from agent.intelligence.tavily import TavilyClient
from agent.intelligence.market import MarketState
from agent.models.position import Position


class DecisionAction(str, Enum):
    """Trading actions the agent can decide."""

    HOLD = "HOLD"
    OPEN_LONG = "OPEN_LONG"
    OPEN_SHORT = "OPEN_SHORT"
    ADJUST_LEVERAGE = "ADJUST_LEVERAGE"
    CLOSE = "CLOSE"


class Urgency(str, Enum):
    """Decision urgency levels."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass
class TradingDecision:
    """Structured trading decision from LLM."""

    action: DecisionAction
    asset: str

    # Position parameters (for opens/adjusts)
    leverage_bps: Optional[int] = None  # 10000-40000 (1x-4x)
    size_usdc: Optional[float] = None

    # Confidence and reasoning
    confidence: int = 50  # 0-100
    reasoning: str = ""
    urgency: Urgency = Urgency.LOW

    # Validation flags
    blocked: bool = False
    block_reason: Optional[str] = None
    rule_violations: list[str] = None

    # Metadata
    raw_response: str = ""
    parse_success: bool = True

    def __post_init__(self):
        """Initialize defaults."""
        if self.rule_violations is None:
            self.rule_violations = []

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "action": self.action.value,
            "asset": self.asset,
            "leverage_bps": self.leverage_bps,
            "size_usdc": self.size_usdc,
            "confidence": self.confidence,
            "reasoning": self.reasoning,
            "urgency": self.urgency.value,
            "blocked": self.blocked,
            "block_reason": self.block_reason,
            "rule_violations": self.rule_violations,
            "parse_success": self.parse_success,
        }

    @property
    def requires_execution(self) -> bool:
        """Check if decision requires blockchain execution."""
        return self.action != DecisionAction.HOLD and not self.blocked

    @property
    def is_high_confidence(self, threshold: int = 70) -> bool:
        """Check if confidence exceeds threshold."""
        return self.confidence >= threshold


class LLMStrategy:
    """LLM-powered strategy for generating trading decisions.

    Uses Perplexity AI to analyze market conditions and make
    trading recommendations with reasoning and confidence scores.
    """

    # Protocol constraints for prompt
    MIN_LEVERAGE_BPS = 10000  # 1x
    MAX_LEVERAGE_BPS = 40000  # 4x
    MAX_DIVERGENCE_BPS = 300  # 3%

    def __init__(
        self,
        tavily_client: TavilyClient,
        max_retries: int = 3,
    ):
        """Initialize LLM strategy engine.

        Args:
            tavily_client: Client for AI market intelligence
            max_retries: Max retries for failed/malformed responses
        """
        self.tavily = tavily_client
        self.max_retries = max_retries

        logger.info("LLM strategy engine initialized")

    async def decide(
        self,
        market_state: MarketState,
        current_position: Optional[Position] = None,
        available_capital_usdc: float = 0.0,
        max_leverage_bps: int = MAX_LEVERAGE_BPS,
    ) -> TradingDecision:
        """Generate a trading decision based on market state.

        Args:
            market_state: Current market conditions
            current_position: Active position if any
            available_capital_usdc: Available capital for trading
            max_leverage_bps: Maximum allowed leverage (dynamic based on pool)

        Returns:
            Trading decision with reasoning
        """
        logger.info(f"Generating trading decision for {market_state.asset}")

        # Build prompt
        prompt = self._build_prompt(
            market_state=market_state,
            current_position=current_position,
            available_capital_usdc=available_capital_usdc,
            max_leverage_bps=max_leverage_bps,
        )

        # Query LLM with retry logic
        for attempt in range(self.max_retries):
            try:
                response = await self.tavily.query(
                    prompt=prompt,
                    system_prompt=self._get_system_prompt(),
                    temperature=0.7,  # Some creativity but not too random
                    max_tokens=800,
                )

                # Parse response
                decision = self._parse_response(
                    content=response.content,
                    asset=market_state.asset,
                )

                if decision.parse_success:
                    logger.success(
                        f"Decision: {decision.action.value} with {decision.confidence}% confidence"
                    )
                    return decision
                else:
                    logger.warning(f"Parse failed (attempt {attempt + 1}/{self.max_retries})")
                    if attempt == self.max_retries - 1:
                        # Return conservative HOLD on final failure
                        return self._create_fallback_decision(
                            asset=market_state.asset,
                            reason="Failed to parse LLM response after retries",
                        )

            except Exception as e:
                logger.error(f"LLM query failed (attempt {attempt + 1}/{self.max_retries}): {e}")
                if attempt == self.max_retries - 1:
                    return self._create_fallback_decision(
                        asset=market_state.asset,
                        reason=f"LLM query failed: {str(e)}",
                    )

        # Should never reach here, but safety fallback
        return self._create_fallback_decision(
            asset=market_state.asset,
            reason="Unexpected error in decision generation",
        )

    def _get_system_prompt(self) -> str:
        """Get system prompt for LLM.

        Returns:
            System prompt string
        """
        return """You are a trading agent for xLever protocol, a leveraged trading platform for tokenized assets.

Your role is to make informed trading decisions based on market analysis, technical indicators, and risk management principles.

CRITICAL RULES:
- ALWAYS respond with valid JSON only, no markdown or explanations
- Confidence must be 0-100 based on signal strength
- Leverage must be 10000-40000 (1x-4x in basis points)
- Consider pool state, funding rates, and divergence
- Be conservative when confidence is low
- Provide clear reasoning for decisions

You must output ONLY valid JSON in this exact format:
{
  "action": "HOLD|OPEN_LONG|OPEN_SHORT|ADJUST_LEVERAGE|CLOSE",
  "leverage_bps": 10000-40000,
  "size_usdc": number,
  "confidence": 0-100,
  "reasoning": "brief explanation",
  "urgency": "low|medium|high"
}"""

    def _build_prompt(
        self,
        market_state: MarketState,
        current_position: Optional[Position],
        available_capital_usdc: float,
        max_leverage_bps: int,
    ) -> str:
        """Build decision prompt from market state.

        Args:
            market_state: Current market conditions
            current_position: Active position if any
            available_capital_usdc: Available capital
            max_leverage_bps: Max allowed leverage

        Returns:
            Formatted prompt string
        """
        # Position summary
        if current_position and current_position.is_open:
            pnl_usdc, pnl_pct = current_position.calculate_pnl(market_state.spot_price)
            position_info = f"""Active position: {current_position.direction.value.upper()} {current_position.asset}
- Entry price: ${current_position.entry_price:.2f}
- Leverage: {current_position.leverage_bps / 10000:.1f}x
- Size: ${current_position.size_usdc:.2f} USDC
- Current PnL: ${pnl_usdc:.2f} ({pnl_pct:+.2f}%)"""
        else:
            position_info = "No active position"

        # Market summary
        market_summary = f"""Market intelligence for {market_state.asset}:
- Spot price: ${market_state.spot_price:.2f}
- 24h change: {market_state.price_24h_change_pct:+.2f}%
- Volatility: {market_state.volatility_24h_pct:.2f}%
- Sentiment: {market_state.sentiment or "unknown"} (confidence: {market_state.sentiment_confidence}%)
- Position bias: {market_state.position_bias or "neutral"}"""

        if market_state.upcoming_events:
            market_summary += f"\n- Upcoming events: {', '.join(market_state.upcoming_events[:3])}"

        if market_state.risk_factors:
            market_summary += f"\n- Risk factors: {', '.join(market_state.risk_factors[:3])}"

        # Pool state
        pool_info = ""
        if market_state.pool_state:
            pool = market_state.pool_state
            pool_info = f"""Pool state:
- Net exposure: {pool.net_direction} (${pool.net_exposure_magnitude:.2f})
- Junior LP ratio: {pool.junior_ratio * 100:.1f}%
- Total liquidity: ${pool.total_liquidity_usdc:.2f} USDC
- Funding rate: {pool.funding_rate_bps / 100:.2f}% annual
- Health score: {pool.health_score:.2f}"""

        # Constraints
        constraints = f"""Rule constraints (MUST obey):
- Maximum leverage: {max_leverage_bps / 10000:.1f}x ({max_leverage_bps} bps)
- Available capital: ${available_capital_usdc:.2f} USDC
- TWAP divergence: {market_state.divergence_bps / 100:.2f}% (cannot trade if >3%)
- Maximum position: 25% of capital = ${available_capital_usdc * 0.25:.2f} USDC"""

        # Build full prompt
        prompt = f"""Analyze the following market conditions and make a trading decision.

{position_info}

{market_summary}

{pool_info}

{constraints}

Based on this information, decide ONE action:
1. HOLD - No changes (use when uncertain or conditions unfavorable)
2. OPEN_LONG - Open long position with leverage
3. OPEN_SHORT - Open short position with leverage
4. ADJUST_LEVERAGE - Change leverage on existing position
5. CLOSE - Exit current position

Consider:
- Is the sentiment aligned with a directional bias?
- Is confidence high enough to take risk?
- Are there upcoming events that create uncertainty?
- Is the pool heavily skewed (funding costs)?
- Is divergence acceptable (<3%)?

Output ONLY valid JSON with your decision."""

        return prompt

    def _parse_response(self, content: str, asset: str) -> TradingDecision:
        """Parse LLM response into trading decision.

        Args:
            content: Raw LLM response
            asset: Asset ticker

        Returns:
            Parsed trading decision
        """
        # Extract JSON
        data = self._extract_json(content)

        if not data:
            logger.warning("Failed to extract JSON from response")
            return self._create_fallback_decision(
                asset=asset,
                reason="Could not parse JSON from LLM response",
                raw_response=content,
            )

        try:
            # Parse action
            action_str = str(data.get("action", "HOLD")).upper()
            try:
                action = DecisionAction(action_str)
            except ValueError:
                logger.warning(f"Invalid action: {action_str}, defaulting to HOLD")
                action = DecisionAction.HOLD

            # Parse urgency
            urgency_str = str(data.get("urgency", "low")).lower()
            try:
                urgency = Urgency(urgency_str)
            except ValueError:
                urgency = Urgency.LOW

            # Parse numeric values with bounds
            leverage_bps = data.get("leverage_bps")
            if leverage_bps:
                leverage_bps = int(leverage_bps)
                leverage_bps = max(self.MIN_LEVERAGE_BPS, min(self.MAX_LEVERAGE_BPS, leverage_bps))

            size_usdc = data.get("size_usdc")
            if size_usdc:
                size_usdc = float(size_usdc)
                size_usdc = max(0, size_usdc)

            confidence = int(data.get("confidence", 50))
            confidence = max(0, min(100, confidence))

            reasoning = str(data.get("reasoning", "No reasoning provided"))

            return TradingDecision(
                action=action,
                asset=asset,
                leverage_bps=leverage_bps,
                size_usdc=size_usdc,
                confidence=confidence,
                reasoning=reasoning,
                urgency=urgency,
                raw_response=content,
                parse_success=True,
            )

        except Exception as e:
            logger.error(f"Failed to parse decision data: {e}")
            return self._create_fallback_decision(
                asset=asset,
                reason=f"Parse error: {str(e)}",
                raw_response=content,
            )

    def _extract_json(self, content: str) -> Optional[Dict[str, Any]]:
        """Extract JSON from content, handling markdown wrappers.

        Args:
            content: Raw content

        Returns:
            Parsed JSON or None
        """
        content = content.strip()

        # Try direct parse
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass

        # Try markdown code blocks
        patterns = [
            r"```json\s*\n(.*?)\n```",
            r"```\s*\n(.*?)\n```",
            r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}",  # Nested JSON
        ]

        for pattern in patterns:
            match = re.search(pattern, content, re.DOTALL)
            if match:
                json_str = match.group(1) if match.lastindex else match.group(0)
                try:
                    return json.loads(json_str)
                except json.JSONDecodeError:
                    continue

        return None

    def _create_fallback_decision(
        self,
        asset: str,
        reason: str,
        raw_response: str = "",
    ) -> TradingDecision:
        """Create a conservative fallback decision.

        Args:
            asset: Asset ticker
            reason: Reason for fallback
            raw_response: Raw LLM response if available

        Returns:
            Conservative HOLD decision
        """
        return TradingDecision(
            action=DecisionAction.HOLD,
            asset=asset,
            confidence=0,
            reasoning=f"Fallback: {reason}",
            urgency=Urgency.LOW,
            raw_response=raw_response,
            parse_success=False,
        )
