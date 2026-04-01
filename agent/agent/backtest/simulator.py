"""Backtesting simulator for xLever AI Trading Agent."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import pandas as pd
from loguru import logger


@dataclass
class BacktestConfig:
    """Configuration for backtesting.

    Attributes:
        start_date: Start date for backtest period
        end_date: End date for backtest period
        initial_capital: Starting capital in USDC
        trading_fee_bps: Trading fee in basis points (default 30 = 0.3%)
        slippage_bps: Slippage in basis points (default 5 = 0.05%)
        max_leverage_bps: Maximum allowed leverage in basis points (default 50000 = 5x)
    """

    start_date: datetime
    end_date: datetime
    initial_capital: float = 100000.0
    trading_fee_bps: int = 30  # 0.3% fee
    slippage_bps: int = 5  # 0.05% slippage
    max_leverage_bps: int = 50000  # 5x leverage


@dataclass
class Trade:
    """Record of a single trade.

    Attributes:
        timestamp: Time of trade execution
        action: Trade action (OPEN_LONG, OPEN_SHORT, CLOSE_POSITION)
        asset: Asset traded
        direction: Position direction (LONG or SHORT)
        entry_price: Entry price for the position
        exit_price: Exit price (None if position still open)
        size_usdc: Position size in USDC
        leverage_bps: Leverage used in basis points
        pnl: Profit/loss in USDC (None if position still open)
        pnl_pct: Profit/loss percentage (None if position still open)
        fees_paid: Total fees paid for this trade
        exit_reason: Reason for closing position
    """

    timestamp: datetime
    action: str
    asset: str
    direction: str
    entry_price: float
    exit_price: Optional[float] = None
    size_usdc: float = 0.0
    leverage_bps: int = 10000  # 1x default
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    fees_paid: float = 0.0
    exit_reason: Optional[str] = None

    @property
    def is_closed(self) -> bool:
        """Check if trade is closed."""
        return self.exit_price is not None


@dataclass
class BacktestResult:
    """Results from a backtest run.

    Attributes:
        trades: List of all trades executed
        equity_curve: DataFrame with timestamp and equity value
        metrics: Dictionary of performance metrics
        config: Configuration used for backtest
        final_equity: Final equity value
        total_return: Total return percentage
    """

    trades: list[Trade] = field(default_factory=list)
    equity_curve: pd.DataFrame = field(default_factory=pd.DataFrame)
    metrics: dict = field(default_factory=dict)
    config: Optional[BacktestConfig] = None
    final_equity: float = 0.0
    total_return: float = 0.0

    def __post_init__(self):
        """Calculate final equity and total return after initialization."""
        if not self.equity_curve.empty and self.config:
            self.final_equity = float(self.equity_curve["equity"].iloc[-1])
            self.total_return = ((self.final_equity - self.config.initial_capital) /
                                self.config.initial_capital * 100)


class BacktestSimulator:
    """Simulator for backtesting trading strategies.

    Simulates trading with realistic fees, slippage, and leverage mechanics.
    """

    def __init__(self, config: BacktestConfig):
        """Initialize backtest simulator.

        Args:
            config: Backtesting configuration
        """
        self.config = config
        self.equity = config.initial_capital
        self.trades: list[Trade] = []
        self.equity_history: list[tuple[datetime, float]] = []
        self.open_position: Optional[Trade] = None

        logger.info(f"Initialized backtest: {config.start_date} to {config.end_date}, "
                   f"capital: ${config.initial_capital:,.2f}")

    def _calculate_fees(self, size_usdc: float) -> float:
        """Calculate trading fees.

        Args:
            size_usdc: Position size in USDC

        Returns:
            Fee amount in USDC
        """
        return size_usdc * (self.config.trading_fee_bps / 10000)

    def _apply_slippage(self, price: float, direction: str) -> float:
        """Apply slippage to price.

        Args:
            price: Original price
            direction: Trade direction (LONG or SHORT)

        Returns:
            Price after slippage
        """
        slippage_multiplier = self.config.slippage_bps / 10000
        if direction == "LONG":
            # Buying, price goes up
            return price * (1 + slippage_multiplier)
        else:
            # Selling, price goes down
            return price * (1 - slippage_multiplier)

    def open_position(
        self,
        timestamp: datetime,
        asset: str,
        direction: str,
        price: float,
        size_usdc: float,
        leverage_bps: int,
    ) -> bool:
        """Open a new position.

        Args:
            timestamp: Time of trade
            asset: Asset to trade
            direction: LONG or SHORT
            price: Entry price
            size_usdc: Position size in USDC
            leverage_bps: Leverage in basis points

        Returns:
            True if position opened successfully, False otherwise
        """
        if self.open_position:
            logger.warning("Cannot open position: already have an open position")
            return False

        if leverage_bps > self.config.max_leverage_bps:
            logger.warning(f"Leverage {leverage_bps} exceeds max {self.config.max_leverage_bps}")
            return False

        if size_usdc > self.equity:
            logger.warning(f"Insufficient capital: {size_usdc} > {self.equity}")
            return False

        # Apply slippage and calculate fees
        entry_price = self._apply_slippage(price, direction)
        fees = self._calculate_fees(size_usdc)

        # Deduct fees from equity
        self.equity -= fees

        # Create trade record
        trade = Trade(
            timestamp=timestamp,
            action=f"OPEN_{direction}",
            asset=asset,
            direction=direction,
            entry_price=entry_price,
            size_usdc=size_usdc,
            leverage_bps=leverage_bps,
            fees_paid=fees,
        )

        self.open_position = trade
        logger.debug(f"Opened {direction} position: {asset} @ {entry_price:.2f}, "
                    f"size: ${size_usdc:,.2f}, leverage: {leverage_bps/10000}x")

        return True

    def close_position(
        self,
        timestamp: datetime,
        price: float,
        reason: str = "strategy",
    ) -> bool:
        """Close the open position.

        Args:
            timestamp: Time of trade
            price: Exit price
            reason: Reason for closing

        Returns:
            True if position closed successfully, False otherwise
        """
        if not self.open_position:
            logger.warning("Cannot close position: no open position")
            return False

        pos = self.open_position

        # Apply slippage (opposite direction of entry)
        opposite_direction = "SHORT" if pos.direction == "LONG" else "LONG"
        exit_price = self._apply_slippage(price, opposite_direction)

        # Calculate exit fees
        fees = self._calculate_fees(pos.size_usdc)
        self.equity -= fees
        pos.fees_paid += fees

        # Calculate PnL
        if pos.direction == "LONG":
            price_change = (exit_price - pos.entry_price) / pos.entry_price
        else:  # SHORT
            price_change = (pos.entry_price - exit_price) / pos.entry_price

        # Apply leverage effect
        leverage_multiplier = pos.leverage_bps / 10000
        pnl_pct = price_change * leverage_multiplier * 100
        pnl_usdc = pos.size_usdc * (pnl_pct / 100)

        # Update equity
        self.equity += pnl_usdc

        # Update trade record
        pos.exit_price = exit_price
        pos.pnl = pnl_usdc
        pos.pnl_pct = pnl_pct
        pos.exit_reason = reason

        self.trades.append(pos)
        self.open_position = None

        logger.debug(f"Closed position: {pos.asset} @ {exit_price:.2f}, "
                    f"PnL: ${pnl_usdc:,.2f} ({pnl_pct:.2f}%), reason: {reason}")

        return True

    def update_equity_history(self, timestamp: datetime, current_price: Optional[float] = None):
        """Update equity history with current equity value.

        Args:
            timestamp: Current timestamp
            current_price: Current market price (for unrealized PnL calculation)
        """
        equity = self.equity

        # Add unrealized PnL from open position
        if self.open_position and current_price:
            pos = self.open_position
            if pos.direction == "LONG":
                price_change = (current_price - pos.entry_price) / pos.entry_price
            else:  # SHORT
                price_change = (pos.entry_price - current_price) / pos.entry_price

            leverage_multiplier = pos.leverage_bps / 10000
            unrealized_pnl_pct = price_change * leverage_multiplier * 100
            unrealized_pnl_usdc = pos.size_usdc * (unrealized_pnl_pct / 100)

            equity += unrealized_pnl_usdc

        self.equity_history.append((timestamp, equity))

    def run(
        self,
        market_data: pd.DataFrame,
        strategy_signals: pd.DataFrame,
    ) -> BacktestResult:
        """Run backtest simulation.

        Args:
            market_data: DataFrame with OHLCV data (must have 'close' column)
            strategy_signals: DataFrame with trading signals
                             (must have 'action', 'direction', 'size_usdc', 'leverage_bps')

        Returns:
            BacktestResult with trades, equity curve, and metrics
        """
        logger.info(f"Running backtest with {len(market_data)} bars")

        # Merge market data with signals on index (timestamp)
        data = market_data.join(strategy_signals, how="left")

        for idx, row in data.iterrows():
            timestamp = idx if isinstance(idx, datetime) else datetime.fromisoformat(str(idx))
            current_price = row["close"]

            # Check for signal
            if pd.notna(row.get("action")):
                action = row["action"]

                if action in ["OPEN_LONG", "OPEN_SHORT"]:
                    if not self.open_position:
                        direction = row["direction"]
                        size_usdc = row.get("size_usdc", self.equity * 0.1)  # Default 10% of equity
                        leverage_bps = int(row.get("leverage_bps", 10000))  # Default 1x

                        self.open_position(
                            timestamp=timestamp,
                            asset=row.get("asset", "ETH"),
                            direction=direction,
                            price=current_price,
                            size_usdc=min(size_usdc, self.equity),
                            leverage_bps=leverage_bps,
                        )

                elif action == "CLOSE_POSITION":
                    if self.open_position:
                        reason = row.get("exit_reason", "strategy")
                        self.close_position(
                            timestamp=timestamp,
                            price=current_price,
                            reason=reason,
                        )

            # Update equity history
            self.update_equity_history(timestamp, current_price)

        # Close any remaining open position
        if self.open_position:
            last_row = data.iloc[-1]
            last_timestamp = data.index[-1]
            if isinstance(last_timestamp, datetime):
                timestamp = last_timestamp
            else:
                timestamp = datetime.fromisoformat(str(last_timestamp))

            self.close_position(
                timestamp=timestamp,
                price=last_row["close"],
                reason="end_of_backtest",
            )

        # Create equity curve DataFrame
        equity_curve = pd.DataFrame(
            self.equity_history,
            columns=["timestamp", "equity"],
        ).set_index("timestamp")

        # Create result
        result = BacktestResult(
            trades=self.trades,
            equity_curve=equity_curve,
            config=self.config,
        )

        logger.info(f"Backtest complete: {len(self.trades)} trades, "
                   f"final equity: ${result.final_equity:,.2f}, "
                   f"total return: {result.total_return:.2f}%")

        return result
