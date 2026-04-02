"""
SIWE (Sign-In with Ethereum) authentication routes.

Flow:
  1. GET  /api/auth/nonce     → returns a fresh nonce
  2. POST /api/auth/verify    → verifies signed SIWE message, sets session cookie
  3. POST /api/auth/logout    → clears session
  4. GET  /api/auth/me        → returns current authenticated wallet (or 401)
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from siwe import SiweMessage

from ..auth import (
    SESSION_COOKIE_NAME,
    consume_nonce,
    create_nonce,
    create_session,
    require_auth,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class VerifyRequest(BaseModel):
    message: str  # The full EIP-4361 SIWE message string
    signature: str  # The wallet's signature of the message (hex)


@router.get("/nonce")
async def get_nonce():
    """Generate a fresh nonce for SIWE message construction."""
    return {"nonce": await create_nonce()}


@router.post("/verify")
async def verify(body: VerifyRequest, response: Response):
    """Verify a signed SIWE message and create an authenticated session."""
    try:
        siwe_msg = SiweMessage.from_message(body.message)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid SIWE message format")

    # Verify the nonce was issued by us and hasn't been used
    if not await consume_nonce(siwe_msg.nonce):
        raise HTTPException(status_code=400, detail="Invalid or expired nonce. Request a new one.")

    # Verify the cryptographic signature matches the claimed address
    try:
        siwe_msg.verify(body.signature)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Signature verification failed: {e}")

    # Create session and set cookie
    wallet = siwe_msg.address.lower()
    token = await create_session(wallet)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=86400,  # 24 hours
    )

    return {"ok": True, "address": wallet, "token": token}


@router.post("/logout")
async def logout(response: Response):
    """Clear the session cookie."""
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
async def me(wallet: str = Depends(require_auth)):
    """Return the currently authenticated wallet address."""
    return {"address": wallet}
