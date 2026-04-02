"""
Multi-Chain Lending & Borrowing API
────────────────────────────────────
Aggregates lending market data and position tracking across:
  - Euler V2 (Ink Sepolia + Ethereum Mainnet)
  - Kamino Finance (Solana)
  - EVAA Protocol (TON)

Routes accept an optional `chain` query param to filter by chain.
Without it, returns aggregated data across all chains.

Market data is fetched from on-chain RPCs and public APIs with 60-second
in-memory caching. Hardcoded fallbacks are used when external calls fail.
"""

import logging
import time
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger("lending")

router = APIRouter(prefix="/lending", tags=["lending"])


# ─── Chain Registry ───────────────────────────────────────────
SUPPORTED_CHAINS = ["ink-sepolia", "ethereum", "solana", "ton"]

CHAIN_PROTOCOLS = {
    "ink-sepolia": "euler-v2",
    "ethereum": "euler-v2",
    "solana": "kamino",
    "ton": "evaa",
}

# ─── RPC Endpoints for on-chain reads ─────────────────────────
CHAIN_RPC = {
    "ink-sepolia": "https://rpc-gel-sepolia.inkonchain.com",
    "ethereum": "https://eth.llamarpc.com",
    "solana": "https://api.mainnet-beta.solana.com",
    "ton": "https://toncenter.com/api/v2/jsonRPC",
}

# ─── External API endpoints for market data ───────────────────
KAMINO_API = "https://api.kamino.finance"
KAMINO_MARKET_PUBKEY = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"

EVAA_API = "https://api.evaa.finance"

# ─── Euler V2 eVault contract config ─────────────────────────
# Function selectors (first 4 bytes of keccak256 of signature)
# totalSupplyAssets()  -> 0x01e1d114
# totalBorrowAssets()  -> 0xfee3f7f9  (totalBorrows)
# interestRate()       -> 0x7c3a00fd
# decimals()           -> 0x313ce567
# asset()              -> 0x38d52e0f

EULER_VAULT_SELECTORS = {
    "totalSupply": "0x01e1d114",
    "totalBorrows": "0xfee3f7f9",
    "interestRate": "0x7c3a00fd",
}

EULER_VAULT_CONFIG = {
    "ink-sepolia": {
        "USDC": {
            "vault": "0xFabab97dCE620294D2B0b0e46C68964e326300Ac",
            "decimals": 6,
            "collateralFactor": 0.85,
            "liquidationThreshold": 0.90,
            "reserveFactor": 0.10,
        },
        "wQQQx": {
            "vault": "0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9",
            "decimals": 18,
            "collateralFactor": 0.65,
            "liquidationThreshold": 0.75,
            "reserveFactor": 0.15,
        },
        "wSPYx": {
            "vault": "0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e",
            "decimals": 18,
            "collateralFactor": 0.70,
            "liquidationThreshold": 0.80,
            "reserveFactor": 0.12,
        },
        "WETH": {
            "vault": None,
            "decimals": 18,
            "collateralFactor": 0.80,
            "liquidationThreshold": 0.85,
            "reserveFactor": 0.10,
        },
    },
    "ethereum": {
        "USDC": {
            "vault": "0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9",
            "decimals": 6,
            "collateralFactor": 0.85,
            "liquidationThreshold": 0.90,
            "reserveFactor": 0.10,
        },
        "WETH": {
            "vault": "0xD8b27CF359b7D15710a5BE299AF6e7Bf904984C2",
            "decimals": 18,
            "collateralFactor": 0.80,
            "liquidationThreshold": 0.85,
            "reserveFactor": 0.10,
        },
        "wstETH": {
            "vault": "0xbC4B4AC47582c3AA228917616B53b543b0367b0a",
            "decimals": 18,
            "collateralFactor": 0.78,
            "liquidationThreshold": 0.83,
            "reserveFactor": 0.10,
        },
        "USDT": {
            "vault": "0x313603FA690301b0CaeEf8069c065862f9162162",
            "decimals": 6,
            "collateralFactor": 0.82,
            "liquidationThreshold": 0.88,
            "reserveFactor": 0.10,
        },
    },
}

# ─── Fallback Data (used when live fetches fail) ─────────────
# IMPORTANT: These are stale placeholder values, not live data.
# Every market returned from fallback is tagged with "source": "fallback"
# so the frontend can distinguish live vs stale data.


