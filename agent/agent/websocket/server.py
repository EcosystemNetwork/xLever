"""WebSocket server for real-time agent event broadcasting."""

import asyncio
import json
from typing import Set, Dict, Any, Optional
from datetime import datetime
from enum import Enum
from websockets.server import WebSocketServerProtocol, serve
from pydantic import BaseModel, Field
from loguru import logger


class EventType(str, Enum):
    """Types of events broadcast by the agent."""

    # Decision events
    DECISION_MADE = "decision_made"
    DECISION_APPROVED = "decision_approved"
    DECISION_REJECTED = "decision_rejected"

    # Position events
    POSITION_OPENED = "position_opened"
    POSITION_CLOSED = "position_closed"
    POSITION_UPDATED = "position_updated"
    POSITION_LIQUIDATED = "position_liquidated"

    # Market events
    MARKET_UPDATE = "market_update"
    PRICE_ALERT = "price_alert"

    # System events
    AGENT_STARTED = "agent_started"
    AGENT_STOPPED = "agent_stopped"
    ERROR = "error"
    HEALTH_CHECK = "health_check"


class Severity(str, Enum):
    """Severity levels for events."""

    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class EventMessage(BaseModel):
    """Structured event message for WebSocket broadcast."""

    event_type: EventType = Field(description="Type of event")
    severity: Severity = Field(default=Severity.INFO, description="Event severity")
    timestamp: datetime = Field(default_factory=datetime.now, description="Event timestamp")
    data: Dict[str, Any] = Field(default_factory=dict, description="Event data payload")
    message: Optional[str] = Field(default=None, description="Human-readable message")

    def to_json(self) -> str:
        """Convert to JSON string for transmission.

        Returns:
            JSON string representation
        """
        return json.dumps(
            {
                "event_type": self.event_type.value,
                "severity": self.severity.value,
                "timestamp": self.timestamp.isoformat(),
                "data": self.data,
                "message": self.message,
            }
        )


