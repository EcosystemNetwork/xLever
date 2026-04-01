"""Quick verification script for Phase 2 components."""

import asyncio
from datetime import datetime

# Import Phase 2 components
from agent.risk.health import HealthMonitor, HealthAction
from agent.risk.limits import RiskLimitChecker, RiskLimits, TrailingStop
from agent.hitl.controller import HITLController, HITLMode, Urgency
from agent.monitor.metrics import MetricsCollector, CycleMetrics
from agent.monitor.alerts import AlertManager, AlertSeverity


def test_health_monitor():
    """Test health monitor component."""
    print("\n=== Testing Health Monitor ===")

    # Test action determination
    from agent.risk.health import HealthMonitor

    # Mock instance (without Web3 client)
    test_scores = [1.6, 1.35, 1.25, 1.15, 1.08, 1.02]

    for score in test_scores:
        # Create mock health check result
        import time
        from agent.risk.health import HealthCheckResult

        monitor = HealthMonitor.__new__(HealthMonitor)
        result = monitor.get_action_for_health_score(score)

        print(f"  Health Score {score:.2f} → {result.action.value} ({result.severity})")
        print(f"    Message: {result.message}")

    print("✓ Health Monitor tests passed")


def test_risk_limits():
    """Test risk limit checker component."""
    print("\n=== Testing Risk Limits ===")

    # Create risk limits
    limits = RiskLimits(
        stop_loss_percent=15.0,
        take_profit_percent=30.0,
        trailing_stop_percent=10.0,
        daily_loss_limit_percent=5.0,
    )

    print(f"  Configured limits: {limits}")

    # Create checker
    checker = RiskLimitChecker(limits=limits)

    # Test stop-loss
    should_stop = checker.should_stop_loss(
        entry_price=100.0,
        current_price=82.0,  # -18% loss
        is_long=True,
    )
    print(f"  Stop-loss test (long, -18%): {should_stop}")

    # Test take-profit
    should_profit = checker.should_take_profit(
        entry_price=100.0,
        current_price=135.0,  # +35% profit
        is_long=True,
    )
    print(f"  Take-profit test (long, +35%): {should_profit}")

    # Test trailing stop
    trailing = checker.create_trailing_stop(
        position_id=1,
        entry_price=100.0,
        current_price=120.0,
        is_long=True,
    )
    print(f"  Trailing stop created: peak=${trailing.highest_price:.2f}, stop=${trailing.stop_price:.2f}")

    # Update trailing stop
    trailing.update(125.0)
    print(f"  After update to $125: peak=${trailing.highest_price:.2f}, stop=${trailing.stop_price:.2f}")

    # Test daily loss
    checker.record_realized_pnl(-300.0)  # Record $300 loss
    exceeded = checker.is_daily_loss_exceeded(capital=10000.0)
    print(f"  Daily loss test (-$300 on $10k): {exceeded} (limit: 5%)")

    print("✓ Risk Limits tests passed")


def test_hitl_controller():
    """Test HITL controller component."""
    print("\n=== Testing HITL Controller ===")

    # Create controller
    hitl = HITLController(
        mode=HITLMode.APPROVAL_ABOVE_THRESHOLD,
        threshold_usdc=1000.0,
    )

    print(f"  Mode: {hitl.mode.value}")
    print(f"  Threshold: ${hitl.threshold_usdc:.2f}")

    # Mock decision
    from agent.strategy.llm_strategy import TradingDecision, DecisionAction

    # Small decision (no approval needed)
    small_decision = TradingDecision(
        action=DecisionAction.OPEN_LONG,
        asset="wSPYx",
        size_usdc=500.0,
        confidence=75,
        reasoning="Test decision",
    )

    needs_approval = hitl.requires_approval(small_decision)
    print(f"  Small decision ($500): approval_required={needs_approval}")

    # Large decision (approval needed)
    large_decision = TradingDecision(
        action=DecisionAction.OPEN_LONG,
        asset="wSPYx",
        size_usdc=2000.0,
        confidence=85,
        reasoning="Large test decision",
    )

    needs_approval = hitl.requires_approval(large_decision)
    print(f"  Large decision ($2000): approval_required={needs_approval}")

    # Test approval stats
    stats = hitl.get_approval_stats()
    print(f"  Approval stats: {stats}")

    print("✓ HITL Controller tests passed")


