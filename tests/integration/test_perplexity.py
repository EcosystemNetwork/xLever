"""Integration tests for Perplexity AI client.

These tests make actual API calls to Perplexity and should be:
- Marked with @pytest.mark.integration for selective execution
- Skipped if PERPLEXITY_API_KEY is not set
"""

import pytest
import os
from unittest.mock import AsyncMock, Mock, patch

from agent.intelligence.perplexity import PerplexityClient, PerplexityResponse


@pytest.fixture
def skip_if_no_api_key():
    """Skip test if Perplexity API key is not set."""
    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key or api_key == "your_perplexity_api_key_here":
        pytest.skip("PERPLEXITY_API_KEY not set - skipping integration test")
    return api_key


@pytest.mark.integration
class TestPerplexityClientInitialization:
    """Test Perplexity client initialization."""

    def test_client_with_api_key(self):
        """Test client initialization with API key."""
        client = PerplexityClient(api_key="test_key_123")

        assert client.api_key == "test_key_123"
        assert client.base_url == "https://api.perplexity.ai"
        assert client.default_model.startswith("llama")

    def test_client_custom_model(self):
        """Test client initialization with custom model."""
        client = PerplexityClient(
            api_key="test_key",
            model="sonar-pro",
        )

        assert client.default_model == "sonar-pro"

    def test_client_custom_timeout(self):
        """Test client initialization with custom timeout."""
        client = PerplexityClient(
            api_key="test_key",
            timeout=60.0,
        )

        assert client.timeout == 60.0


@pytest.mark.integration
class TestPerplexityQueryMocked:
    """Test Perplexity query with mocked responses."""

    @pytest.mark.asyncio
    async def test_query_success_response(self):
        """Test successful query response parsing."""
        client = PerplexityClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [
                    {
                        "message": {
                            "content": "This is the response content",
                            "role": "assistant",
                        }
                    }
                ],
                "model": "llama-3.1-sonar-large-128k-online",
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150,
                },
            }
            mock_post.return_value = mock_response

            response = await client.query(
                prompt="Test query",
                system_prompt="You are a helpful assistant",
            )

            assert isinstance(response, PerplexityResponse)
            assert response.content == "This is the response content"
            assert response.model == "llama-3.1-sonar-large-128k-online"
            assert response.usage["prompt_tokens"] == 100
            assert response.usage["completion_tokens"] == 50

    @pytest.mark.asyncio
    async def test_query_with_parameters(self):
        """Test query with custom parameters."""
        client = PerplexityClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": "Response", "role": "assistant"}}],
                "model": "test-model",
                "usage": {},
            }
            mock_post.return_value = mock_response

            await client.query(
                prompt="Test",
                temperature=0.8,
                max_tokens=500,
                top_p=0.9,
            )

            # Verify parameters were passed
            call_kwargs = mock_post.call_args[1]
            payload = call_kwargs["json"]

            assert payload["temperature"] == 0.8
            assert payload["max_tokens"] == 500
            assert payload["top_p"] == 0.9

    @pytest.mark.asyncio
    async def test_query_error_handling(self):
        """Test query error handling."""
        client = PerplexityClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            # Mock error response
            mock_response = Mock()
            mock_response.status_code = 400
            mock_response.raise_for_status.side_effect = Exception("API error")
            mock_post.return_value = mock_response

            with pytest.raises(Exception, match="API error"):
                await client.query(prompt="Test")

    @pytest.mark.asyncio
    async def test_query_timeout_handling(self):
        """Test query timeout handling."""
        client = PerplexityClient(api_key="test_key", timeout=1.0)

        with patch.object(client.client, "post") as mock_post:
            # Mock timeout
            import httpx

            mock_post.side_effect = httpx.TimeoutException("Request timeout")

            with pytest.raises(httpx.TimeoutException):
                await client.query(prompt="Test")

    @pytest.mark.asyncio
    async def test_query_rate_limit_handling(self):
        """Test rate limit error handling."""
        client = PerplexityClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            # Mock rate limit response
            mock_response = Mock()
            mock_response.status_code = 429
            mock_response.json.return_value = {"error": "Rate limit exceeded"}
            mock_response.raise_for_status.side_effect = Exception("Rate limit")
            mock_post.return_value = mock_response

            with pytest.raises(Exception, match="Rate limit"):
                await client.query(prompt="Test")


