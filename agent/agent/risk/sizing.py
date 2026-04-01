"""Position sizing calculator using Kelly-inspired formula.

Implements adaptive position sizing based on:
- Available capital
- Leverage
- Confidence level
- Market volatility
- Pool concentration risk
"""

from typing import Optional
from dataclasses import dataclass
from loguru import logger


# Position sizing parameters
BASE_FRACTION = 0.25  # Max 25% of capital per position
MIN_POSITION_USDC = 10.0  # Minimum viable position size
MAX_POSITION_USDC = 10000.0  # Hard cap for safety

# Volatility adjustments
LOW_VOLATILITY_THRESHOLD = 0.10  # 10% annualized
HIGH_VOLATILITY_THRESHOLD = 0.30  # 30% annualized

# Pool concentration risk
MAX_POOL_CONCENTRATION = 0.20  # 20% of pool


@dataclass
class PositionSizeResult:
    """Result of position size calculation."""

    size_usdc: float
    recommended_leverage_bps: int
    confidence_adjusted: float
    volatility_factor: float
    concentration_factor: float
    reasoning: str

    def to_dict(self):
        """Convert to dictionary."""
        return {
            "size_usdc": self.size_usdc,
            "recommended_leverage_bps": self.recommended_leverage_bps,
            "confidence_adjusted": self.confidence_adjusted,
            "volatility_factor": self.volatility_factor,
            "concentration_factor": self.concentration_factor,
            "reasoning": self.reasoning,
        }


def calculate_position_size(
    capital: float,
    leverage_bps: int,
    confidence: float,
    volatility: float,
    pool_concentration: float = 0.0,
    max_pool_liquidity: Optional[float] = None,
) -> float:
    """Calculate recommended position size using Kelly-inspired formula.

    Formula:
    base_fraction = 0.25  # Max 25% of capital
    confidence_factor = confidence / 100  # 0-1
    volatility_factor = max(0, 1 - volatility)  # Reduce size in high vol
    concentration_penalty = max(0, 1 - (pool_concentration / 0.20))
    size = capital * base_fraction * confidence_factor * volatility_factor * concentration_penalty

    Args:
        capital: Available capital in USDC
        leverage_bps: Intended leverage in basis points (10000 = 1x)
        confidence: Confidence score 0-100
        volatility: Annualized volatility (e.g., 0.25 = 25%)
        pool_concentration: Current position as fraction of pool (0-1)
        max_pool_liquidity: Maximum pool liquidity (for hard cap)

    Returns:
        Recommended position size in USDC

    Examples:
        >>> calculate_position_size(10000, 20000, 80, 0.15, 0.05)
        1700.0  # 10000 * 0.25 * 0.8 * 0.85 * 0.75
    """
    # Input validation
    if capital <= 0:
        logger.warning("Capital must be positive, returning 0")
        return 0.0

    if confidence < 0 or confidence > 100:
        logger.warning(f"Confidence {confidence} out of range [0,100], clamping")
        confidence = max(0, min(100, confidence))

    if volatility < 0:
        logger.warning(f"Volatility {volatility} cannot be negative, using 0")
        volatility = 0

    # Calculate factors
    confidence_factor = confidence / 100.0

    # Volatility adjustment: reduce size as volatility increases
    # At 0% vol: factor = 1.0
    # At 30%+ vol: factor = 0.7 (max reduction of 30%)
    volatility_factor = max(0.7, 1.0 - min(volatility, 0.30))

    # Pool concentration penalty: reduce size as we approach 20% of pool
    # At 0% concentration: factor = 1.0
    # At 20% concentration: factor = 0 (no new position)
    concentration_penalty = max(0, 1.0 - (pool_concentration / MAX_POOL_CONCENTRATION))

    # Calculate base size
    size = capital * BASE_FRACTION * confidence_factor * volatility_factor * concentration_penalty

    # Apply leverage adjustment (higher leverage = smaller position for same risk)
    leverage_multiplier = leverage_bps / 10000
    if leverage_multiplier > 1.0:
        # Reduce position size inversely with leverage to maintain similar risk exposure
        # E.g., 2x leverage = 0.5x position size
        size = size / (1 + (leverage_multiplier - 1) * 0.5)

    # Apply bounds
    size = max(MIN_POSITION_USDC, min(MAX_POSITION_USDC, size))

    # Apply pool liquidity cap if provided
    if max_pool_liquidity:
        max_size_from_pool = max_pool_liquidity * MAX_POOL_CONCENTRATION
        size = min(size, max_size_from_pool)

    logger.debug(
        f"Position sizing: capital=${capital:.2f}, confidence={confidence}%, "
        f"vol={volatility:.2%}, concentration={pool_concentration:.2%} -> ${size:.2f}"
    )

    return round(size, 2)


