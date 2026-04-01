"""
Live on-chain data routes — pool state, oracle, junior tranche, fees, positions, Pyth prices.

Replaces the standalone server.py by integrating its on-chain polling + caching
into the FastAPI app as an async background task.
"""

import asyncio
import logging
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from web3 import Web3

from ..config import get_settings

logger = logging.getLogger("live")
settings = get_settings()

router = APIRouter(prefix="/live", tags=["live"])

# ═══════════════════════════════════════════════════════════════
# CHAIN CONFIG
# ═══════════════════════════════════════════════════════════════

w3 = Web3(Web3.HTTPProvider(settings.RPC_URL, request_kwargs={"timeout": 10}))

VAULT_ADDRESSES = {
    "wQQQx": "0xd76378af8494eafa6251d13dcbcaa4f39e70b90b",
    "wSPYx": "0x6bbb5fe4f82b14bd29fd8d7b9cc1f45a6e19c3dd",
}

PYTH_HERMES_URL = "https://hermes.pyth.network"
PYTH_FEEDS = {
    "QQQ": "0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
    "SPY": "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
}

VAULT_ABI = [
    {
        "name": "getPoolState", "type": "function", "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "tuple", "components": [
            {"name": "totalSeniorDeposits", "type": "uint256"},
            {"name": "totalJuniorDeposits", "type": "uint256"},
            {"name": "insuranceFund", "type": "uint256"},
            {"name": "netExposure", "type": "int256"},
            {"name": "grossLongExposure", "type": "uint256"},
            {"name": "grossShortExposure", "type": "uint256"},
            {"name": "lastRebalanceTime", "type": "uint256"},
            {"name": "currentMaxLeverageBps", "type": "uint256"},
            {"name": "fundingRateBps", "type": "int256"},
            {"name": "protocolState", "type": "uint8"},
        ]}],
    },
    {
        "name": "getPosition", "type": "function", "stateMutability": "view",
        "inputs": [{"name": "user", "type": "address"}],
        "outputs": [{"name": "", "type": "tuple", "components": [
            {"name": "depositAmount", "type": "uint128"},
            {"name": "leverageBps", "type": "int32"},
            {"name": "entryTWAP", "type": "uint128"},
            {"name": "lastFeeTimestamp", "type": "uint64"},
            {"name": "settledFees", "type": "uint128"},
            {"name": "leverageLockExpiry", "type": "uint32"},
            {"name": "isActive", "type": "bool"},
        ]}],
    },
    {
        "name": "getPositionValue", "type": "function", "stateMutability": "view",
        "inputs": [{"name": "user", "type": "address"}],
        "outputs": [
            {"name": "value", "type": "uint256"},
            {"name": "pnl", "type": "int256"},
        ],
    },
    {
        "name": "getCurrentTWAP", "type": "function", "stateMutability": "view",
        "inputs": [],
        "outputs": [
            {"name": "twap", "type": "uint256"},
            {"name": "spreadBps", "type": "uint256"},
        ],
    },
    {
        "name": "getMaxLeverage", "type": "function", "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "maxLeverageBps", "type": "uint256"}],
    },
    {
        "name": "getFundingRate", "type": "function", "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "int256"}],
    },
    {
        "name": "getCarryRate", "type": "function", "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "int256"}],
    },
    {
        "name": "getJuniorValue", "type": "function", "stateMutability": "view",
        "inputs": [],
        "outputs": [
            {"name": "totalValue", "type": "uint256"},
            {"name": "sharePrice", "type": "uint256"},
        ],
    },
    {
        "name": "getOracleState", "type": "function", "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "tuple", "components": [
            {"name": "executionPrice", "type": "uint256"},
            {"name": "displayPrice", "type": "uint256"},
            {"name": "riskPrice", "type": "uint256"},
            {"name": "divergenceBps", "type": "uint256"},
            {"name": "spreadBps", "type": "uint256"},
            {"name": "isFresh", "type": "bool"},
            {"name": "isCircuitBroken", "type": "bool"},
            {"name": "lastUpdateTime", "type": "uint256"},
            {"name": "updateCount", "type": "uint256"},
        ]}],
    },
]


