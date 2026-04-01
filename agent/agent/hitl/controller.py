"""Human-in-the-Loop controller for trade approval workflows."""

import asyncio
import uuid
from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from loguru import logger

from agent.strategy.llm_strategy import TradingDecision


class HITLMode(str, Enum):
    """Human-in-the-loop operation modes."""

    AUTONOMOUS = "autonomous"  # No approvals needed
    APPROVAL_REQUIRED = "approval_required"  # All trades need approval
    APPROVAL_ABOVE_THRESHOLD = "approval_above_threshold"  # Only large trades
    NOTIFICATIONS_ONLY = "notifications_only"  # Notify but don't block


class Urgency(str, Enum):
    """Decision urgency levels affecting timeout duration."""

    LOW = "low"  # 1 hour timeout
    MEDIUM = "medium"  # 15 min timeout
    HIGH = "high"  # 5 min timeout
    CRITICAL = "critical"  # 1 min timeout


# Timeout durations by urgency level (seconds)
TIMEOUT_DURATIONS = {
    Urgency.LOW: 3600,  # 1 hour
    Urgency.MEDIUM: 900,  # 15 minutes
    Urgency.HIGH: 300,  # 5 minutes
    Urgency.CRITICAL: 60,  # 1 minute
}


@dataclass
class PendingDecision:
    """A decision pending human approval."""

    id: str
    decision: TradingDecision
    created_at: datetime
    urgency: Urgency
    timeout_at: datetime
    approved: Optional[bool] = None
    rejection_reason: Optional[str] = None
    resolved_at: Optional[datetime] = None

    @property
    def is_expired(self) -> bool:
        """Check if decision has timed out."""
        return datetime.now() >= self.timeout_at

    @property
    def is_resolved(self) -> bool:
        """Check if decision has been approved or rejected."""
        return self.approved is not None

    @property
    def time_remaining_seconds(self) -> float:
        """Calculate seconds until timeout."""
        remaining = (self.timeout_at - datetime.now()).total_seconds()
        return max(0, remaining)

    def to_dict(self) -> Dict:
        """Convert to dictionary for API/WebSocket."""
        return {
            "id": self.id,
            "decision": self.decision.to_dict(),
            "created_at": self.created_at.isoformat(),
            "urgency": self.urgency.value,
            "timeout_at": self.timeout_at.isoformat(),
            "time_remaining_seconds": self.time_remaining_seconds,
            "approved": self.approved,
            "rejection_reason": self.rejection_reason,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
        }


