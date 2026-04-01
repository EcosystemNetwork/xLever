# xLever AI Trading Agent

Foundation layer for autonomous leveraged trading on Ink Sepolia.

## Overview

The xLever AI Trading Agent autonomously trades wSPYx and wQQQx leveraged tokens using Euler vaults and Perplexity AI for market intelligence.

## Installation

```bash
cd agent
pip install -e .
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:
- `RPC_URL`: Ink Sepolia RPC endpoint
- `CHAIN_ID`: 763373 (Ink Sepolia)
- `PRIVATE_KEY`: Trading wallet private key
- `PERPLEXITY_API_KEY`: Perplexity AI API key
- `DATABASE_URL`: SQLite or PostgreSQL connection string

## Architecture

### Components

1. **Configuration Management** (`agent/config.py`)
   - Pydantic-based settings with validation
   - Environment variable loading
   - Structured logging configuration

2. **Database Models** (`agent/models/`)
   - `Position`: Trading position tracking
   - `Decision`: Agent decision history
   - `Metrics`: Performance and system metrics
   - Async SQLAlchemy with SQLite/PostgreSQL support

3. **Web3 Client** (`agent/execution/web3_client.py`)
   - Async blockchain interactions
   - Transaction signing and broadcasting
   - Contract interaction helpers
   - Retry logic with exponential backoff

4. **Perplexity AI Client** (`agent/intelligence/perplexity.py`)
   - Market analysis and sentiment
   - Trading recommendations
   - Rate limiting (10 req/min)
   - Structured response parsing

5. **WebSocket Server** (`agent/websocket/server.py`)
   - Real-time event broadcasting
   - Decision and position updates
   - Multiple client support
   - JSON message protocol

6. **Cache Layer** (`agent/cache.py`)
   - TTL-based in-memory caching
   - Price and market data caching
   - JSON serialization
   - Hit rate statistics

7. **Contract Integration** (`agent/contracts/`)
   - Deployed contract addresses
   - ABI definitions for ERC20, Euler vaults, Hedging vaults
   - Pyth oracle configuration

## Development Status

**Phase 1: Foundation Layer** ✅ Complete
- All core components implemented
- Dependencies installed
- Imports verified

**Phase 2: Trading Logic** 🔜 Next
- Market data fetching
- Decision engine
- Position management
- Risk checks

**Phase 3: Testing & Deployment** 🔜 Future
- Unit tests
- Integration tests
- Production deployment

## Contract Addresses (Ink Sepolia)

- **EVC**: `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c`
- **wSPYx Hedging**: `0xd0673BeB607CA2136b126d34ED0D3Ff7826c93EE`
- **wQQQx Hedging**: `0x3Bc3c0D268455aD7eAe1432f57f3C24f42EdC7C8`
- **USDC**: `0x6b57475467cd854d36Be7FB614caDa5207838943`

See `agent/contracts/addresses.py` for complete list.

## Usage Example

```python
from agent.config import get_settings
from agent.execution.web3_client import Web3Client
from agent.intelligence.perplexity import PerplexityClient

# Load configuration
settings = get_settings()

# Initialize Web3 client
web3_client = Web3Client(
    rpc_url=settings.blockchain.rpc_url,
    chain_id=settings.blockchain.chain_id,
    private_key=settings.blockchain.private_key,
)

# Initialize Perplexity client
async with PerplexityClient(api_key=settings.apis.perplexity_api_key) as perplexity:
    analysis = await perplexity.analyze_market("SPY")
    print(analysis.content)
```

## License

MIT