def _get_contract(symbol: str):
    addr = VAULT_ADDRESSES.get(symbol)
    if not addr:
        return None
    return w3.eth.contract(address=Web3.to_checksum_address(addr), abi=VAULT_ABI)


# ═══════════════════════════════════════════════════════════════
# ASYNC CACHE — background polling every 15s
# ═══════════════════════════════════════════════════════════════

CACHE_TTL = 15
_cache: dict = {}
_cache_task: Optional[asyncio.Task] = None


def _read_pool_state(symbol: str) -> Optional[dict]:
    contract = _get_contract(symbol)
    if not contract:
        return None
    try:
        ps = contract.functions.getPoolState().call()
        return {
            "totalSeniorDeposits": str(ps[0]),
            "totalJuniorDeposits": str(ps[1]),
            "insuranceFund": str(ps[2]),
            "netExposure": str(ps[3]),
            "grossLongExposure": str(ps[4]),
            "grossShortExposure": str(ps[5]),
            "lastRebalanceTime": ps[6],
            "currentMaxLeverageBps": ps[7],
            "fundingRateBps": str(ps[8]),
            "protocolState": ps[9],
        }
    except Exception as e:
        logger.warning(f"pool_state {symbol}: {e}")
        return None


def _read_oracle_state(symbol: str) -> Optional[dict]:
    contract = _get_contract(symbol)
    if not contract:
        return None
    try:
        os_data = contract.functions.getOracleState().call()
        return {
            "executionPrice": str(os_data[0]),
            "displayPrice": str(os_data[1]),
            "riskPrice": str(os_data[2]),
            "divergenceBps": os_data[3],
            "spreadBps": os_data[4],
            "isFresh": os_data[5],
            "isCircuitBroken": os_data[6],
            "lastUpdateTime": os_data[7],
            "updateCount": os_data[8],
        }
    except Exception as e:
        logger.warning(f"oracle_state {symbol}: {e}")
        return None


def _read_junior_value(symbol: str) -> Optional[dict]:
    contract = _get_contract(symbol)
    if not contract:
        return None
    try:
        jv = contract.functions.getJuniorValue().call()
        return {"totalValue": str(jv[0]), "sharePrice": str(jv[1])}
    except Exception as e:
        logger.warning(f"junior_value {symbol}: {e}")
        return None


def _read_fee_state(symbol: str) -> Optional[dict]:
    contract = _get_contract(symbol)
    if not contract:
        return None
    result = {}
    try:
        result["fundingRateBps"] = str(contract.functions.getFundingRate().call())
    except Exception:
        result["fundingRateBps"] = None
    try:
        result["carryRateBps"] = str(contract.functions.getCarryRate().call())
    except Exception:
        result["carryRateBps"] = None
    try:
        result["maxLeverageBps"] = contract.functions.getMaxLeverage().call()
    except Exception:
        result["maxLeverageBps"] = None
    try:
        twap = contract.functions.getCurrentTWAP().call()
        result["twap"] = str(twap[0])
        result["twapSpreadBps"] = twap[1]
    except Exception:
        result["twap"] = None
        result["twapSpreadBps"] = None
    return result


async def _fetch_pyth_price(symbol: str) -> Optional[dict]:
    feed_id = PYTH_FEEDS.get(symbol)
    if not feed_id:
        return None
    try:
        url = f"{PYTH_HERMES_URL}/v2/updates/price/latest?ids[]={feed_id}"
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
            data = resp.json()
            if data.get("parsed") and len(data["parsed"]) > 0:
                p = data["parsed"][0]["price"]
                price = int(p["price"]) * (10 ** int(p["expo"]))
                return {
                    "price": price,
                    "conf": int(p["conf"]) * (10 ** int(p["expo"])),
                    "publishTime": p.get("publish_time"),
                }
    except Exception as e:
        logger.warning(f"pyth {symbol}: {e}")
    return None


