"""
Market Data Layer — quotes, historical OHLCV, options via yfinance.

Replaces the OpenBB dependency with direct yfinance calls to avoid
heavy dependency chains and version conflicts.
"""

import logging
import re
from datetime import datetime as _dt
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/openbb", tags=["openbb"])

_SYMBOL_RE = re.compile(r"^[A-Za-z0-9.&]{1,10}$")


def _validate_symbol(symbol: str) -> str:
    if not _SYMBOL_RE.match(symbol):
        raise HTTPException(400, "Invalid symbol.")
    return symbol.upper()


def _get_ticker(symbol: str):
    import yfinance as yf
    return yf.Ticker(symbol)


# ─── Equity quotes ───────────────────────────────────────

@router.get("/quote/{symbol}")
async def get_quote(symbol: str, provider: str = "yfinance"):
    symbol = _validate_symbol(symbol)
    try:
        t = _get_ticker(symbol)
        info = t.info
        data = [{
            "symbol": symbol,
            "last_price": info.get("currentPrice") or info.get("regularMarketPrice"),
            "open": info.get("open") or info.get("regularMarketOpen"),
            "high": info.get("dayHigh") or info.get("regularMarketDayHigh"),
            "low": info.get("dayLow") or info.get("regularMarketDayLow"),
            "close": info.get("previousClose") or info.get("regularMarketPreviousClose"),
            "volume": info.get("volume") or info.get("regularMarketVolume"),
            "market_cap": info.get("marketCap"),
            "change_percent": info.get("regularMarketChangePercent"),
            "name": info.get("shortName") or info.get("longName"),
        }]
        return {"symbol": symbol, "provider": "yfinance", "data": data}
    except Exception as e:
        logger.error(f"Quote error for {symbol}: {e}")
        raise HTTPException(502, "Failed to fetch quote.")


@router.get("/quotes")
async def get_quotes(
    symbols: str = Query(..., description="Comma-separated symbols"),
    provider: str = "yfinance",
):
    import yfinance as yf
    symbol_list = [_validate_symbol(s.strip()) for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(400, "No valid symbols.")
    try:
        tickers = yf.Tickers(" ".join(symbol_list))
        data = []
        for sym in symbol_list:
            info = tickers.tickers[sym].info
            data.append({
                "symbol": sym,
                "last_price": info.get("currentPrice") or info.get("regularMarketPrice"),
                "open": info.get("open") or info.get("regularMarketOpen"),
                "high": info.get("dayHigh") or info.get("regularMarketDayHigh"),
                "low": info.get("dayLow") or info.get("regularMarketDayLow"),
                "volume": info.get("volume") or info.get("regularMarketVolume"),
                "change_percent": info.get("regularMarketChangePercent"),
                "name": info.get("shortName"),
            })
        return {"symbols": symbol_list, "provider": "yfinance", "data": data}
    except Exception as e:
        logger.error(f"Quotes error: {e}")
        raise HTTPException(502, "Failed to fetch quotes.")


# ─── Historical ──────────────────────────────────────────

@router.get("/historical/{symbol}")
async def get_historical(
    symbol: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    interval: str = "1d",
    provider: str = "yfinance",
):
    symbol = _validate_symbol(symbol)
    for label, val in [("start_date", start_date), ("end_date", end_date)]:
        if val:
            try:
                _dt.strptime(val, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(400, f"Invalid {label}. Use YYYY-MM-DD.")
    try:
        t = _get_ticker(symbol)
        kwargs = {"interval": interval}
        if start_date:
            kwargs["start"] = start_date
        if end_date:
            kwargs["end"] = end_date
        if not start_date and not end_date:
            kwargs["period"] = "1y"
        df = t.history(**kwargs)
        df = df.reset_index()
        data = []
        for _, row in df.iterrows():
            rec = {}
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    rec[k.lower()] = v.isoformat()
                else:
                    rec[k.lower()] = v
            data.append(rec)
        return {"symbol": symbol, "provider": "yfinance", "count": len(data), "data": data}
    except Exception as e:
        logger.error(f"Historical error for {symbol}: {e}")
        raise HTTPException(502, "Failed to fetch historical data.")


# ─── Market snapshots ────────────────────────────────────

@router.get("/snapshots")
async def get_market_snapshots(provider: str = "yfinance"):
    import yfinance as yf
    tracked = ["QQQ", "SPY", "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "SMH"]
    try:
        tickers = yf.Tickers(" ".join(tracked))
        data = []
        for sym in tracked:
            info = tickers.tickers[sym].info
            data.append({
                "symbol": sym,
                "last_price": info.get("currentPrice") or info.get("regularMarketPrice"),
                "change_percent": info.get("regularMarketChangePercent"),
                "volume": info.get("volume") or info.get("regularMarketVolume"),
                "market_cap": info.get("marketCap"),
                "name": info.get("shortName"),
            })
        return {"provider": "yfinance", "count": len(data), "data": data}
    except Exception as e:
        logger.error(f"Snapshots error: {e}")
        raise HTTPException(502, "Failed to fetch snapshots.")


# ─── Options ─────────────────────────────────────────────

@router.get("/options/{symbol}")
async def get_options_chain(
    symbol: str,
    provider: str = "yfinance",
    expiration: Optional[str] = None,
):
    symbol = _validate_symbol(symbol)
    try:
        t = _get_ticker(symbol)
        expirations = t.options
        if not expirations:
            return {"symbol": symbol, "provider": "yfinance", "count": 0, "data": [], "expirations": []}
        target_exp = expiration if expiration and expiration in expirations else expirations[0]
        chain = t.option_chain(target_exp)
        calls = chain.calls.to_dict(orient="records")
        puts = chain.puts.to_dict(orient="records")
        data = []
        for c in calls:
            c["option_type"] = "call"
            c["expiration"] = target_exp
            data.append(c)
        for p in puts:
            p["option_type"] = "put"
            p["expiration"] = target_exp
            data.append(p)
        for row in data:
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
        return {"symbol": symbol, "provider": "yfinance", "count": len(data), "data": data, "expirations": list(expirations)}
    except Exception as e:
        logger.error(f"Options error for {symbol}: {e}")
        raise HTTPException(502, "Failed to fetch options chain.")


# ─── Dashboard context ───────────────────────────────────

@router.get("/dashboard-context")
async def get_dashboard_context(provider: str = "yfinance"):
    import yfinance as yf
    tracked = ["QQQ", "SPY", "AAPL", "NVDA", "TSLA"]
    try:
        tickers = yf.Tickers(" ".join(tracked))
        quotes = []
        for sym in tracked:
            info = tickers.tickers[sym].info
            quotes.append({
                "symbol": sym,
                "last_price": info.get("currentPrice") or info.get("regularMarketPrice"),
                "change_percent": info.get("regularMarketChangePercent"),
                "volume": info.get("volume"),
                "name": info.get("shortName"),
            })
        return {"provider": "yfinance", "assets": tracked, "quotes": quotes}
    except Exception as e:
        logger.error(f"Dashboard context error: {e}")
        raise HTTPException(502, "Failed to fetch dashboard context.")
