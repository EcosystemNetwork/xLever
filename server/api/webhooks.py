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

from .database import async_session
from .models import WebhookEvent

logger = logging.getLogger("xlever.webhooks")


async def send_webhook(
    agent_id: int,
    webhook_url: str,
    webhook_secret: str | None,
    event_type: str,
    payload: dict,
):
    """
    POST event payload to the agent's webhook URL.
    Signs the body with HMAC-SHA256 if a webhook_secret is configured.
    Logs the result to webhook_events for debugging.
    """
    body = json.dumps(payload, default=str)
    headers = {"Content-Type": "application/json"}

    # Sign the payload if a secret is configured
    if webhook_secret:
        sig = hmac.new(
            webhook_secret.encode(),
            body.encode(),
            hashlib.sha256,
        ).hexdigest()
        headers["X-Webhook-Signature"] = sig

    status_code = None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(webhook_url, content=body, headers=headers)
            status_code = resp.status_code
    except Exception as e:
        logger.warning(f"Webhook delivery failed for agent {agent_id}: {e}")

    # Log the delivery attempt using its own session
    async with async_session() as db:
        event = WebhookEvent(
            agent_id=agent_id,
            event_type=event_type,
            payload=payload,
            status_code=status_code,
            delivered_at=datetime.now(timezone.utc),
        )
        db.add(event)
        try:
            await db.commit()
        except Exception:
            pass  # Don't fail over webhook logging


def fire_webhook(agent_id: int, webhook_url: str, webhook_secret: str | None, event_type: str, payload: dict):
    """Non-blocking webhook dispatch — schedules send_webhook as a background task."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(send_webhook(agent_id, webhook_url, webhook_secret, event_type, payload))
    except RuntimeError:
        pass  # No running event loop — skip webhook
