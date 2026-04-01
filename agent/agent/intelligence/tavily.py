"""Tavily AI Search client for market intelligence and analysis."""

import asyncio
from typing import Optional, List
from datetime import datetime, timedelta
import httpx
from pydantic import BaseModel, Field
from loguru import logger


class TavilySearchResult(BaseModel):
    """Individual search result from Tavily."""

    title: str = Field(description="Result title")
    url: str = Field(description="Source URL")
    content: str = Field(description="Snippet/content from the result")
    score: float = Field(default=0.0, description="Relevance score")
    published_date: Optional[str] = Field(default=None, description="Publication date if available")


class TavilyResponse(BaseModel):
    """Structured response from Tavily API."""

    query: str = Field(description="Original search query")
    answer: Optional[str] = Field(default=None, description="AI-generated answer summary")
    results: List[TavilySearchResult] = Field(default_factory=list, description="Search results")
    response_time: float = Field(default=0.0, description="API response time in seconds")
    timestamp: datetime = Field(default_factory=datetime.now, description="Response timestamp")

    @property
    def content(self) -> str:
        """Get the main content (answer or concatenated results)."""
        if self.answer:
            return self.answer
        return "\n\n".join([f"**{r.title}**\n{r.content}" for r in self.results[:5]])

    @property
    def citations(self) -> List[str]:
        """Get source URLs as citations."""
        return [r.url for r in self.results]


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


class TavilyClient:
    """Async client for Tavily AI Search API.

    Provides market intelligence and analysis with built-in rate limiting,
    retry logic, and response parsing.
    """

    API_URL = "https://api.tavily.com/search"

    def __init__(
        self,
        api_key: str,
        max_requests_per_minute: int = 20,
        timeout: int = 30,
        search_depth: str = "advanced",
    ):
        """Initialize Tavily client.

        Args:
            api_key: Tavily API key
            max_requests_per_minute: Rate limit for API calls
            timeout: Request timeout in seconds
            search_depth: Search depth - "basic" or "advanced"
        """
        self.api_key = api_key
        self.timeout = timeout
        self.search_depth = search_depth

        # Setup rate limiter
        self.rate_limiter = RateLimiter(
            max_requests=max_requests_per_minute, time_window=60
        )

        # Setup HTTP client
        self.client = httpx.AsyncClient(
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )

        logger.info(
            f"Tavily client initialized with search_depth: {search_depth}, "
            f"rate limit: {max_requests_per_minute}/min"
        )

    async def search(
        self,
        query: str,
        include_answer: bool = True,
        include_domains: Optional[List[str]] = None,
        exclude_domains: Optional[List[str]] = None,
        max_results: int = 5,
    ) -> TavilyResponse:
        """Search using Tavily AI.

        Args:
            query: Search query
            include_answer: Include AI-generated answer summary
            include_domains: Only include results from these domains
            exclude_domains: Exclude results from these domains
            max_results: Maximum number of results to return

        Returns:
            TavilyResponse with search results

        Raises:
            httpx.HTTPError: If API request fails after retries
        """
        # Wait for rate limit
        await self.rate_limiter.acquire()

        # Build request payload
        payload = {
            "api_key": self.api_key,
            "query": query,
            "search_depth": self.search_depth,
            "include_answer": include_answer,
            "include_raw_content": False,
            "max_results": max_results,
        }

        if include_domains:
            payload["include_domains"] = include_domains
        if exclude_domains:
            payload["exclude_domains"] = exclude_domains

        logger.debug(f"Searching Tavily: {query[:100]}...")

        # Send request with retry logic
        response_data = await self._request_with_retry(payload)

        # Parse response
        return self._parse_response(query, response_data)

    async def query(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> TavilyResponse:
        """Query Tavily for market intelligence (compatibility method).

        This method provides compatibility with the PerplexityClient interface.

        Args:
            prompt: Search query/question
            system_prompt: Ignored (for compatibility)
            temperature: Ignored (for compatibility)
            max_tokens: Ignored (for compatibility)

        Returns:
            TavilyResponse with search results
        """
        return await self.search(prompt, include_answer=True)

    async def analyze_market(
        self,
        asset: str,
        include_sentiment: bool = True,
        include_technicals: bool = True,
    ) -> TavilyResponse:
        """Analyze market conditions for a specific asset.

        Args:
            asset: Asset ticker (e.g., "SPY", "QQQ")
            include_sentiment: Include sentiment analysis
            include_technicals: Include technical analysis

        Returns:
            Market analysis response
        """
        sections = []
        if include_sentiment:
            sections.append("sentiment")
        if include_technicals:
            sections.append("technical analysis")

        query = (
            f"{asset} stock market analysis {' '.join(sections)} "
            f"price forecast outlook today {datetime.now().strftime('%Y-%m-%d')}"
        )

        # Focus on financial news sources
        return await self.search(
            query,
            include_answer=True,
            include_domains=[
                "reuters.com",
                "bloomberg.com",
                "cnbc.com",
                "marketwatch.com",
                "finance.yahoo.com",
                "seekingalpha.com",
                "investopedia.com",
            ],
            max_results=7,
        )

    async def get_trading_recommendation(
        self, asset: str, current_positions: List[dict]
    ) -> TavilyResponse:
        """Get trading recommendation for an asset.

        Args:
            asset: Asset ticker
            current_positions: List of current open positions

        Returns:
            Trading recommendation response
        """
        query = (
            f"{asset} stock buy sell hold recommendation analyst rating "
            f"price target {datetime.now().strftime('%B %Y')}"
        )

        return await self.search(
            query,
            include_answer=True,
            include_domains=[
                "tipranks.com",
                "zacks.com",
                "thestreet.com",
                "fool.com",
                "barrons.com",
                "investors.com",
            ],
            max_results=5,
        )

    async def get_market_news(
        self, asset: str, hours_back: int = 24
    ) -> TavilyResponse:
        """Get recent market news for an asset.

        Args:
            asset: Asset ticker
            hours_back: How many hours back to search

        Returns:
            Recent news response
        """
        query = f"{asset} stock news latest breaking {datetime.now().strftime('%Y-%m-%d')}"

        return await self.search(
            query,
            include_answer=True,
            max_results=10,
        )

    async def get_economic_events(self) -> TavilyResponse:
        """Get upcoming economic events and calendar.

        Returns:
            Economic events response
        """
        query = (
            f"economic calendar events this week fed fomc "
            f"earnings reports {datetime.now().strftime('%B %Y')}"
        )

        return await self.search(
            query,
            include_answer=True,
            include_domains=[
                "forexfactory.com",
                "investing.com",
                "tradingeconomics.com",
                "earningswhispers.com",
            ],
            max_results=5,
        )

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

    def _parse_response(self, query: str, response_data: dict) -> TavilyResponse:
        """Parse API response into structured format.

        Args:
            query: Original search query
            response_data: Raw API response

        Returns:
            Parsed TavilyResponse
        """
        try:
            results = [
                TavilySearchResult(
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("content", ""),
                    score=r.get("score", 0.0),
                    published_date=r.get("published_date"),
                )
                for r in response_data.get("results", [])
            ]

            return TavilyResponse(
                query=query,
                answer=response_data.get("answer"),
                results=results,
                response_time=response_data.get("response_time", 0.0),
            )

        except (KeyError, TypeError) as e:
            logger.error(f"Failed to parse response: {e}")
            raise ValueError(f"Invalid API response format: {response_data}")

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()
        logger.debug("Tavily client closed")

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()
