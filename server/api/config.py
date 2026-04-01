# pydantic_settings reads from env vars and .env files — type-safe config without manual parsing
from pydantic_settings import BaseSettings
# lru_cache ensures we only parse settings once, reusing the same instance everywhere
from functools import lru_cache


# BaseSettings subclass — each field maps to an environment variable of the same name
class Settings(BaseSettings):
    # asyncpg driver is required for SQLAlchemy async — standard psycopg2 would block the event loop
    DATABASE_URL: str = "postgresql+asyncpg://xlever:xlever@localhost:5432/xlever"

    # Redis connection for future use (rate limiting, pub/sub alerts, session cache)
    REDIS_URL: str = "redis://localhost:6379/0"

    # Human-readable name shown in FastAPI's auto-generated /docs page title
    APP_NAME: str = "xLever API"
    # Debug mode controls SQLAlchemy echo (SQL logging) — off by default to reduce noise
    DEBUG: bool = False
    # Whitelist of frontend origins allowed to make cross-origin requests to this API
    CORS_ORIGINS: list[str] = ["http://localhost:8080", "http://localhost:5173", "http://localhost:3000", "https://xlever.markets"]

    # Ink Sepolia RPC endpoint — xLever deploys on Ink chain (Euler V2 EVK vaults live here)
    RPC_URL: str = "https://rpc-gel-sepolia.inkonchain.com"
    # Chain ID for Ink Sepolia — frontend uses this to verify wallet is on the correct network
    CHAIN_ID: int = 763373

    # How long cached Yahoo Finance data stays fresh before re-fetching (5 min balances freshness vs rate limits)
    YAHOO_CACHE_TTL: int = 300  # 5 minutes

    # model_config tells pydantic-settings where to find the .env file and to ignore extra vars
    model_config = {"env_file": "../.env", "extra": "ignore"}


# Singleton pattern via lru_cache — prevents re-reading .env on every get_settings() call
@lru_cache
def get_settings() -> Settings:
    # Instantiate Settings, which triggers env var / .env parsing via pydantic-settings
    return Settings()
