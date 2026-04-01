# APIRouter groups user endpoints; Depends injects DB; HTTPException for error responses
from fastapi import APIRouter, Depends, HTTPException
# select builds SQL queries for looking up users by wallet address
from sqlalchemy import select
# AsyncSession type for the injected DB session
from sqlalchemy.ext.asyncio import AsyncSession

# Wallet address format validation
# TODO: Replace with full SIWE (Sign-In with Ethereum) to verify wallet ownership
from ..auth import validate_wallet_address
# get_db yields a scoped async DB session per request
from ..database import get_db
# User ORM model for DB operations
from ..models import User
# Request/response schemas for user creation, preferences update, and serialization
from ..schemas import UserCreate, UserOut, UserPreferences

# Prefix all routes with /users; tag groups them in Swagger docs
router = APIRouter(prefix="/users", tags=["users"])


# POST /api/users/ — register a wallet or return existing user (idempotent upsert)
@router.post("/", response_model=UserOut)
async def create_or_get_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    """Register a wallet address or return existing user (SIWE auth layer goes here)."""
    # Normalize to lowercase — Ethereum addresses are case-insensitive but we store consistently
    addr = body.wallet_address.lower()
    # Check if this wallet is already registered
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()

    # If user exists, update last_seen and return — makes this endpoint idempotent
    if user:
        # Import func here to access SQL now() — avoids unused import at module level
        from sqlalchemy import func
        # Update last_seen to track activity — useful for identifying inactive wallets
        user.last_seen = func.now()
        # Persist the last_seen update
        await db.commit()
        # Refresh to get the server-generated timestamp value
        await db.refresh(user)
        # Return existing user data
        return user

    # New wallet — create a user record with empty preferences
    user = User(wallet_address=addr, preferences={})
    # Add to the session for insertion
    db.add(user)
    # Persist to the database so it gets an auto-generated ID and timestamps
    await db.commit()
    # Refresh to load server-generated fields (id, created_at, last_seen)
    await db.refresh(user)
    # Return the newly created user
    return user


# GET /api/users/{wallet_address} — look up a user by wallet address
@router.get("/{wallet_address}", response_model=UserOut)
async def get_user(wallet_address: str, db: AsyncSession = Depends(get_db)):
    # Validate wallet address format (TODO: replace with SIWE ownership verification)
    addr = validate_wallet_address(wallet_address)
    # Query for the user by their wallet address
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()
    # 404 if not found — the wallet hasn't been registered yet
    if not user:
        raise HTTPException(404, "User not found")
    return user


# PATCH /api/users/{wallet_address}/preferences — partial update of user preferences
@router.patch("/{wallet_address}/preferences", response_model=UserOut)
async def update_preferences(
    wallet_address: str, prefs: UserPreferences, db: AsyncSession = Depends(get_db)
):
    # Validate wallet address format (TODO: replace with SIWE ownership verification)
    addr = validate_wallet_address(wallet_address)
    # Look up the user to update
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()
    # 404 if the wallet hasn't been registered yet
    if not user:
        raise HTTPException(404, "User not found")

    # Start with current preferences — default to empty dict if null (first-time setup)
    current = user.preferences or {}
    # Only include non-None fields from the request — enables true partial updates
    updates = prefs.model_dump(exclude_none=True)
    # Merge new values into existing preferences — preserves fields not in this request
    current.update(updates)
    # Assign the merged dict back — triggers SQLAlchemy's change detection for JSONB
    user.preferences = current
    # Persist the updated preferences
    await db.commit()
    # Refresh to ensure the returned data matches what's in the database
    await db.refresh(user)
    return user