@pytest.mark.integration
class TestPerplexityLiveAPI:
    """Test Perplexity API with live calls (requires API key)."""

    @pytest.mark.asyncio
    async def test_simple_query(self, skip_if_no_api_key):
        """Test simple query to Perplexity API."""
        api_key = skip_if_no_api_key
        client = PerplexityClient(api_key=api_key)

        response = await client.query(
            prompt="What is 2 + 2?",
            system_prompt="You are a helpful math assistant. Answer concisely.",
            max_tokens=50,
        )

        assert isinstance(response, PerplexityResponse)
        assert len(response.content) > 0
        assert response.model is not None
        assert response.usage["prompt_tokens"] > 0
        assert response.usage["completion_tokens"] > 0

    @pytest.mark.asyncio
    async def test_json_response_query(self, skip_if_no_api_key):
        """Test query requesting JSON response."""
        api_key = skip_if_no_api_key
        client = PerplexityClient(api_key=api_key)

        response = await client.query(
            prompt='Return a JSON object with "answer": 4',
            system_prompt="You respond only with valid JSON.",
            max_tokens=100,
            temperature=0.1,
        )

        assert isinstance(response, PerplexityResponse)
        assert len(response.content) > 0

        # Try to parse as JSON
        import json

        try:
            # Extract JSON if wrapped in markdown
            content = response.content.strip()
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()

            data = json.loads(content)
            assert "answer" in data or isinstance(data, dict)
        except json.JSONDecodeError:
            # Some models may not return pure JSON
            assert "{" in response.content or "[" in response.content

    @pytest.mark.asyncio
    async def test_market_sentiment_query(self, skip_if_no_api_key):
        """Test market sentiment analysis query."""
        api_key = skip_if_no_api_key
        client = PerplexityClient(api_key=api_key)

        response = await client.query(
            prompt="What is the current market sentiment for the S&P 500? Respond with: bullish, bearish, or neutral.",
            system_prompt="You are a financial market analyst. Be concise.",
            max_tokens=200,
            temperature=0.5,
        )

        assert isinstance(response, PerplexityResponse)
        assert len(response.content) > 0

        # Check if response contains sentiment keywords
        content_lower = response.content.lower()
        has_sentiment = any(
            word in content_lower for word in ["bullish", "bearish", "neutral"]
        )
        assert has_sentiment, "Response should contain sentiment"

    @pytest.mark.asyncio
    async def test_trading_decision_query(self, skip_if_no_api_key):
        """Test trading decision analysis query."""
        api_key = skip_if_no_api_key
        client = PerplexityClient(api_key=api_key)

        prompt = """Analyze this market condition and provide a trading decision:
Asset: SPY
Price: $450
24h Change: +1.5%
Sentiment: Bullish

Respond with JSON:
{
    "action": "OPEN_LONG|OPEN_SHORT|HOLD",
    "confidence": 0-100,
    "reasoning": "brief explanation"
}"""

        response = await client.query(
            prompt=prompt,
            system_prompt="You are a trading agent. Respond only with valid JSON.",
            max_tokens=300,
            temperature=0.7,
        )

        assert isinstance(response, PerplexityResponse)
        assert len(response.content) > 0

        # Response should contain JSON-like structure
        content = response.content
        assert "{" in content
        assert "action" in content.lower() or "reasoning" in content.lower()


