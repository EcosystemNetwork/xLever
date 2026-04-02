"""
Webhook dispatch for external agent event notifications.

Sends async POST requests to registered webhook URLs with HMAC-SHA256 signatures.
Fire-and-forget — does not block the API response. Logs delivery to webhook_events table.
"""
import asyncio
import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ExternalAgent, WebhookEvent

logger = logging.getLogger("xlever.webhooks")


async def send_webhook(
    db: AsyncSession,
    agent: ExternalAgent,
    event_type: str,
    payload: dict,
):
    """
    POST event payload to the agent's webhook URL.
    Signs the body with HMAC-SHA256 if a webhook_secret is configured.
    Logs the result to webhook_events for debugging.
    """
    if not agent.webhook_url:
        return

    body = json.dumps(payload, default=str)
    headers = {"Content-Type": "application/json"}

    # Sign the payload if a secret is configured
    if agent.webhook_secret:
        sig = hmac.new(
            agent.webhook_secret.encode(),
            body.encode(),
            hashlib.sha256,
        ).hexdigest()
        headers["X-Webhook-Signature"] = sig

    status_code = None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(agent.webhook_url, content=body, headers=headers)
            status_code = resp.status_code
    except Exception as e:
        logger.warning(f"Webhook delivery failed for agent {agent.id}: {e}")

    # Log the delivery attempt
    event = WebhookEvent(
        agent_id=agent.id,
        event_type=event_type,
        payload=payload,
        status_code=status_code,
        delivered_at=datetime.now(timezone.utc),
    )
    db.add(event)
    try:
        await db.commit()
    except Exception:
        pass  # Don't fail the main request over webhook logging


def fire_webhook(db: AsyncSession, agent: ExternalAgent, event_type: str, payload: dict):
    """Non-blocking webhook dispatch — schedules send_webhook as a background task."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(send_webhook(db, agent, event_type, payload))
    except RuntimeError:
        pass  # No running event loop — skip webhook