class WebSocketManager:
    """Manages WebSocket connections and broadcasts events.

    Handles multiple concurrent client connections, connection lifecycle,
    and reliable message broadcasting.
    """

    def __init__(self, host: str = "localhost", port: int = 8765):
        """Initialize WebSocket manager.

        Args:
            host: Host to bind server to
            port: Port to listen on
        """
        self.host = host
        self.port = port
        self.connections: Set[WebSocketServerProtocol] = set()
        self.server = None
        self._running = False
        self._message_queue: asyncio.Queue = asyncio.Queue()
        self._broadcast_task: Optional[asyncio.Task] = None

        logger.info(f"WebSocket manager initialized on {host}:{port}")

    async def start(self):
        """Start the WebSocket server and broadcast loop."""
        if self._running:
            logger.warning("WebSocket server already running")
            return

        try:
            # Start WebSocket server
            self.server = await serve(
                self._handle_connection,
                self.host,
                self.port,
            )

            # Start broadcast loop
            self._broadcast_task = asyncio.create_task(self._broadcast_loop())
            self._running = True

            logger.success(f"WebSocket server started on ws://{self.host}:{self.port}")

        except Exception as e:
            logger.error(f"Failed to start WebSocket server: {e}")
            raise

    async def stop(self):
        """Stop the WebSocket server and close all connections."""
        if not self._running:
            return

        logger.info("Stopping WebSocket server...")

        # Cancel broadcast task
        if self._broadcast_task:
            self._broadcast_task.cancel()
            try:
                await self._broadcast_task
            except asyncio.CancelledError:
                pass

        # Close all connections
        if self.connections:
            await asyncio.gather(
                *[conn.close() for conn in self.connections],
                return_exceptions=True,
            )
            self.connections.clear()

        # Stop server
        if self.server:
            self.server.close()
            await self.server.wait_closed()

        self._running = False
        logger.success("WebSocket server stopped")

    async def _handle_connection(self, websocket: WebSocketServerProtocol):
        """Handle a new WebSocket connection.

        Args:
            websocket: WebSocket connection
        """
        addr = websocket.remote_address or ("unknown", 0)
        client_id = f"{addr[0]}:{addr[1]}" if len(addr) >= 2 else str(addr)
        logger.info(f"New WebSocket connection: {client_id}")

        # Add to connections
        self.connections.add(websocket)

        try:
            # Send welcome message
            welcome = EventMessage(
                event_type=EventType.HEALTH_CHECK,
                message="Connected to xLever AI Trading Agent",
                data={"clients": len(self.connections)},
            )
            await websocket.send(welcome.to_json())

            # Keep connection alive and handle incoming messages
            async for message in websocket:
                # Echo for now (can add command handling later)
                logger.debug(f"Received from {client_id}: {message}")

        except Exception as e:
            logger.warning(f"Connection error for {client_id}: {e}")

        finally:
            # Remove from connections
            self.connections.discard(websocket)
            logger.info(f"Connection closed: {client_id} ({len(self.connections)} remaining)")

    async def _broadcast_loop(self):
        """Background task to broadcast queued messages."""
        logger.debug("Broadcast loop started")

        try:
            while True:
                # Get next message from queue
                message = await self._message_queue.get()

                # Broadcast to all connected clients
                if self.connections:
                    await self._send_to_all(message)

        except asyncio.CancelledError:
            logger.debug("Broadcast loop cancelled")
            raise

    async def _send_to_all(self, message: str):
        """Send message to all connected clients.

        Args:
            message: JSON message to broadcast
        """
        if not self.connections:
            return

        # Send to all connections, removing failed ones
        failed_connections = set()

        for websocket in self.connections:
            try:
                await websocket.send(message)
            except Exception as e:
                logger.warning(f"Failed to send to {websocket.remote_address}: {e}")
                failed_connections.add(websocket)

        # Remove failed connections
        self.connections -= failed_connections

    async def broadcast(
        self,
        event_type: EventType,
        data: Dict[str, Any],
        message: Optional[str] = None,
        severity: Severity = Severity.INFO,
    ):
        """Broadcast an event to all connected clients.

        Args:
            event_type: Type of event
            data: Event data payload
            message: Optional human-readable message
            severity: Event severity level
        """
        event = EventMessage(
            event_type=event_type,
            severity=severity,
            data=data,
            message=message,
        )

        # Queue for broadcast
        await self._message_queue.put(event.to_json())

        logger.debug(f"Queued broadcast: {event_type.value} to {len(self.connections)} clients")

    async def broadcast_decision(
        self,
        decision_id: int,
        action: str,
        asset: str,
        confidence: float,
        approved: bool,
    ):
        """Broadcast a trading decision event.

        Args:
            decision_id: Decision ID
            action: Trading action
            asset: Asset ticker
            confidence: Confidence score
            approved: Whether decision was approved
        """
        event_type = EventType.DECISION_APPROVED if approved else EventType.DECISION_REJECTED

        await self.broadcast(
            event_type=event_type,
            data={
                "decision_id": decision_id,
                "action": action,
                "asset": asset,
                "confidence": confidence,
            },
            message=f"{action} {asset} (confidence: {confidence:.1%})",
            severity=Severity.INFO if approved else Severity.WARNING,
        )

    async def broadcast_position_update(
        self,
        position_id: int,
        asset: str,
        direction: str,
        size_usdc: float,
        pnl: Optional[float] = None,
        status: str = "open",
    ):
        """Broadcast a position update event.

        Args:
            position_id: Position ID
            asset: Asset ticker
            direction: Position direction (long/short)
            size_usdc: Position size in USDC
            pnl: Current profit/loss
            status: Position status
        """
        if status == "open":
            event_type = EventType.POSITION_OPENED
        elif status == "closed":
            event_type = EventType.POSITION_CLOSED
        elif status == "liquidated":
            event_type = EventType.POSITION_LIQUIDATED
        else:
            event_type = EventType.POSITION_UPDATED

        await self.broadcast(
            event_type=event_type,
            data={
                "position_id": position_id,
                "asset": asset,
                "direction": direction,
                "size_usdc": size_usdc,
                "pnl": pnl,
                "status": status,
            },
            message=f"{direction.upper()} {asset}: ${size_usdc:.2f}",
            severity=Severity.INFO,
        )

    async def broadcast_error(self, error_message: str, context: Dict[str, Any]):
        """Broadcast an error event.

        Args:
            error_message: Error description
            context: Additional error context
        """
        await self.broadcast(
            event_type=EventType.ERROR,
            data=context,
            message=error_message,
            severity=Severity.ERROR,
        )

    @property
    def is_running(self) -> bool:
        """Check if server is running."""
        return self._running

    @property
    def connection_count(self) -> int:
        """Get number of active connections."""
        return len(self.connections)

    async def __aenter__(self):
        """Async context manager entry."""
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.stop()
