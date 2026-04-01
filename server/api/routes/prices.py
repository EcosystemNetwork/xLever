"""Yahoo Finance proxy with DB-backed cache (replaces localStorage caching)."""
# DB cache is shared across all clients, reducing Yahoo Finance API calls vs per-browser localStorage

# httpx is the async HTTP client — required because urllib/requests would block FastAPI's event loop
import httpx
# datetime/timedelta for comparing cache freshness against the configured TTL
from datetime import datetime, timedelta, timezone

# APIRouter groups related endpoints; Depends injects DB sessions; HTTPException returns error responses
from fastapi import APIRouter, Depends, HTTPException
# select builds the SQL query for checking the cache
from sqlalchemy import select
# AsyncSession type hint for the injected database session
from sqlalchemy.ext.asyncio import AsyncSession

# Settings provides the cache TTL configuration
from ..config import get_settings
# get_db is the FastAPI dependency that yields a scoped async DB session
from ..database import get_db
# PriceCache ORM model for reading/writing the cache table
from ..models import PriceCache
# PriceResponse schema defines the API response shape
from ..schemas import PriceResponse

# Prefix all routes with /prices; tag groups them in the OpenAPI docs
router = APIRouter(prefix="/prices", tags=["prices"])
# Cache settings once to avoid repeated lru_cache lookups in hot path
settings = get_settings()

# Yahoo Finance v8 chart API base URL — this is the unofficial but widely-used endpoint
YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
# Spoof a browser User-Agent because Yahoo blocks requests with default httpx/python agent strings
YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


# GET /api/prices/{symbol} — main price data endpoint used by the backtester
@router.get("/{symbol}", response_model=PriceResponse)
async def get_price_data(
    symbol: str,           # Ticker to fetch (QQQ, SPY, etc.)
    period: str = "1y",    # Default 1-year lookback for backtesting
    interval: str = "1d",  # Default daily candles for backtesting
    db: AsyncSession = Depends(get_db),  # Injected DB session for cache reads/writes
):
    """
    Fetch OHLCV data for a symbol. Returns cached data if fresh enough,
    otherwise fetches from Yahoo Finance and updates the cache.
    """
    # Normalize to uppercase so "qqq" and "QQQ" share the same cache entry
    symbol = symbol.upper()
    # Convert TTL seconds to timedelta for datetime arithmetic
    ttl = timedelta(seconds=settings.YAHOO_CACHE_TTL)

    # Query the cache table for an existing entry matching this exact symbol+interval+period
    result = await db.execute(
        select(PriceCache).where(
            PriceCache.symbol == symbol,
            PriceCache.interval == interval,
            PriceCache.period == period,
        )
    )
    # scalar_one_or_none returns the row or None — avoids try/except for missing rows
    cached = result.scalar_one_or_none()

    # If cache exists and hasn't expired, return it immediately without hitting Yahoo
    if cached and (datetime.now(timezone.utc) - cached.fetched_at.replace(tzinfo=timezone.utc)) < ttl:
        return PriceResponse(
            symbol=symbol, interval=interval, period=period, data=cached.data, cached=True
        )

    # Cache miss or stale — fetch fresh data from Yahoo Finance
    try:
        # 15-second timeout prevents hanging if Yahoo is slow; AsyncClient for non-blocking I/O
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{YAHOO_BASE}/{symbol}",
                # Yahoo uses "range" param (not "period") for the time window
                params={"range": period, "interval": interval},
                # Browser User-Agent to avoid being blocked by Yahoo's bot detection
                headers=YAHOO_HEADERS,
            )
            # Raise on 4xx/5xx so we can convert to HTTPException below
            resp.raise_for_status()
            # Parse the JSON response body
            data = resp.json()
    # Handle HTTP errors from Yahoo (404 for invalid symbol, 429 for rate limit, etc.)
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Yahoo Finance error: {e.response.status_code}")
    # Handle network errors (DNS failure, connection refused, timeout)
    except httpx.RequestError as e:
        raise HTTPException(502, f"Failed to reach Yahoo Finance: {e}")

    # Upsert the cache — update existing row or insert new one
    if cached:
        # Update existing cache entry with fresh data and reset the timestamp
        cached.data = data
        cached.fetched_at = datetime.now(timezone.utc)
    else:
        # Insert new cache entry for this symbol+interval+period combination
        db.add(PriceCache(symbol=symbol, interval=interval, period=period, data=data))
    # Persist the cache update to the database
    await db.commit()

    # Return the fresh data with cached=False so the client knows this was a live fetch
    return PriceResponse(symbol=symbol, interval=interval, period=period, data=data, cached=False)
