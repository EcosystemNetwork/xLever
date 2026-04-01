"""Main agent loop orchestrating all components."""

import asyncio
import signal
import time
from datetime import datetime
from typing import Optional
from loguru import logger

from agent.config import Settings, get_settings
from agent.execution.web3_client import Web3Client
from agent.execution.tx_builder import TransactionBuilder
from agent.intelligence.tavily import TavilyClient
from agent.intelligence.market import MarketIntelligence, MarketState
from agent.strategy.llm_strategy import LLMStrategy, TradingDecision
from agent.strategy.rules import RuleEngine
from agent.risk.sizing import PositionSizeCalculator
from agent.risk.health import HealthMonitor, HealthAction
from agent.risk.limits import RiskLimitChecker, RiskLimits
from agent.hitl.controller import HITLController, HITLMode
from agent.monitor.metrics import MetricsCollector, CycleMetrics
from agent.monitor.alerts import AlertManager, AlertSeverity
from agent.websocket.server import WebSocketManager
from agent.models.position import Position, PositionStatus


class TradingAgent:
    """Main AI trading agent.

    Orchestrates all components: market intelligence, decision making,
    rule validation, risk management, execution, and monitoring.
    """

    def __init__(
        self,
        settings: Optional[Settings] = None,
        paper_mode: bool = True,
    ):
        """Initialize trading agent.

        Args:
            settings: Agent configuration (uses defaults if not provided)
            paper_mode: Run in paper trading mode (no real execution)
        """
        self.settings = settings or get_settings()
        self.paper_mode = paper_mode
        self.running = False

        # Component initialization flags
        self._initialized = False

        # Components (initialized in initialize())
        self.web3: Optional[Web3Client] = None
        self.tavily: Optional[TavilyClient] = None
        self.market_intel: Optional[MarketIntelligence] = None
        self.llm_strategy: Optional[LLMStrategy] = None
        self.rule_engine: Optional[RuleEngine] = None
        self.position_sizer: Optional[PositionSizeCalculator] = None
        self.health_monitor: Optional[HealthMonitor] = None
        self.risk_checker: Optional[RiskLimitChecker] = None
        self.hitl_controller: Optional[HITLController] = None
        self.metrics: Optional[MetricsCollector] = None
        self.alert_manager: Optional[AlertManager] = None
        self.ws_manager: Optional[WebSocketManager] = None

        # Agent state
        self._current_position: Optional[Position] = None
        self._shutdown_requested = False
        self._available_capital_usdc: float = 10000.0  # Updated from wallet balance when available

        # Tracking (used by API routes)
        self.start_time: Optional[datetime] = None
        self.last_decision_at: Optional[datetime] = None
        self.total_decisions: int = 0
        self.total_trades: int = 0

        # Transaction builder (initialized in initialize())
        self.tx_builder = None

        logger.info(
            f"Trading agent created (mode: {'PAPER' if paper_mode else 'LIVE'})"
        )

    @property
    def hitl(self):
        """Alias for hitl_controller (used by API routes)."""
        return self.hitl_controller

    @property
    def current_position(self):
        """Current position (used by API routes)."""
        return self._current_position

    @property
    def last_health_score(self):
        """Last health score (used by API routes)."""
        if self.health_monitor:
            return self.health_monitor.last_health_score
        return None

    async def initialize(self) -> None:
        """Initialize all agent components."""
        if self._initialized:
            logger.warning("Agent already initialized")
            return

        logger.info("Initializing trading agent components...")

        try:
            # 1. WebSocket server (for monitoring)
            self.ws_manager = WebSocketManager(
                host="localhost",
                port=8765,
            )
            await self.ws_manager.start()

            # 2. Alert manager (depends on WebSocket)
            self.alert_manager = AlertManager(
                websocket_manager=self.ws_manager,
                max_history=500,
            )

            # 3. Web3 client
            self.web3 = Web3Client(
                rpc_url=self.settings.blockchain.rpc_url,
                chain_id=self.settings.blockchain.chain_id,
                private_key=self.settings.blockchain.private_key,
            )

            # Check connection
            if not await self.web3.is_connected():
                raise Exception("Failed to connect to blockchain")

            # 3b. Transaction builder
            self.tx_builder = TransactionBuilder(
                web3_client=self.web3,
                max_gas_gwei=100,
            )

            # 4. Tavily client (for AI market intelligence)
            self.tavily = TavilyClient(
                api_key=self.settings.apis.tavily_api_key,
            )

            # 5. Market intelligence
            self.market_intel = MarketIntelligence(
                tavily_client=self.tavily,
                web3_client=self.web3,
                refresh_interval=900,  # 15 minutes
            )

            # 6. LLM strategy
            self.llm_strategy = LLMStrategy(
                tavily_client=self.tavily,
                max_retries=3,
            )

            # 7. Rule engine
            self.rule_engine = RuleEngine(
                current_gas_price_gwei=50,  # TODO: Fetch actual gas price
            )

            # 8. Position sizer
            self.position_sizer = PositionSizeCalculator(
                base_fraction=0.25,
                min_position=10.0,
                max_position=self.settings.risk.max_position_usdc,
            )

            # 9. Health monitor
            from agent.contracts.addresses import CONTRACTS
            vault_address = CONTRACTS["wSPYx_HEDGING"]

            self.health_monitor = HealthMonitor(
                web3_client=self.web3,
                vault_address=vault_address,
                poll_interval=60,
            )

            # 10. Risk limit checker
            risk_limits = RiskLimits(
                stop_loss_percent=self.settings.risk.stop_loss_pct,
                take_profit_percent=self.settings.risk.take_profit_pct,
                trailing_stop_percent=10.0,
                daily_loss_limit_percent=5.0,
                max_position_size_usdc=self.settings.risk.max_position_usdc,
            )
            self.risk_checker = RiskLimitChecker(limits=risk_limits)

            # 11. HITL controller
            self.hitl_controller = HITLController(
                mode=HITLMode.AUTONOMOUS if self.paper_mode else HITLMode.APPROVAL_ABOVE_THRESHOLD,
                threshold_usdc=1000.0,
                default_timeout_action="reject",
            )

            # 12. Metrics collector
            self.metrics = MetricsCollector(max_history=1000)

            self._initialized = True

            await self.alert_manager.info(
                title="Agent Initialized",
                message=f"Trading agent initialized in {'PAPER' if self.paper_mode else 'LIVE'} mode",
            )

            logger.success("All components initialized successfully")

        except Exception as e:
            logger.critical(f"Failed to initialize agent: {e}")
            await self.shutdown()
            raise

    async def make_decision(
        self,
        market_state: MarketState,
    ) -> TradingDecision:
        """Generate trading decision through full pipeline.

        Args:
            market_state: Current market state

        Returns:
            Validated and potentially modified trading decision
        """
        # 1. Get LLM recommendation
        logger.info("Querying LLM for trading decision...")

        decision = await self.llm_strategy.decide(
            market_state=market_state,
            current_position=self._current_position,
            available_capital_usdc=self._available_capital_usdc,
            max_leverage_bps=self.settings.risk.max_leverage_bps,
        )

        logger.info(
            f"LLM decision: {decision.action.value} "
            f"(confidence: {decision.confidence}%)"
        )

        # 2. Apply rule engine
        logger.info("Validating decision through rule engine...")

        validated_decision, rule_results = self.rule_engine.validate(
            decision=decision,
            market_state=market_state,
            current_position=self._current_position,
            position_history=[],  # TODO: Load from database
        )

        # Check if blocked by rules
        if validated_decision.blocked:
            logger.warning(
                f"Decision blocked by rules: {validated_decision.block_reason}"
            )

            await self.alert_manager.warning(
                title="Decision Blocked",
                message=f"{decision.action.value} blocked: {validated_decision.block_reason}",
                violated_rules=validated_decision.rule_violations,
            )

        # 3. Route through HITL if needed
        if self.hitl_controller.requires_approval(validated_decision):
            logger.info("Decision requires human approval, requesting...")

            await self.alert_manager.info(
                title="Approval Required",
                message=f"{decision.action.value} requires human approval",
                decision=validated_decision.to_dict(),
            )

            validated_decision = await self.hitl_controller.request_approval(
                decision=validated_decision,
            )

        return validated_decision

    async def execute(self, decision: TradingDecision) -> None:
        """Execute a trading decision.

        Args:
            decision: Trading decision to execute
        """
        if decision.blocked:
            logger.warning("Cannot execute blocked decision")
            return

        if decision.action.value == "HOLD":
            logger.info("Decision is HOLD, nothing to execute")
            return

        if self.paper_mode:
            await self.simulate_execution(decision)
        else:
            await self.execute_on_chain(decision)

    async def simulate_execution(self, decision: TradingDecision) -> None:
        """Simulate execution in paper trading mode.

        Args:
            decision: Trading decision to simulate
        """
        logger.info(f"[PAPER MODE] Simulating execution: {decision.action.value}")

        await self.alert_manager.info(
            title="Paper Trade Executed",
            message=f"Simulated {decision.action.value} for {decision.asset}",
            decision=decision.to_dict(),
        )

        # TODO: Track simulated position

    async def execute_on_chain(self, decision: TradingDecision) -> None:
        """Execute decision on blockchain.

        Args:
            decision: Trading decision to execute
        """
        logger.info(f"[LIVE MODE] Executing on-chain: {decision.action.value}")

        try:
            tx_hash = await self.tx_builder.execute_decision(
                decision=decision,
                slippage_bps=50,
            )

            if tx_hash:
                self.total_trades += 1

                # Broadcast via WebSocket
                if self.ws_manager:
                    from agent.websocket.server import EventType, Severity
                    await self.ws_manager.broadcast(
                        event_type=EventType.POSITION_OPENED if decision.action.value in ("OPEN_LONG", "OPEN_SHORT") else EventType.POSITION_CLOSED,
                        data={"tx_hash": tx_hash, **decision.to_dict()},
                        message=f"Executed {decision.action.value} on-chain: {tx_hash}",
                        severity=Severity.INFO,
                    )

                await self.alert_manager.info(
                    title="Live Execution",
                    message=f"Executed {decision.action.value} on-chain: {tx_hash}",
                    tx_hash=tx_hash,
                    decision=decision.to_dict(),
                )
            else:
                logger.warning("Transaction builder returned no tx_hash")

        except Exception as e:
            logger.error(f"On-chain execution failed: {e}")
            await self.alert_manager.critical(
                title="Execution Failed",
                message=f"Failed to execute {decision.action.value}: {str(e)}",
                decision=decision.to_dict(),
            )

    async def execute_health_action(self, action: HealthAction) -> None:
        """Execute health score remediation action.

        Args:
            action: Health action to execute
        """
        logger.critical(f"Executing health action: {action.value}")

        await self.alert_manager.critical(
            title="Health Action",
            message=f"Executing {action.value} due to low health score",
            action=action.value,
        )

        # TODO: Implement specific health actions
        # - REDUCE_25_PERCENT: Reduce position by 25%
        # - REDUCE_50_PERCENT: Reduce position by 50%
        # - REDUCE_TO_1_5X: Reduce leverage to 1.5x
        # - EMERGENCY_EXIT: Close all positions

    async def handle_error(self, error: Exception) -> None:
        """Handle errors in the main loop.

        Args:
            error: Exception that occurred
        """
        logger.error(f"Error in agent loop: {error}", exc_info=True)

        await self.alert_manager.critical(
            title="Agent Error",
            message=str(error),
            error_type=type(error).__name__,
        )

    async def run(self) -> None:
        """Main agent loop.

        Continuously monitors market, makes decisions, and executes trades
        while enforcing all safety rules and risk limits.
        """
        if not self._initialized:
            await self.initialize()

        self.running = True
        self.start_time = datetime.now()

        await self.alert_manager.info(
            title="Agent Started",
            message=f"Trading agent loop started (interval: {self.settings.agent.loop_interval}s)",
        )

        logger.success(
            f"Agent loop starting (interval: {self.settings.agent.loop_interval}s)"
        )

        while self.running and not self._shutdown_requested:
            cycle_start = time.time()

            try:
                # 1. Check health first (safety priority)
                logger.debug("Checking position health...")
                health_result = await self.health_monitor.check_and_act()

                if health_result.requires_immediate_action:
                    logger.critical(
                        f"Immediate health action required: {health_result.action.value}"
                    )
                    await self.execute_health_action(health_result.action)
                    continue  # Skip trading cycle, focus on health

                # 2. Refresh market intelligence
                logger.info("Refreshing market intelligence...")
                market_state = await self.market_intel.get_market_state(
                    asset="wSPYx",  # TODO: Make configurable
                    force_refresh=False,
                    include_sentiment=True,
                )

                # 3. Check risk limits
                if self.risk_checker.is_daily_loss_exceeded(capital=10000.0):
                    logger.critical("Daily loss limit exceeded, pausing trading")

                    await self.alert_manager.critical(
                        title="Daily Loss Limit",
                        message="Trading paused: daily loss limit exceeded",
                        daily_pnl=self.risk_checker.today_pnl,
                    )

                    # Skip trading cycle
                    await asyncio.sleep(self.settings.agent.loop_interval)
                    continue

                # 4. Generate and validate decision
                logger.info("Generating trading decision...")
                decision = await self.make_decision(market_state)
                self.total_decisions += 1
                self.last_decision_at = datetime.now()

                # Broadcast decision via WebSocket
                if self.ws_manager:
                    from agent.websocket.server import EventType, Severity
                    await self.ws_manager.broadcast(
                        event_type=EventType.DECISION_MADE,
                        data=decision.to_dict(),
                        message=f"Decision: {decision.action.value} (confidence: {decision.confidence}%)",
                        severity=Severity.INFO,
                    )

                # Store decision in decisions_db
                from agent.api.routes.decisions import get_decisions_db
                decisions_db = get_decisions_db()
                decision_record = {
                    "id": str(self.total_decisions),
                    "created_at": datetime.now(),
                    **decision.to_dict(),
                    "market_price": market_state.spot_price,
                    "market_sentiment": market_state.sentiment,
                    "health_score": health_result.health_score,
                    "executed": False,
                    "execution_tx": None,
                    "execution_error": None,
                    "required_approval": False,
                    "approved": None,
                    "approved_by": None,
                    "approval_note": None,
                    "executed_at": None,
                    "rules_applied": [],
                    "rules_passed": [],
                    "rules_failed": decision.rule_violations,
                }
                decisions_db[str(self.total_decisions)] = decision_record

                # 5. Execute if approved and not blocked
                if decision.requires_execution:
                    logger.info(f"Executing decision: {decision.action.value}")
                    await self.execute(decision)
                    decision_record["executed"] = True
                    decision_record["executed_at"] = datetime.now()
                else:
                    logger.debug(
                        f"Decision does not require execution: {decision.action.value}"
                    )

                # 6. Record metrics
                cycle_duration = (time.time() - cycle_start) * 1000  # milliseconds

                metrics = CycleMetrics(
                    timestamp=datetime.now(),
                    cycle_duration_ms=cycle_duration,
                    decision_action=decision.action.value,
                    decision_confidence=decision.confidence,
                    decision_blocked=decision.blocked,
                    position_count=1 if self._current_position else 0,
                    position_pnl=0.0,  # TODO: Calculate actual PnL
                    health_score=health_result.health_score,
                    market_price=market_state.spot_price,
                    divergence_bps=market_state.divergence_bps,
                    errors=[],
                )

                self.metrics.record_cycle(metrics)

                logger.success(
                    f"Cycle completed in {cycle_duration:.0f}ms "
                    f"(decision: {decision.action.value})"
                )

            except Exception as e:
                await self.handle_error(e)

                # Record error in metrics
                cycle_duration = (time.time() - cycle_start) * 1000

                error_metrics = CycleMetrics(
                    timestamp=datetime.now(),
                    cycle_duration_ms=cycle_duration,
                    decision_action="ERROR",
                    decision_confidence=0,
                    decision_blocked=True,
                    position_count=0,
                    position_pnl=0.0,
                    health_score=0.0,
                    market_price=0.0,
                    divergence_bps=0,
                    errors=[str(e)],
                )

                self.metrics.record_cycle(error_metrics)

            # Wait before next cycle
            await asyncio.sleep(self.settings.agent.loop_interval)

        logger.info("Agent loop stopped")

    async def shutdown(self) -> None:
        """Graceful shutdown of all components."""
        logger.info("Shutting down trading agent...")

        self.running = False
        self._shutdown_requested = True

        # Stop components
        if self.health_monitor:
            await self.health_monitor.stop_monitoring()

        if self.market_intel:
            await self.market_intel.close()

        if self.ws_manager:
            await self.ws_manager.stop()

        if self.alert_manager:
            await self.alert_manager.info(
                title="Agent Stopped",
                message="Trading agent shut down gracefully",
            )

        logger.success("Trading agent shut down complete")

    def setup_signal_handlers(self) -> None:
        """Setup signal handlers for graceful shutdown."""

        def signal_handler(sig, frame):
            logger.warning(f"Received signal {sig}, initiating shutdown...")
            self._shutdown_requested = True

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)


async def main():
    """Entry point for running the trading agent."""
    from datetime import datetime

    # Load settings
    settings = get_settings()

    # Create agent
    agent = TradingAgent(
        settings=settings,
        paper_mode=True,  # Start in paper mode for safety
    )

    # Setup signal handlers
    agent.setup_signal_handlers()

    try:
        # Initialize and run
        await agent.initialize()
        await agent.run()

    except KeyboardInterrupt:
        logger.warning("Interrupted by user")

    except Exception as e:
        logger.critical(f"Fatal error: {e}", exc_info=True)

    finally:
        await agent.shutdown()


def main_sync():
    """Synchronous entry point for CLI."""
    asyncio.run(main())


if __name__ == "__main__":
    main_sync()
