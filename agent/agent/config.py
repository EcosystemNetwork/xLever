"""Configuration management for xLever AI Trading Agent."""

from typing import Literal
from pydantic import Field, validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from loguru import logger


class BlockchainConfig(BaseSettings):
    """Blockchain connection configuration."""

    rpc_url: str = Field(
        default="https://rpc-gel-sepolia.inkonchain.com/",
        description="RPC endpoint URL for Ink Sepolia",
    )
    chain_id: int = Field(default=763373, description="Chain ID for Ink Sepolia")
    private_key: str = Field(..., description="Private key for transaction signing")

    @validator("private_key")
    def validate_private_key(cls, v: str) -> str:
        """Validate private key format."""
        if not v or v == "your_private_key_here":
            raise ValueError("PRIVATE_KEY must be set to a valid private key")
        # Remove 0x prefix if present for consistency
        return v.removeprefix("0x")

    model_config = SettingsConfigDict(env_prefix="")


class APIConfig(BaseSettings):
    """External API configuration."""

    tavily_api_key: str = Field(..., description="Tavily API key for market intelligence")

    @validator("tavily_api_key")
    def validate_api_key(cls, v: str) -> str:
        """Validate API key is set."""
        if not v or v == "your_tavily_api_key_here":
            raise ValueError("TAVILY_API_KEY must be set")
        return v

    model_config = SettingsConfigDict(env_prefix="")


class DatabaseConfig(BaseSettings):
    """Database configuration."""

    database_url: str = Field(
        default="sqlite+aiosqlite:///./agent.db", description="Async database URL"
    )

    model_config = SettingsConfigDict(env_prefix="")


class AgentConfig(BaseSettings):
    """Agent behavior configuration."""

    mode: Literal["simulation", "live"] = Field(
        default="simulation", description="Agent execution mode"
    )
    loop_interval: int = Field(
        default=300, ge=60, le=3600, description="Seconds between decision cycles"
    )

    model_config = SettingsConfigDict(env_prefix="AGENT_")


class RiskConfig(BaseSettings):
    """Risk management limits and parameters."""

    max_leverage_bps: int = Field(
        default=50000, ge=10000, le=100000, description="Max leverage in basis points (5x = 50000)"
    )
    max_position_usdc: float = Field(
        default=1000.0, ge=10.0, description="Maximum position size in USDC"
    )
    stop_loss_pct: float = Field(
        default=10.0, ge=1.0, le=50.0, description="Stop loss percentage"
    )
    take_profit_pct: float = Field(
        default=20.0, ge=5.0, le=100.0, description="Take profit percentage"
    )

    model_config = SettingsConfigDict(env_prefix="")


class LoggingConfig(BaseSettings):
    """Logging configuration."""

    log_level: str = Field(default="INFO", description="Log level")

    model_config = SettingsConfigDict(env_prefix="")


class Settings(BaseSettings):
    """Master settings for xLever AI Trading Agent."""

    blockchain: BlockchainConfig = Field(default_factory=BlockchainConfig)
    apis: APIConfig = Field(default_factory=APIConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    agent: AgentConfig = Field(default_factory=AgentConfig)
    risk: RiskConfig = Field(default_factory=RiskConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    def __init__(self, **kwargs):
        """Initialize settings and configure logging."""
        super().__init__(**kwargs)
        self._configure_logging()

    def _configure_logging(self):
        """Configure loguru with appropriate settings."""
        logger.remove()  # Remove default handler
        logger.add(
            "logs/agent_{time:YYYY-MM-DD}.log",
            level=self.logging.log_level,
            rotation="00:00",
            retention="30 days",
            format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
        )
        logger.add(
            lambda msg: print(msg, end=""),
            level=self.logging.log_level,
            format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>",
            colorize=True,
        )
        logger.info(f"Agent starting in {self.agent.mode} mode")


# Singleton instance
_settings: Settings | None = None


def get_settings() -> Settings:
    """Get or create the settings singleton instance."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
