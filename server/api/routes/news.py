"""
News aggregation and streaming routes for the xLever agent swarm.

Endpoints:
  GET  /api/news/stream  — SSE stream of news items (primary)
  GET  /api/news/poll    — Polling fallback for environments without SSE
  POST /api/news/inject  — Manual news injection (testing/webhooks)
  GET  /api/news/sources — List configured news sources and their status
"""

import asyncio
import hashlib
import logging
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/news", tags=["news"])

# ═══════════════════════════════════════════════════════════════
# NEWS ITEM SCHEMA
# ═══════════════════════════════════════════════════════════════


class NewsItem(BaseModel):
    headline: str
    body: str = ""
    source: str = "unknown"
    symbols: list[str] = []
    timestamp: int | None = None  # Unix ms
    url: str | None = None


class NewsInject(BaseModel):
    items: list[NewsItem]


# ═══════════════════════════════════════════════════════════════
# IN-MEMORY BUFFER (ring buffer for recent news)
# ═══════════════════════════════════════════════════════════════

MAX_BUFFER = 500
_news_buffer: deque[dict[str, Any]] = deque(maxlen=MAX_BUFFER)
_subscribers: list[asyncio.Queue] = []
_seen_hashes: set[str] = set()
MAX_SEEN = 2000


def _hash_headline(headline: str) -> str:
    return hashlib.md5(headline.encode()).hexdigest()[:12]


def _publish(item: dict[str, Any]) -> bool:
    """Add item to buffer and notify SSE subscribers. Returns False if duplicate."""
    h = _hash_headline(item["headline"])
    if h in _seen_hashes:
        return False
    _seen_hashes.add(h)
    if len(_seen_hashes) > MAX_SEEN:
        # Evict oldest half
        keep = list(_seen_hashes)[-MAX_SEEN // 2 :]
        _seen_hashes.clear()
        _seen_hashes.update(keep)

    item["id"] = f"{item.get('timestamp', int(time.time() * 1000))}-{h}"
    item.setdefault("timestamp", int(time.time() * 1000))
    _news_buffer.append(item)

    # Push to all SSE subscribers
    for q in _subscribers:
        try:
            q.put_nowait(item)
        except asyncio.QueueFull:
            pass  # Subscriber too slow — drop
    return True


# ═══════════════════════════════════════════════════════════════
# NEWS SOURCES — fetchers that run in background
# ═══════════════════════════════════════════════════════════════

# Tracked symbols for relevance filtering
TRACKED_SYMBOLS = {
    "QQQ", "SPY", "AAPL", "NVDA", "TSLA", "DELL", "SMCI", "ANET",
    "VRT", "KLAC", "LRCX", "AMAT", "TER", "CEG", "GEV", "SMR",
    "ETN", "PWR", "APLD", "SMH", "XLE", "XOP", "ITA", "VUG",
    "VGK", "VXUS", "SGOV", "SLV", "PPLT", "PALL", "STRK", "SNDK",
    "NASDAQ", "S&P", "DOW", "FED", "FOMC", "CPI", "GDP", "JOBS",
}


def _extract_symbols(text: str) -> list[str]:
    upper = text.upper()
    return [s for s in TRACKED_SYMBOLS if f" {s} " in f" {upper} " or upper.startswith(f"{s} ") or upper.endswith(f" {s}")]


async def _fetch_rss_yahoo_finance(client: httpx.AsyncClient) -> list[dict]:
    """Fetch Yahoo Finance RSS feed for market news."""
    items = []
    try:
        resp = await client.get(
            "https://feeds.finance.yahoo.com/rss/2.0/headline",
            params={"s": "QQQ,SPY,AAPL,NVDA,TSLA", "region": "US", "lang": "en-US"},
            timeout=10,
        )
        if resp.status_code != 200:
            return items

        # Simple XML parsing — avoid heavy dependency
        text = resp.text
        for block in text.split("<item>")[1:]:
            title = _xml_tag(block, "title")
            desc = _xml_tag(block, "description")
            link = _xml_tag(block, "link")
            pub_date = _xml_tag(block, "pubDate")

            if not title:
                continue

            ts = int(time.time() * 1000)
            if pub_date:
                try:
                    from email.utils import parsedate_to_datetime
                    dt = parsedate_to_datetime(pub_date)
                    ts = int(dt.timestamp() * 1000)
                except Exception:
                    pass

            items.append({
                "headline": title,
                "body": desc or "",
                "source": "yahoo-finance",
                "symbols": _extract_symbols(f"{title} {desc or ''}"),
                "timestamp": ts,
                "url": link,
            })
    except Exception as e:
        logger.warning(f"Yahoo Finance RSS fetch failed: {e}")
    return items


async def _fetch_newsapi_everything(client: httpx.AsyncClient, api_key: str | None) -> list[dict]:
    """Fetch from NewsAPI.org (requires API key in NEWSAPI_KEY env var)."""
    if not api_key:
        return []
    items = []
    try:
        resp = await client.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": "stock market OR nasdaq OR S&P 500 OR federal reserve OR earnings",
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": 20,
                "apiKey": api_key,
            },
            timeout=10,
        )
        if resp.status_code != 200:
            return items

        data = resp.json()
        for article in data.get("articles", []):
            title = article.get("title", "")
            desc = article.get("description", "")
            if not title or title == "[Removed]":
                continue

            ts = int(time.time() * 1000)
            pub = article.get("publishedAt")
            if pub:
                try:
                    dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                    ts = int(dt.timestamp() * 1000)
                except Exception:
                    pass

            items.append({
                "headline": title,
                "body": desc or "",
                "source": f"newsapi:{article.get('source', {}).get('name', 'unknown')}",
                "symbols": _extract_symbols(f"{title} {desc or ''}"),
                "timestamp": ts,
                "url": article.get("url"),
            })
    except Exception as e:
        logger.warning(f"NewsAPI fetch failed: {e}")
    return items


