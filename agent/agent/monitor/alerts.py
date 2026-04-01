"""Alert system with WebSocket broadcasting."""

from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any
from loguru import logger

from agent.websocket.server import WebSocketManager, EventType, Severity


class AlertSeverity(str, Enum):
    """Alert severity levels."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class Alert:
    """Alert record."""

    severity: AlertSeverity
    title: str
    message: str
    timestamp: datetime = field(default_factory=datetime.now)
    context: Dict[str, Any] = field(default_factory=dict)
    acknowledged: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "severity": self.severity.value,
            "title": self.title,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
            "context": self.context,
            "acknowledged": self.acknowledged,
        }


class AlertManager:
    """Manage alerts and broadcast via WebSocket.

    Collects alerts from various agent components and broadcasts
    them to connected clients for real-time monitoring.
    """

    def __init__(
        self,
        websocket_manager: Optional[WebSocketManager] = None,
        max_history: int = 500,
    ):
        """Initialize alert manager.

        Args:
            websocket_manager: WebSocket manager for broadcasting alerts
            max_history: Maximum number of alerts to keep in history
        """
        self.ws_manager = websocket_manager
        self.max_history = max_history

        # Alert history
        self._alerts: List[Alert] = []

        # Statistics
        self._total_alerts = 0
        self._alert_counts = {
            AlertSeverity.INFO: 0,
            AlertSeverity.WARNING: 0,
            AlertSeverity.CRITICAL: 0,
        }

        logger.info(f"Alert manager initialized (max history: {max_history})")

    async def send_alert(
        self,
        severity: AlertSeverity,
        title: str,
        message: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Alert:
        """Create and broadcast an alert.

        Args:
            severity: Alert severity level
            title: Alert title
            message: Alert message
            context: Additional context data

        Returns:
            Created alert instance
        """
        alert = Alert(
            severity=severity,
            title=title,
            message=message,
            context=context or {},
        )

        # Add to history
        self._alerts.append(alert)
        if len(self._alerts) > self.max_history:
            self._alerts.pop(0)

        # Update statistics
        self._total_alerts += 1
        self._alert_counts[severity] += 1

        # Log alert
        log_msg = f"[{severity.value.upper()}] {title}: {message}"
        if severity == AlertSeverity.CRITICAL:
            logger.critical(log_msg)
        elif severity == AlertSeverity.WARNING:
            logger.warning(log_msg)
        else:
            logger.info(log_msg)

        # Broadcast via WebSocket
        if self.ws_manager:
            try:
                # Map alert severity to WebSocket severity
                ws_severity = Severity.INFO
                if severity == AlertSeverity.WARNING:
                    ws_severity = Severity.WARNING
                elif severity == AlertSeverity.CRITICAL:
                    ws_severity = Severity.CRITICAL

                await self.ws_manager.broadcast(
                    event_type=EventType.PRICE_ALERT,  # Generic alert event
                    data={
                        "title": title,
                        "severity": severity.value,
                        "context": context or {},
                    },
                    message=message,
                    severity=ws_severity,
                )

                logger.debug(f"Alert broadcast to {self.ws_manager.connection_count} clients")

            except Exception as e:
                logger.error(f"Failed to broadcast alert: {e}")

        return alert

    async def info(self, title: str, message: str, **context) -> Alert:
        """Send info alert.

        Args:
            title: Alert title
            message: Alert message
            **context: Additional context as keyword arguments

        Returns:
            Created alert
        """
        return await self.send_alert(
            severity=AlertSeverity.INFO,
            title=title,
            message=message,
            context=context,
        )

    async def warning(self, title: str, message: str, **context) -> Alert:
        """Send warning alert.

        Args:
            title: Alert title
            message: Alert message
            **context: Additional context as keyword arguments

        Returns:
            Created alert
        """
        return await self.send_alert(
            severity=AlertSeverity.WARNING,
            title=title,
            message=message,
            context=context,
        )

    async def critical(self, title: str, message: str, **context) -> Alert:
        """Send critical alert.

        Args:
            title: Alert title
            message: Alert message
            **context: Additional context as keyword arguments

        Returns:
            Created alert
        """
        return await self.send_alert(
            severity=AlertSeverity.CRITICAL,
            title=title,
            message=message,
            context=context,
        )

    def get_recent_alerts(
        self,
        limit: int = 100,
        severity: Optional[AlertSeverity] = None,
        unacknowledged_only: bool = False,
    ) -> List[Alert]:
        """Get recent alerts.

        Args:
            limit: Maximum number of alerts to return
            severity: Filter by severity level
            unacknowledged_only: Only return unacknowledged alerts

        Returns:
            List of alerts (most recent first)
        """
        alerts = self._alerts

        # Filter by severity
        if severity:
            alerts = [a for a in alerts if a.severity == severity]

        # Filter by acknowledgment
        if unacknowledged_only:
            alerts = [a for a in alerts if not a.acknowledged]

        # Return most recent first
        return list(reversed(alerts[-limit:]))

    def acknowledge(self, alert_index: int) -> bool:
        """Acknowledge an alert.

        Args:
            alert_index: Index of alert to acknowledge

        Returns:
            True if acknowledged successfully
        """
        if 0 <= alert_index < len(self._alerts):
            self._alerts[alert_index].acknowledged = True
            logger.debug(f"Alert {alert_index} acknowledged")
            return True

        logger.warning(f"Cannot acknowledge - alert {alert_index} not found")
        return False

    def acknowledge_all(self, severity: Optional[AlertSeverity] = None) -> int:
        """Acknowledge all alerts or all of a specific severity.

        Args:
            severity: Optional severity filter

        Returns:
            Number of alerts acknowledged
        """
        count = 0

        for alert in self._alerts:
            if not alert.acknowledged:
                if severity is None or alert.severity == severity:
                    alert.acknowledged = True
                    count += 1

        logger.info(f"Acknowledged {count} alerts")
        return count

    def get_alert_stats(self) -> Dict[str, Any]:
        """Get alert statistics.

        Returns:
            Dictionary with alert metrics
        """
        unacknowledged = sum(1 for a in self._alerts if not a.acknowledged)

        return {
            "total_alerts": self._total_alerts,
            "info_count": self._alert_counts[AlertSeverity.INFO],
            "warning_count": self._alert_counts[AlertSeverity.WARNING],
            "critical_count": self._alert_counts[AlertSeverity.CRITICAL],
            "unacknowledged": unacknowledged,
            "history_size": len(self._alerts),
        }

    def clear_history(self, severity: Optional[AlertSeverity] = None) -> int:
        """Clear alert history.

        Args:
            severity: Optional severity filter (clears all if None)

        Returns:
            Number of alerts cleared
        """
        if severity is None:
            count = len(self._alerts)
            self._alerts.clear()
            logger.info(f"Cleared {count} alerts from history")
            return count

        original_count = len(self._alerts)
        self._alerts = [a for a in self._alerts if a.severity != severity]
        cleared = original_count - len(self._alerts)

        logger.info(f"Cleared {cleared} {severity.value} alerts from history")
        return cleared

    @property
    def alert_count(self) -> int:
        """Get current number of alerts in history."""
        return len(self._alerts)

    @property
    def unacknowledged_count(self) -> int:
        """Get number of unacknowledged alerts."""
        return sum(1 for a in self._alerts if not a.acknowledged)