def _tag_fallback(markets: dict[str, dict]) -> dict[str, dict]:
    """Tag all markets in a dict with source=fallback."""
    for m in markets.values():
        m["source"] = "fallback"
    return markets


FALLBACK_EULER_MARKETS = {
    "ink-sepolia": {
        "USDC": {
            "symbol": "USDC", "supplyApy": 4.82, "borrowApy": 6.15,
            "utilization": 0.72, "totalSupply": 2_400_000, "totalBorrow": 1_728_000,
            "collateralFactor": 0.85, "liquidationThreshold": 0.90,
            "reserveFactor": 0.10, "decimals": 6,
            "protocol": "euler-v2", "chain": "ink-sepolia",
        },
        "wQQQx": {
            "symbol": "wQQQx", "supplyApy": 2.31, "borrowApy": 4.87,
            "utilization": 0.48, "totalSupply": 890_000, "totalBorrow": 427_200,
            "collateralFactor": 0.65, "liquidationThreshold": 0.75,
            "reserveFactor": 0.15, "decimals": 18,
            "protocol": "euler-v2", "chain": "ink-sepolia",
        },
        "wSPYx": {
            "symbol": "wSPYx", "supplyApy": 1.95, "borrowApy": 3.62,
            "utilization": 0.54, "totalSupply": 1_100_000, "totalBorrow": 594_000,
            "collateralFactor": 0.70, "liquidationThreshold": 0.80,
            "reserveFactor": 0.12, "decimals": 18,
            "protocol": "euler-v2", "chain": "ink-sepolia",
        },
        "WETH": {
            "symbol": "WETH", "supplyApy": 3.14, "borrowApy": 5.28,
            "utilization": 0.63, "totalSupply": 3_800_000, "totalBorrow": 2_394_000,
            "collateralFactor": 0.80, "liquidationThreshold": 0.85,
            "reserveFactor": 0.10, "decimals": 18,
            "protocol": "euler-v2", "chain": "ink-sepolia",
        },
    },
    "ethereum": {
        "USDC": {
            "symbol": "USDC", "supplyApy": 5.12, "borrowApy": 6.84,
            "utilization": 0.78, "totalSupply": 145_000_000, "totalBorrow": 113_100_000,
            "collateralFactor": 0.85, "liquidationThreshold": 0.90,
            "reserveFactor": 0.10, "decimals": 6,
            "protocol": "euler-v2", "chain": "ethereum",
        },
        "WETH": {
            "symbol": "WETH", "supplyApy": 2.87, "borrowApy": 4.95,
            "utilization": 0.58, "totalSupply": 320_000_000, "totalBorrow": 185_600_000,
            "collateralFactor": 0.80, "liquidationThreshold": 0.85,
            "reserveFactor": 0.10, "decimals": 18,
            "protocol": "euler-v2", "chain": "ethereum",
        },
        "wstETH": {
            "symbol": "wstETH", "supplyApy": 3.42, "borrowApy": 5.18,
            "utilization": 0.66, "totalSupply": 280_000_000, "totalBorrow": 184_800_000,
            "collateralFactor": 0.78, "liquidationThreshold": 0.83,
            "reserveFactor": 0.10, "decimals": 18,
            "protocol": "euler-v2", "chain": "ethereum",
        },
        "USDT": {
            "symbol": "USDT", "supplyApy": 4.95, "borrowApy": 6.52,
            "utilization": 0.76, "totalSupply": 98_000_000, "totalBorrow": 74_480_000,
            "collateralFactor": 0.82, "liquidationThreshold": 0.88,
            "reserveFactor": 0.10, "decimals": 6,
            "protocol": "euler-v2", "chain": "ethereum",
        },
    },
}