class PositionSizeCalculator:
    """Advanced position size calculator with full reasoning.

    Provides detailed calculation results including all factors
    and reasoning for the recommended size.
    """

    def __init__(
        self,
        base_fraction: float = BASE_FRACTION,
        min_position: float = MIN_POSITION_USDC,
        max_position: float = MAX_POSITION_USDC,
    ):
        """Initialize position size calculator.

        Args:
            base_fraction: Base fraction of capital per position (default: 0.25)
            min_position: Minimum position size in USDC
            max_position: Maximum position size in USDC
        """
        self.base_fraction = base_fraction
        self.min_position = min_position
        self.max_position = max_position

        logger.info(
            f"Position size calculator initialized: "
            f"base={base_fraction:.0%}, min=${min_position}, max=${max_position}"
        )

    def calculate(
        self,
        capital: float,
        leverage_bps: int,
        confidence: float,
        volatility: float,
        pool_concentration: float = 0.0,
        max_pool_liquidity: Optional[float] = None,
    ) -> PositionSizeResult:
        """Calculate position size with detailed reasoning.

        Args:
            capital: Available capital in USDC
            leverage_bps: Intended leverage in basis points
            confidence: Confidence score 0-100
            volatility: Annualized volatility
            pool_concentration: Current position as fraction of pool
            max_pool_liquidity: Maximum pool liquidity

        Returns:
            PositionSizeResult with size and reasoning
        """
        # Input validation
        if capital <= 0:
            return PositionSizeResult(
                size_usdc=0.0,
                recommended_leverage_bps=leverage_bps,
                confidence_adjusted=0.0,
                volatility_factor=0.0,
                concentration_factor=0.0,
                reasoning="No capital available",
            )

        # Calculate factors
        confidence_factor = max(0, min(100, confidence)) / 100.0
        volatility_factor = max(0.7, 1.0 - min(volatility, 0.30))
        concentration_penalty = max(0, 1.0 - (pool_concentration / MAX_POOL_CONCENTRATION))

        # Calculate base size
        size = (
            capital
            * self.base_fraction
            * confidence_factor
            * volatility_factor
            * concentration_penalty
        )

        # Leverage adjustment
        leverage_multiplier = leverage_bps / 10000
        if leverage_multiplier > 1.0:
            size = size / (1 + (leverage_multiplier - 1) * 0.5)

        # Apply bounds
        original_size = size
        size = max(self.min_position, min(self.max_position, size))

        # Apply pool liquidity cap
        pool_capped = False
        if max_pool_liquidity:
            max_size_from_pool = max_pool_liquidity * MAX_POOL_CONCENTRATION
            if size > max_size_from_pool:
                size = max_size_from_pool
                pool_capped = True

        # Build reasoning
        reasoning_parts = []

        reasoning_parts.append(
            f"Base allocation: ${capital:.2f} * {self.base_fraction:.0%} = ${capital * self.base_fraction:.2f}"
        )

        if confidence_factor < 1.0:
            reasoning_parts.append(
                f"Confidence adjustment: {confidence}% -> {confidence_factor:.2f}x"
            )

        if volatility_factor < 1.0:
            reasoning_parts.append(
                f"Volatility reduction: {volatility:.1%} vol -> {volatility_factor:.2f}x"
            )

        if concentration_penalty < 1.0:
            reasoning_parts.append(
                f"Concentration penalty: {pool_concentration:.1%} of pool -> {concentration_penalty:.2f}x"
            )

        if leverage_multiplier > 1.0:
            reasoning_parts.append(
                f"Leverage adjustment: {leverage_multiplier:.1f}x leverage reduces size"
            )

        if size != original_size:
            if size == self.min_position:
                reasoning_parts.append(f"Applied minimum position size: ${self.min_position}")
            elif size == self.max_position:
                reasoning_parts.append(f"Applied maximum position size: ${self.max_position}")

        if pool_capped:
            reasoning_parts.append(
                f"Capped at {MAX_POOL_CONCENTRATION:.0%} of pool liquidity"
            )

        reasoning = "; ".join(reasoning_parts)

        # Recommend lower leverage if confidence is low
        recommended_leverage = leverage_bps
        if confidence < 50:
            recommended_leverage = min(leverage_bps, 15000)  # Max 1.5x for low confidence
            reasoning += f"; Low confidence -> recommend max {recommended_leverage / 10000:.1f}x leverage"
        elif confidence < 70:
            recommended_leverage = min(leverage_bps, 20000)  # Max 2x for medium confidence
            reasoning += f"; Medium confidence -> recommend max {recommended_leverage / 10000:.1f}x leverage"

        result = PositionSizeResult(
            size_usdc=round(size, 2),
            recommended_leverage_bps=recommended_leverage,
            confidence_adjusted=confidence_factor,
            volatility_factor=volatility_factor,
            concentration_factor=concentration_penalty,
            reasoning=reasoning,
        )

        logger.info(
            f"Position sizing result: ${result.size_usdc:.2f} "
            f"with {result.recommended_leverage_bps / 10000:.1f}x leverage"
        )
        logger.debug(f"Reasoning: {reasoning}")

        return result

    def calculate_max_position(
        self,
        capital: float,
        pool_liquidity: Optional[float] = None,
    ) -> float:
        """Calculate the maximum possible position size.

        Args:
            capital: Available capital
            pool_liquidity: Pool liquidity for concentration limit

        Returns:
            Maximum position size in USDC
        """
        max_size = capital * self.base_fraction

        # Apply hard cap
        max_size = min(max_size, self.max_position)

        # Apply pool concentration limit
        if pool_liquidity:
            max_size_from_pool = pool_liquidity * MAX_POOL_CONCENTRATION
            max_size = min(max_size, max_size_from_pool)

        return round(max_size, 2)

    def validate_position_size(
        self,
        size: float,
        capital: float,
        pool_liquidity: Optional[float] = None,
    ) -> tuple[bool, Optional[str]]:
        """Validate if a position size is acceptable.

        Args:
            size: Proposed position size
            capital: Available capital
            pool_liquidity: Pool liquidity

        Returns:
            Tuple of (is_valid, error_message)
        """
        if size < self.min_position:
            return False, f"Position size ${size:.2f} below minimum ${self.min_position}"

        if size > self.max_position:
            return False, f"Position size ${size:.2f} exceeds maximum ${self.max_position}"

        if size > capital * self.base_fraction:
            return False, (
                f"Position size ${size:.2f} exceeds {self.base_fraction:.0%} "
                f"of capital ${capital:.2f}"
            )

        if pool_liquidity:
            max_from_pool = pool_liquidity * MAX_POOL_CONCENTRATION
            if size > max_from_pool:
                return False, (
                    f"Position size ${size:.2f} would exceed "
                    f"{MAX_POOL_CONCENTRATION:.0%} of pool (${max_from_pool:.2f})"
                )

        return True, None
