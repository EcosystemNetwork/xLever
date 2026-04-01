from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from ..schemas import UserCreate, UserOut, UserPreferences

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/", response_model=UserOut)
async def create_or_get_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    """Register a wallet address or return existing user (SIWE auth layer goes here)."""
    addr = body.wallet_address.lower()
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()

    if user:
        from sqlalchemy import func
        user.last_seen = func.now()
        await db.commit()
        await db.refresh(user)
        return user

    user = User(wallet_address=addr, preferences={})
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/{wallet_address}", response_model=UserOut)
async def get_user(wallet_address: str, db: AsyncSession = Depends(get_db)):
    addr = wallet_address.lower()
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    return user


@router.patch("/{wallet_address}/preferences", response_model=UserOut)
async def update_preferences(
    wallet_address: str, prefs: UserPreferences, db: AsyncSession = Depends(get_db)
):
    addr = wallet_address.lower()
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    current = user.preferences or {}
    updates = prefs.model_dump(exclude_none=True)
    current.update(updates)
    user.preferences = current
    await db.commit()
    await db.refresh(user)
    return user
