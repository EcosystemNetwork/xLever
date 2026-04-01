"""Integration tests for Tavily AI Search client.

These tests make actual API calls to Tavily and should be:
- Marked with @pytest.mark.integration for selective execution
- Skipped if TAVILY_API_KEY is not set
"""

import pytest
import os
from unittest.mock import AsyncMock, Mock, patch

from agent.intelligence.tavily import TavilyClient, TavilyResponse, TavilySearchResult


@pytest.fixture
def skip_if_no_api_key():
    """Skip test if Tavily API key is not set."""
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key or api_key == "your_tavily_api_key_here":
        pytest.skip("TAVILY_API_KEY not set - skipping integration test")
    return api_key


@pytest.mark.integration
class TestTavilyClientInitialization:
    """Test Tavily client initialization."""

    def test_client_with_api_key(self):
        """Test client initialization with API key."""
        client = TavilyClient(api_key="test_key_123")

        assert client.api_key == "test_key_123"
        assert client.API_URL == "https://api.tavily.com/search"
        assert client.search_depth == "advanced"

    def test_client_custom_search_depth(self):
        """Test client initialization with custom search depth."""
        client = TavilyClient(
            api_key="test_key",
            search_depth="basic",
        )

        assert client.search_depth == "basic"

    def test_client_custom_timeout(self):
        """Test client initialization with custom timeout."""
        client = TavilyClient(
            api_key="test_key",
            timeout=60,
        )

        assert client.timeout == 60


@pytest.mark.integration
class TestTavilySearchMocked:
    """Test Tavily search with mocked responses."""

    @pytest.mark.asyncio
    async def test_search_success_response(self):
        """Test successful search response parsing."""
        client = TavilyClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.raise_for_status = Mock()
            mock_response.json.return_value = {
                "answer": "This is the AI-generated answer",
                "results": [
                    {
                        "title": "Test Result 1",
                        "url": "https://example.com/1",
                        "content": "Content snippet 1",
                        "score": 0.95,
                    },
                    {
                        "title": "Test Result 2",
                        "url": "https://example.com/2",
                        "content": "Content snippet 2",
                        "score": 0.85,
                    },
                ],
                "response_time": 1.5,
            }
            mock_post.return_value = mock_response

            response = await client.search(query="Test query")

            assert isinstance(response, TavilyResponse)
            assert response.answer == "This is the AI-generated answer"
            assert len(response.results) == 2
            assert response.results[0].title == "Test Result 1"
            assert response.results[0].score == 0.95
            assert response.response_time == 1.5

    @pytest.mark.asyncio
    async def test_search_with_domain_filters(self):
        """Test search with domain filtering."""
        client = TavilyClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.raise_for_status = Mock()
            mock_response.json.return_value = {
                "answer": "Response",
                "results": [],
                "response_time": 0.5,
            }
            mock_post.return_value = mock_response

            await client.search(
                query="Test",
                include_domains=["reuters.com", "bloomberg.com"],
                exclude_domains=["twitter.com"],
            )

            # Verify parameters were passed
            call_kwargs = mock_post.call_args[1]
            payload = call_kwargs["json"]

            assert payload["include_domains"] == ["reuters.com", "bloomberg.com"]
            assert payload["exclude_domains"] == ["twitter.com"]

    @pytest.mark.asyncio
    async def test_search_error_handling(self):
        """Test search error handling."""
        client = TavilyClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            import httpx
            mock_post.side_effect = httpx.HTTPStatusError(
                "API error",
                request=Mock(),
                response=Mock(status_code=400),
            )

            with pytest.raises(httpx.HTTPStatusError):
                await client.search(query="Test")

    @pytest.mark.asyncio
    async def test_query_compatibility_method(self):
        """Test query method for PerplexityClient compatibility."""
        client = TavilyClient(api_key="test_key")

        with patch.object(client, "search") as mock_search:
            mock_search.return_value = TavilyResponse(
                query="Test",
                answer="Answer",
                results=[],
            )

            response = await client.query(
                prompt="Test query",
                system_prompt="Ignored",
                temperature=0.7,
            )

            assert isinstance(response, TavilyResponse)
            mock_search.assert_called_once_with("Test query", include_answer=True)


@pytest.mark.integration
class TestTavilyLiveAPI:
    """Test Tavily API with live calls (requires API key)."""

    @pytest.mark.asyncio
    async def test_simple_search(self, skip_if_no_api_key):
        """Test simple search to Tavily API."""
        api_key = skip_if_no_api_key
        client = TavilyClient(api_key=api_key)

        response = await client.search(
            query="What is the S&P 500?",
            max_results=3,
        )

        assert isinstance(response, TavilyResponse)
        assert response.query == "What is the S&P 500?"
        assert len(response.results) > 0
        assert response.response_time > 0

        await client.close()

    @pytest.mark.asyncio
    async def test_market_analysis_search(self, skip_if_no_api_key):
        """Test market analysis method."""
        api_key = skip_if_no_api_key
        client = TavilyClient(api_key=api_key)

        response = await client.analyze_market(
            asset="SPY",
            include_sentiment=True,
            include_technicals=True,
        )

        assert isinstance(response, TavilyResponse)
        assert len(response.results) > 0

        # Check content property
        content = response.content
        assert len(content) > 0

        await client.close()

    @pytest.mark.asyncio
    async def test_trading_recommendation_search(self, skip_if_no_api_key):
        """Test trading recommendation method."""
        api_key = skip_if_no_api_key
        client = TavilyClient(api_key=api_key)

        response = await client.get_trading_recommendation(
            asset="QQQ",
            current_positions=[],
        )

        assert isinstance(response, TavilyResponse)
        assert len(response.results) > 0

        await client.close()

    @pytest.mark.asyncio
    async def test_market_news_search(self, skip_if_no_api_key):
        """Test market news search."""
        api_key = skip_if_no_api_key
        client = TavilyClient(api_key=api_key)

        response = await client.get_market_news(
            asset="SPY",
            hours_back=24,
        )

        assert isinstance(response, TavilyResponse)
        assert len(response.results) > 0

        await client.close()


