"""Perplexity AI client for market intelligence and analysis."""

import asyncio
from typing import Optional, List
from datetime import datetime, timedelta
import httpx
from pydantic import BaseModel, Field
from loguru import logger


class PerplexityResponse(BaseModel):
    """Structured response from Perplexity API."""

    content: str = Field(description="AI-generated response content")
    model: str = Field(description="Model used for generation")
    usage: dict = Field(default_factory=dict, description="Token usage statistics")
    citations: List[str] = Field(default_factory=list, description="Source citations")
    timestamp: datetime = Field(default_factory=datetime.now, description="Response timestamp")


class RateLimiter:
    """Token bucket rate limiter for API calls."""

    def __init__(self, max_requests: int, time_window: int):
        """Initialize rate limiter.

        Args:
            max_requests: Maximum number of requests allowed
            time_window: Time window in seconds
        """
        self.max_requests = max_requests
        self.time_window = time_window
        self.requests: List[datetime] = []
        self._lock = asyncio.Lock()

    async def acquire(self):
        """Acquire permission to make a request.

        Blocks if rate limit is exceeded until a slot becomes available.
        """
        async with self._lock:
            now = datetime.now()
            cutoff = now - timedelta(seconds=self.time_window)

            # Remove old requests outside the time window
            self.requests = [req_time for req_time in self.requests if req_time > cutoff]

            # Check if we're at the limit
            if len(self.requests) >= self.max_requests:
                # Calculate wait time until oldest request expires
                oldest = self.requests[0]
                wait_seconds = (oldest + timedelta(seconds=self.time_window) - now).total_seconds()

                if wait_seconds > 0:
                    logger.warning(f"Rate limit reached, waiting {wait_seconds:.1f}s")
                    await asyncio.sleep(wait_seconds)

                    # Recursively try again
                    return await self.acquire()

            # Add current request
            self.requests.append(now)


class PerplexityClient:
    """Async client for Perplexity AI API.

    Provides market intelligence and analysis with built-in rate limiting,
    retry logic, and response parsing.
    """

    API_URL = "https://api.perplexity.ai/chat/completions"

    def __init__(
        self,
        api_key: str,
        model: str = "llama-3.1-sonar-small-128k-online",
        max_requests_per_minute: int = 10,
        timeout: int = 30,
    ):
        """Initialize Perplexity client.

        Args:
            api_key: Perplexity API key
            model: Model to use for queries
            max_requests_per_minute: Rate limit for API calls
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

        # Setup rate limiter
        self.rate_limiter = RateLimiter(
            max_requests=max_requests_per_minute, time_window=60
        )

        # Setup HTTP client
        self.client = httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

        logger.info(
            f"Perplexity client initialized with model: {model}, "
            f"rate limit: {max_requests_per_minute}/min"
        )

    async def query(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> PerplexityResponse:
        """Query Perplexity AI for market intelligence.

        Args:
            prompt: User query/question
            system_prompt: Optional system prompt for context
            temperature: Sampling temperature (0-1)
            max_tokens: Maximum tokens in response

        Returns:
            PerplexityResponse with AI-generated content

        Raises:
            httpx.HTTPError: If API request fails after retries
        """
        # Wait for rate limit
        await self.rate_limiter.acquire()

        # Build messages
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        # Build request payload
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "return_citations": True,
            "return_images": False,
        }

        logger.debug(f"Querying Perplexity: {prompt[:100]}...")

        # Send request with retry logic
        response_data = await self._request_with_retry(payload)

        # Parse response
        return self._parse_response(response_data)

    async def analyze_market(
        self,
        asset: str,
        include_sentiment: bool = True,
        include_technicals: bool = True,
    ) -> PerplexityResponse:
        """Analyze market conditions for a specific asset.

        Args:
            asset: Asset ticker (e.g., "SPY", "QQQ")
            include_sentiment: Include sentiment analysis
            include_technicals: Include technical analysis

        Returns:
            Market analysis response
        """
        system_prompt = (
            "You are a financial market analyst providing concise, "
            "factual analysis for algorithmic trading decisions. "
            "Focus on recent data and quantifiable metrics."
        )

        sections = []
        if include_sentiment:
            sections.append("market sentiment")
        if include_technicals:
            sections.append("technical indicators")

        prompt = (
            f"Analyze current market conditions for {asset}. "
            f"Provide: {', '.join(sections)}, recent price action, "
            f"and key factors affecting price. "
            f"Keep response under 500 words."
        )

        return await self.query(prompt, system_prompt=system_prompt)

    async def get_trading_recommendation(
        self, asset: str, current_positions: List[dict]
    ) -> PerplexityResponse:
        """Get trading recommendation for an asset.

        Args:
            asset: Asset ticker
            current_positions: List of current open positions

        Returns:
            Trading recommendation response
        """
        system_prompt = (
            "You are a trading advisor for a leveraged trading algorithm. "
            "Provide clear directional recommendations (LONG, SHORT, or HOLD) "
            "with specific reasoning based on current market conditions."
        )

        positions_str = (
            f"Current positions: {len(current_positions)} open"
            if current_positions
            else "No current positions"
        )

        prompt = (
            f"Should we LONG, SHORT, or HOLD {asset} right now? "
            f"{positions_str}. "
            f"Consider: market momentum, volatility, risk factors. "
            f"Provide: 1) Recommendation, 2) Confidence (0-100%), "
            f"3) Key reasoning (2-3 points), 4) Risk level."
        )

        return await self.query(prompt, system_prompt=system_prompt, temperature=0.5)

    async def _request_with_retry(
        self, payload: dict, max_retries: int = 3
    ) -> dict:
        """Send request with exponential backoff retry.

        Args:
            payload: Request payload
            max_retries: Maximum retry attempts

        Returns:
            Response data dictionary

        Raises:
            httpx.HTTPError: If all retries fail
        """
        last_exception = None

        for attempt in range(max_retries):
            try:
                response = await self.client.post(self.API_URL, json=payload)
                response.raise_for_status()
                return response.json()

            except httpx.HTTPStatusError as e:
                last_exception = e
                status = e.response.status_code

                # Don't retry on client errors (except rate limit)
                if 400 <= status < 500 and status != 429:
                    logger.error(f"Client error {status}: {e.response.text}")
                    raise

                # Retry on server errors and rate limits
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt  # Exponential backoff
                    logger.warning(
                        f"Request failed (attempt {attempt + 1}/{max_retries}): {e}. "
                        f"Retrying in {wait_time}s..."
                    )
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"All {max_retries} attempts failed: {e}")

            except httpx.RequestError as e:
                last_exception = e
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt
                    logger.warning(
                        f"Request error (attempt {attempt + 1}/{max_retries}): {e}. "
                        f"Retrying in {wait_time}s..."
                    )
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"All {max_retries} attempts failed: {e}")

        raise last_exception

    def _parse_response(self, response_data: dict) -> PerplexityResponse:
        """Parse API response into structured format.

        Args:
            response_data: Raw API response

        Returns:
            Parsed PerplexityResponse
        """
        try:
            choices = response_data.get("choices", [])
            if not choices:
                raise ValueError("No choices in Perplexity response")
            content = choices[0]["message"]["content"]
            model = response_data.get("model", self.model)
            usage = response_data.get("usage", {})
            citations = response_data.get("citations", [])

            return PerplexityResponse(
                content=content,
                model=model,
                usage=usage,
                citations=citations,
            )

        except (KeyError, IndexError) as e:
            logger.error(f"Failed to parse response: {e}")
            raise ValueError(f"Invalid API response format: {response_data}")

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()
        logger.debug("Perplexity client closed")

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()
