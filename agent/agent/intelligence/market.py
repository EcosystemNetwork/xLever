"""Market intelligence module for data aggregation and analysis."""

import asyncio
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from decimal import Decimal
import httpx
from loguru import logger

from agent.intelligence.tavily import TavilyClient
from agent.execution.web3_client import Web3Client
from agent.contracts.addresses import CONTRACTS, PYTH_HERMES_URL, PYTH_FEEDS, ASSETS
from agent.contracts.abi_loader import HEDGING_VAULT_ABI, EULER_VAULT_ABI


@dataclass
class PriceData:
    """Price information from Pyth oracle."""

    price: float
    confidence: float
    expo: int
    publish_time: datetime

    @property
    def price_with_confidence(self) -> tuple[float, float]:
        """Get price bounds considering confidence interval."""
        return (self.price - self.confidence, self.price + self.confidence)


@dataclass
class PoolState:
    """On-chain pool state from Euler vaults."""

    net_exposure_long: float  # Positive if net long
    net_exposure_short: float  # Positive if net short
    junior_ratio: float  # Junior LP ratio (0-1)
    total_liquidity_usdc: float
    funding_rate_bps: int  # Annual funding rate in basis points
    health_score: float

    @property
    def net_direction(self) -> str:
        """Get net pool direction."""
        if self.net_exposure_long > self.net_exposure_short:
            return "long"
        elif self.net_exposure_short > self.net_exposure_long:
            return "short"
        return "neutral"

    @property
    def net_exposure_magnitude(self) -> float:
        """Get absolute net exposure."""
        return abs(self.net_exposure_long - self.net_exposure_short)


