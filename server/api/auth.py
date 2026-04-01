"""
Authentication dependencies for the xLever API.
"""
import os
import re

from fastapi import Header, HTTPException


# ─── Admin API Key Auth ───────────────────────────────────────

def admin_api_key(x_admin_key: str = Header(..., alias="X-Admin-Key")) -> str:
    """Verify the X-Admin-Key header against the ADMIN_API_KEY env var."""
    expected = os.environ.get("ADMIN_API_KEY", "dev-admin-key-change-me")
    if x_admin_key != expected:
        raise HTTPException(status_code=403, detail="Invalid admin API key")
    return x_admin_key


# ─── Wallet Address Validation ────────────────────────────────

_ETH_ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


def validate_wallet_address(wallet_address: str) -> str:
    """
    Validate that a wallet address is a well-formed Ethereum address.

    TODO: Implement full SIWE (Sign-In with Ethereum) authentication to
    verify wallet ownership. This currently only validates address format.
    """
    if not _ETH_ADDRESS_RE.match(wallet_address):
        raise HTTPException(
            status_code=400,
            detail="Invalid wallet address format. Must be 0x followed by 40 hex characters.",
        )
    return wallet_address.lower()