FALLBACK_KAMINO_MARKETS = {
    "USDC": {
        "symbol": "USDC", "supplyApy": 6.34, "borrowApy": 8.72,
        "utilization": 0.81, "totalSupply": 520_000_000, "totalBorrow": 421_200_000,
        "collateralFactor": 0.85, "liquidationThreshold": 0.90, "decimals": 6,
        "protocol": "kamino", "chain": "solana",
    },
    "SOL": {
        "symbol": "SOL", "supplyApy": 7.82, "borrowApy": 10.14,
        "utilization": 0.74, "totalSupply": 890_000_000, "totalBorrow": 658_600_000,
        "collateralFactor": 0.75, "liquidationThreshold": 0.85, "decimals": 9,
        "protocol": "kamino", "chain": "solana",
    },
    "USDT": {
        "symbol": "USDT", "supplyApy": 5.91, "borrowApy": 8.15,
        "utilization": 0.77, "totalSupply": 310_000_000, "totalBorrow": 238_700_000,
        "collateralFactor": 0.80, "liquidationThreshold": 0.88, "decimals": 6,
        "protocol": "kamino", "chain": "solana",
    },
    "JitoSOL": {
        "symbol": "JitoSOL", "supplyApy": 8.45, "borrowApy": 11.20,
        "utilization": 0.69, "totalSupply": 420_000_000, "totalBorrow": 289_800_000,
        "collateralFactor": 0.70, "liquidationThreshold": 0.80, "decimals": 9,
        "protocol": "kamino", "chain": "solana",
    },
}

FALLBACK_EVAA_MARKETS = {
    "TON": {
        "symbol": "TON", "supplyApy": 5.67, "borrowApy": 7.89,
        "utilization": 0.68, "totalSupply": 180_000_000, "totalBorrow": 122_400_000,
        "collateralFactor": 0.75, "liquidationThreshold": 0.82, "decimals": 9,
        "protocol": "evaa", "chain": "ton",
    },
    "USDT": {
        "symbol": "USDT", "supplyApy": 7.12, "borrowApy": 9.45,
        "utilization": 0.82, "totalSupply": 95_000_000, "totalBorrow": 77_900_000,
        "collateralFactor": 0.85, "liquidationThreshold": 0.90, "decimals": 6,
        "protocol": "evaa", "chain": "ton",
    },
    "USDC": {
        "symbol": "USDC", "supplyApy": 6.89, "borrowApy": 9.12,
        "utilization": 0.79, "totalSupply": 72_000_000, "totalBorrow": 56_880_000,
        "collateralFactor": 0.85, "liquidationThreshold": 0.90, "decimals": 6,
        "protocol": "evaa", "chain": "ton",
    },
    "stTON": {
        "symbol": "stTON", "supplyApy": 6.23, "borrowApy": 8.67,
        "utilization": 0.63, "totalSupply": 45_000_000, "totalBorrow": 28_350_000,
        "collateralFactor": 0.65, "liquidationThreshold": 0.75, "decimals": 9,
        "protocol": "evaa", "chain": "ton",
    },
}


# ─── In-Memory Cache ─────────────────────────────────────────

CACHE_TTL_SECONDS = 60

_cache: dict[str, dict[str, Any]] = {}
# Each entry: {"data": <value>, "ts": <monotonic timestamp>}


def _cache_get(key: str) -> Any | None:
    """Return cached value if present and not expired, else None."""
    entry = _cache.get(key)
    if entry is None:
        return None
    if time.monotonic() - entry["ts"] > CACHE_TTL_SECONDS:
        del _cache[key]
        return None
    return entry["data"]


def _cache_set(key: str, data: Any) -> None:
    """Store data in cache with current timestamp."""
    _cache[key] = {"data": data, "ts": time.monotonic()}


# ─── Shared HTTP Client ──────────────────────────────────────
# Reused across requests for connection pooling. Created lazily.

_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
    return _http_client


# ─── Euler V2 On-Chain Reader ─────────────────────────────────

async def _eth_call(rpc_url: str, to: str, data: str) -> str | None:
    """Execute an eth_call and return the hex result, or None on error."""
    client = _get_client()
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{"to": to, "data": data}, "latest"],
    }
    try:
        resp = await client.post(rpc_url, json=payload)
        resp.raise_for_status()
        body = resp.json()
        if "error" in body:
            logger.warning("eth_call error for %s: %s", to, body["error"])
            return None
        return body.get("result")
    except Exception as exc:
        logger.warning("eth_call failed for %s: %s", to, exc)
        return None


def _decode_uint256(hex_str: str | None) -> int | None:
    """Decode a uint256 from an eth_call hex response."""
    if not hex_str or hex_str == "0x":
        return None
    try:
        return int(hex_str, 16)
    except (ValueError, TypeError):
        return None


