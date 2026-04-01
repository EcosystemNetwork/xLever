"""
OpenBB Intelligence Layer — market snapshots, quotes, options context for xLever.

Uses OpenBB Platform SDK (yfinance provider by default, no API key needed).
Falls back gracefully if OpenBB is not installed or a provider is unavailable.
"""
# Docstring explains the purpose and dependency model — OpenBB is optional, not a hard requirement

# logging for recording OpenBB initialization status and errors
import logging
import re
from datetime import datetime as _dt
# Optional type hint for nullable query parameters
from typing import Optional

# APIRouter groups endpoints; HTTPException returns structured errors; Query validates params
from fastapi import APIRouter, HTTPException, Query

# Module-level logger namespaced to this file for filtering in log output
logger = logging.getLogger(__name__)
# Prefix all routes with /openbb; tag groups them in Swagger docs
router = APIRouter(prefix="/openbb", tags=["openbb"])

# Lazy-load sentinel — OpenBB is ~500MB in memory, so we defer import until first use
_obb = None

# Allowed OpenBB data providers — reject unknown values to prevent injection
ALLOWED_PROVIDERS = {"yfinance", "fmp", "intrinio", "polygon", "tiingo", "cboe", "tmx"}

# Symbol validation: alphanumeric + dots (e.g. BRK.B), max 10 characters
_SYMBOL_RE = re.compile(r"^[A-Za-z0-9.&]{1,10}$")


def _validate_symbol(symbol: str) -> str:
    """Validate and normalize a ticker symbol."""
    if not _SYMBOL_RE.match(symbol):
        raise HTTPException(400, "Invalid symbol. Must be alphanumeric (with . allowed), max 10 characters.")
    return symbol.upper()


def _validate_provider(provider: str) -> str:
    """Validate that the provider is in the allowed whitelist."""
    if provider not in ALLOWED_PROVIDERS:
        raise HTTPException(
            400,
            f"Unknown provider '{provider}'. Allowed: {', '.join(sorted(ALLOWED_PROVIDERS))}",
        )
    return provider


# Factory function that lazy-loads OpenBB SDK on first call and caches it in module global
def get_obb():
    # Access the module-level singleton so we can set it on first call
    global _obb
    # Only import on first call — avoids 500MB memory hit if OpenBB endpoints are never used
    if _obb is None:
        try:
            # Import the OpenBB Platform SDK entry point
            from openbb import obb
            # Cache the instance so subsequent calls skip the import
            _obb = obb
            # Log successful initialization for operational visibility
            logger.info("OpenBB Platform initialized")
        except ImportError:
            # Return a helpful error if OpenBB is not installed rather than a cryptic traceback
            raise HTTPException(
                503,
                "OpenBB not installed. Run: pip install 'openbb[all]'",
            )
    # Return the cached OpenBB SDK instance
    return _obb


# ───────────────────────────────────────────────────────────
# Equity quotes
# ───────────────────────────────────────────────────────────


# GET /api/openbb/quote/{symbol} — real-time quote for a single equity
@router.get("/quote/{symbol}")
async def get_quote(symbol: str, provider: str = "yfinance"):
    """Real-time equity quote for a symbol."""
    symbol = _validate_symbol(symbol)
    provider = _validate_provider(provider)
    obb = get_obb()
    try:
        result = obb.equity.price.quote(symbol=symbol, provider=provider)
        data = result.to_dataframe().to_dict(orient="records")
        return {"symbol": symbol, "provider": result.provider, "data": data}
    except Exception as e:
        logger.error(f"OpenBB quote error for {symbol}: {e}")
        raise HTTPException(502, "Failed to fetch quote from upstream provider.")


