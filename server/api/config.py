from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://xlever:xlever@localhost:5432/xlever"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # App
    APP_NAME: str = "xLever API"
    DEBUG: bool = False
    CORS_ORIGINS: list[str] = ["http://localhost:8080", "http://localhost:5173", "http://localhost:3000"]

    # Chain
    RPC_URL: str = "https://rpc-gel-sepolia.inkonchain.com"
    CHAIN_ID: int = 763373

    # Yahoo Finance proxy
    YAHOO_CACHE_TTL: int = 300  # 5 minutes

    model_config = {"env_file": "../.env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
