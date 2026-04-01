"""Market intelligence module for data aggregation and analysis."""

import asyncio
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from decimal import Decimal
import httpx
from loguru import logger

from agent.intelligence.perplexity import PerplexityClient
from agent.execution.web3_client import Web3Client
from agent.contracts.addresses import CONTRACTS, PYTH_HERMES_URL, PYTH_FEEDS, ASSETS


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
    - Market sentiment from Perplexity AI

    Implements caching and automatic refresh logic.
    """

    def __init__(
        self,
        perplexity_client: PerplexityClient,
        web3_client: Web3Client,
        refresh_interval: int = 900,  # 15 minutes
        price_move_threshold_pct: float = 1.0,  # Force refresh on >1% move
    ):
        """Initialize market intelligence aggregator.

        Args:
            perplexity_client: Client for AI market analysis
            web3_client: Client for blockchain queries
            refresh_interval: Default refresh interval in seconds
            price_move_threshold_pct: Price move % to trigger immediate refresh
        """
        self.perplexity = perplexity_client
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
                raise price_data

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
        # TODO: Implement contract calls to fetch actual pool state
        # For now, return mock data
        # This requires:
        # 1. Load vault ABI
        # 2. Call vault contract methods
        # 3. Parse results

        logger.warning(f"Using mock pool state for {asset} - implement contract integration")

        return PoolState(
            net_exposure_long=50000.0,
            net_exposure_short=30000.0,
            junior_ratio=0.35,  # 35% junior LP
            total_liquidity_usdc=100000.0,
            funding_rate_bps=500,  # 5% annual
            health_score=1.6,
        )

    async def _get_sentiment(self, asset: str) -> Optional[Dict[str, Any]]:
        """Get market sentiment from Perplexity AI.

        Args:
            asset: Asset ticker

        Returns:
            Sentiment analysis data
        """
        # Map wSPYx -> SPY, wQQQx -> QQQ for better results
        ticker_map = {"wSPYx": "SPY", "wQQQx": "QQQ"}
        query_ticker = ticker_map.get(asset, asset)

        system_prompt = (
            "You are a market analyst for tokenized US equity assets (SP500, NASDAQ trackers). "
            "Provide concise, factual analysis for algorithmic trading decisions."
        )

        current_price = self._last_prices.get(asset, "unknown")

        prompt = f"""Analyze current market conditions for {query_ticker}.

Current data:
- Price: ${current_price}

Provide a JSON response with:
1. Current market sentiment (bullish/bearish/neutral) with confidence 0-100
2. Key events in next 24-48 hours affecting US equities
3. Risk factors that could cause >3% moves
4. Recommended position bias (long/short/neutral) with reasoning

Respond ONLY with valid JSON in this format:
{{
  "sentiment": "bullish|bearish|neutral",
  "confidence": 0-100,
  "upcoming_events": ["event1", "event2"],
  "risk_factors": ["risk1", "risk2"],
  "position_bias": "long|short|neutral",
  "reasoning": "brief explanation"
}}"""

        try:
            response = await self.perplexity.query(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.5,
                max_tokens=500,
            )

            # Parse JSON from response
            import json
            content = response.content.strip()

            # Try to extract JSON if wrapped in markdown
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()

            data = json.loads(content)
            logger.debug(f"Sentiment for {asset}: {data.get('sentiment')} ({data.get('confidence')}%)")

            return data

        except Exception as e:
            logger.error(f"Failed to parse sentiment for {asset}: {e}")
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