# GET /api/openbb/quotes?symbols=QQQ,SPY — batch quotes for multiple equities
@router.get("/quotes")
async def get_quotes(
    # Required comma-separated list — description appears in Swagger docs
    symbols: str = Query(..., description="Comma-separated symbols, e.g. QQQ,SPY,AAPL"),
    provider: str = "yfinance",  # Default provider needs no API key
):
    """Batch equity quotes for multiple symbols."""
    provider = _validate_provider(provider)
    obb = get_obb()
    symbol_list = [_validate_symbol(s.strip()) for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(400, "No valid symbols provided.")
    try:
        result = obb.equity.price.quote(symbol=symbol_list, provider=provider)
        data = result.to_dataframe().to_dict(orient="records")
        return {"symbols": symbol_list, "provider": result.provider, "data": data}
    except Exception as e:
        logger.error(f"OpenBB quotes error for {symbol_list}: {e}")
        raise HTTPException(502, "Failed to fetch quotes from upstream provider.")


# ───────────────────────────────────────────────────────────
# Historical price data
# ───────────────────────────────────────────────────────────


# GET /api/openbb/historical/{symbol} — OHLCV time series via OpenBB
@router.get("/historical/{symbol}")
async def get_historical(
    symbol: str,
    start_date: Optional[str] = None,  # Optional start date filter (YYYY-MM-DD)
    end_date: Optional[str] = None,    # Optional end date filter (YYYY-MM-DD)
    interval: str = "1d",              # Candle interval — daily by default
    provider: str = "yfinance",        # Default provider needs no API key
):
    """Historical OHLCV data via OpenBB."""
    symbol = _validate_symbol(symbol)
    provider = _validate_provider(provider)
    # Validate date formats if provided
    for label, val in [("start_date", start_date), ("end_date", end_date)]:
        if val:
            try:
                _dt.strptime(val, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid {label} format. Use YYYY-MM-DD.")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    obb = get_obb()
    try:
        kwargs = {"symbol": symbol, "provider": provider, "interval": interval}
        if start_date:
            kwargs["start_date"] = start_date
        if end_date:
            kwargs["end_date"] = end_date
        result = obb.equity.price.historical(**kwargs)
        data = result.to_dataframe().reset_index().to_dict(orient="records")
        for row in data:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        return {
            "symbol": symbol,
            "provider": result.provider,
            "count": len(data),
            "data": data,
        }
    except Exception as e:
        logger.error(f"OpenBB historical error for {symbol}: {e}")
        raise HTTPException(502, "Failed to fetch historical data from upstream provider.")


# ───────────────────────────────────────────────────────────
# Market snapshots
# ───────────────────────────────────────────────────────────


# GET /api/openbb/snapshots — broad market overview (top movers, volume leaders)
@router.get("/snapshots")
async def get_market_snapshots(provider: str = "fmp"):
    """Broad market snapshot — top movers, volume leaders, etc."""
    provider = _validate_provider(provider)
    obb = get_obb()
    try:
        result = obb.equity.market_snapshots(provider=provider)
        df = result.to_dataframe()
        if "volume" in df.columns:
            df = df.nlargest(50, "volume")
        data = df.to_dict(orient="records")
        return {"provider": result.provider, "count": len(data), "data": data}
    except Exception as e:
        logger.error(f"OpenBB snapshots error: {e}")
        raise HTTPException(502, "Failed to fetch market snapshots from upstream provider.")


# ───────────────────────────────────────────────────────────
# Options chains
# ───────────────────────────────────────────────────────────


# GET /api/openbb/options/{symbol} — options chain with strikes, OI, volume, and greeks
@router.get("/options/{symbol}")
async def get_options_chain(
    symbol: str,
    provider: str = "yfinance",         # Default provider needs no API key
    expiration: Optional[str] = None,   # Optional specific expiry date filter
):
    """Options chain for a symbol — strikes, OI, volume, greeks."""
    symbol = _validate_symbol(symbol)
    provider = _validate_provider(provider)
    obb = get_obb()
    try:
        kwargs = {"symbol": symbol, "provider": provider}
        if expiration:
            kwargs["expiration"] = expiration
        result = obb.derivatives.options.chains(**kwargs)
        df = result.to_dataframe()
        data = df.to_dict(orient="records")
        for row in data:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        return {
            "symbol": symbol,
            "provider": result.provider,
            "count": len(data),
            "data": data,
        }
    except Exception as e:
        logger.error(f"OpenBB options error for {symbol}: {e}")
        raise HTTPException(502, "Failed to fetch options chain from upstream provider.")


# ───────────────────────────────────────────────────────────
# Curated xLever dashboard context
# ───────────────────────────────────────────────────────────


# GET /api/openbb/dashboard-context — pre-built quote bundle for the xLever dashboard
@router.get("/dashboard-context")
async def get_dashboard_context(provider: str = "yfinance"):
    """
    Pre-built context for the xLever dashboard:
    quotes for tracked assets + key metrics.
    """
    provider = _validate_provider(provider)
    obb = get_obb()
    tracked = ["QQQ", "SPY", "AAPL", "NVDA", "TSLA"]
    try:
        result = obb.equity.price.quote(symbol=tracked, provider=provider)
        df = result.to_dataframe()
        quotes = df.to_dict(orient="records")
        for row in quotes:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        return {
            "provider": result.provider,
            "assets": tracked,
            "quotes": quotes,
        }
    except Exception as e:
        logger.error(f"OpenBB dashboard context error: {e}")
        raise HTTPException(502, "Failed to fetch dashboard context from upstream provider.")
