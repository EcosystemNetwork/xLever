"""Risk limits: stop-loss, take-profit, trailing stops, daily loss tracking."""

from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Optional, Dict
from loguru import logger


@dataclass
class RiskLimits:
    """Risk management limit configuration."""

    stop_loss_percent: float = 15.0  # -15% loss triggers exit
    take_profit_percent: float = 30.0  # +30% profit triggers exit
    trailing_stop_percent: float = 10.0  # Trail by 10% from peak
    daily_loss_limit_percent: float = 5.0  # Max 5% daily loss
    max_position_size_usdc: float = 10000.0  # Hard cap on position size

    def validate(self) -> bool:
        """Validate limit configuration.

        Returns:
            True if configuration is valid
        """
        if self.stop_loss_percent <= 0 or self.stop_loss_percent > 100:
            logger.error(f"Invalid stop loss: {self.stop_loss_percent}%")
            return False

        if self.take_profit_percent <= 0:
            logger.error(f"Invalid take profit: {self.take_profit_percent}%")
            return False

        if self.trailing_stop_percent <= 0 or self.trailing_stop_percent > 100:
            logger.error(f"Invalid trailing stop: {self.trailing_stop_percent}%")
            return False

        if self.daily_loss_limit_percent <= 0 or self.daily_loss_limit_percent > 100:
            logger.error(f"Invalid daily loss limit: {self.daily_loss_limit_percent}%")
            return False

        return True


@dataclass
class TrailingStop:
    """Trailing stop-loss tracker."""

    entry_price: float
    highest_price: float
    trailing_percent: float
    is_long: bool

    def update(self, current_price: float) -> None:
        """Update highest price if current price is higher.

        Args:
            current_price: Current market price
        """
        if self.is_long:
            # For longs, track upward movement
            if current_price > self.highest_price:
                logger.debug(
                    f"Trailing stop updated: ${self.highest_price:.2f} -> ${current_price:.2f}"
                )
                self.highest_price = current_price
        else:
            # For shorts, track downward movement (inverse logic)
            if current_price < self.highest_price:
                logger.debug(
                    f"Trailing stop updated: ${self.highest_price:.2f} -> ${current_price:.2f}"
                )
                self.highest_price = current_price

    def should_trigger(self, current_price: float) -> bool:
        """Check if trailing stop should trigger.

        Args:
            current_price: Current market price

        Returns:
            True if stop should trigger
        """
        if self.is_long:
            # For longs, trigger if price falls X% from highest
            drop_from_high = (self.highest_price - current_price) / self.highest_price * 100
            should_trigger = drop_from_high >= self.trailing_percent

            if should_trigger:
                logger.warning(
                    f"Trailing stop triggered: price ${current_price:.2f} is "
                    f"{drop_from_high:.2f}% below peak ${self.highest_price:.2f}"
                )

            return should_trigger
        else:
            # For shorts, trigger if price rises X% from lowest
            rise_from_low = (current_price - self.highest_price) / self.highest_price * 100
            should_trigger = rise_from_low >= self.trailing_stop_percent

            if should_trigger:
                logger.warning(
                    f"Trailing stop triggered: price ${current_price:.2f} is "
                    f"{rise_from_low:.2f}% above low ${self.highest_price:.2f}"
                )

            return should_trigger

    @property
    def stop_price(self) -> float:
        """Calculate current stop price.

        Returns:
            Price at which stop would trigger
        """
        if self.is_long:
            return self.highest_price * (1 - self.trailing_percent / 100)
        else:
            return self.highest_price * (1 + self.trailing_percent / 100)