async def _fetch_euler_chain(chain: str) -> dict[str, dict]:
    """Fetch Euler V2 vault data for a single chain via JSON-RPC eth_call."""
    cache_key = f"euler:{chain}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    fallback = FALLBACK_EULER_MARKETS.get(chain, {})
    vaults = EULER_VAULT_CONFIG.get(chain, {})
    rpc_url = CHAIN_RPC.get(chain)

    if not vaults or not rpc_url:
        logger.warning("Euler %s: no vault config or RPC, using fallback", chain)
        return _tag_fallback(dict(fallback))

    markets: dict[str, dict] = {}
    had_failure = False

    for symbol, cfg in vaults.items():
        vault_addr = cfg["vault"]
        if not vault_addr:
            # No vault deployed for this asset — use fallback
            if symbol in fallback:
                markets[symbol] = {**fallback[symbol], "source": "fallback"}
            continue
        # Issue three eth_calls in parallel-ish (sequential for simplicity, httpx
        # connection pooling helps). For true parallelism we could use asyncio.gather
        # but keeping it simple since we have caching.
        raw_supply = await _eth_call(rpc_url, vault_addr, EULER_VAULT_SELECTORS["totalSupply"])
        raw_borrows = await _eth_call(rpc_url, vault_addr, EULER_VAULT_SELECTORS["totalBorrows"])
        raw_rate = await _eth_call(rpc_url, vault_addr, EULER_VAULT_SELECTORS["interestRate"])

        total_supply = _decode_uint256(raw_supply)
        total_borrows = _decode_uint256(raw_borrows)
        interest_rate_raw = _decode_uint256(raw_rate)

        # If any call failed, use fallback for this symbol
        if total_supply is None or total_borrows is None:
            fb = fallback.get(symbol)
            if fb:
                markets[symbol] = {**fb, "source": "fallback"}
            had_failure = True
            continue

        # Convert from raw token units to human-readable values
        decimals = cfg["decimals"]
        supply_human = total_supply / (10 ** decimals)
        borrow_human = total_borrows / (10 ** decimals)
        utilization = borrow_human / supply_human if supply_human > 0 else 0.0

        # Interest rate from Euler V2: returned as a per-second rate scaled by 1e27.
        # Annualize: rate_per_sec * seconds_per_year / 1e27 * 100 for percentage.
        SECONDS_PER_YEAR = 365.25 * 24 * 3600
        if interest_rate_raw is not None and interest_rate_raw > 0:
            borrow_apy = (interest_rate_raw * SECONDS_PER_YEAR / 1e27) * 100
            # Supply APY = borrow APY * utilization * (1 - reserve_factor)
            supply_apy = borrow_apy * utilization * (1 - cfg["reserveFactor"])
        else:
            # Fallback to stored rates if interest rate call failed
            logger.warning("Euler %s/%s: interest rate call failed, using fallback rates", chain, symbol)
            fb = fallback.get(symbol, {})
            borrow_apy = fb.get("borrowApy", 0)
            supply_apy = fb.get("supplyApy", 0)

        markets[symbol] = {
            "symbol": symbol,
            "supplyApy": round(supply_apy, 2),
            "borrowApy": round(borrow_apy, 2),
            "utilization": round(utilization, 4),
            "totalSupply": round(supply_human),
            "totalBorrow": round(borrow_human),
            "collateralFactor": cfg["collateralFactor"],
            "liquidationThreshold": cfg["liquidationThreshold"],
            "reserveFactor": cfg["reserveFactor"],
            "decimals": decimals,
            "protocol": "euler-v2",
            "chain": chain,
            "source": "live",
        }

    # If we got no data at all, return entire fallback
    if not markets:
        logger.warning("Euler %s: no data fetched, using full fallback", chain)
        return _tag_fallback(dict(fallback))

    # Fill in any missing symbols from fallback
    for symbol in fallback:
        if symbol not in markets:
            markets[symbol] = {**fallback[symbol], "source": "fallback"}

    if not had_failure:
        _cache_set(cache_key, markets)

    return markets


async def _fetch_euler_markets() -> dict[str, dict[str, dict]]:
    """Fetch Euler data for both chains."""
    ink = await _fetch_euler_chain("ink-sepolia")
    eth = await _fetch_euler_chain("ethereum")
    return {"ink-sepolia": ink, "ethereum": eth}


# ─── Kamino (Solana) API Reader ──────────────────────────────

