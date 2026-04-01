"""Health score monitoring for Euler vault positions."""

import asyncio
from dataclasses import dataclass
from enum import Enum
from typing import Optional
from loguru import logger

from agent.execution.web3_client import Web3Client
from agent.contracts.addresses import CONTRACTS
from agent.contracts.abi_loader import HEDGING_VAULT_ABI


# Health Score Thresholds
HS_SAFE = 1.5
HS_WARNING = 1.4
HS_LEVEL_1 = 1.3  # Reduce 25%
HS_LEVEL_2 = 1.2  # Reduce 50%
HS_LEVEL_3 = 1.1  # Max 1.5x leverage
HS_EMERGENCY = 1.05  # Full exit


class HealthAction(str, Enum):
    """Recommended actions based on health score levels."""

    NONE = "none"
    ALERT_WARNING = "alert_warning"
    REDUCE_25_PERCENT = "reduce_25_percent"
    REDUCE_50_PERCENT = "reduce_50_percent"
    REDUCE_TO_1_5X = "reduce_to_1_5x"
    EMERGENCY_EXIT = "emergency_exit"


@dataclass
class HealthCheckResult:
    """Result of health score check."""

    health_score: float
    action: HealthAction
    message: str
    severity: str  # "info", "warning", "critical"
    timestamp: float

    @property
    def requires_immediate_action(self) -> bool:
        """Check if health requires immediate intervention."""
        return self.action in [
            HealthAction.REDUCE_50_PERCENT,
            HealthAction.REDUCE_TO_1_5X,
            HealthAction.EMERGENCY_EXIT,
        ]


class HealthMonitor:
    """Monitor health scores and recommend actions.

    Polls Euler vault health scores and maps them to specific
    risk management actions based on threshold levels.
    """

    def __init__(
        self,
        web3_client: Web3Client,
        vault_address: str,
        poll_interval: int = 60,
    ):
        """Initialize health monitor.

        Args:
            web3_client: Web3 client for blockchain queries
            vault_address: Euler vault contract address
            poll_interval: Seconds between health checks
        """
        self.web3 = web3_client
        self.vault_address = vault_address
        self.poll_interval = poll_interval

        self._last_health_score: Optional[float] = None
        self._last_action: HealthAction = HealthAction.NONE
        self._running = False
        self._monitor_task: Optional[asyncio.Task] = None

        logger.info(
            f"Health monitor initialized for vault {vault_address} "
            f"(poll interval: {poll_interval}s)"
        )

    async def get_health_score(self) -> float:
        """Poll current health score from Euler vault.

        Returns:
            Current health score (>1.0 means healthy)

        Raises:
            Exception: If unable to fetch health score
        """
        logger.debug(f"Fetching health score from vault {self.vault_address}")

        try:
            # Call getHealthScore(account) on the hedging vault
            account = self.web3.account.address
            raw_score = await self.web3.call_contract_function(
                self.vault_address,
                HEDGING_VAULT_ABI,
                "getHealthScore",
                account,
            )

            # Contract returns uint256 scaled by 1e18
            health_score = float(raw_score) / 1e18
            logger.debug(f"Health score: {health_score:.3f}")
            return health_score

        except Exception as e:
            logger.warning(f"Failed to fetch on-chain health score: {e}")
            # Fall back to safe default if no position exists or contract call fails
            if self._last_health_score is not None:
                logger.debug(f"Using cached health score: {self._last_health_score:.3f}")
                return self._last_health_score
            # No position likely means healthy
            return 2.0

    def get_action_for_health_score(self, health_score: float) -> HealthCheckResult:
        """Determine recommended action based on health score level.

        Args:
            health_score: Current health score

        Returns:
            Health check result with recommended action
        """
        import time

        timestamp = time.time()

        if health_score <= HS_EMERGENCY:
            return HealthCheckResult(
                health_score=health_score,
                action=HealthAction.EMERGENCY_EXIT,
                message=f"EMERGENCY: Health score {health_score:.3f} at or below {HS_EMERGENCY} - immediate exit required",
                severity="critical",
                timestamp=timestamp,
            )

        elif health_score <= HS_LEVEL_3:
            return HealthCheckResult(
                health_score=health_score,
                action=HealthAction.REDUCE_TO_1_5X,
                message=f"CRITICAL: Health score {health_score:.3f} at or below {HS_LEVEL_3} - reduce to max 1.5x leverage",
                severity="critical",
                timestamp=timestamp,
            )

        elif health_score <= HS_LEVEL_2:
            return HealthCheckResult(
                health_score=health_score,
                action=HealthAction.REDUCE_50_PERCENT,
                message=f"DANGER: Health score {health_score:.3f} at or below {HS_LEVEL_2} - reduce position by 50%",
                severity="critical",
                timestamp=timestamp,
            )

        elif health_score <= HS_LEVEL_1:
            return HealthCheckResult(
                health_score=health_score,
                action=HealthAction.REDUCE_25_PERCENT,
                message=f"WARNING: Health score {health_score:.3f} at or below {HS_LEVEL_1} - reduce position by 25%",
                severity="warning",
                timestamp=timestamp,
            )

        elif health_score < HS_SAFE:
            return HealthCheckResult(
                health_score=health_score,
                action=HealthAction.ALERT_WARNING,
                message=f"CAUTION: Health score {health_score:.3f} below {HS_SAFE} - monitor closely",
                severity="warning",
                timestamp=timestamp,
            )

        else:
            return HealthCheckResult(
                health_score=health_score,
                action=HealthAction.NONE,
                message=f"Health score {health_score:.3f} is safe (above {HS_SAFE})",
                severity="info",
                timestamp=timestamp,
            )

    async def check_and_act(self) -> HealthCheckResult:
        """Check current health and return recommended action.

        Returns:
            Health check result with action recommendation
        """
        try:
            # Fetch current health score
            health_score = await self.get_health_score()
            self._last_health_score = health_score

            # Determine action
            result = self.get_action_for_health_score(health_score)

            # Log based on severity
            if result.severity == "critical":
                logger.critical(result.message)
            elif result.severity == "warning":
                logger.warning(result.message)
            else:
                logger.debug(result.message)

            # Track action changes
            if result.action != self._last_action:
                logger.info(f"Health action changed: {self._last_action.value} -> {result.action.value}")
                self._last_action = result.action

            return result

        except Exception as e:
            logger.error(f"Failed to check health score: {e}")
            # Return safe default on error
            import time
            return HealthCheckResult(
                health_score=self._last_health_score or 0.0,
                action=HealthAction.NONE,
                message=f"Health check failed: {e}",
                severity="warning",
                timestamp=time.time(),
            )

    async def start_monitoring(self):
        """Start continuous health monitoring in background."""
        if self._running:
            logger.warning("Health monitoring already running")
            return

        self._running = True
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        logger.success("Health monitoring started")

    async def stop_monitoring(self):
        """Stop health monitoring."""
        if not self._running:
            return

        self._running = False

        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass

        logger.info("Health monitoring stopped")

    async def _monitor_loop(self):
        """Background monitoring loop."""
        logger.debug("Health monitor loop started")

        try:
            while self._running:
                await self.check_and_act()
                await asyncio.sleep(self.poll_interval)

        except asyncio.CancelledError:
            logger.debug("Health monitor loop cancelled")
            raise

    @property
    def last_health_score(self) -> Optional[float]:
        """Get last recorded health score."""
        return self._last_health_score

    @property
    def is_healthy(self) -> bool:
        """Check if last health score was safe."""
        if self._last_health_score is None:
            return False
        return self._last_health_score >= HS_WARNING
