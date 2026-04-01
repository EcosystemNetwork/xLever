"""Metrics collection for agent monitoring."""

from dataclasses import dataclass, asdict
from datetime import datetime
from typing import List, Dict, Any, Optional
from collections import deque
from loguru import logger


@dataclass
class CycleMetrics:
    """Metrics for a single decision cycle."""

    timestamp: datetime
    cycle_duration_ms: float
    decision_action: str
    decision_confidence: float
    decision_blocked: bool
    position_count: int
    position_pnl: float
    health_score: float
    market_price: float
    divergence_bps: int
    errors: List[str]

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        data = asdict(self)
        data["timestamp"] = self.timestamp.isoformat()
        return data


class MetricsCollector:
    """Collect and store agent metrics for monitoring and analysis.

    Maintains a rolling window of recent cycle metrics and provides
    aggregated statistics for dashboard display.
    """

    def __init__(self, max_history: int = 1000):
        """Initialize metrics collector.

        Args:
            max_history: Maximum number of cycles to keep in history
        """
        self.max_history = max_history
        self._cycles: deque[CycleMetrics] = deque(maxlen=max_history)

        # Aggregate counters
        self._total_cycles = 0
        self._total_decisions = 0
        self._total_blocks = 0
        self._total_errors = 0

        logger.info(f"Metrics collector initialized (max history: {max_history})")

    def record_cycle(self, metrics: CycleMetrics) -> None:
        """Record metrics for a decision cycle.

        Args:
            metrics: Cycle metrics to record
        """
        self._cycles.append(metrics)

        # Update counters
        self._total_cycles += 1

        if metrics.decision_action != "HOLD":
            self._total_decisions += 1

        if metrics.decision_blocked:
            self._total_blocks += 1

        if metrics.errors:
            self._total_errors += len(metrics.errors)

        logger.debug(
            f"Cycle metrics recorded: {metrics.decision_action} "
            f"(confidence: {metrics.decision_confidence}%, "
            f"duration: {metrics.cycle_duration_ms:.0f}ms)"
        )

    def get_recent_cycles(self, limit: int = 100) -> List[CycleMetrics]:
        """Get most recent cycle metrics.

        Args:
            limit: Maximum number of cycles to return

        Returns:
            List of recent cycle metrics
        """
        cycles_list = list(self._cycles)
        return cycles_list[-limit:]

    def get_dashboard_data(self) -> Dict[str, Any]:
        """Prepare aggregated data for dashboard display.

        Returns:
            Dictionary with dashboard metrics
        """
        if not self._cycles:
            return {
                "total_cycles": 0,
                "total_decisions": 0,
                "total_blocks": 0,
                "total_errors": 0,
                "avg_cycle_duration_ms": 0,
                "avg_confidence": 0,
                "decision_distribution": {},
                "recent_pnl": 0,
                "current_health_score": 0,
                "current_price": 0,
            }

        cycles_list = list(self._cycles)

        # Calculate averages
        avg_duration = sum(c.cycle_duration_ms for c in cycles_list) / len(cycles_list)
        avg_confidence = sum(c.decision_confidence for c in cycles_list) / len(cycles_list)

        # Decision distribution
        decision_counts: Dict[str, int] = {}
        for cycle in cycles_list:
            action = cycle.decision_action
            decision_counts[action] = decision_counts.get(action, 0) + 1

        # Recent PnL (last 10 cycles)
        recent_pnl = sum(c.position_pnl for c in cycles_list[-10:])

        # Latest values
        latest = cycles_list[-1]

        return {
            "total_cycles": self._total_cycles,
            "total_decisions": self._total_decisions,
            "total_blocks": self._total_blocks,
            "total_errors": self._total_errors,
            "avg_cycle_duration_ms": round(avg_duration, 2),
            "avg_confidence": round(avg_confidence, 2),
            "decision_distribution": decision_counts,
            "recent_pnl": round(recent_pnl, 2),
            "current_health_score": latest.health_score,
            "current_price": latest.market_price,
            "current_divergence_bps": latest.divergence_bps,
            "last_update": latest.timestamp.isoformat(),
        }

    def get_performance_stats(self, hours: Optional[int] = None) -> Dict[str, Any]:
        """Get performance statistics.

        Args:
            hours: Number of hours to analyze (None for all history)

        Returns:
            Performance statistics
        """
        if not self._cycles:
            return {
                "cycles_analyzed": 0,
                "total_pnl": 0,
                "win_rate": 0,
                "avg_pnl_per_trade": 0,
                "max_drawdown": 0,
            }

        cycles_list = list(self._cycles)

        # Filter by time if requested
        if hours:
            cutoff_time = datetime.now() - datetime.timedelta(hours=hours)
            cycles_list = [c for c in cycles_list if c.timestamp >= cutoff_time]

        if not cycles_list:
            return {
                "cycles_analyzed": 0,
                "total_pnl": 0,
                "win_rate": 0,
                "avg_pnl_per_trade": 0,
                "max_drawdown": 0,
            }

        # Calculate statistics
        total_pnl = sum(c.position_pnl for c in cycles_list)
        trades = [c for c in cycles_list if c.decision_action != "HOLD"]
        winning_trades = [c for c in trades if c.position_pnl > 0]

        win_rate = len(winning_trades) / len(trades) * 100 if trades else 0
        avg_pnl = total_pnl / len(trades) if trades else 0

        # Calculate max drawdown
        cumulative_pnl = 0
        peak_pnl = 0
        max_drawdown = 0

        for cycle in cycles_list:
            cumulative_pnl += cycle.position_pnl
            peak_pnl = max(peak_pnl, cumulative_pnl)
            drawdown = peak_pnl - cumulative_pnl
            max_drawdown = max(max_drawdown, drawdown)

        return {
            "cycles_analyzed": len(cycles_list),
            "trades_executed": len(trades),
            "total_pnl": round(total_pnl, 2),
            "win_rate": round(win_rate, 2),
            "avg_pnl_per_trade": round(avg_pnl, 2),
            "max_drawdown": round(max_drawdown, 2),
            "winning_trades": len(winning_trades),
            "losing_trades": len(trades) - len(winning_trades),
        }

    def get_error_summary(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent errors from cycles.

        Args:
            limit: Maximum number of errors to return

        Returns:
            List of error records
        """
        errors = []

        for cycle in reversed(list(self._cycles)):
            if cycle.errors:
                for error in cycle.errors:
                    errors.append(
                        {
                            "timestamp": cycle.timestamp.isoformat(),
                            "error": error,
                            "cycle_action": cycle.decision_action,
                        }
                    )

                    if len(errors) >= limit:
                        return errors

        return errors

    def export_metrics(self, format: str = "json") -> Any:
        """Export metrics in specified format.

        Args:
            format: Export format ("json", "csv")

        Returns:
            Exported metrics data
        """
        if format == "json":
            return [cycle.to_dict() for cycle in self._cycles]

        elif format == "csv":
            # CSV export (simplified)
            import csv
            import io

            output = io.StringIO()
            if not self._cycles:
                return output.getvalue()

            fieldnames = list(asdict(self._cycles[0]).keys())
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writeheader()

            for cycle in self._cycles:
                row = asdict(cycle)
                row["timestamp"] = cycle.timestamp.isoformat()
                row["errors"] = "; ".join(cycle.errors) if cycle.errors else ""
                writer.writerow(row)

            return output.getvalue()

        else:
            raise ValueError(f"Unsupported export format: {format}")

    @property
    def total_cycles(self) -> int:
        """Get total number of cycles recorded."""
        return self._total_cycles

    @property
    def cycle_count(self) -> int:
        """Get number of cycles in current history."""
        return len(self._cycles)
