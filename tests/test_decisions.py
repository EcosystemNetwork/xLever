"""Unit tests for LLM decision parsing and strategy."""

import pytest
from unittest.mock import AsyncMock, Mock

from agent.strategy.llm_strategy import (
    LLMStrategy,
    TradingDecision,
    DecisionAction,
    Urgency,
)
from agent.intelligence.perplexity import PerplexityResponse
from agent.intelligence.market import MarketState


class TestDecisionParsing:
    """Test decision parsing from LLM responses."""

    def test_parse_valid_json(self, sample_market_state):
        """Test parsing valid JSON response."""
        strategy = LLMStrategy(perplexity_client=Mock())

        json_response = '''{
            "action": "OPEN_LONG",
            "leverage_bps": 25000,
            "size_usdc": 1000.0,
            "confidence": 80,
            "reasoning": "Strong bullish momentum",
            "urgency": "medium"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")

        assert decision.parse_success
        assert decision.action == DecisionAction.OPEN_LONG
        assert decision.leverage_bps == 25000
        assert decision.size_usdc == 1000.0
        assert decision.confidence == 80
        assert decision.reasoning == "Strong bullish momentum"
        assert decision.urgency == Urgency.MEDIUM

    def test_parse_json_with_markdown(self, sample_market_state):
        """Test parsing JSON wrapped in markdown code blocks."""
        strategy = LLMStrategy(perplexity_client=Mock())

        markdown_response = '''```json
{
    "action": "OPEN_SHORT",
    "leverage_bps": 20000,
    "size_usdc": 500.0,
    "confidence": 70,
    "reasoning": "Bearish technicals",
    "urgency": "low"
}
```'''

        decision = strategy._parse_response(markdown_response, "wQQQx")

        assert decision.parse_success
        assert decision.action == DecisionAction.OPEN_SHORT
        assert decision.leverage_bps == 20000

    def test_parse_hold_decision(self):
        """Test parsing HOLD decision."""
        strategy = LLMStrategy(perplexity_client=Mock())

        json_response = '''{
            "action": "HOLD",
            "confidence": 50,
            "reasoning": "Insufficient signal strength",
            "urgency": "low"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")

        assert decision.parse_success
        assert decision.action == DecisionAction.HOLD
        assert decision.leverage_bps is None
        assert decision.size_usdc is None

    def test_parse_close_decision(self):
        """Test parsing CLOSE decision."""
        strategy = LLMStrategy(perplexity_client=Mock())

        json_response = '''{
            "action": "CLOSE",
            "confidence": 90,
            "reasoning": "Take profit target reached",
            "urgency": "high"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")

        assert decision.parse_success
        assert decision.action == DecisionAction.CLOSE
        assert decision.urgency == Urgency.HIGH

    def test_parse_adjust_leverage_decision(self):
        """Test parsing ADJUST_LEVERAGE decision."""
        strategy = LLMStrategy(perplexity_client=Mock())

        json_response = '''{
            "action": "ADJUST_LEVERAGE",
            "leverage_bps": 15000,
            "confidence": 65,
            "reasoning": "Reducing exposure due to volatility",
            "urgency": "medium"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")

        assert decision.parse_success
        assert decision.action == DecisionAction.ADJUST_LEVERAGE
        assert decision.leverage_bps == 15000

    def test_parse_invalid_action_defaults_to_hold(self):
        """Test invalid action defaults to HOLD."""
        strategy = LLMStrategy(perplexity_client=Mock())

        json_response = '''{
            "action": "INVALID_ACTION",
            "confidence": 50,
            "reasoning": "Test",
            "urgency": "low"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")

        assert decision.parse_success
        assert decision.action == DecisionAction.HOLD

    def test_parse_invalid_urgency_defaults_to_low(self):
        """Test invalid urgency defaults to LOW."""
        strategy = LLMStrategy(perplexity_client=Mock())

        json_response = '''{
            "action": "HOLD",
            "confidence": 50,
            "reasoning": "Test",
            "urgency": "invalid"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")

        assert decision.parse_success
        assert decision.urgency == Urgency.LOW

    def test_parse_leverage_bounds(self):
        """Test leverage is bounded to valid range."""
        strategy = LLMStrategy(perplexity_client=Mock())

        # Test leverage too high
        json_response = '''{
            "action": "OPEN_LONG",
            "leverage_bps": 100000,
            "size_usdc": 1000.0,
            "confidence": 80,
            "reasoning": "Test",
            "urgency": "medium"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")
        assert decision.leverage_bps == 40000  # Capped at MAX_LEVERAGE_BPS

        # Test leverage too low
        json_response = '''{
            "action": "OPEN_LONG",
            "leverage_bps": 5000,
            "size_usdc": 1000.0,
            "confidence": 80,
            "reasoning": "Test",
            "urgency": "medium"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")
        assert decision.leverage_bps == 10000  # Raised to MIN_LEVERAGE_BPS

    def test_parse_confidence_bounds(self):
        """Test confidence is bounded to 0-100."""
        strategy = LLMStrategy(perplexity_client=Mock())

        # Test confidence too high
        json_response = '''{
            "action": "HOLD",
            "confidence": 150,
            "reasoning": "Test",
            "urgency": "low"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")
        assert decision.confidence == 100

        # Test confidence too low
        json_response = '''{
            "action": "HOLD",
            "confidence": -20,
            "reasoning": "Test",
            "urgency": "low"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")
        assert decision.confidence == 0

    def test_parse_malformed_json_creates_fallback(self):
        """Test malformed JSON creates fallback HOLD decision."""
        strategy = LLMStrategy(perplexity_client=Mock())

        malformed_response = "This is not valid JSON {action: broken}"

        decision = strategy._parse_response(malformed_response, "wSPYx")

        assert not decision.parse_success
        assert decision.action == DecisionAction.HOLD
        assert decision.confidence == 0
        assert "Fallback" in decision.reasoning

    def test_parse_empty_response_creates_fallback(self):
        """Test empty response creates fallback."""
        strategy = LLMStrategy(perplexity_client=Mock())

        decision = strategy._parse_response("", "wSPYx")

        assert not decision.parse_success
        assert decision.action == DecisionAction.HOLD

    def test_parse_missing_required_fields(self):
        """Test parsing with missing required fields uses defaults."""
        strategy = LLMStrategy(perplexity_client=Mock())

        json_response = '''{
            "action": "OPEN_LONG"
        }'''

        decision = strategy._parse_response(json_response, "wSPYx")

        assert decision.parse_success
        assert decision.action == DecisionAction.OPEN_LONG
        assert decision.confidence == 50  # Default
        assert decision.urgency == Urgency.LOW  # Default

    def test_extract_json_direct(self):
        """Test extracting JSON from direct response."""
        strategy = LLMStrategy(perplexity_client=Mock())

        json_str = '{"action": "HOLD", "confidence": 50}'
        extracted = strategy._extract_json(json_str)

        assert extracted is not None
        assert extracted["action"] == "HOLD"

    def test_extract_json_from_markdown(self):
        """Test extracting JSON from markdown blocks."""
        strategy = LLMStrategy(perplexity_client=Mock())

        markdown = '''Here is the decision:
```json
{"action": "HOLD", "confidence": 50}
```
'''

        extracted = strategy._extract_json(markdown)

        assert extracted is not None
        assert extracted["action"] == "HOLD"

    def test_extract_json_from_generic_code_block(self):
        """Test extracting JSON from generic code blocks."""
        strategy = LLMStrategy(perplexity_client=Mock())

        code_block = '''```
{"action": "HOLD", "confidence": 50}
```'''

        extracted = strategy._extract_json(code_block)

        assert extracted is not None
        assert extracted["action"] == "HOLD"


class TestLLMStrategy:
    """Test LLMStrategy decision generation."""

    @pytest.mark.asyncio
    async def test_decide_successful_call(self, mock_perplexity_client, sample_market_state):
        """Test successful decision generation."""
        # Mock response
        mock_perplexity_client.query.return_value = PerplexityResponse(
            content='{"action": "OPEN_LONG", "leverage_bps": 25000, "size_usdc": 1000.0, "confidence": 80, "reasoning": "Bullish", "urgency": "medium"}',
            model="test-model",
            usage={"prompt_tokens": 100, "completion_tokens": 50},
        )

        strategy = LLMStrategy(perplexity_client=mock_perplexity_client)

        decision = await strategy.decide(
            market_state=sample_market_state,
            current_position=None,
            available_capital_usdc=10000.0,
        )

        assert decision.parse_success
        assert decision.action == DecisionAction.OPEN_LONG
        assert decision.confidence == 80
        assert mock_perplexity_client.query.called

    @pytest.mark.asyncio
    async def test_decide_with_current_position(self, mock_perplexity_client, sample_market_state, sample_position_long):
        """Test decision generation with active position."""
        mock_perplexity_client.query.return_value = PerplexityResponse(
            content='{"action": "CLOSE", "confidence": 85, "reasoning": "Taking profit", "urgency": "high"}',
            model="test-model",
            usage={"prompt_tokens": 100, "completion_tokens": 50},
        )

        strategy = LLMStrategy(perplexity_client=mock_perplexity_client)

        decision = await strategy.decide(
            market_state=sample_market_state,
            current_position=sample_position_long,
            available_capital_usdc=10000.0,
        )

        assert decision.parse_success
        assert decision.action == DecisionAction.CLOSE

    @pytest.mark.asyncio
    async def test_decide_fallback_on_parse_failure(self, mock_perplexity_client, sample_market_state):
        """Test fallback to HOLD on repeated parse failures."""
        # Mock malformed response
        mock_perplexity_client.query.return_value = PerplexityResponse(
            content="This is not JSON",
            model="test-model",
            usage={"prompt_tokens": 100, "completion_tokens": 50},
        )

        strategy = LLMStrategy(perplexity_client=mock_perplexity_client, max_retries=2)

        decision = await strategy.decide(
            market_state=sample_market_state,
            current_position=None,
            available_capital_usdc=10000.0,
        )

        # Should fallback to conservative HOLD
        assert not decision.parse_success
        assert decision.action == DecisionAction.HOLD
        assert decision.confidence == 0
        assert "Fallback" in decision.reasoning

    @pytest.mark.asyncio
    async def test_decide_fallback_on_exception(self, mock_perplexity_client, sample_market_state):
        """Test fallback to HOLD on LLM query exception."""
        # Mock exception
        mock_perplexity_client.query.side_effect = Exception("API error")

        strategy = LLMStrategy(perplexity_client=mock_perplexity_client, max_retries=1)

        decision = await strategy.decide(
            market_state=sample_market_state,
            current_position=None,
            available_capital_usdc=10000.0,
        )

        # Should fallback to conservative HOLD
        assert not decision.parse_success
        assert decision.action == DecisionAction.HOLD
        assert "failed" in decision.reasoning.lower()

    @pytest.mark.asyncio
    async def test_decide_retry_on_parse_failure(self, mock_perplexity_client, sample_market_state):
        """Test retry logic on parse failure."""
        # First call returns bad JSON, second call succeeds
        mock_perplexity_client.query.side_effect = [
            PerplexityResponse(content="bad json", model="test-model", usage={}),
            PerplexityResponse(
                content='{"action": "HOLD", "confidence": 50, "reasoning": "Retry worked", "urgency": "low"}',
                model="test-model",
                usage={},
            ),
        ]

        strategy = LLMStrategy(perplexity_client=mock_perplexity_client, max_retries=3)

        decision = await strategy.decide(
            market_state=sample_market_state,
            current_position=None,
            available_capital_usdc=10000.0,
        )

        # Should succeed on retry
        assert decision.parse_success
        assert decision.action == DecisionAction.HOLD
        assert mock_perplexity_client.query.call_count == 2

    def test_build_prompt_no_position(self, sample_market_state):
        """Test prompt building with no active position."""
        strategy = LLMStrategy(perplexity_client=Mock())

        prompt = strategy._build_prompt(
            market_state=sample_market_state,
            current_position=None,
            available_capital_usdc=10000.0,
            max_leverage_bps=30000,
        )

        assert "No active position" in prompt
        assert "wSPYx" in prompt
        assert "$550.0" in prompt  # Spot price from fixture
        assert "3.0x" in prompt  # Max leverage

    def test_build_prompt_with_position(self, sample_market_state, sample_position_long):
        """Test prompt building with active position."""
        strategy = LLMStrategy(perplexity_client=Mock())

        prompt = strategy._build_prompt(
            market_state=sample_market_state,
            current_position=sample_position_long,
            available_capital_usdc=10000.0,
            max_leverage_bps=30000,
        )

        assert "Active position" in prompt
        assert "LONG" in prompt
        assert "Entry price" in prompt
        assert "Current PnL" in prompt

    def test_build_prompt_includes_market_data(self, sample_market_state):
        """Test prompt includes comprehensive market data."""
        strategy = LLMStrategy(perplexity_client=Mock())

        prompt = strategy._build_prompt(
            market_state=sample_market_state,
            current_position=None,
            available_capital_usdc=10000.0,
            max_leverage_bps=30000,
        )

        # Check market data inclusions
        assert sample_market_state.asset in prompt
        assert str(sample_market_state.spot_price) in prompt
        assert sample_market_state.sentiment in prompt
        assert "Pool state" in prompt
        assert "Rule constraints" in prompt

    def test_create_fallback_decision(self):
        """Test creating fallback decision."""
        strategy = LLMStrategy(perplexity_client=Mock())

        fallback = strategy._create_fallback_decision(
            asset="wSPYx",
            reason="Test fallback",
            raw_response="some raw text",
        )

        assert fallback.action == DecisionAction.HOLD
        assert fallback.asset == "wSPYx"
        assert fallback.confidence == 0
        assert not fallback.parse_success
        assert "Fallback" in fallback.reasoning
        assert fallback.raw_response == "some raw text"

    def test_get_system_prompt(self):
        """Test system prompt generation."""
        strategy = LLMStrategy(perplexity_client=Mock())

        system_prompt = strategy._get_system_prompt()

        assert "trading agent" in system_prompt.lower()
        assert "JSON" in system_prompt
        assert "confidence" in system_prompt.lower()
        assert "leverage" in system_prompt.lower()


class TestTradingDecision:
    """Test TradingDecision data class."""

    def test_to_dict(self, sample_decision_open_long):
        """Test converting decision to dictionary."""
        decision_dict = sample_decision_open_long.to_dict()

        assert decision_dict["action"] == "OPEN_LONG"
        assert decision_dict["asset"] == "wSPYx"
        assert decision_dict["leverage_bps"] == 30000
        assert decision_dict["confidence"] == 80
        assert decision_dict["blocked"] is False

    def test_requires_execution_open_long(self, sample_decision_open_long):
        """Test OPEN_LONG requires execution."""
        assert sample_decision_open_long.requires_execution

    def test_requires_execution_hold(self, sample_decision_hold):
        """Test HOLD does not require execution."""
        assert not sample_decision_hold.requires_execution

    def test_requires_execution_blocked(self, sample_decision_open_long):
        """Test blocked decision does not require execution."""
        sample_decision_open_long.blocked = True
        assert not sample_decision_open_long.requires_execution

    def test_is_high_confidence_true(self, sample_decision_open_long):
        """Test high confidence check returns true."""
        sample_decision_open_long.confidence = 75
        assert sample_decision_open_long.is_high_confidence(threshold=70)

    def test_is_high_confidence_false(self, sample_decision_open_long):
        """Test high confidence check returns false."""
        sample_decision_open_long.confidence = 65
        assert not sample_decision_open_long.is_high_confidence(threshold=70)

    def test_rule_violations_initialization(self):
        """Test rule violations list is initialized."""
        decision = TradingDecision(
            action=DecisionAction.HOLD,
            asset="wSPYx",
        )

        assert decision.rule_violations == []

    def test_decision_with_violations(self, sample_decision_open_long):
        """Test decision with rule violations."""
        sample_decision_open_long.blocked = True
        sample_decision_open_long.block_reason = "Divergence too high"
        sample_decision_open_long.rule_violations = ["R4_DivergenceGate"]

        assert sample_decision_open_long.blocked
        assert len(sample_decision_open_long.rule_violations) == 1
        assert not sample_decision_open_long.requires_execution