async def _fetch_openbb_news(client: httpx.AsyncClient) -> list[dict]:
    """Fetch financial news via OpenBB Platform SDK (if available)."""
    items = []
    try:
        from openbb import obb
        result = obb.news.world(limit=20)
        if hasattr(result, "results") and result.results:
            for article in result.results:
                title = getattr(article, "title", "") or ""
                desc = getattr(article, "text", "") or getattr(article, "description", "") or ""
                if not title:
                    continue

                ts = int(time.time() * 1000)
                pub = getattr(article, "date", None) or getattr(article, "published", None)
                if pub and hasattr(pub, "timestamp"):
                    ts = int(pub.timestamp() * 1000)

                items.append({
                    "headline": title,
                    "body": desc[:500],
                    "source": f"openbb:{getattr(article, 'source', 'unknown')}",
                    "symbols": _extract_symbols(f"{title} {desc}"),
                    "timestamp": ts,
                    "url": getattr(article, "url", None),
                })
    except ImportError:
        pass  # OpenBB not installed
    except Exception as e:
        logger.warning(f"OpenBB news fetch failed: {e}")
    return items


def _xml_tag(text: str, tag: str) -> str:
    """Extract text content from a simple XML tag."""
    start = text.find(f"<{tag}>")
    if start < 0:
        start = text.find(f"<{tag} ")
    if start < 0:
        return ""
    start = text.find(">", start) + 1
    cdata_start = text.find("<![CDATA[", start, start + 20)
    if cdata_start >= 0:
        start = cdata_start + 9
        end = text.find("]]>", start)
    else:
        end = text.find(f"</{tag}>", start)
    if end < 0:
        return ""
    return text[start:end].strip()


# ═══════════════════════════════════════════════════════════════
# BACKGROUND AGGREGATION LOOP
# ═══════════════════════════════════════════════════════════════

_bg_task: asyncio.Task | None = None
_source_status: dict[str, dict] = {}