async def _fetch_kamino_markets() -> dict[str, dict]:
    """Fetch Kamino reserve data from their public API."""
    cache_key = "kamino:solana"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    client = _get_client()
    url = f"{KAMINO_API}/v2/kamino-market/{KAMINO_MARKET_PUBKEY}/reserves"

    try:
        resp = await client.get(url)
        resp.raise_for_status()
        reserves = resp.json()
    except Exception as exc:
        logger.warning("Kamino API fetch failed: %s", exc)
        return _tag_fallback(dict(FALLBACK_KAMINO_MARKETS))

    if not isinstance(reserves, list) or len(reserves) == 0:
        logger.warning("Kamino API returned empty or unexpected data")
        return _tag_fallback(dict(FALLBACK_KAMINO_MARKETS))

    markets: dict[str, dict] = {}

    for reserve in reserves:
        # The Kamino API returns reserve objects; extract the relevant fields.
        # Field names may vary; try common patterns.
        symbol = (
            reserve.get("symbol")
            or reserve.get("tokenSymbol")
            or reserve.get("mint", {}).get("symbol", "")
        )
        if not symbol:
            continue

        # Map only symbols we care about (ones in our fallback)
        if symbol not in FALLBACK_KAMINO_MARKETS:
            continue

        fb = FALLBACK_KAMINO_MARKETS[symbol]

        try:
            supply_apy = float(reserve.get("supplyInterestAPY", 0)) * 100
            borrow_apy = float(reserve.get("borrowInterestAPY", 0)) * 100
            total_supply = float(reserve.get("totalSupply", 0))
            total_borrow = float(reserve.get("totalBorrow", 0))
            utilization = total_borrow / total_supply if total_supply > 0 else 0.0

            markets[symbol] = {
                "symbol": symbol,
                "supplyApy": round(supply_apy, 2),
                "borrowApy": round(borrow_apy, 2),
                "utilization": round(utilization, 4),
                "totalSupply": round(total_supply),
                "totalBorrow": round(total_borrow),
                "collateralFactor": fb["collateralFactor"],
                "liquidationThreshold": fb["liquidationThreshold"],
                "decimals": fb["decimals"],
                "protocol": "kamino",
                "chain": "solana",
                "source": "live",
            }
        except (ValueError, TypeError, KeyError) as exc:
            logger.warning("Kamino: failed to parse reserve %s: %s", symbol, exc)
            markets[symbol] = {**fb, "source": "fallback"}

    # Fill in any missing symbols from fallback
    for symbol in FALLBACK_KAMINO_MARKETS:
        if symbol not in markets:
            markets[symbol] = {**FALLBACK_KAMINO_MARKETS[symbol], "source": "fallback"}

    _cache_set(cache_key, markets)
    return markets


# ─── EVAA (TON) API Reader ───────────────────────────────────

async def _fetch_evaa_markets() -> dict[str, dict]:
    """Fetch EVAA market data from their public API."""
    cache_key = "evaa:ton"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    client = _get_client()
    url = f"{EVAA_API}/v1/markets"

    try:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("EVAA API fetch failed: %s", exc)
        return _tag_fallback(dict(FALLBACK_EVAA_MARKETS))

    # data may be a list of markets or an object with a "markets" key
    market_list = data if isinstance(data, list) else data.get("markets", [])

    if not isinstance(market_list, list) or len(market_list) == 0:
        logger.warning("EVAA API returned empty or unexpected data")
        return _tag_fallback(dict(FALLBACK_EVAA_MARKETS))

    markets: dict[str, dict] = {}

    for item in market_list:
        symbol = (
            item.get("symbol")
            or item.get("tokenSymbol")
            or item.get("asset", "")
        )
        if not symbol:
            continue

        if symbol not in FALLBACK_EVAA_MARKETS:
            continue

        fb = FALLBACK_EVAA_MARKETS[symbol]

        try:
            # EVAA API returns rates as decimals or percentages depending on version.
            # Try to detect: if supplyRate < 1, it's a decimal (multiply by 100).
            raw_supply = float(item.get("supplyRate", item.get("supplyApy", 0)))
            raw_borrow = float(item.get("borrowRate", item.get("borrowApy", 0)))
            supply_apy = raw_supply * 100 if raw_supply < 1 else raw_supply
            borrow_apy = raw_borrow * 100 if raw_borrow < 1 else raw_borrow

            total_supply = float(item.get("totalSupply", item.get("tvl", 0)))
            total_borrow = float(item.get("totalBorrow", item.get("totalBorrowed", 0)))
            utilization = total_borrow / total_supply if total_supply > 0 else 0.0

            markets[symbol] = {
                "symbol": symbol,
                "supplyApy": round(supply_apy, 2),
                "borrowApy": round(borrow_apy, 2),
                "utilization": round(utilization, 4),
                "totalSupply": round(total_supply),
                "totalBorrow": round(total_borrow),
                "collateralFactor": fb["collateralFactor"],
                "liquidationThreshold": fb["liquidationThreshold"],
                "decimals": fb["decimals"],
                "protocol": "evaa",
                "chain": "ton",
                "source": "live",
            }
        except (ValueError, TypeError, KeyError) as exc:
            logger.warning("EVAA: failed to parse market %s: %s", symbol, exc)
            markets[symbol] = {**fb, "source": "fallback"}

    for symbol in FALLBACK_EVAA_MARKETS:
        if symbol not in markets:
            markets[symbol] = {**FALLBACK_EVAA_MARKETS[symbol], "source": "fallback"}

    _cache_set(cache_key, markets)
    return markets


