"""
OpenBB Intelligence Layer — market snapshots, quotes, options context for xLever.

Uses OpenBB Platform SDK (yfinance provider by default, no API key needed).
Falls back gracefully if OpenBB is not installed or a provider is unavailable.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/openbb", tags=["openbb"])

# Lazy-load OpenBB (heavy import, ~500MB memory)
_obb = None


def get_obb():
    global _obb
    if _obb is None:
        try:
            from openbb import obb
            _obb = obb
            logger.info("OpenBB Platform initialized")
        except ImportError:
            raise HTTPException(
                503,
                "OpenBB not installed. Run: pip install 'openbb[all]'",
            )
    return _obb


# ───────────────────────────────────────────────────────────
# Equity quotes
# ───────────────────────────────────────────────────────────


@router.get("/quote/{symbol}")
async def get_quote(symbol: str, provider: str = "yfinance"):
    """Real-time equity quote for a symbol."""
    obb = get_obb()
    try:
        result = obb.equity.price.quote(symbol=symbol.upper(), provider=provider)
        data = result.to_dataframe().to_dict(orient="records")
        return {"symbol": symbol.upper(), "provider": result.provider, "data": data}
    except Exception as e:
        raise HTTPException(502, f"OpenBB quote error: {e}")


@router.get("/quotes")
async def get_quotes(
    symbols: str = Query(..., description="Comma-separated symbols, e.g. QQQ,SPY,AAPL"),
    provider: str = "yfinance",
):
    """Batch equity quotes for multiple symbols."""
    obb = get_obb()
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    try:
        result = obb.equity.price.quote(symbol=symbol_list, provider=provider)
        data = result.to_dataframe().to_dict(orient="records")
        return {"symbols": symbol_list, "provider": result.provider, "data": data}
    except Exception as e:
        raise HTTPException(502, f"OpenBB quotes error: {e}")


# ───────────────────────────────────────────────────────────
# Historical price data
# ───────────────────────────────────────────────────────────


@router.get("/historical/{symbol}")
async def get_historical(
    symbol: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    interval: str = "1d",
    provider: str = "yfinance",
):
    """Historical OHLCV data via OpenBB."""
    obb = get_obb()
    try:
        kwargs = {"symbol": symbol.upper(), "provider": provider, "interval": interval}
        if start_date:
            kwargs["start_date"] = start_date
        if end_date:
            kwargs["end_date"] = end_date
        result = obb.equity.price.historical(**kwargs)
        data = result.to_dataframe().reset_index().to_dict(orient="records")
        # Convert any Timestamp objects to ISO strings
        for row in data:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        return {
            "symbol": symbol.upper(),
            "provider": result.provider,
            "count": len(data),
            "data": data,
        }
    except Exception as e:
        raise HTTPException(502, f"OpenBB historical error: {e}")


# ───────────────────────────────────────────────────────────
# Market snapshots
# ───────────────────────────────────────────────────────────


@router.get("/snapshots")
async def get_market_snapshots(provider: str = "fmp"):
    """Broad market snapshot — top movers, volume leaders, etc."""
    obb = get_obb()
    try:
        result = obb.equity.market_snapshots(provider=provider)
        df = result.to_dataframe()
        # Return only top 50 by volume to keep payload reasonable
        if "volume" in df.columns:
            df = df.nlargest(50, "volume")
        data = df.to_dict(orient="records")
        return {"provider": result.provider, "count": len(data), "data": data}
    except Exception as e:
        raise HTTPException(502, f"OpenBB snapshots error: {e}")


# ───────────────────────────────────────────────────────────
# Options chains
# ───────────────────────────────────────────────────────────


@router.get("/options/{symbol}")
async def get_options_chain(
    symbol: str,
    provider: str = "yfinance",
    expiration: Optional[str] = None,
):
    """Options chain for a symbol — strikes, OI, volume, greeks."""
    obb = get_obb()
    try:
        kwargs = {"symbol": symbol.upper(), "provider": provider}
        if expiration:
            kwargs["expiration"] = expiration
        result = obb.derivatives.options.chains(**kwargs)
        df = result.to_dataframe()
        data = df.to_dict(orient="records")
        # Convert dates
        for row in data:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        return {
            "symbol": symbol.upper(),
            "provider": result.provider,
            "count": len(data),
            "data": data,
        }
    except Exception as e:
        raise HTTPException(502, f"OpenBB options error: {e}")


# ───────────────────────────────────────────────────────────
# Curated xLever dashboard context
# ───────────────────────────────────────────────────────────


@router.get("/dashboard-context")
async def get_dashboard_context(provider: str = "yfinance"):
    """
    Pre-built context for the xLever dashboard:
    quotes for tracked assets + key metrics.
    """
    obb = get_obb()
    tracked = ["QQQ", "SPY", "AAPL", "NVDA", "TSLA"]
    try:
        result = obb.equity.price.quote(symbol=tracked, provider=provider)
        df = result.to_dataframe()
        quotes = df.to_dict(orient="records")
        # Convert dates
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
        raise HTTPException(502, f"OpenBB dashboard context error: {e}")