@pytest.mark.integration
class TestTavilyResponseParsing:
    """Test Tavily response parsing utilities."""

    def test_parse_response_object(self):
        """Test parsing TavilyResponse object."""
        response = TavilyResponse(
            query="Test query",
            answer="Test answer",
            results=[
                TavilySearchResult(
                    title="Result 1",
                    url="https://example.com",
                    content="Content",
                    score=0.9,
                )
            ],
            response_time=1.0,
        )

        assert response.query == "Test query"
        assert response.answer == "Test answer"
        assert len(response.results) == 1
        assert response.results[0].title == "Result 1"

    def test_response_content_property_with_answer(self):
        """Test content property returns answer when available."""
        response = TavilyResponse(
            query="Test",
            answer="This is the answer",
            results=[
                TavilySearchResult(
                    title="Result",
                    url="https://example.com",
                    content="Content",
                    score=0.9,
                )
            ],
        )

        assert response.content == "This is the answer"

    def test_response_content_property_without_answer(self):
        """Test content property concatenates results when no answer."""
        response = TavilyResponse(
            query="Test",
            answer=None,
            results=[
                TavilySearchResult(
                    title="Result 1",
                    url="https://example.com/1",
                    content="Content 1",
                    score=0.9,
                ),
                TavilySearchResult(
                    title="Result 2",
                    url="https://example.com/2",
                    content="Content 2",
                    score=0.8,
                ),
            ],
        )

        content = response.content
        assert "Result 1" in content
        assert "Content 1" in content
        assert "Result 2" in content

    def test_response_citations_property(self):
        """Test citations property returns URLs."""
        response = TavilyResponse(
            query="Test",
            results=[
                TavilySearchResult(
                    title="Result 1",
                    url="https://example.com/1",
                    content="Content",
                    score=0.9,
                ),
                TavilySearchResult(
                    title="Result 2",
                    url="https://example.com/2",
                    content="Content",
                    score=0.8,
                ),
            ],
        )

        assert response.citations == [
            "https://example.com/1",
            "https://example.com/2",
        ]


@pytest.mark.integration
class TestTavilyContextManager:
    """Test Tavily client context manager."""

    @pytest.mark.asyncio
    async def test_context_manager_usage(self):
        """Test using client as async context manager."""
        async with TavilyClient(api_key="test_key") as client:
            assert client is not None
            assert hasattr(client, "search")
            assert hasattr(client, "query")

    @pytest.mark.asyncio
    async def test_context_manager_cleanup(self):
        """Test context manager cleanup."""
        client = TavilyClient(api_key="test_key")

        async with client:
            pass

        # Client should have cleaned up resources


@pytest.mark.integration
class TestTavilyErrorScenarios:
    """Test various error scenarios."""

    @pytest.mark.asyncio
    async def test_invalid_api_key(self):
        """Test handling of invalid API key."""
        client = TavilyClient(api_key="invalid_key_12345")

        with patch.object(client.client, "post") as mock_post:
            import httpx
            mock_response = Mock()
            mock_response.status_code = 401
            mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
                "Unauthorized",
                request=Mock(),
                response=mock_response,
            )
            mock_post.return_value = mock_response

            with pytest.raises(httpx.HTTPStatusError):
                await client.search(query="Test")

    @pytest.mark.asyncio
    async def test_malformed_response(self):
        """Test handling of malformed API response."""
        client = TavilyClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.raise_for_status = Mock()
            mock_response.json.return_value = {
                "invalid": "structure",
            }
            mock_post.return_value = mock_response

            # Should handle gracefully
            response = await client.search(query="Test")
            assert isinstance(response, TavilyResponse)
            assert len(response.results) == 0

    @pytest.mark.asyncio
    async def test_network_error(self):
        """Test handling of network errors."""
        client = TavilyClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            import httpx
            mock_post.side_effect = httpx.NetworkError("Connection failed")

            with pytest.raises(httpx.NetworkError):
                await client.search(query="Test")

    @pytest.mark.asyncio
    async def test_timeout_error(self):
        """Test handling of timeout errors."""
        client = TavilyClient(api_key="test_key", timeout=1)

        with patch.object(client.client, "post") as mock_post:
            import httpx
            mock_post.side_effect = httpx.TimeoutException("Request timeout")

            with pytest.raises(httpx.TimeoutException):
                await client.search(query="Test")
