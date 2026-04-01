"""
Multi-Chain Lending & Borrowing API
────────────────────────────────────
Aggregates lending market data and position tracking across:
  - Euler V2 (Ink Sepolia + Ethereum Mainnet)
  - Kamino Finance (Solana)
  - EVAA Protocol (TON)

Routes accept an optional `chain` query param to filter by chain.
Without it, returns aggregated data across all chains.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
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
# Kamino public API for Solana lending data
KAMINO_API = "https://api.kamino.finance"
# EVAA public API for TON lending data
EVAA_API = "https://api.evaa.finance"


# ─── Market Data (per chain) ─────────────────────────────────

EULER_MARKETS = {
    "ink-sepolia": {
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
            "protocol": "euler-v2",
            "chain": "ink-sepolia",
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
            "protocol": "euler-v2",
            "chain": "ink-sepolia",
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
            "protocol": "euler-v2",
            "chain": "ink-sepolia",
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
            "protocol": "euler-v2",
            "chain": "ink-sepolia",
        },
    },
    "ethereum": {
        "USDC": {
            "symbol": "USDC",
            "supplyApy": 5.12,
            "borrowApy": 6.84,
            "utilization": 0.78,
            "totalSupply": 145_000_000,
            "totalBorrow": 113_100_000,
            "collateralFactor": 0.85,
            "liquidationThreshold": 0.90,
            "reserveFactor": 0.10,
            "decimals": 6,
            "protocol": "euler-v2",
            "chain": "ethereum",
        },
        "WETH": {
            "symbol": "WETH",
            "supplyApy": 2.87,
            "borrowApy": 4.95,
            "utilization": 0.58,
            "totalSupply": 320_000_000,
            "totalBorrow": 185_600_000,
            "collateralFactor": 0.80,
            "liquidationThreshold": 0.85,
            "reserveFactor": 0.10,
            "decimals": 18,
            "protocol": "euler-v2",
            "chain": "ethereum",
        },
        "wstETH": {
            "symbol": "wstETH",
            "supplyApy": 3.42,
            "borrowApy": 5.18,
            "utilization": 0.66,
            "totalSupply": 280_000_000,
            "totalBorrow": 184_800_000,
            "collateralFactor": 0.78,
            "liquidationThreshold": 0.83,
            "reserveFactor": 0.10,
            "decimals": 18,
            "protocol": "euler-v2",
            "chain": "ethereum",
        },
        "USDT": {
            "symbol": "USDT",
            "supplyApy": 4.95,
            "borrowApy": 6.52,
            "utilization": 0.76,
            "totalSupply": 98_000_000,
            "totalBorrow": 74_480_000,
            "collateralFactor": 0.82,
            "liquidationThreshold": 0.88,
            "reserveFactor": 0.10,
            "decimals": 6,
            "protocol": "euler-v2",
            "chain": "ethereum",
        },
    },
}

KAMINO_MARKETS = {
    "USDC": {
        "symbol": "USDC",
        "supplyApy": 6.34,
        "borrowApy": 8.72,
        "utilization": 0.81,
        "totalSupply": 520_000_000,
        "totalBorrow": 421_200_000,
        "collateralFactor": 0.85,
        "liquidationThreshold": 0.90,
        "decimals": 6,
        "protocol": "kamino",
        "chain": "solana",
    },
    "SOL": {
        "symbol": "SOL",
        "supplyApy": 7.82,
        "borrowApy": 10.14,
        "utilization": 0.74,
        "totalSupply": 890_000_000,
        "totalBorrow": 658_600_000,
        "collateralFactor": 0.75,
        "liquidationThreshold": 0.85,
        "decimals": 9,
        "protocol": "kamino",
        "chain": "solana",
    },
    "USDT": {
        "symbol": "USDT",
        "supplyApy": 5.91,
        "borrowApy": 8.15,
        "utilization": 0.77,
        "totalSupply": 310_000_000,
        "totalBorrow": 238_700_000,
        "collateralFactor": 0.80,
        "liquidationThreshold": 0.88,
        "decimals": 6,
        "protocol": "kamino",
        "chain": "solana",
    },
    "JitoSOL": {
        "symbol": "JitoSOL",
        "supplyApy": 8.45,
        "borrowApy": 11.20,
        "utilization": 0.69,
        "totalSupply": 420_000_000,
        "totalBorrow": 289_800_000,
        "collateralFactor": 0.70,
        "liquidationThreshold": 0.80,
        "decimals": 9,
        "protocol": "kamino",
        "chain": "solana",
    },
}

EVAA_MARKETS = {
    "TON": {
        "symbol": "TON",
        "supplyApy": 5.67,
        "borrowApy": 7.89,
        "utilization": 0.68,
        "totalSupply": 180_000_000,
        "totalBorrow": 122_400_000,
        "collateralFactor": 0.75,
        "liquidationThreshold": 0.82,
        "decimals": 9,
        "protocol": "evaa",
        "chain": "ton",
    },
    "USDT": {
        "symbol": "USDT",
        "supplyApy": 7.12,
        "borrowApy": 9.45,
        "utilization": 0.82,
        "totalSupply": 95_000_000,
        "totalBorrow": 77_900_000,
        "collateralFactor": 0.85,
        "liquidationThreshold": 0.90,
        "decimals": 6,
        "protocol": "evaa",
        "chain": "ton",
    },
    "USDC": {
        "symbol": "USDC",
        "supplyApy": 6.89,
        "borrowApy": 9.12,
        "utilization": 0.79,
        "totalSupply": 72_000_000,
        "totalBorrow": 56_880_000,
        "collateralFactor": 0.85,
        "liquidationThreshold": 0.90,
        "decimals": 6,
        "protocol": "evaa",
        "chain": "ton",
    },
    "stTON": {
        "symbol": "stTON",
        "supplyApy": 6.23,
        "borrowApy": 8.67,
        "utilization": 0.63,
        "totalSupply": 45_000_000,
        "totalBorrow": 28_350_000,
        "collateralFactor": 0.65,
        "liquidationThreshold": 0.75,
        "decimals": 9,
        "protocol": "evaa",
        "chain": "ton",
    },
}

ALL_MARKETS = {
    "ink-sepolia": EULER_MARKETS["ink-sepolia"],
    "ethereum": EULER_MARKETS["ethereum"],
    "solana": KAMINO_MARKETS,
    "ton": EVAA_MARKETS,
}


def _get_markets(chain: Optional[str] = None) -> dict:
    """Return markets filtered by chain, or all markets if no chain specified."""
    if chain:
        if chain not in SUPPORTED_CHAINS:
            return {}
        return ALL_MARKETS.get(chain, {})
    # Flatten all markets across chains, keyed by chain
    return ALL_MARKETS


# ─── Market Routes ────────────────────────────────────────────

@router.get("/markets")
async def get_lending_markets(chain: Optional[str] = Query(None, description="Filter by chain: ink-sepolia, ethereum, solana, ton")):
    """
    Return lending market data across all chains or filtered by chain.
    Each market includes supply/borrow APY, utilization, TVL, and protocol info.
    """
    markets = _get_markets(chain)
    if chain and not markets:
        raise HTTPException(404, f"No markets for chain: {chain}")
    return markets


@router.get("/markets/{symbol}")
async def get_lending_market(
    symbol: str,
    chain: Optional[str] = Query(None, description="Specific chain to query"),
):
    """Return data for a specific market symbol, optionally filtered by chain."""
    if chain:
        markets = ALL_MARKETS.get(chain, {})
        market = markets.get(symbol.upper())
        if not market:
            raise HTTPException(404, f"Market {symbol} not found on {chain}")
        return market

    # Search across all chains, return all matches
    results = []
    for c, markets in ALL_MARKETS.items():
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
    if chain:
        markets = ALL_MARKETS.get(chain, {})
    else:
        # Find first chain that has this symbol
        markets = {}
        for c, m in ALL_MARKETS.items():
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
    }


# ─── Cross-Chain Aggregation ─────────────────────────────────

@router.get("/overview")
async def get_lending_overview():
    """
    Cross-chain lending overview — total TVL, best rates, protocol breakdown.
    Used by the lending dashboard and agent for opportunity detection.
    """
    overview = {
        "chains": {},
        "bestSupplyApy": {"symbol": "", "apy": 0, "chain": "", "protocol": ""},
        "bestBorrowApy": {"symbol": "", "apy": float("inf"), "chain": "", "protocol": ""},
        "totalTvl": 0,
        "totalBorrowed": 0,
    }

    for chain, markets in ALL_MARKETS.items():
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
            "marketCount": len(ALL_MARKETS.get(chain, {})),
            "status": "active",
        }
        for chain in SUPPORTED_CHAINS
    ]
