"""
Authentication dependencies for the xLever API.

Implements SIWE (Sign-In with Ethereum) for wallet ownership verification.
Flow: frontend calls /api/auth/nonce → user signs message → /api/auth/verify → session cookie.

Also supports API key authentication for external agents (OpenClaw, AutoGPT, etc.).
"""
import hashlib
import json
import logging
import os
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .config import get_settings

logger = logging.getLogger("xlever.auth")


# ─── Redis Connection ─────────────────────────────────────────
# Sessions and nonces are stored in Redis so they survive server restarts
# and work across multiple worker processes.

_redis = None


async def _get_redis():
    """Lazy-init Redis connection."""
    global _redis
    if _redis is not None:
        return _redis
    try:
        import redis.asyncio as aioredis
        settings = get_settings()
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await _redis.ping()
        logger.info("Redis session store connected")
        return _redis
    except Exception as exc:
        logger.warning("Redis unavailable (%s), falling back to in-memory sessions", exc)
        return None


# ─── In-memory fallback (used when Redis is unavailable) ──────

_mem_sessions: dict[str, dict] = {}
_mem_nonces: dict[str, datetime] = {}


# ─── Admin API Key Auth ───────────────────────────────────────

def admin_api_key(x_admin_key: str = Header(..., alias="X-Admin-Key")) -> str:
    """Verify the X-Admin-Key header against the ADMIN_API_KEY env var."""
    expected = os.environ.get("ADMIN_API_KEY")
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Admin API key not configured. Set ADMIN_API_KEY environment variable.",
        )
    if x_admin_key != expected:
        raise HTTPException(status_code=403, detail="Invalid admin API key")
    return x_admin_key


# ─── Wallet Address Validation ────────────────────────────────

_ETH_ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


def validate_wallet_address(wallet_address: str) -> str:
    """Validate that a wallet address is a well-formed Ethereum address."""
    if not _ETH_ADDRESS_RE.match(wallet_address):
        raise HTTPException(
            status_code=400,
            detail="Invalid wallet address format. Must be 0x followed by 40 hex characters.",
        )
    return wallet_address.lower()


# ─── SIWE Session Store (Redis-backed with in-memory fallback) ─

_SESSION_TTL = timedelta(hours=24)
_NONCE_TTL = timedelta(minutes=5)
SESSION_COOKIE_NAME = "xlever_session"


async def create_nonce() -> str:
    """Generate a cryptographically random nonce for SIWE message signing."""
    nonce = secrets.token_urlsafe(32)
    r = await _get_redis()
    if r:
        await r.setex(f"nonce:{nonce}", int(_NONCE_TTL.total_seconds()), "1")
    else:
        _mem_nonces[nonce] = datetime.now(timezone.utc) + _NONCE_TTL
        _cleanup_mem_nonces()
    return nonce


async def consume_nonce(nonce: str) -> bool:
    """Validate and consume a nonce (single-use). Returns True if valid."""
    r = await _get_redis()
    if r:
        result = await r.delete(f"nonce:{nonce}")
        return result > 0
    else:
        _cleanup_mem_nonces()
        expires = _mem_nonces.pop(nonce, None)
        if expires is None:
            return False
        return datetime.now(timezone.utc) < expires


async def create_session(wallet_address: str) -> str:
    """Create a new session for an authenticated wallet. Returns session token."""
    token = secrets.token_urlsafe(48)
    session_data = {"wallet": wallet_address.lower()}
    r = await _get_redis()
    if r:
        await r.setex(f"session:{token}", int(_SESSION_TTL.total_seconds()), json.dumps(session_data))
    else:
        _mem_sessions[token] = {
            **session_data,
            "expires": datetime.now(timezone.utc) + _SESSION_TTL,
        }
        _cleanup_mem_sessions()
    return token


async def get_session_wallet(token: str) -> Optional[str]:
    """Look up the wallet address for a session token. Returns None if invalid/expired."""
    r = await _get_redis()
    if r:
        data = await r.get(f"session:{token}")
        if not data:
            return None
        return json.loads(data).get("wallet")
    else:
        session = _mem_sessions.get(token)
        if not session:
            return None
        if datetime.now(timezone.utc) > session["expires"]:
            _mem_sessions.pop(token, None)
            return None
        return session["wallet"]