# ─── Aggregated Market Loader ─────────────────────────────────

async def _load_all_markets() -> dict[str, dict[str, dict]]:
    """Load market data for all chains, using cache + live fetches."""
    cache_key = "all_markets"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    euler = await _fetch_euler_markets()
    kamino = await _fetch_kamino_markets()
    evaa = await _fetch_evaa_markets()

    result = {
        "ink-sepolia": euler.get("ink-sepolia", FALLBACK_EULER_MARKETS.get("ink-sepolia", {})),
        "ethereum": euler.get("ethereum", FALLBACK_EULER_MARKETS.get("ethereum", {})),
        "solana": kamino,
        "ton": evaa,
    }

    _cache_set(cache_key, result)
    return result


async def _get_markets(chain: Optional[str] = None) -> dict:
    """Return markets filtered by chain, or all markets if no chain specified."""
    all_markets = await _load_all_markets()
    if chain:
        if chain not in SUPPORTED_CHAINS:
            return {}
        return all_markets.get(chain, {})
    return all_markets


# ─── Market Routes ────────────────────────────────────────────

@router.get("/markets")
async def get_lending_markets(
    chain: Optional[str] = Query(None, description="Filter by chain: ink-sepolia, ethereum, solana, ton"),
):
    """
    Return lending market data across all chains or filtered by chain.
    Each market includes supply/borrow APY, utilization, TVL, and protocol info.
    """
    markets = await _get_markets(chain)
    if chain and not markets:
        raise HTTPException(404, f"No markets for chain: {chain}")
    return markets


@router.get("/markets/{symbol}")
async def get_lending_market(
    symbol: str,
    chain: Optional[str] = Query(None, description="Specific chain to query"),
):
    """Return data for a specific market symbol, optionally filtered by chain."""
    all_markets = await _load_all_markets()

    if chain:
        markets = all_markets.get(chain, {})
        market = markets.get(symbol.upper())
        if not market:
            raise HTTPException(404, f"Market {symbol} not found on {chain}")
        return market

    # Search across all chains, return all matches
    results = []
    for c, markets in all_markets.items():
        if symbol.upper() in markets:
            results.append(markets[symbol.upper()])
    if not results:
        raise HTTPException(404, f"Market {symbol} not found on any chain")
    return results[0] if len(results) == 1 else results


# ─── Position Routes ──────────────────────────────────────────

@router.get("/positions/{wallet_address}")
async def get_lending_positions(
    wallet_address: str,
    chain: Optional[str] = Query(None, description="Filter by chain"),
):
    """
    Return a wallet's lending positions across all chains or filtered.
    In production, reads from on-chain state cached in the DB.
    """
    addr = wallet_address.lower()

    if chain and chain not in SUPPORTED_CHAINS:
        raise HTTPException(400, f"Unsupported chain: {chain}")

    chains_to_query = [chain] if chain else SUPPORTED_CHAINS

    positions = []
    for c in chains_to_query:
        positions.append({
            "chain": c,
            "protocol": CHAIN_PROTOCOLS.get(c, "unknown"),
            "wallet": addr,
            "supplies": [],
            "borrows": [],
            "healthFactor": None,
            "source": "placeholder",
            "totalCollateralUsd": 0,
            "totalDebtUsd": 0,
            "netApy": 0,
            "liquidationPrice": None,
        })

    # Single chain: return flat object for backwards compat
    if chain:
        return positions[0]

    return {
        "wallet": addr,
        "chains": {p["chain"]: p for p in positions},
        "aggregated": {
            "totalCollateralUsd": sum(p["totalCollateralUsd"] for p in positions),
            "totalDebtUsd": sum(p["totalDebtUsd"] for p in positions),
            "netApy": 0,
            "chainCount": len(positions),
        },
    }


