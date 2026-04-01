"""Sentiment analysis module for parsing market intelligence."""

import json
import re
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum
from loguru import logger


class Sentiment(str, Enum):
    """Market sentiment values."""

    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


class PositionBias(str, Enum):
    """Recommended position bias."""

    LONG = "long"
    SHORT = "short"
    NEUTRAL = "neutral"


@dataclass
class SentimentAnalysis:
    """Structured sentiment analysis result."""

    sentiment: Sentiment
    confidence: int  # 0-100
    upcoming_events: list[str]
    risk_factors: list[str]
    position_bias: PositionBias
    reasoning: str

    # Metadata
    raw_content: str
    parse_success: bool = True

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "sentiment": self.sentiment.value,
            "confidence": self.confidence,
            "upcoming_events": self.upcoming_events,
            "risk_factors": self.risk_factors,
            "position_bias": self.position_bias.value,
            "reasoning": self.reasoning,
            "parse_success": self.parse_success,
        }

    @property
    def is_confident(self, threshold: int = 70) -> bool:
        """Check if confidence exceeds threshold."""
        return self.confidence >= threshold

    @property
    def has_high_risk(self, max_factors: int = 3) -> bool:
        """Check if high number of risk factors present."""
        return len(self.risk_factors) > max_factors

    @property
    def alignment_score(self) -> float:
        """Calculate alignment between sentiment and position bias.

        Returns:
            Score from -1 to 1:
            - 1.0: Perfect alignment (bullish sentiment + long bias)
            - 0.0: Neutral or mixed
            - -1.0: Conflict (bullish sentiment + short bias)
        """
        sentiment_score = {
            Sentiment.BULLISH: 1.0,
            Sentiment.NEUTRAL: 0.0,
            Sentiment.BEARISH: -1.0,
        }[self.sentiment]

        bias_score = {
            PositionBias.LONG: 1.0,
            PositionBias.NEUTRAL: 0.0,
            PositionBias.SHORT: -1.0,
        }[self.position_bias]

        # Both agree on direction
        if abs(sentiment_score - bias_score) < 0.1:
            return sentiment_score

        # One is neutral
        if sentiment_score == 0.0 or bias_score == 0.0:
            return (sentiment_score + bias_score) / 2

        # Conflicting signals
        return 0.0


