# Spawn Prompt: Agent-Foundation

## CONTEXT

You are building the foundation layer for the xLever AI Trading Agent.

**PRD Location**: `docs/prds/2026-04-01-xlever-ai-agent/PRD.md`
**Target Repo**: `xLever/agent/`
**Language**: Python 3.11+

### Existing Patterns to Read First
- `frontend/app.js` — Web3 wallet connection patterns
- `contracts/src/xLever/interfaces/IVault.sol` — Contract interfaces
- `contracts/src/xLever/modules/EulerHedgingModule.sol` — Hedging module
- `server/server.py` — Existing Python HTTP patterns

### Contract Addresses (Ink Sepolia)
```python
CONTRACTS = {
    # Core Protocol
    "EVC": "0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c",

    # Hedging Modules (main entry points)
    "wSPYx_HEDGING": "0xd0673BeB607CA2136b126d34ED0D3Ff7826c93EE",
    "wQQQx_HEDGING": "0x3Bc3c0D268455aD7eAe1432f57f3C24f42EdC7C8",

    # Tokens
    "USDC": "0x6b57475467cd854d36Be7FB614caDa5207838943",
    "wSPYx": "0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e",
    "wQQQx": "0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9",

    # Euler Vaults
    "USDC_VAULT": "0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53",
    "wSPYx_VAULT": "0x6d064558d58645439A64cE1e88989Dfba88AA052",
    "wQQQx_VAULT": "0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9",

    # Interest Rate Model
    "IRM": "0xE91A4B01632a7D281fb3eB0E83Ad9D5F0305d48f",
}

# Pyth Hermes API for real-time prices
PYTH_HERMES_URL = "https://hermes.pyth.network"
PYTH_FEEDS = {
    "SPY/USD": "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68aca0c4ae8a14",
    "QQQ/USD": "0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
}
```

---

## SCOPE

Create the following directory structure:

```
agent/
├── __init__.py
├── config.py                  # Task 2
├── cache.py                   # Task 8
│
├── models/                    # Task 3
│   ├── __init__.py
│   ├── base.py               # SQLAlchemy base
│   ├── position.py
│   ├── decision.py
│   └── metrics.py
│
├── intelligence/              # Task 6
│   ├── __init__.py
│   └── perplexity.py         # Perplexity API client
│
├── execution/                 # Task 4
│   ├── __init__.py
│   └── web3_client.py        # Web3 connection
│
├── contracts/                 # Task 5
│   ├── __init__.py
│   ├── addresses.py
│   └── abis/
│       ├── EulerHedgingModule.json
│       ├── EVault.json
│       └── ERC20.json
│
└── websocket/                 # Task 7
    ├── __init__.py
    └── server.py

pyproject.toml                 # Task 1
requirements.txt               # Task 1
.env.example                   # Task 1
```

---

## YOUR TASKS

### Task 1: Project Structure Setup
Create `pyproject.toml` with dependencies:
- web3>=6.0
- httpx>=0.27
- fastapi>=0.110
- sqlalchemy>=2.0
- cachetools>=5.0
- websockets>=12.0
- pydantic>=2.0
- python-dotenv

Create `.env.example` with all required environment variables.

### Task 2: Configuration Management
Create `agent/config.py`:
- Load from environment variables
- Pydantic Settings model
- Validation on startup
- Sections: blockchain, apis, database, agent_settings, risk_limits

### Task 3: Database Models
Create SQLAlchemy models for:
- `Position` — tracking open/closed positions
- `Decision` — logging all agent decisions
- `MarketIntelligence` — caching Perplexity responses
- `Metrics` — timeseries metrics

Include migration script using Alembic.

### Task 4: Web3 Client Setup
Create `agent/execution/web3_client.py`:
- Async Web3 connection to Ink Sepolia
- Account management (from private key)
- Gas estimation utilities
- Transaction sending with retry logic
- Contract instance factory

### Task 5: Contract ABIs Integration
- Extract ABIs from `contracts/out/` (compile first if needed)
- Create `agent/contracts/addresses.py` with all deployed addresses
- Create contract wrapper classes for type-safe interaction

### Task 6: Perplexity Client
Create `agent/intelligence/perplexity.py`:
- Async HTTP client using httpx
- Rate limiting (self-imposed)
- Response parsing with Pydantic
- Error handling and retry logic
- Caching responses in memory

### Task 7: WebSocket Server Setup
Create `agent/websocket/server.py`:
- WebSocket server for real-time updates to frontend
- Connection management (multiple clients)
- Event broadcasting (decisions, alerts, metrics)
- Severity-based message formatting (info/warning/critical)

### Task 8: In-Memory Cache Setup
Create `agent/cache.py`:
- TTLCache from cachetools
- Key prefixing
- Configurable TTL per cache type
- JSON serialization for complex objects

---

## BOUNDARIES

**DO:**
- Use async/await throughout
- Use Pydantic for all data models
- Use structured logging (loguru or structlog)
- Write docstrings for public functions
- Handle all exceptions gracefully

**DO NOT:**
- Implement trading logic (that's Agent-Core)
- Create the API server (that's Agent-Tests)
- Write tests (that's Agent-Tests)
- Store secrets in code (use environment variables)
- Use synchronous HTTP calls

---

## SUCCESS CRITERIA

- [ ] `pip install -e .` works without errors
- [ ] `python -c "from agent.config import Settings; Settings()"` validates config
- [ ] `python -c "from agent.execution.web3_client import Web3Client"` imports
- [ ] `python -c "from agent.intelligence.perplexity import PerplexityClient"` imports
- [ ] Database tables can be created via migration
- [ ] WebSocket server can accept connections
- [ ] In-memory cache stores and retrieves values with TTL

---

## PATTERNS TO FOLLOW

### Config Pattern
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    rpc_url: str
    chain_id: int = 763373
    private_key: str

    class Config:
        env_file = ".env"
```

### Async Web3 Pattern
```python
from web3 import AsyncWeb3, AsyncHTTPProvider

class Web3Client:
    def __init__(self, rpc_url: str):
        self.w3 = AsyncWeb3(AsyncHTTPProvider(rpc_url))

    async def get_balance(self, address: str) -> int:
        return await self.w3.eth.get_balance(address)
```

### Perplexity Client Pattern
```python
import httpx

class PerplexityClient:
    BASE_URL = "https://api.perplexity.ai"

    async def query(self, prompt: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": "llama-3.1-sonar-small-128k-online", "messages": [...]}
            )
            return response.json()
```
