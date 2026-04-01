"""In-memory cache with TTL support for agent data."""

import json
from typing import Any, Optional
from datetime import datetime, timedelta
from cachetools import TTLCache
from loguru import logger


class AgentCache:
    """Thread-safe in-memory cache with TTL and JSON serialization.

    Provides caching for frequently accessed data like prices, positions,
    and market data with configurable TTL per key prefix.
    """

    # Default TTL values (in seconds) for different data types
    DEFAULT_TTLS = {
        "price": 30,  # Price data expires quickly
        "position": 60,  # Position data
        "market": 300,  # Market analysis
        "config": 3600,  # Configuration data
        "default": 300,  # Default 5 minutes
    }

    def __init__(self, maxsize: int = 1000, default_ttl: int = 300):
        """Initialize cache.

        Args:
            maxsize: Maximum number of items in cache
            default_ttl: Default TTL in seconds
        """
        self._cache = TTLCache(maxsize=maxsize, ttl=default_ttl)
        self._default_ttl = default_ttl
        self._stats = {"hits": 0, "misses": 0, "sets": 0, "deletes": 0}

        logger.info(f"Agent cache initialized (max_size={maxsize}, default_ttl={default_ttl}s)")

    def get(self, key: str, default: Any = None) -> Any:
        """Get value from cache.

        Args:
            key: Cache key
            default: Default value if key not found

        Returns:
            Cached value or default
        """
        try:
            value = self._cache[key]
            self._stats["hits"] += 1
            logger.debug(f"Cache HIT: {key}")
            return self._deserialize(value)
        except KeyError:
            self._stats["misses"] += 1
            logger.debug(f"Cache MISS: {key}")
            return default

    def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None,
    ):
        """Set value in cache with optional custom TTL.

        Args:
            key: Cache key
            value: Value to cache (must be JSON serializable)
            ttl: Custom TTL in seconds (uses default if not provided)
        """
        # Determine TTL based on key prefix
        if ttl is None:
            ttl = self._get_ttl_for_key(key)

        # Serialize value
        serialized = self._serialize(value)

        # Store with TTL
        self._cache[key] = serialized
        self._stats["sets"] += 1

        logger.debug(f"Cache SET: {key} (ttl={ttl}s)")

    def delete(self, key: str) -> bool:
        """Delete key from cache.

        Args:
            key: Cache key to delete

        Returns:
            True if key was deleted, False if not found
        """
        try:
            del self._cache[key]
            self._stats["deletes"] += 1
            logger.debug(f"Cache DELETE: {key}")
            return True
        except KeyError:
            return False

    def clear(self):
        """Clear all items from cache."""
        self._cache.clear()
        logger.info("Cache cleared")

    def has(self, key: str) -> bool:
        """Check if key exists in cache.

        Args:
            key: Cache key

        Returns:
            True if key exists and not expired
        """
        return key in self._cache

    def get_or_set(
        self,
        key: str,
        factory_fn: callable,
        ttl: Optional[int] = None,
    ) -> Any:
        """Get value from cache or compute and cache it.

        Args:
            key: Cache key
            factory_fn: Function to compute value if not cached
            ttl: Custom TTL in seconds

        Returns:
            Cached or computed value
        """
        value = self.get(key)

        if value is not None:
            return value

        # Compute value
        value = factory_fn()

        # Cache it
        self.set(key, value, ttl=ttl)

        return value

    def _get_ttl_for_key(self, key: str) -> int:
        """Determine TTL based on key prefix.

        Args:
            key: Cache key

        Returns:
            TTL in seconds
        """
        for prefix, ttl in self.DEFAULT_TTLS.items():
            if key.startswith(prefix):
                return ttl

        return self._default_ttl

    def _serialize(self, value: Any) -> str:
        """Serialize value to JSON string.

        Args:
            value: Value to serialize

        Returns:
            JSON string

        Raises:
            TypeError: If value is not JSON serializable
        """
        try:
            return json.dumps(value, default=str)  # default=str handles datetime
        except TypeError as e:
            logger.error(f"Failed to serialize value: {e}")
            raise

    def _deserialize(self, value: str) -> Any:
        """Deserialize JSON string to value.

        Args:
            value: JSON string

        Returns:
            Deserialized value
        """
        try:
            return json.loads(value)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to deserialize value: {e}")
            # Return raw value as fallback
            return value

    @property
    def size(self) -> int:
        """Get current cache size."""
        return len(self._cache)

    @property
    def stats(self) -> dict:
        """Get cache statistics.

        Returns:
            Dictionary with hits, misses, sets, deletes, size, and hit_rate
        """
        total_requests = self._stats["hits"] + self._stats["misses"]
        hit_rate = (
            self._stats["hits"] / total_requests * 100 if total_requests > 0 else 0
        )

        return {
            **self._stats,
            "size": self.size,
            "hit_rate": f"{hit_rate:.1f}%",
        }

    def __repr__(self) -> str:
        return f"<AgentCache(size={self.size}/{self._cache.maxsize}, stats={self.stats})>"


# Singleton instance
_cache: Optional[AgentCache] = None


def get_cache(maxsize: int = 1000, default_ttl: int = 300) -> AgentCache:
    """Get or create the cache singleton instance.

    Args:
        maxsize: Maximum cache size (only used on first call)
        default_ttl: Default TTL (only used on first call)

    Returns:
        AgentCache instance
    """
    global _cache
    if _cache is None:
        _cache = AgentCache(maxsize=maxsize, default_ttl=default_ttl)
    return _cache