# ─── Rate History ─────────────────────────────────────────────

@router.get("/rates/history/{symbol}")
async def get_rate_history(
    symbol: str,
    chain: Optional[str] = Query(None),
    period: str = "7d",
):
    """Return historical supply/borrow rate data for charting."""
    all_markets = await _load_all_markets()

    if chain:
        markets = all_markets.get(chain, {})
    else:
        # Find first chain that has this symbol
        markets = {}
        for c, m in all_markets.items():
            if symbol.upper() in m:
                markets = m
                chain = c
                break

    market = markets.get(symbol.upper())
    if not market:
        raise HTTPException(404, f"Market {symbol} not found")

    return {
        "symbol": symbol.upper(),
        "chain": chain,
        "protocol": market.get("protocol", "unknown"),
        "period": period,
        "current": {
            "supplyApy": market["supplyApy"],
            "borrowApy": market["borrowApy"],
            "utilization": market["utilization"],
        },
        "history": [],
        "note": "Historical rate data not yet available",
    }


# ─── Cross-Chain Aggregation ─────────────────────────────────

@router.get("/overview")
async def get_lending_overview():
    """
    Cross-chain lending overview — total TVL, best rates, protocol breakdown.
    Used by the lending dashboard and agent for opportunity detection.
    """
    all_markets = await _load_all_markets()

    overview = {
        "chains": {},
        "bestSupplyApy": {"symbol": "", "apy": 0, "chain": "", "protocol": ""},
        "bestBorrowApy": {"symbol": "", "apy": float("inf"), "chain": "", "protocol": ""},
        "totalTvl": 0,
        "totalBorrowed": 0,
    }

    for chain, markets in all_markets.items():
        chain_tvl = 0
        chain_borrowed = 0
        market_count = len(markets)

        for symbol, market in markets.items():
            supply = market.get("totalSupply", 0)
            borrow = market.get("totalBorrow", 0)
            chain_tvl += supply
            chain_borrowed += borrow

            # Track best rates
            if market["supplyApy"] > overview["bestSupplyApy"]["apy"]:
                overview["bestSupplyApy"] = {
                    "symbol": symbol,
                    "apy": market["supplyApy"],
                    "chain": chain,
                    "protocol": market.get("protocol", "unknown"),
                }
            if market["borrowApy"] < overview["bestBorrowApy"]["apy"]:
                overview["bestBorrowApy"] = {
                    "symbol": symbol,
                    "apy": market["borrowApy"],
                    "chain": chain,
                    "protocol": market.get("protocol", "unknown"),
                }

        overview["chains"][chain] = {
            "protocol": CHAIN_PROTOCOLS.get(chain, "unknown"),
            "marketCount": market_count,
            "tvl": chain_tvl,
            "totalBorrowed": chain_borrowed,
            "utilization": chain_borrowed / chain_tvl if chain_tvl > 0 else 0,
        }
        overview["totalTvl"] += chain_tvl
        overview["totalBorrowed"] += chain_borrowed

    # Handle case where no borrow markets exist
    if overview["bestBorrowApy"]["apy"] == float("inf"):
        overview["bestBorrowApy"]["apy"] = 0

    return overview


@router.get("/chains")
async def get_supported_chains():
    """Return list of supported chains with their protocols and status."""
    all_markets = await _load_all_markets()

    return [
        {
            "chain": chain,
            "protocol": CHAIN_PROTOCOLS[chain],
            "name": {
                "ink-sepolia": "Ink Sepolia",
                "ethereum": "Ethereum",
                "solana": "Solana",
                "ton": "TON",
            }[chain],
            "marketCount": len(all_markets.get(chain, {})),
            "status": "active",
        }
        for chain in SUPPORTED_CHAINS
    ]