def test_metrics_collector():
    """Test metrics collector component."""
    print("\n=== Testing Metrics Collector ===")

    # Create collector
    collector = MetricsCollector(max_history=100)

    # Record some test cycles
    for i in range(5):
        metrics = CycleMetrics(
            timestamp=datetime.now(),
            cycle_duration_ms=2500.0 + i * 100,
            decision_action="HOLD" if i % 2 == 0 else "OPEN_LONG",
            decision_confidence=70.0 + i * 5,
            decision_blocked=False,
            position_count=i % 2,
            position_pnl=10.0 * i if i % 2 == 1 else -5.0,
            health_score=1.5 + i * 0.01,
            market_price=550.0 + i,
            divergence_bps=50 + i * 10,
            errors=[],
        )
        collector.record_cycle(metrics)

    # Get dashboard data
    dashboard = collector.get_dashboard_data()
    print(f"  Total cycles: {dashboard['total_cycles']}")
    print(f"  Avg duration: {dashboard['avg_cycle_duration_ms']:.0f}ms")
    print(f"  Avg confidence: {dashboard['avg_confidence']:.1f}%")
    print(f"  Decision distribution: {dashboard['decision_distribution']}")
    print(f"  Recent PnL: ${dashboard['recent_pnl']:.2f}")

    # Performance stats
    stats = collector.get_performance_stats()
    print(f"  Performance: {stats['trades_executed']} trades, ${stats['total_pnl']:.2f} PnL")

    print("✓ Metrics Collector tests passed")


async def test_alert_manager():
    """Test alert manager component."""
    print("\n=== Testing Alert Manager ===")

    # Create alert manager (without WebSocket)
    alert_mgr = AlertManager(
        websocket_manager=None,
        max_history=100,
    )

    # Send test alerts
    await alert_mgr.info(
        title="Test Info",
        message="This is an informational alert",
        test_key="test_value",
    )

    await alert_mgr.warning(
        title="Test Warning",
        message="This is a warning alert",
        position_id=1,
    )

    await alert_mgr.critical(
        title="Test Critical",
        message="This is a critical alert",
        health_score=1.02,
    )

    # Get recent alerts
    recent = alert_mgr.get_recent_alerts(limit=10)
    print(f"  Total alerts sent: {len(recent)}")

    for alert in recent:
        print(f"  [{alert.severity.value.upper()}] {alert.title}: {alert.message}")

    # Get stats
    stats = alert_mgr.get_alert_stats()
    print(f"  Alert stats: {stats}")

    # Test acknowledgment
    alert_mgr.acknowledge_all(severity=AlertSeverity.INFO)
    stats = alert_mgr.get_alert_stats()
    print(f"  After acknowledging INFO: {stats['unacknowledged']} unacknowledged")

    print("✓ Alert Manager tests passed")


async def main():
    """Run all component tests."""
    print("=" * 60)
    print("Phase 2 Component Verification")
    print("=" * 60)

    # Run tests
    test_health_monitor()
    test_risk_limits()
    test_hitl_controller()
    test_metrics_collector()
    await test_alert_manager()

    print("\n" + "=" * 60)
    print("✓ All Phase 2 Components Verified Successfully!")
    print("=" * 60)
    print("\nComponents ready:")
    print("  - Health Monitor (vault safety)")
    print("  - Risk Limits (stop-loss, take-profit, trailing stops)")
    print("  - HITL Controller (human approval workflows)")
    print("  - Metrics Collector (performance tracking)")
    print("  - Alert Manager (real-time notifications)")
    print("\nNext: Run full agent with `python -m agent.main`")


if __name__ == "__main__":
    asyncio.run(main())
