"""Yahoo Finance proxy with DB-backed cache (replaces localStorage caching)."""

import httpx
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_db
from ..models import PriceCache
from ..schemas import PriceResponse

router = APIRouter(prefix="/prices", tags=["prices"])
settings = get_settings()

YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


@router.get("/{symbol}", response_model=PriceResponse)
async def get_price_data(
    symbol: str,
    period: str = "1y",
    interval: str = "1d",
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch OHLCV data for a symbol. Returns cached data if fresh enough,
    otherwise fetches from Yahoo Finance and updates the cache.
    """
    symbol = symbol.upper()
    ttl = timedelta(seconds=settings.YAHOO_CACHE_TTL)

    # Check cache
    result = await db.execute(
        select(PriceCache).where(
            PriceCache.symbol == symbol,
            PriceCache.interval == interval,
            PriceCache.period == period,
        )
    )
    cached = result.scalar_one_or_none()

    if cached and (datetime.now(timezone.utc) - cached.fetched_at.replace(tzinfo=timezone.utc)) < ttl:
        return PriceResponse(
            symbol=symbol, interval=interval, period=period, data=cached.data, cached=True
        )

    # Fetch from Yahoo Finance
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{YAHOO_BASE}/{symbol}",
                params={"range": period, "interval": interval},
                headers=YAHOO_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Yahoo Finance error: {e.response.status_code}")
    except httpx.RequestError as e:
        raise HTTPException(502, f"Failed to reach Yahoo Finance: {e}")

    # Upsert cache
    if cached:
        cached.data = data
        cached.fetched_at = datetime.now(timezone.utc)
    else:
        db.add(PriceCache(symbol=symbol, interval=interval, period=period, data=data))
    await db.commit()

    return PriceResponse(symbol=symbol, interval=interval, period=period, data=data, cached=False)
