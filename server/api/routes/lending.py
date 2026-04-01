"""
Lending & Borrowing API — market data and position tracking for Euler V2 lending markets.
Serves the frontend lending page and lending agent with real-time market metrics.
"""

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/lending", tags=["lending"])


# ─── Simulated Market Data ──────────────────────────────────────
# In production these values come from on-chain reads via Euler V2 EVK.
# During development we serve realistic defaults so the frontend renders properly.

LENDING_MARKETS = {
    "USDC": {
        "symbol": "USDC",
        "supplyApy": 4.82,
        "borrowApy": 6.15,
        "utilization": 0.72,
        "totalSupply": 2_400_000,
        "totalBorrow": 1_728_000,
        "collateralFactor": 0.85,
        "liquidationThreshold": 0.90,
        "reserveFactor": 0.10,
        "decimals": 6,
    },
    "wQQQx": {
        "symbol": "wQQQx",
        "supplyApy": 2.31,
        "borrowApy": 4.87,
        "utilization": 0.48,
        "totalSupply": 890_000,
        "totalBorrow": 427_200,
        "collateralFactor": 0.65,
        "liquidationThreshold": 0.75,
        "reserveFactor": 0.15,
        "decimals": 18,
    },
    "wSPYx": {
        "symbol": "wSPYx",
        "supplyApy": 1.95,
        "borrowApy": 3.62,
        "utilization": 0.54,
        "totalSupply": 1_100_000,
        "totalBorrow": 594_000,
        "collateralFactor": 0.70,
        "liquidationThreshold": 0.80,
        "reserveFactor": 0.12,
        "decimals": 18,
    },
    "WETH": {
        "symbol": "WETH",
        "supplyApy": 3.14,
        "borrowApy": 5.28,
        "utilization": 0.63,
        "totalSupply": 3_800_000,
        "totalBorrow": 2_394_000,
        "collateralFactor": 0.80,
        "liquidationThreshold": 0.85,
        "reserveFactor": 0.10,
        "decimals": 18,
    },
}


@router.get("/markets")
async def get_lending_markets():
    """Return all lending market data (supply/borrow APY, utilization, TVL)."""
    return LENDING_MARKETS


@router.get("/markets/{symbol}")
async def get_lending_market(symbol: str):
    """Return data for a specific lending market."""
    market = LENDING_MARKETS.get(symbol.upper())
    if not market:
        raise HTTPException(404, f"Market {symbol} not found")
    return market


@router.get("/positions/{wallet_address}")
async def get_lending_positions(wallet_address: str):
    """
    Return a wallet's lending positions (supplies, borrows, health factor).
    In production this reads from on-chain state cached in the DB.
    """
    addr = wallet_address.lower()

    # Placeholder response — in production, query cached on-chain data
    return {
        "wallet": addr,
        "supplies": [],
        "borrows": [],
        "healthFactor": None,
        "totalCollateralUsd": 0,
        "totalDebtUsd": 0,
        "netApy": 0,
        "liquidationPrice": None,
    }


@router.get("/rates/history/{symbol}")
async def get_rate_history(symbol: str, period: str = "7d"):
    """
    Return historical supply/borrow rate data for charting.
    In production this comes from indexed on-chain events.
    """
    market = LENDING_MARKETS.get(symbol.upper())
    if not market:
        raise HTTPException(404, f"Market {symbol} not found")

    # Return static current rates — historical indexing is a future feature
    return {
        "symbol": symbol.upper(),
        "period": period,
        "current": {
            "supplyApy": market["supplyApy"],
            "borrowApy": market["borrowApy"],
            "utilization": market["utilization"],
        },
        "history": [],
    }