def _cleanup_mem_nonces():
    """Remove expired nonces from in-memory fallback."""
    now = datetime.now(timezone.utc)
    expired = [k for k, v in _mem_nonces.items() if now > v]
    for k in expired:
        del _mem_nonces[k]


def _cleanup_mem_sessions():
    """Remove expired sessions from in-memory fallback."""
    now = datetime.now(timezone.utc)
    expired = [k for k, v in _mem_sessions.items() if now > v["expires"]]
    for k in expired:
        del _mem_sessions[k]


# ─── FastAPI Dependencies ─────────────────────────────────────

async def require_auth(
    request: Request,
    xlever_session: Optional[str] = Cookie(None, alias=SESSION_COOKIE_NAME),
) -> str:
    """Dependency: require a valid SIWE session. Returns the authenticated wallet address."""
    # Also check Authorization header for non-browser clients
    auth_header = request.headers.get("Authorization", "")
    token = xlever_session
    if not token and auth_header.startswith("Bearer "):
        token = auth_header[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Authentication required. Sign in with your wallet.")

    wallet = await get_session_wallet(token)
    if not wallet:
        raise HTTPException(status_code=401, detail="Session expired or invalid. Please sign in again.")

    return wallet


def require_wallet_owner(wallet_address: str, authenticated_wallet: str) -> str:
    """Verify the authenticated user owns the requested wallet address."""
    addr = validate_wallet_address(wallet_address)
    if addr != authenticated_wallet:
        raise HTTPException(status_code=403, detail="You can only access your own wallet data.")
    return addr


# ─── External Agent API Key Auth ─────────────────────────────

def hash_api_key(key: str) -> str:
    """SHA-256 hash of an API key for storage (never store plaintext)."""
    return hashlib.sha256(key.encode()).hexdigest()


def generate_api_key() -> tuple[str, str]:
    """Generate an API key and its hash. Returns (plaintext_key, hash)."""
    key = secrets.token_urlsafe(48)
    return key, hash_api_key(key)


@dataclass
class AgentIdentity:
    """Represents an authenticated external agent."""
    agent_id: int
    name: str
    owner_wallet: str
    permissions: dict
    allowed_assets: list
    rate_limit_per_minute: int


async def require_agent_auth(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AgentIdentity:
    """Dependency: require a valid API key from an external agent. Returns AgentIdentity."""
    from .models import ExternalAgent  # deferred to avoid circular import

    api_key = request.headers.get("X-API-Key", "")
    if not api_key:
        raise HTTPException(status_code=401, detail="API key required. Send X-API-Key header.")

    key_hash = hash_api_key(api_key)
    result = await db.execute(
        select(ExternalAgent).where(ExternalAgent.api_key_hash == key_hash)
    )
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=401, detail="Invalid API key.")
    if not agent.is_active:
        raise HTTPException(status_code=403, detail="Agent is deactivated. Contact the wallet owner.")

    # Update last_used_at
    agent.last_used_at = datetime.now(timezone.utc)
    await db.commit()

    return AgentIdentity(
        agent_id=agent.id,
        name=agent.name,
        owner_wallet=agent.owner_wallet,
        permissions=agent.permissions or {},
        allowed_assets=agent.allowed_assets or [],
        rate_limit_per_minute=agent.rate_limit_per_minute or 10,
    )


async def require_auth_or_agent(
    request: Request,
    xlever_session: Optional[str] = Cookie(None, alias=SESSION_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> str | AgentIdentity:
    """
    Combined dependency: accepts either SIWE session OR API key.
    Returns wallet address (str) for browser sessions, AgentIdentity for external agents.
    """
    # Try API key first (non-browser clients)
    api_key = request.headers.get("X-API-Key", "")
    if api_key:
        return await require_agent_auth(request, db)

    # Fall back to SIWE session
    auth_header = request.headers.get("Authorization", "")
    token = xlever_session
    if not token and auth_header.startswith("Bearer "):
        token = auth_header[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Authentication required. Use wallet session or X-API-Key.")

    wallet = await get_session_wallet(token)
    if not wallet:
        raise HTTPException(status_code=401, detail="Session expired or invalid.")

    return wallet