async def _aggregation_loop():
    """Background task that periodically fetches from all sources."""
    import os
    newsapi_key = os.environ.get("NEWSAPI_KEY")

    while True:
        try:
            async with httpx.AsyncClient() as client:
                # Fetch from all sources in parallel
                results = await asyncio.gather(
                    _fetch_rss_yahoo_finance(client),
                    _fetch_newsapi_everything(client, newsapi_key),
                    _fetch_openbb_news(client),
                    return_exceptions=True,
                )

                source_names = ["yahoo-finance", "newsapi", "openbb"]
                total_new = 0

                for name, result in zip(source_names, results):
                    if isinstance(result, Exception):
                        _source_status[name] = {
                            "status": "error",
                            "error": str(result),
                            "last_check": datetime.now(timezone.utc).isoformat(),
                        }
                        continue

                    published = 0
                    for item in result:
                        if _publish(item):
                            published += 1
                    total_new += published

                    _source_status[name] = {
                        "status": "ok",
                        "items_fetched": len(result),
                        "items_new": published,
                        "last_check": datetime.now(timezone.utc).isoformat(),
                    }

                if total_new > 0:
                    logger.info(f"News aggregation: {total_new} new items from {len(source_names)} sources")

        except Exception as e:
            logger.error(f"News aggregation loop error: {e}")

        # Poll every 60 seconds
        await asyncio.sleep(60)


def _ensure_bg_task():
    """Start the background aggregation loop if not already running."""
    global _bg_task
    if _bg_task is None or _bg_task.done():
        _bg_task = asyncio.create_task(_aggregation_loop())


# ═══════════════════════════════════════════════════════════════
# SSE STREAMING ENDPOINT
# ═══════════════════════════════════════════════════════════════


@router.get("/stream")
async def news_stream(request: Request):
    """Server-Sent Events stream of news items. Primary real-time channel."""
    _ensure_bg_task()

    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.append(queue)

    async def event_generator():
        try:
            # Send recent buffer as initial catch-up
            recent = list(_news_buffer)[-20:]
            if recent:
                import json
                yield f"data: {json.dumps(recent)}\n\n"

            # Stream new items as they arrive
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=30)
                    import json
                    yield f"data: {json.dumps(item)}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive comment
                    yield ": keepalive\n\n"
        finally:
            if queue in _subscribers:
                _subscribers.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ═══════════════════════════════════════════════════════════════
# POLLING ENDPOINT (fallback)
# ═══════════════════════════════════════════════════════════════


@router.get("/poll")
async def news_poll(since: int = Query(0, description="Unix timestamp ms — return items newer than this")):
    """Polling fallback for environments that don't support SSE."""
    _ensure_bg_task()

    items = [item for item in _news_buffer if item.get("timestamp", 0) > since]
    # Sort by timestamp descending, limit to 50
    items.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
    return {"items": items[:50], "buffer_size": len(_news_buffer)}


# ═══════════════════════════════════════════════════════════════
# MANUAL INJECTION (webhooks / testing)
# ═══════════════════════════════════════════════════════════════


@router.post("/inject")
async def news_inject(body: NewsInject):
    """Manually inject news items (for webhooks or testing)."""
    published = 0
    for item in body.items:
        d = item.model_dump()
        d["source"] = d.get("source", "inject")
        if _publish(d):
            published += 1
    return {"published": published, "total": len(body.items)}


# ═══════════════════════════════════════════════════════════════
# SOURCE STATUS
# ═══════════════════════════════════════════════════════════════


