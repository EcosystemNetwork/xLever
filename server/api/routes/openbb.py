"""
OpenBB Intelligence Layer — market snapshots, quotes, options context for xLever.

Uses OpenBB Platform SDK (yfinance provider by default, no API key needed).
Falls back gracefully if OpenBB is not installed or a provider is unavailable.
"""
# Docstring explains the purpose and dependency model — OpenBB is optional, not a hard requirement

# logging for recording OpenBB initialization status and errors
import logging
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
    # Lazy-load OpenBB SDK (first call triggers import)
    obb = get_obb()
    try:
        # Fetch quote via OpenBB — uppercase symbol for provider compatibility
        result = obb.equity.price.quote(symbol=symbol.upper(), provider=provider)
        # Convert to dict records for JSON serialization — DataFrame isn't JSON-serializable
        data = result.to_dataframe().to_dict(orient="records")
        # Return structured response with provider metadata for debugging data source issues
        return {"symbol": symbol.upper(), "provider": result.provider, "data": data}
    except Exception as e:
        # 502 because the error is upstream (OpenBB/yfinance), not in our code
        raise HTTPException(502, f"OpenBB quote error: {e}")


# GET /api/openbb/quotes?symbols=QQQ,SPY — batch quotes for multiple equities
@router.get("/quotes")
async def get_quotes(
    # Required comma-separated list — description appears in Swagger docs
    symbols: str = Query(..., description="Comma-separated symbols, e.g. QQQ,SPY,AAPL"),
    provider: str = "yfinance",  # Default provider needs no API key
):
    """Batch equity quotes for multiple symbols."""
    # Lazy-load OpenBB SDK
    obb = get_obb()
    # Parse comma-separated string into a clean list of uppercase symbols
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    try:
        # OpenBB accepts a list of symbols for batch fetching — single API call for all
        result = obb.equity.price.quote(symbol=symbol_list, provider=provider)
        # Convert DataFrame to JSON-friendly dict records
        data = result.to_dataframe().to_dict(orient="records")
        # Return all quotes with the symbol list and provider for client-side correlation
        return {"symbols": symbol_list, "provider": result.provider, "data": data}
    except Exception as e:
        # 502 because the failure is in the upstream data provider
        raise HTTPException(502, f"OpenBB quotes error: {e}")


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
    # Lazy-load OpenBB SDK
    obb = get_obb()
    try:
        # Build kwargs dynamically — only include date params if provided to use provider defaults
        kwargs = {"symbol": symbol.upper(), "provider": provider, "interval": interval}
        # Only add start_date if caller specified it — lets provider use its own default range
        if start_date:
            kwargs["start_date"] = start_date
        # Only add end_date if caller specified it — omitting means "up to today"
        if end_date:
            kwargs["end_date"] = end_date
        # Fetch historical OHLCV data via OpenBB SDK
        result = obb.equity.price.historical(**kwargs)
        # reset_index moves the date index into a column; to_dict makes it JSON-friendly
        data = result.to_dataframe().reset_index().to_dict(orient="records")
        # Pandas Timestamps aren't JSON-serializable — convert any date/datetime values to ISO strings
        for row in data:
            for k, v in row.items():
                # Check for isoformat method to catch both date and datetime objects
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        # Return structured response with count for client-side validation
        return {
            "symbol": symbol.upper(),
            "provider": result.provider,
            "count": len(data),
            "data": data,
        }
    except Exception as e:
        # 502 because the failure is in the upstream data provider
        raise HTTPException(502, f"OpenBB historical error: {e}")


# ───────────────────────────────────────────────────────────
# Market snapshots
# ───────────────────────────────────────────────────────────


# GET /api/openbb/snapshots — broad market overview (top movers, volume leaders)
@router.get("/snapshots")
async def get_market_snapshots(provider: str = "fmp"):
    """Broad market snapshot — top movers, volume leaders, etc."""
    # Lazy-load OpenBB SDK
    obb = get_obb()
    try:
        # Fetch market-wide snapshot data — fmp provider gives comprehensive coverage
        result = obb.equity.market_snapshots(provider=provider)
        # Convert to DataFrame for filtering and serialization
        df = result.to_dataframe()
        # Limit to top 50 by volume to keep the response payload manageable for the frontend
        if "volume" in df.columns:
            df = df.nlargest(50, "volume")
        # Convert to dict records for JSON serialization
        data = df.to_dict(orient="records")
        # Return with count so the client knows how many records to expect
        return {"provider": result.provider, "count": len(data), "data": data}
    except Exception as e:
        # 502 because the failure is in the upstream data provider
        raise HTTPException(502, f"OpenBB snapshots error: {e}")


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
    # Lazy-load OpenBB SDK
    obb = get_obb()
    try:
        # Build kwargs dynamically — only include expiration if specified
        kwargs = {"symbol": symbol.upper(), "provider": provider}
        # Filter to a specific expiry if provided — otherwise returns all available expirations
        if expiration:
            kwargs["expiration"] = expiration
        # Fetch the full options chain via OpenBB SDK
        result = obb.derivatives.options.chains(**kwargs)
        # Convert to DataFrame then dict for JSON serialization
        df = result.to_dataframe()
        data = df.to_dict(orient="records")
        # Convert date/datetime objects to ISO strings since Pandas types aren't JSON-serializable
        for row in data:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        # Return structured response with count for client-side validation
        return {
            "symbol": symbol.upper(),
            "provider": result.provider,
            "count": len(data),
            "data": data,
        }
    except Exception as e:
        # 502 because the failure is in the upstream data provider
        raise HTTPException(502, f"OpenBB options error: {e}")


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
    # Lazy-load OpenBB SDK
    obb = get_obb()
    # Hardcoded list of assets the xLever dashboard tracks — these are the primary ETFs and stocks
    tracked = ["QQQ", "SPY", "AAPL", "NVDA", "TSLA"]
    try:
        # Batch-fetch quotes for all tracked assets in a single call
        result = obb.equity.price.quote(symbol=tracked, provider=provider)
        # Convert to DataFrame then dict for JSON serialization
        df = result.to_dataframe()
        quotes = df.to_dict(orient="records")
        # Convert date/datetime objects to ISO strings for JSON compatibility
        for row in quotes:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        # Return structured response with the tracked asset list for client-side reference
        return {
            "provider": result.provider,
            "assets": tracked,
            "quotes": quotes,
        }
    except Exception as e:
        # 502 because the failure is in the upstream data provider
        raise HTTPException(502, f"OpenBB dashboard context error: {e}")