class RiskLimitChecker:
    """Check risk limits and track daily losses.

    Implements stop-loss, take-profit, trailing stops, and daily loss limits.
    """

    def __init__(self, limits: Optional[RiskLimits] = None):
        """Initialize risk limit checker.

        Args:
            limits: Risk limit configuration (uses defaults if not provided)
        """
        self.limits = limits or RiskLimits()

        if not self.limits.validate():
            raise ValueError("Invalid risk limits configuration")

        # Daily tracking
        self._daily_pnl: Dict[date, float] = {}
        self._today_date: Optional[date] = None
        self._today_pnl: float = 0.0

        # Trailing stops by position ID
        self._trailing_stops: Dict[int, TrailingStop] = {}

        logger.info(
            f"Risk limits initialized: "
            f"stop-loss={self.limits.stop_loss_percent}%, "
            f"take-profit={self.limits.take_profit_percent}%, "
            f"trailing={self.limits.trailing_stop_percent}%, "
            f"daily-loss={self.limits.daily_loss_limit_percent}%"
        )

    def should_stop_loss(
        self,
        entry_price: float,
        current_price: float,
        is_long: bool,
    ) -> bool:
        """Check if stop loss should trigger.

        Args:
            entry_price: Position entry price
            current_price: Current market price
            is_long: True if long position

        Returns:
            True if stop loss should trigger
        """
        if is_long:
            loss_pct = (entry_price - current_price) / entry_price * 100
        else:
            loss_pct = (current_price - entry_price) / entry_price * 100

        should_trigger = loss_pct >= self.limits.stop_loss_percent

        if should_trigger:
            logger.warning(
                f"Stop loss triggered: {loss_pct:.2f}% loss exceeds limit "
                f"{self.limits.stop_loss_percent}%"
            )

        return should_trigger

    def should_take_profit(
        self,
        entry_price: float,
        current_price: float,
        is_long: bool,
    ) -> bool:
        """Check if take profit should trigger.

        Args:
            entry_price: Position entry price
            current_price: Current market price
            is_long: True if long position

        Returns:
            True if take profit should trigger
        """
        if is_long:
            profit_pct = (current_price - entry_price) / entry_price * 100
        else:
            profit_pct = (entry_price - current_price) / entry_price * 100

        should_trigger = profit_pct >= self.limits.take_profit_percent

        if should_trigger:
            logger.success(
                f"Take profit triggered: {profit_pct:.2f}% profit exceeds target "
                f"{self.limits.take_profit_percent}%"
            )

        return should_trigger

    def create_trailing_stop(
        self,
        position_id: int,
        entry_price: float,
        current_price: float,
        is_long: bool,
    ) -> TrailingStop:
        """Create and track a trailing stop for a position.

        Args:
            position_id: Position identifier
            entry_price: Position entry price
            current_price: Current market price
            is_long: True if long position

        Returns:
            Created trailing stop instance
        """
        trailing_stop = TrailingStop(
            entry_price=entry_price,
            highest_price=current_price if is_long else current_price,
            trailing_percent=self.limits.trailing_stop_percent,
            is_long=is_long,
        )

        self._trailing_stops[position_id] = trailing_stop

        logger.info(
            f"Trailing stop created for position {position_id}: "
            f"entry=${entry_price:.2f}, initial_high=${current_price:.2f}, "
            f"trail={self.limits.trailing_stop_percent}%"
        )

        return trailing_stop

    def update_trailing_stop(self, position_id: int, current_price: float) -> bool:
        """Update trailing stop for a position.

        Args:
            position_id: Position identifier
            current_price: Current market price

        Returns:
            True if trailing stop should trigger
        """
        trailing_stop = self._trailing_stops.get(position_id)

        if not trailing_stop:
            logger.warning(f"No trailing stop found for position {position_id}")
            return False

        trailing_stop.update(current_price)
        return trailing_stop.should_trigger(current_price)

    def remove_trailing_stop(self, position_id: int) -> None:
        """Remove trailing stop for a closed position.

        Args:
            position_id: Position identifier
        """
        if position_id in self._trailing_stops:
            del self._trailing_stops[position_id]
            logger.debug(f"Trailing stop removed for position {position_id}")

    def record_realized_pnl(self, pnl: float) -> None:
        """Record realized PnL for daily tracking.

        Args:
            pnl: Realized profit/loss in USDC
        """
        today = date.today()

        # Reset if new day
        if self._today_date != today:
            logger.info(f"New trading day: {today}")
            self._today_date = today
            self._today_pnl = 0.0

        # Add to today's PnL
        self._today_pnl += pnl

        # Update history
        if today not in self._daily_pnl:
            self._daily_pnl[today] = 0.0
        self._daily_pnl[today] += pnl

        logger.info(f"Daily PnL updated: ${self._today_pnl:.2f} (trade: ${pnl:.2f})")

    def is_daily_loss_exceeded(self, capital: float = 10000.0) -> bool:
        """Check if daily loss limit has been exceeded.

        Args:
            capital: Total trading capital for percentage calculation

        Returns:
            True if daily loss limit exceeded
        """
        today = date.today()

        # Reset if new day
        if self._today_date != today:
            self._today_date = today
            self._today_pnl = 0.0

        # Only check losses (negative PnL)
        if self._today_pnl >= 0:
            return False

        loss_pct = abs(self._today_pnl) / capital * 100

        exceeded = loss_pct >= self.limits.daily_loss_limit_percent

        if exceeded:
            logger.critical(
                f"Daily loss limit exceeded: {loss_pct:.2f}% (${abs(self._today_pnl):.2f}) "
                f"vs limit {self.limits.daily_loss_limit_percent}%"
            )
        elif loss_pct > self.limits.daily_loss_limit_percent * 0.75:
            # Warning at 75% of limit
            logger.warning(
                f"Daily loss approaching limit: {loss_pct:.2f}% "
                f"(${abs(self._today_pnl):.2f}) of {self.limits.daily_loss_limit_percent}%"
            )

        return exceeded

    def get_daily_pnl(self, day: Optional[date] = None) -> float:
        """Get PnL for a specific day.

        Args:
            day: Date to query (defaults to today)

        Returns:
            Daily PnL in USDC
        """
        day = day or date.today()

        if day == self._today_date:
            return self._today_pnl

        return self._daily_pnl.get(day, 0.0)

    def get_pnl_summary(self, days: int = 7) -> Dict[str, float]:
        """Get PnL summary for recent days.

        Args:
            days: Number of days to include

        Returns:
            Dictionary with daily PnL values
        """
        summary = {}
        today = date.today()

        for i in range(days):
            day = today - datetime.timedelta(days=i)
            pnl = self.get_daily_pnl(day)
            summary[day.isoformat()] = pnl

        return summary

    @property
    def today_pnl(self) -> float:
        """Get today's realized PnL."""
        return self._today_pnl

    @property
    def active_trailing_stops(self) -> int:
        """Get number of active trailing stops."""
        return len(self._trailing_stops)