@dataclass
class MarketState:
    """Complete market state for decision making."""

    # Price data
    asset: str
    spot_price: float
    twap_price: Optional[float] = None
    price_24h_change_pct: float = 0.0
    volatility_24h_pct: float = 0.0

    # Pool state
    pool_state: Optional[PoolState] = None
    divergence_bps: int = 0  # TWAP divergence in basis points

    # Market intelligence
    sentiment: Optional[str] = None  # "bullish" | "bearish" | "neutral"
    sentiment_confidence: int = 0  # 0-100
    upcoming_events: list[str] = field(default_factory=list)
    risk_factors: list[str] = field(default_factory=list)
    position_bias: Optional[str] = None  # "long" | "short" | "neutral"

    # Metadata
    timestamp: datetime = field(default_factory=datetime.now)
    data_age_seconds: float = 0.0

    @property
    def is_stale(self, max_age_seconds: int = 900) -> bool:
        """Check if market data is stale (default: 15 min)."""
        age = (datetime.now() - self.timestamp).total_seconds()
        return age > max_age_seconds

    @property
    def is_divergence_high(self, threshold_bps: int = 300) -> bool:
        """Check if TWAP divergence exceeds threshold (default: 3%)."""
        return abs(self.divergence_bps) > threshold_bps

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for logging and storage."""
        return {
            "asset": self.asset,
            "spot_price": self.spot_price,
            "twap_price": self.twap_price,
            "price_24h_change_pct": self.price_24h_change_pct,
            "volatility_24h_pct": self.volatility_24h_pct,
            "divergence_bps": self.divergence_bps,
            "sentiment": self.sentiment,
            "sentiment_confidence": self.sentiment_confidence,
            "position_bias": self.position_bias,
            "pool_net_direction": self.pool_state.net_direction if self.pool_state else None,
            "junior_ratio": self.pool_state.junior_ratio if self.pool_state else None,
            "health_score": self.pool_state.health_score if self.pool_state else None,
            "timestamp": self.timestamp.isoformat(),
        }


class MarketIntelligence:
    """Market intelligence aggregator.

    Combines data from multiple sources:
    - Pyth oracle for price feeds
    - On-chain pool state from Euler vaults
    - Market sentiment from Tavily AI Search

    Implements caching and automatic refresh logic.
    """

    def __init__(
        self,
        tavily_client: TavilyClient,
        web3_client: Web3Client,
        refresh_interval: int = 900,  # 15 minutes
        price_move_threshold_pct: float = 1.0,  # Force refresh on >1% move
    ):
        """Initialize market intelligence aggregator.

        Args:
            tavily_client: Client for AI market analysis
            web3_client: Client for blockchain queries
            refresh_interval: Default refresh interval in seconds
            price_move_threshold_pct: Price move % to trigger immediate refresh
        """
        self.tavily = tavily_client
        self.web3 = web3_client
        self.refresh_interval = refresh_interval
        self.price_move_threshold = price_move_threshold_pct

        # Cache
        self._cache: Dict[str, MarketState] = {}
        self._last_prices: Dict[str, float] = {}

        # HTTP client for Pyth
        self.http_client = httpx.AsyncClient(timeout=10.0)

        logger.info(
            f"Market intelligence initialized "
            f"(refresh: {refresh_interval}s, price threshold: {price_move_threshold_pct}%)"
        )

    async def get_market_state(
        self,
        asset: str,
        force_refresh: bool = False,
        include_sentiment: bool = True,
    ) -> MarketState:
        """Get current market state for an asset.

        Args:
            asset: Asset ticker (wSPYx, wQQQx)
            force_refresh: Force refresh even if cache is fresh
            include_sentiment: Include Perplexity sentiment analysis

        Returns:
            Complete market state

        Raises:
            ValueError: If asset not supported
        """
        if asset not in ASSETS:
            raise ValueError(f"Unsupported asset: {asset}. Must be one of {list(ASSETS.keys())}")

        # Check cache
        cached = self._cache.get(asset)
        if cached and not force_refresh and not cached.is_stale:
            logger.debug(f"Using cached market state for {asset}")
            return cached

        logger.info(f"Refreshing market state for {asset}")

        # Gather data in parallel
        results = await asyncio.gather(
            self._get_price_data(asset),
            self._get_pool_state(asset),
            self._get_sentiment(asset) if include_sentiment else None,
            return_exceptions=True,
        )

        price_data, pool_state, sentiment_data = results

        # Handle errors gracefully
        if isinstance(price_data, Exception):
            logger.error(f"Failed to fetch price data: {price_data}")
            # Use cached price if available
            price_data = (
                PriceData(cached.spot_price, 0, 0, cached.timestamp)
                if cached
                else None
            )
            if not price_data:
                raise RuntimeError("Failed to fetch price data and no cached price available")

        if isinstance(pool_state, Exception):
            logger.warning(f"Failed to fetch pool state: {pool_state}")
            pool_state = cached.pool_state if cached else None

        if isinstance(sentiment_data, Exception):
            logger.warning(f"Failed to fetch sentiment: {sentiment_data}")
            sentiment_data = None

        # Build market state
        market_state = MarketState(
            asset=asset,
            spot_price=price_data.price,
            pool_state=pool_state,
            timestamp=datetime.now(),
        )

        # Add sentiment if available
        if sentiment_data:
            market_state.sentiment = sentiment_data.get("sentiment")
            market_state.sentiment_confidence = sentiment_data.get("confidence", 0)
            market_state.upcoming_events = sentiment_data.get("upcoming_events", [])
            market_state.risk_factors = sentiment_data.get("risk_factors", [])
            market_state.position_bias = sentiment_data.get("position_bias")

        # Calculate divergence if TWAP available
        if market_state.twap_price:
            market_state.divergence_bps = int(
                ((market_state.spot_price - market_state.twap_price) / market_state.twap_price) * 10000
            )

        # Check for significant price move
        last_price = self._last_prices.get(asset)
        if last_price:
            price_change_pct = abs((price_data.price - last_price) / last_price) * 100
            if price_change_pct >= self.price_move_threshold:
                logger.warning(
                    f"Significant price move detected for {asset}: {price_change_pct:.2f}%"
                )

        # Update cache
        self._cache[asset] = market_state
        self._last_prices[asset] = price_data.price

        logger.success(
            f"Market state refreshed for {asset}: ${price_data.price:.2f}, "
            f"sentiment: {market_state.sentiment}, bias: {market_state.position_bias}"
        )

        return market_state

    async def _get_price_data(self, asset: str) -> PriceData:
        """Fetch current price from Pyth oracle.

        Args:
            asset: Asset ticker

        Returns:
            Price data from Pyth
        """
        asset_config = ASSETS[asset]
        feed_id = asset_config["pyth_feed"]

        # Query Pyth Hermes API
        url = f"{PYTH_HERMES_URL}/v2/updates/price/latest"
        params = {"ids[]": feed_id}

        try:
            response = await self.http_client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            if not data.get("parsed"):
                raise ValueError("No price data in response")

            price_feed = data["parsed"][0]["price"]

            # Parse price (Pyth uses price * 10^expo format)
            price = float(price_feed["price"]) * (10 ** price_feed["expo"])
            confidence = float(price_feed["conf"]) * (10 ** price_feed["expo"])
            publish_time = datetime.fromtimestamp(int(price_feed["publish_time"]))

            logger.debug(
                f"Pyth price for {asset}: ${price:.2f} "
                f"(±${confidence:.2f}, age: {(datetime.now() - publish_time).seconds}s)"
            )

            return PriceData(
                price=price,
                confidence=confidence,
                expo=price_feed["expo"],
                publish_time=publish_time,
            )

        except Exception as e:
            logger.error(f"Failed to fetch Pyth price for {asset}: {e}")
            raise

    async def _get_pool_state(self, asset: str) -> PoolState:
        """Fetch on-chain pool state from Euler vaults.

        Args:
            asset: Asset ticker

        Returns:
            Current pool state
        """
        asset_config = ASSETS[asset]
        vault_address = asset_config["vault_address"]
        hedging_vault = asset_config["hedging_vault"]

        try:
            # Fetch vault balance (total liquidity) from Euler vault
            account = self.web3.account.address
            vault_balance = await self.web3.call_contract_function(
                vault_address, EULER_VAULT_ABI, "balanceOf", account,
            )
            total_liquidity = float(vault_balance) / 1e6  # USDC decimals

            # Fetch position from hedging vault
            position = await self.web3.call_contract_function(
                hedging_vault, HEDGING_VAULT_ABI, "getPosition", account,
            )
            collateral = float(position[0]) / 1e6
            debt = float(position[1]) / 1e6
            is_long = position[2]

            # Fetch health score
            raw_hs = await self.web3.call_contract_function(
                hedging_vault, HEDGING_VAULT_ABI, "getHealthScore", account,
            )
            health_score = float(raw_hs) / 1e18

            net_long = collateral if is_long else 0.0
            net_short = collateral if not is_long else 0.0

            # Junior ratio estimated from collateral vs debt
            junior_ratio = max(0.0, (collateral - debt) / collateral) if collateral > 0 else 0.5

            logger.debug(f"Pool state for {asset}: liquidity=${total_liquidity:.2f}, HS={health_score:.3f}")

            return PoolState(
                net_exposure_long=net_long,
                net_exposure_short=net_short,
                junior_ratio=junior_ratio,
                total_liquidity_usdc=max(total_liquidity, 1.0),
                funding_rate_bps=500,  # TODO: fetch from contract when available
                health_score=health_score,
            )

        except Exception as e:
            logger.warning(f"Failed to fetch pool state for {asset}: {e}, using defaults")
            return PoolState(
                net_exposure_long=0.0,
                net_exposure_short=0.0,
                junior_ratio=0.5,
                total_liquidity_usdc=100000.0,
                funding_rate_bps=500,
                health_score=2.0,
            )

    async def _get_sentiment(self, asset: str) -> Optional[Dict[str, Any]]:
        """Get market sentiment from Tavily AI Search.

        Args:
            asset: Asset ticker

        Returns:
            Sentiment analysis data
        """
        # Map wSPYx -> SPY, wQQQx -> QQQ for better results
        ticker_map = {"wSPYx": "SPY", "wQQQx": "QQQ"}
        query_ticker = ticker_map.get(asset, asset)

        try:
            # Use Tavily to search for market analysis
            response = await self.tavily.analyze_market(
                asset=query_ticker,
                include_sentiment=True,
                include_technicals=True,
            )

            # Parse the Tavily response to extract sentiment
            content = response.content.lower()

            # Simple sentiment extraction from search results
            bullish_signals = ["bullish", "buy", "upgrade", "outperform", "positive", "rally", "gains"]
            bearish_signals = ["bearish", "sell", "downgrade", "underperform", "negative", "decline", "losses"]

            bullish_count = sum(1 for word in bullish_signals if word in content)
            bearish_count = sum(1 for word in bearish_signals if word in content)

            if bullish_count > bearish_count:
                sentiment = "bullish"
                confidence = min(70 + (bullish_count - bearish_count) * 5, 95)
                position_bias = "long"
            elif bearish_count > bullish_count:
                sentiment = "bearish"
                confidence = min(70 + (bearish_count - bullish_count) * 5, 95)
                position_bias = "short"
            else:
                sentiment = "neutral"
                confidence = 50
                position_bias = "neutral"

            # Extract events and risk factors from results
            upcoming_events = []
            risk_factors = []

            for result in response.results[:5]:
                title = result.title.lower()
                if any(word in title for word in ["fed", "fomc", "earnings", "jobs", "cpi", "gdp"]):
                    upcoming_events.append(result.title)
                if any(word in title for word in ["risk", "warning", "concern", "crash", "volatility"]):
                    risk_factors.append(result.title)

            data = {
                "sentiment": sentiment,
                "confidence": confidence,
                "upcoming_events": upcoming_events[:3],
                "risk_factors": risk_factors[:3],
                "position_bias": position_bias,
                "reasoning": response.answer if response.answer else "Based on recent market news and analysis",
                "sources": response.citations[:5],
            }

            logger.debug(f"Sentiment for {asset}: {sentiment} ({confidence}%)")
            return data

        except Exception as e:
            logger.error(f"Failed to get sentiment for {asset}: {e}")
            return None

    async def close(self):
        """Close HTTP client."""
        await self.http_client.aclose()
        logger.debug("Market intelligence client closed")

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()