class HITLController:
    """Manage human-in-the-loop approval workflows.

    Handles decision approval requests, timeouts, and approval tracking.
    Supports multiple operational modes from fully autonomous to full approval.
    """

    def __init__(
        self,
        mode: HITLMode = HITLMode.AUTONOMOUS,
        threshold_usdc: float = 1000.0,
        default_timeout_action: str = "reject",  # "reject" or "approve"
    ):
        """Initialize HITL controller.

        Args:
            mode: Operation mode for approval requirements
            threshold_usdc: Size threshold for approval (only for APPROVAL_ABOVE_THRESHOLD mode)
            default_timeout_action: What to do when approval times out
        """
        self.mode = mode
        self.threshold_usdc = threshold_usdc
        self.default_timeout_action = default_timeout_action

        # Pending decisions awaiting approval
        self.pending: Dict[str, PendingDecision] = {}

        # Approval history
        self._approval_history: List[PendingDecision] = []

        logger.info(
            f"HITL controller initialized: mode={mode.value}, "
            f"threshold=${threshold_usdc:.2f}, "
            f"timeout_action={default_timeout_action}"
        )

    def requires_approval(self, decision: TradingDecision) -> bool:
        """Check if decision requires human approval based on mode and criteria.

        Args:
            decision: Trading decision to evaluate

        Returns:
            True if approval required
        """
        # Mode-based logic
        if self.mode == HITLMode.AUTONOMOUS:
            return False

        if self.mode == HITLMode.NOTIFICATIONS_ONLY:
            return False  # Don't block, just notify

        if self.mode == HITLMode.APPROVAL_REQUIRED:
            # All non-HOLD decisions need approval
            return decision.requires_execution

        if self.mode == HITLMode.APPROVAL_ABOVE_THRESHOLD:
            # Only large positions need approval
            if not decision.requires_execution:
                return False

            if decision.size_usdc and decision.size_usdc >= self.threshold_usdc:
                logger.info(
                    f"Approval required: position size ${decision.size_usdc:.2f} "
                    f"exceeds threshold ${self.threshold_usdc:.2f}"
                )
                return True

            return False

        return False

    async def request_approval(
        self,
        decision: TradingDecision,
        urgency: Optional[Urgency] = None,
    ) -> TradingDecision:
        """Queue decision for approval and wait for response.

        Args:
            decision: Trading decision requiring approval
            urgency: Override decision urgency (uses decision.urgency if not provided)

        Returns:
            Approved or rejected decision (may be modified)

        Note:
            This is a blocking call that waits until approval/rejection or timeout.
        """
        # Use decision urgency if not overridden
        if urgency is None:
            try:
                urgency = Urgency(decision.urgency.lower())
            except (ValueError, AttributeError):
                urgency = Urgency.MEDIUM

        # Create pending decision
        decision_id = str(uuid.uuid4())
        timeout_seconds = TIMEOUT_DURATIONS[urgency]

        pending = PendingDecision(
            id=decision_id,
            decision=decision,
            created_at=datetime.now(),
            urgency=urgency,
            timeout_at=datetime.now() + timedelta(seconds=timeout_seconds),
        )

        self.pending[decision_id] = pending

        logger.info(
            f"Approval requested for decision {decision_id}: {decision.action.value} "
            f"(urgency: {urgency.value}, timeout: {timeout_seconds}s)"
        )

        # Wait for approval with timeout checking
        poll_interval = 1.0  # Check every second
        start_time = datetime.now()

        while not pending.is_resolved:
            # Check timeout
            if pending.is_expired:
                logger.warning(
                    f"Decision {decision_id} timed out after {timeout_seconds}s "
                    f"(action: {self.default_timeout_action})"
                )

                # Apply default timeout action
                if self.default_timeout_action == "approve":
                    pending.approved = True
                    pending.rejection_reason = "Auto-approved on timeout"
                else:
                    pending.approved = False
                    pending.rejection_reason = "Timed out waiting for approval"

                pending.resolved_at = datetime.now()
                break

            # Wait before next check
            await asyncio.sleep(poll_interval)

        # Move to history
        self._approval_history.append(pending)
        del self.pending[decision_id]

        # Modify decision based on approval
        if pending.approved:
            logger.success(f"Decision {decision_id} approved")
            return decision
        else:
            logger.warning(
                f"Decision {decision_id} rejected: {pending.rejection_reason}"
            )
            # Mark decision as blocked
            decision.blocked = True
            decision.block_reason = pending.rejection_reason or "Rejected by human"
            return decision

    def approve(self, decision_id: str, notes: Optional[str] = None) -> bool:
        """Approve a pending decision.

        Args:
            decision_id: ID of decision to approve
            notes: Optional approval notes

        Returns:
            True if approved successfully, False if not found
        """
        pending = self.pending.get(decision_id)

        if not pending:
            logger.warning(f"Cannot approve - decision {decision_id} not found")
            return False

        if pending.is_expired:
            logger.warning(f"Cannot approve - decision {decision_id} has expired")
            return False

        pending.approved = True
        pending.rejection_reason = notes
        pending.resolved_at = datetime.now()

        logger.success(f"Decision {decision_id} approved" + (f": {notes}" if notes else ""))

        return True

    def reject(self, decision_id: str, reason: str = "Rejected by operator") -> bool:
        """Reject a pending decision.

        Args:
            decision_id: ID of decision to reject
            reason: Reason for rejection

        Returns:
            True if rejected successfully, False if not found
        """
        pending = self.pending.get(decision_id)

        if not pending:
            logger.warning(f"Cannot reject - decision {decision_id} not found")
            return False

        if pending.is_expired:
            logger.warning(f"Cannot reject - decision {decision_id} has expired")
            return False

        pending.approved = False
        pending.rejection_reason = reason
        pending.resolved_at = datetime.now()

        logger.warning(f"Decision {decision_id} rejected: {reason}")

        return True

    async def check_timeouts(self) -> List[PendingDecision]:
        """Check for timed out decisions and apply default action.

        Returns:
            List of decisions that timed out
        """
        timed_out = []

        for decision_id, pending in list(self.pending.items()):
            if pending.is_expired and not pending.is_resolved:
                logger.warning(
                    f"Auto-resolving timed out decision {decision_id} "
                    f"(action: {self.default_timeout_action})"
                )

                # Apply default timeout action
                if self.default_timeout_action == "approve":
                    pending.approved = True
                    pending.rejection_reason = "Auto-approved on timeout"
                else:
                    pending.approved = False
                    pending.rejection_reason = "Timed out waiting for approval"

                pending.resolved_at = datetime.now()

                # Move to history
                self._approval_history.append(pending)
                del self.pending[decision_id]

                timed_out.append(pending)

        return timed_out

    def get_pending_decisions(self) -> List[PendingDecision]:
        """Get all pending decisions awaiting approval.

        Returns:
            List of pending decisions
        """
        return list(self.pending.values())

    def get_approval_history(
        self,
        limit: int = 100,
        approved_only: bool = False,
        rejected_only: bool = False,
    ) -> List[PendingDecision]:
        """Get approval history.

        Args:
            limit: Maximum number of results
            approved_only: Only return approved decisions
            rejected_only: Only return rejected decisions

        Returns:
            List of historical decisions
        """
        history = self._approval_history

        if approved_only:
            history = [d for d in history if d.approved is True]
        elif rejected_only:
            history = [d for d in history if d.approved is False]

        # Return most recent first
        return sorted(history, key=lambda d: d.created_at, reverse=True)[:limit]

    def get_approval_stats(self) -> Dict:
        """Get approval statistics.

        Returns:
            Dictionary with approval metrics
        """
        total = len(self._approval_history)
        approved = sum(1 for d in self._approval_history if d.approved is True)
        rejected = sum(1 for d in self._approval_history if d.approved is False)
        timed_out = sum(
            1
            for d in self._approval_history
            if "timeout" in (d.rejection_reason or "").lower()
        )

        return {
            "total_decisions": total,
            "approved": approved,
            "rejected": rejected,
            "timed_out": timed_out,
            "approval_rate": approved / total * 100 if total > 0 else 0,
            "pending_count": len(self.pending),
        }

    @property
    def pending_count(self) -> int:
        """Get number of pending decisions."""
        return len(self.pending)

    @property
    def is_autonomous(self) -> bool:
        """Check if running in autonomous mode."""
        return self.mode == HITLMode.AUTONOMOUS