class SentimentParser:
    """Parser for LLM sentiment responses.

    Handles multiple response formats and provides fallback parsing
    when JSON is malformed or wrapped in markdown.
    """

    @staticmethod
    def parse(content: str) -> SentimentAnalysis:
        """Parse sentiment from LLM response.

        Args:
            content: Raw LLM response content

        Returns:
            Parsed sentiment analysis
        """
        # Try JSON parsing first
        data = SentimentParser._extract_json(content)

        if data:
            return SentimentParser._parse_json(data, content)
        else:
            # Fallback to text parsing
            logger.warning("JSON parsing failed, attempting text extraction")
            return SentimentParser._parse_text(content)

    @staticmethod
    def _extract_json(content: str) -> Optional[Dict[str, Any]]:
        """Extract JSON from content, handling markdown wrappers.

        Args:
            content: Raw content that may contain JSON

        Returns:
            Parsed JSON dictionary or None
        """
        content = content.strip()

        # Try direct JSON parse
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass

        # Try extracting from markdown code blocks
        patterns = [
            r"```json\s*\n(.*?)\n```",  # ```json ... ```
            r"```\s*\n(.*?)\n```",  # ``` ... ```
            r"\{[^{}]*\}",  # Direct {...} match
        ]

        for pattern in patterns:
            match = re.search(pattern, content, re.DOTALL)
            if match:
                json_str = match.group(1) if match.lastindex else match.group(0)
                try:
                    return json.loads(json_str)
                except json.JSONDecodeError:
                    continue

        return None

    @staticmethod
    def _parse_json(data: Dict[str, Any], raw_content: str) -> SentimentAnalysis:
        """Parse sentiment from JSON data.

        Args:
            data: Parsed JSON dictionary
            raw_content: Original raw content

        Returns:
            Sentiment analysis
        """
        try:
            # Parse enum values with fallback
            sentiment_str = str(data.get("sentiment", "neutral")).lower()
            try:
                sentiment = Sentiment(sentiment_str)
            except ValueError:
                logger.warning(f"Invalid sentiment value: {sentiment_str}, using neutral")
                sentiment = Sentiment.NEUTRAL

            bias_str = str(data.get("position_bias", "neutral")).lower()
            try:
                position_bias = PositionBias(bias_str)
            except ValueError:
                logger.warning(f"Invalid position bias: {bias_str}, using neutral")
                position_bias = PositionBias.NEUTRAL

            # Parse confidence with bounds checking
            confidence = int(data.get("confidence", 50))
            confidence = max(0, min(100, confidence))

            # Parse lists with defaults
            upcoming_events = data.get("upcoming_events", [])
            if not isinstance(upcoming_events, list):
                upcoming_events = [str(upcoming_events)]

            risk_factors = data.get("risk_factors", [])
            if not isinstance(risk_factors, list):
                risk_factors = [str(risk_factors)]

            reasoning = str(data.get("reasoning", "No reasoning provided"))

            return SentimentAnalysis(
                sentiment=sentiment,
                confidence=confidence,
                upcoming_events=upcoming_events,
                risk_factors=risk_factors,
                position_bias=position_bias,
                reasoning=reasoning,
                raw_content=raw_content,
                parse_success=True,
            )

        except Exception as e:
            logger.error(f"Failed to parse JSON sentiment data: {e}")
            return SentimentParser._create_fallback(raw_content, parse_success=False)

    @staticmethod
    def _parse_text(content: str) -> SentimentAnalysis:
        """Parse sentiment from unstructured text using regex.

        Args:
            content: Raw text content

        Returns:
            Best-effort sentiment analysis
        """
        logger.debug("Attempting text-based sentiment extraction")

        # Extract sentiment
        sentiment = Sentiment.NEUTRAL
        if re.search(r"\b(bullish|positive|upward|rally)\b", content, re.IGNORECASE):
            sentiment = Sentiment.BULLISH
        elif re.search(r"\b(bearish|negative|downward|decline)\b", content, re.IGNORECASE):
            sentiment = Sentiment.BEARISH

        # Extract confidence (look for percentages)
        confidence = 50  # Default
        conf_match = re.search(r"confidence[:\s]+(\d+)%?", content, re.IGNORECASE)
        if conf_match:
            confidence = int(conf_match.group(1))
            confidence = max(0, min(100, confidence))

        # Extract position bias
        position_bias = PositionBias.NEUTRAL
        if re.search(r"\b(go long|buy|long position)\b", content, re.IGNORECASE):
            position_bias = PositionBias.LONG
        elif re.search(r"\b(go short|sell|short position)\b", content, re.IGNORECASE):
            position_bias = PositionBias.SHORT

        # Extract events (sentences with "event", "meeting", "earnings", etc.)
        event_keywords = r"\b(event|meeting|earnings|announcement|release|report)\b"
        upcoming_events = []
        for sentence in re.split(r"[.!?]", content):
            if re.search(event_keywords, sentence, re.IGNORECASE):
                upcoming_events.append(sentence.strip())

        # Extract risk factors (sentences with "risk", "concern", "threat", etc.)
        risk_keywords = r"\b(risk|concern|threat|worry|uncertainty|volatility)\b"
        risk_factors = []
        for sentence in re.split(r"[.!?]", content):
            if re.search(risk_keywords, sentence, re.IGNORECASE):
                risk_factors.append(sentence.strip())

        reasoning = content[:200]  # First 200 chars as reasoning

        return SentimentAnalysis(
            sentiment=sentiment,
            confidence=confidence,
            upcoming_events=upcoming_events[:3],  # Limit to top 3
            risk_factors=risk_factors[:3],  # Limit to top 3
            position_bias=position_bias,
            reasoning=reasoning,
            raw_content=content,
            parse_success=False,  # Mark as fallback parsing
        )

    @staticmethod
    def _create_fallback(raw_content: str, parse_success: bool = False) -> SentimentAnalysis:
        """Create a fallback neutral sentiment analysis.

        Args:
            raw_content: Original raw content
            parse_success: Whether parsing was successful

        Returns:
            Neutral sentiment analysis
        """
        return SentimentAnalysis(
            sentiment=Sentiment.NEUTRAL,
            confidence=50,
            upcoming_events=[],
            risk_factors=["Unable to parse market intelligence"],
            position_bias=PositionBias.NEUTRAL,
            reasoning="Parsing failed, defaulting to neutral stance",
            raw_content=raw_content,
            parse_success=parse_success,
        )


def validate_sentiment(analysis: SentimentAnalysis, min_confidence: int = 30) -> tuple[bool, str]:
    """Validate sentiment analysis quality.

    Args:
        analysis: Sentiment analysis to validate
        min_confidence: Minimum acceptable confidence

    Returns:
        Tuple of (is_valid, reason)
    """
    if not analysis.parse_success:
        return False, "Sentiment parsing failed"

    if analysis.confidence < min_confidence:
        return False, f"Confidence too low: {analysis.confidence}% < {min_confidence}%"

    if not analysis.reasoning or len(analysis.reasoning) < 10:
        return False, "Insufficient reasoning provided"

    # Check for conflicts
    if analysis.sentiment == Sentiment.BULLISH and analysis.position_bias == PositionBias.SHORT:
        logger.warning("Conflict: Bullish sentiment but short bias")
        # Not invalid, just noteworthy

    if analysis.sentiment == Sentiment.BEARISH and analysis.position_bias == PositionBias.LONG:
        logger.warning("Conflict: Bearish sentiment but long bias")
        # Not invalid, just noteworthy

    return True, "Valid"