@pytest.mark.integration
class TestPerplexityResponseParsing:
    """Test Perplexity response parsing utilities."""

    def test_parse_response_object(self):
        """Test parsing PerplexityResponse object."""
        response = PerplexityResponse(
            content="Test content",
            model="test-model",
            usage={"prompt_tokens": 10, "completion_tokens": 20},
        )

        assert response.content == "Test content"
        assert response.model == "test-model"
        assert response.usage["prompt_tokens"] == 10
        assert response.usage["completion_tokens"] == 20

    def test_response_total_tokens(self):
        """Test calculating total tokens."""
        response = PerplexityResponse(
            content="Test",
            model="test-model",
            usage={"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        )

        assert response.usage["total_tokens"] == 150

    def test_response_empty_usage(self):
        """Test response with empty usage."""
        response = PerplexityResponse(
            content="Test",
            model="test-model",
            usage={},
        )

        assert isinstance(response.usage, dict)
        assert len(response.usage) == 0


@pytest.mark.integration
class TestPerplexityContextManager:
    """Test Perplexity client context manager."""

    @pytest.mark.asyncio
    async def test_context_manager_usage(self):
        """Test using client as async context manager."""
        async with PerplexityClient(api_key="test_key") as client:
            assert client is not None
            assert hasattr(client, "query")

    @pytest.mark.asyncio
    async def test_context_manager_cleanup(self):
        """Test context manager cleanup."""
        client = PerplexityClient(api_key="test_key")

        async with client:
            pass

        # Client should have cleaned up resources
        # (httpx client is closed)


@pytest.mark.integration
class TestPerplexityModelSelection:
    """Test different Perplexity model selections."""

    @pytest.mark.asyncio
    async def test_sonar_model(self):
        """Test using Sonar model."""
        client = PerplexityClient(
            api_key="test_key",
            model="llama-3.1-sonar-large-128k-online",
        )

        with patch.object(client.client, "post") as mock_post:
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": "Test", "role": "assistant"}}],
                "model": "llama-3.1-sonar-large-128k-online",
                "usage": {},
            }
            mock_post.return_value = mock_response

            await client.query(prompt="Test")

            # Verify model was used
            payload = mock_post.call_args[1]["json"]
            assert payload["model"] == "llama-3.1-sonar-large-128k-online"

    @pytest.mark.asyncio
    async def test_model_override_in_query(self):
        """Test overriding model in individual query."""
        client = PerplexityClient(api_key="test_key", model="default-model")

        with patch.object(client.client, "post") as mock_post:
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": "Test", "role": "assistant"}}],
                "model": "override-model",
                "usage": {},
            }
            mock_post.return_value = mock_response

            await client.query(prompt="Test", model="override-model")

            # Verify overridden model was used
            payload = mock_post.call_args[1]["json"]
            assert payload["model"] == "override-model"


@pytest.mark.integration
class TestPerplexityErrorScenarios:
    """Test various error scenarios."""

    @pytest.mark.asyncio
    async def test_invalid_api_key(self):
        """Test handling of invalid API key."""
        client = PerplexityClient(api_key="invalid_key_12345")

        with patch.object(client.client, "post") as mock_post:
            mock_response = Mock()
            mock_response.status_code = 401
            mock_response.json.return_value = {"error": "Invalid API key"}
            mock_response.raise_for_status.side_effect = Exception("Unauthorized")
            mock_post.return_value = mock_response

            with pytest.raises(Exception, match="Unauthorized"):
                await client.query(prompt="Test")

    @pytest.mark.asyncio
    async def test_malformed_response(self):
        """Test handling of malformed API response."""
        client = PerplexityClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "invalid": "structure",
                # Missing required fields
            }
            mock_post.return_value = mock_response

            with pytest.raises(KeyError):
                await client.query(prompt="Test")

    @pytest.mark.asyncio
    async def test_empty_response_content(self):
        """Test handling of empty response content."""
        client = PerplexityClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": "", "role": "assistant"}}],
                "model": "test-model",
                "usage": {},
            }
            mock_post.return_value = mock_response

            response = await client.query(prompt="Test")

            # Should still return valid response even if content is empty
            assert isinstance(response, PerplexityResponse)
            assert response.content == ""

    @pytest.mark.asyncio
    async def test_network_error(self):
        """Test handling of network errors."""
        client = PerplexityClient(api_key="test_key")

        with patch.object(client.client, "post") as mock_post:
            import httpx

            mock_post.side_effect = httpx.NetworkError("Connection failed")

            with pytest.raises(httpx.NetworkError):
                await client.query(prompt="Test")