async def _refresh_loop():
    """Background task: poll all live state every CACHE_TTL seconds."""
    while True:
        try:
            new: dict = {"_timestamp": time.time()}
            for vault_symbol in VAULT_ADDRESSES:
                ticker = vault_symbol.replace("w", "").replace("x", "")
                # Web3 calls are sync (run in thread to avoid blocking the event loop)
                loop = asyncio.get_event_loop()
                new[f"pool_{ticker}"] = await loop.run_in_executor(None, _read_pool_state, vault_symbol)
                new[f"oracle_{ticker}"] = await loop.run_in_executor(None, _read_oracle_state, vault_symbol)
                new[f"junior_{ticker}"] = await loop.run_in_executor(None, _read_junior_value, vault_symbol)
                new[f"fees_{ticker}"] = await loop.run_in_executor(None, _read_fee_state, vault_symbol)
                new[f"pyth_{ticker}"] = await _fetch_pyth_price(ticker)
            _cache.update(new)
            logger.info(f"cache refreshed at {time.strftime('%H:%M:%S')}")
        except Exception as e:
            logger.error(f"cache refresh error: {e}")
        await asyncio.sleep(CACHE_TTL)


async def start_cache():
    """Called from FastAPI lifespan to start the background poller."""
    global _cache_task
    if _cache_task is None:
        _cache_task = asyncio.create_task(_refresh_loop())
        logger.info("live cache background task started")


async def stop_cache():
    """Called from FastAPI lifespan shutdown."""
    global _cache_task
    if _cache_task:
        _cache_task.cancel()
        _cache_task = None


# ═══════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════

@router.get("/pool/{symbol}")
async def get_pool_state(symbol: str):
    data = _cache.get(f"pool_{symbol}")
    if data is None:
        raise HTTPException(404, detail=f"No pool data for {symbol}")
    return {"symbol": symbol, "source": "contract", **data}


@router.get("/oracle/{symbol}")
async def get_oracle_state(symbol: str):
    data = _cache.get(f"oracle_{symbol}")
    if data is None:
        raise HTTPException(404, detail=f"No oracle data for {symbol}")
    return {"symbol": symbol, "source": "contract", **data}


@router.get("/junior/{symbol}")
async def get_junior_value(symbol: str):
    data = _cache.get(f"junior_{symbol}")
    if data is None:
        raise HTTPException(404, detail=f"No junior data for {symbol}")
    return {"symbol": symbol, "source": "contract", **data}


@router.get("/fees/{symbol}")
async def get_fee_state(symbol: str):
    data = _cache.get(f"fees_{symbol}")
    if data is None:
        raise HTTPException(404, detail=f"No fee data for {symbol}")
    return {"symbol": symbol, "source": "contract", **data}


@router.get("/pyth/{symbol}")
async def get_pyth_price(symbol: str):
    data = _cache.get(f"pyth_{symbol}")
    if data is None:
        raise HTTPException(404, detail=f"No pyth data for {symbol}")
    return {"symbol": symbol, "source": "pyth_hermes", **data}


@router.get("/position/{symbol}")
async def get_position(symbol: str, user: str = Query(..., description="Wallet address 0x...")):
    vault_key = f"w{symbol}x"
    contract = _get_contract(vault_key)
    if not contract:
        raise HTTPException(404, detail=f"Unknown vault: {symbol}")
    try:
        addr = Web3.to_checksum_address(user)
        loop = asyncio.get_event_loop()
        pos = await loop.run_in_executor(None, lambda: contract.functions.getPosition(addr).call())
        val = await loop.run_in_executor(None, lambda: contract.functions.getPositionValue(addr).call())
        return {
            "symbol": symbol, "source": "contract", "user": user,
            "depositAmount": str(pos[0]), "leverageBps": pos[1],
            "entryTWAP": str(pos[2]), "lastFeeTimestamp": pos[3],
            "settledFees": str(pos[4]), "leverageLockExpiry": pos[5],
            "isActive": pos[6], "currentValue": str(val[0]), "pnl": str(val[1]),
        }
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@router.get("/summary")
async def get_summary():
    vaults = {}
    for symbol in ["QQQ", "SPY"]:
        vaults[symbol] = {
            "pool": _cache.get(f"pool_{symbol}"),
            "oracle": _cache.get(f"oracle_{symbol}"),
            "junior": _cache.get(f"junior_{symbol}"),
            "fees": _cache.get(f"fees_{symbol}"),
            "pyth": _cache.get(f"pyth_{symbol}"),
        }
    ts = _cache.get("_timestamp")
    return {
        "source": "contract+pyth",
        "cacheAge": round(time.time() - ts, 1) if ts else None,
        "rpc": settings.RPC_URL,
        "vaults": vaults,
    }