@router.get("/calendar")
async def economic_calendar():
    """
    Return upcoming/recent economic events for verification.
    Tries OpenBB economics calendar, falls back to static schedule.
    """
    events = []

    # Try OpenBB economics calendar
    try:
        from openbb import obb
        result = obb.economy.calendar(
            start_date=(datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d"),
            end_date=(datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d"),
        )
        if hasattr(result, "results") and result.results:
            for ev in result.results:
                name = getattr(ev, "event", "") or getattr(ev, "name", "") or ""
                date = getattr(ev, "date", None)
                date_str = date.strftime("%Y-%m-%d") if hasattr(date, "strftime") else str(date) if date else ""

                # Classify event type
                event_type = _classify_econ_event(name)
                events.append({
                    "name": name,
                    "date": date_str,
                    "type": event_type,
                    "country": getattr(ev, "country", "US"),
                    "actual": getattr(ev, "actual", None),
                    "forecast": getattr(ev, "forecast", None),
                    "previous": getattr(ev, "previous", None),
                })
    except ImportError:
        pass  # OpenBB not installed
    except Exception as e:
        logger.warning(f"OpenBB calendar failed: {e}")

    # If no events from OpenBB, generate static schedule
    if not events:
        events = _generate_static_calendar()

    return {"events": events, "source": "openbb" if events and events[0].get("actual") is not None else "static"}


def _classify_econ_event(name: str) -> str:
    """Classify an economic event name into our known types."""
    n = name.lower()
    if any(k in n for k in ["fomc", "fed funds", "interest rate decision", "federal reserve"]):
        return "fomc"
    if any(k in n for k in ["cpi", "consumer price", "inflation"]):
        return "cpi"
    if any(k in n for k in ["nonfarm", "payroll", "employment", "jobs report", "unemployment"]):
        return "jobs"
    if any(k in n for k in ["gdp", "gross domestic"]):
        return "gdp"
    if any(k in n for k in ["earnings", "quarterly results"]):
        return "earnings"
    if any(k in n for k in ["pmi", "manufacturing", "ism"]):
        return "pmi"
    if any(k in n for k in ["retail sales"]):
        return "retail"
    return "other"


def _generate_static_calendar() -> list[dict]:
    """Generate approximate calendar when OpenBB is unavailable."""
    today = datetime.now(timezone.utc)
    events = []

    # FOMC: ~8 meetings per year, roughly every 6 weeks
    # CPI: ~12th of each month
    # Jobs: first Friday of each month
    # GDP: last week of Jan/Apr/Jul/Oct

    # CPI estimate for this month (around the 12th)
    cpi_day = today.replace(day=12)
    if abs((today - cpi_day).days) <= 3:
        events.append({
            "name": "CPI - Consumer Price Index",
            "date": cpi_day.strftime("%Y-%m-%d"),
            "type": "cpi",
            "country": "US",
            "actual": None,
            "forecast": None,
            "previous": None,
        })

    # Jobs report: first Friday
    first_day = today.replace(day=1)
    days_until_friday = (4 - first_day.weekday()) % 7
    first_friday = first_day.replace(day=1 + days_until_friday)
    if abs((today - first_friday).days) <= 2:
        events.append({
            "name": "Nonfarm Payrolls",
            "date": first_friday.strftime("%Y-%m-%d"),
            "type": "jobs",
            "country": "US",
            "actual": None,
            "forecast": None,
            "previous": None,
        })

    # GDP: last week of Jan(0), Apr(3), Jul(6), Oct(9)
    if today.month in [1, 4, 7, 10] and today.day >= 25:
        events.append({
            "name": "GDP Growth Rate",
            "date": today.strftime("%Y-%m-%d"),
            "type": "gdp",
            "country": "US",
            "actual": None,
            "forecast": None,
            "previous": None,
        })

    return events


@router.get("/sources")
async def news_sources():
    """List configured news sources and their status."""
    import os
    return {
        "sources": {
            "yahoo-finance": {
                "type": "rss",
                "configured": True,
                **_source_status.get("yahoo-finance", {"status": "not_started"}),
            },
            "newsapi": {
                "type": "api",
                "configured": bool(os.environ.get("NEWSAPI_KEY")),
                **_source_status.get("newsapi", {"status": "not_started"}),
            },
            "openbb": {
                "type": "sdk",
                "configured": True,  # Available if OpenBB is installed
                **_source_status.get("openbb", {"status": "not_started"}),
            },
        },
        "buffer_size": len(_news_buffer),
        "subscriber_count": len(_subscribers),
    }
