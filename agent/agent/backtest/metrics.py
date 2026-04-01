"""Performance metrics calculation for backtesting."""

import numpy as np
import pandas as pd
from typing import Optional
from loguru import logger
from agent.backtest.simulator import Trade


class BacktestMetrics:
    """Calculate performance metrics for backtest results."""

    @staticmethod
    def sharpe_ratio(
        returns: pd.Series,
        risk_free_rate: float = 0.02,
        periods_per_year: int = 365,
    ) -> float:
        """Calculate Sharpe ratio.

        Args:
            returns: Series of period returns (as decimals, not percentages)
            risk_free_rate: Annual risk-free rate (default 2%)
            periods_per_year: Number of periods per year (365 for daily, 252 for trading days)

        Returns:
            Sharpe ratio (annualized)
        """
        if len(returns) < 2:
            return 0.0

        excess_returns = returns - (risk_free_rate / periods_per_year)

        if excess_returns.std() == 0:
            return 0.0

        sharpe = np.sqrt(periods_per_year) * (excess_returns.mean() / excess_returns.std())
        return float(sharpe)

    @staticmethod
    def sortino_ratio(
        returns: pd.Series,
        risk_free_rate: float = 0.02,
        periods_per_year: int = 365,
    ) -> float:
        """Calculate Sortino ratio (focuses on downside volatility).

        Args:
            returns: Series of period returns (as decimals)
            risk_free_rate: Annual risk-free rate (default 2%)
            periods_per_year: Number of periods per year

        Returns:
            Sortino ratio (annualized)
        """
        if len(returns) < 2:
            return 0.0

        excess_returns = returns - (risk_free_rate / periods_per_year)
        downside_returns = excess_returns[excess_returns < 0]

        if len(downside_returns) == 0 or downside_returns.std() == 0:
            return 0.0

        sortino = np.sqrt(periods_per_year) * (excess_returns.mean() / downside_returns.std())
        return float(sortino)

    @staticmethod
    def max_drawdown(equity_curve: pd.Series) -> float:
        """Calculate maximum drawdown.

        Args:
            equity_curve: Series of equity values over time

        Returns:
            Maximum drawdown as a percentage (positive number)
        """
        if len(equity_curve) < 2:
            return 0.0

        # Calculate running maximum
        running_max = equity_curve.expanding().max()

        # Calculate drawdown at each point
        drawdown = (equity_curve - running_max) / running_max * 100

        # Return the maximum (most negative) drawdown as a positive number
        max_dd = abs(float(drawdown.min()))

        return max_dd

    @staticmethod
    def calmar_ratio(
        returns: pd.Series,
        equity_curve: pd.Series,
        periods_per_year: int = 365,
    ) -> float:
        """Calculate Calmar ratio (annual return / max drawdown).

        Args:
            returns: Series of period returns
            equity_curve: Series of equity values over time
            periods_per_year: Number of periods per year

        Returns:
            Calmar ratio
        """
        if len(returns) < 2 or len(equity_curve) < 2:
            return 0.0

        # Calculate annualized return
        total_return = (equity_curve.iloc[-1] - equity_curve.iloc[0]) / equity_curve.iloc[0]
        num_periods = len(equity_curve)
        years = num_periods / periods_per_year
        annualized_return = (1 + total_return) ** (1 / years) - 1

        # Calculate max drawdown
        max_dd = BacktestMetrics.max_drawdown(equity_curve)

        if max_dd == 0:
            return 0.0

        calmar = (annualized_return * 100) / max_dd
        return float(calmar)

    @staticmethod
    def win_rate(trades: list[Trade]) -> float:
        """Calculate win rate.

        Args:
            trades: List of closed trades

        Returns:
            Win rate as percentage (0-100)
        """
        closed_trades = [t for t in trades if t.is_closed and t.pnl is not None]

        if not closed_trades:
            return 0.0

        winning_trades = [t for t in closed_trades if t.pnl > 0]
        win_rate = len(winning_trades) / len(closed_trades) * 100

        return win_rate

    @staticmethod
    def profit_factor(trades: list[Trade]) -> float:
        """Calculate profit factor (gross profits / gross losses).

        Args:
            trades: List of closed trades

        Returns:
            Profit factor (> 1 is profitable)
        """
        closed_trades = [t for t in trades if t.is_closed and t.pnl is not None]

        if not closed_trades:
            return 0.0

        gross_profit = sum(t.pnl for t in closed_trades if t.pnl > 0)
        gross_loss = abs(sum(t.pnl for t in closed_trades if t.pnl < 0))

        if gross_loss == 0:
            return float('inf') if gross_profit > 0 else 0.0

        profit_factor = gross_profit / gross_loss
        return profit_factor

    @staticmethod
    def average_win(trades: list[Trade]) -> float:
        """Calculate average winning trade.

        Args:
            trades: List of closed trades

        Returns:
            Average win in USDC
        """
        winning_trades = [t for t in trades if t.is_closed and t.pnl and t.pnl > 0]

        if not winning_trades:
            return 0.0

        return sum(t.pnl for t in winning_trades) / len(winning_trades)

    @staticmethod
    def average_loss(trades: list[Trade]) -> float:
        """Calculate average losing trade.

        Args:
            trades: List of closed trades

        Returns:
            Average loss in USDC (positive number)
        """
        losing_trades = [t for t in trades if t.is_closed and t.pnl and t.pnl < 0]

        if not losing_trades:
            return 0.0

        return abs(sum(t.pnl for t in losing_trades) / len(losing_trades))

    @staticmethod
    def expectancy(trades: list[Trade]) -> float:
        """Calculate trade expectancy (average expected profit per trade).

        Args:
            trades: List of closed trades

        Returns:
            Expectancy in USDC
        """
        closed_trades = [t for t in trades if t.is_closed and t.pnl is not None]

        if not closed_trades:
            return 0.0

        win_rate = BacktestMetrics.win_rate(trades) / 100
        avg_win = BacktestMetrics.average_win(trades)
        avg_loss = BacktestMetrics.average_loss(trades)

        expectancy = (win_rate * avg_win) - ((1 - win_rate) * avg_loss)
        return expectancy

    @staticmethod
    def calculate_all_metrics(
        trades: list[Trade],
        equity_curve: pd.DataFrame,
        initial_capital: float,
    ) -> dict:
        """Calculate all performance metrics.

        Args:
            trades: List of trades
            equity_curve: DataFrame with equity over time
            initial_capital: Starting capital

        Returns:
            Dictionary of all metrics
        """
        logger.info("Calculating performance metrics")

        if equity_curve.empty or len(trades) == 0:
            logger.warning("No data to calculate metrics")
            return {}

        # Extract equity series
        if isinstance(equity_curve, pd.DataFrame):
            equity = equity_curve["equity"]
        else:
            equity = equity_curve

        # Calculate returns
        returns = equity.pct_change().dropna()

        # Calculate metrics
        metrics = {
            # Overall performance
            "total_return_pct": ((equity.iloc[-1] - initial_capital) / initial_capital * 100),
            "final_equity": float(equity.iloc[-1]),

            # Risk metrics
            "sharpe_ratio": BacktestMetrics.sharpe_ratio(returns),
            "sortino_ratio": BacktestMetrics.sortino_ratio(returns),
            "max_drawdown_pct": BacktestMetrics.max_drawdown(equity),
            "calmar_ratio": BacktestMetrics.calmar_ratio(returns, equity),

            # Trade metrics
            "total_trades": len(trades),
            "win_rate_pct": BacktestMetrics.win_rate(trades),
            "profit_factor": BacktestMetrics.profit_factor(trades),
            "average_win": BacktestMetrics.average_win(trades),
            "average_loss": BacktestMetrics.average_loss(trades),
            "expectancy": BacktestMetrics.expectancy(trades),

            # Additional stats
            "total_fees_paid": sum(t.fees_paid for t in trades),
            "average_leverage": np.mean([t.leverage_bps for t in trades]) / 10000,
        }

        # Calculate win/loss counts
        closed_trades = [t for t in trades if t.is_closed and t.pnl is not None]
        metrics["winning_trades"] = len([t for t in closed_trades if t.pnl > 0])
        metrics["losing_trades"] = len([t for t in closed_trades if t.pnl < 0])

        logger.info(f"Metrics calculated: Sharpe {metrics['sharpe_ratio']:.2f}, "
                   f"Win Rate {metrics['win_rate_pct']:.2f}%, "
                   f"Max DD {metrics['max_drawdown_pct']:.2f}%")

        return metrics
