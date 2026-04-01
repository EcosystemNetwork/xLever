# xLever AI Trading Agent

**Production-ready, LLM-powered autonomous trading agent** for the xLever leveraged trading protocol on Ink Sepolia.

## Features

- **Autonomous Trading**: LLM-powered market analysis with Tavily AI Search
- **8 Safety Guardrails**: Rule-based validation before every trade
- **Human-in-the-Loop (HITL)**: 4 approval modes from fully autonomous to notification-only
- **Risk Management**: Health monitoring, position sizing, stop-loss/take-profit
- **Real-time Alerts**: WebSocket server for live decision and position updates
- **Backtesting**: Historical data simulator with performance metrics
- **REST API**: Full control and monitoring via FastAPI

## Quick Start

### 1. Install

```bash
cd agent
pip install -e .
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your API keys and wallet
```

**Required Configuration:**
- `PRIVATE_KEY`: Trading wallet private key
- `TAVILY_API_KEY`: Get from [tavily.com](https://tavily.com/)

### 3. Run

```bash
# Paper trading mode (safe, no real transactions)
python -m agent.main

# Or with CLI commands:
xlever-agent          # Start the trading agent
xlever-api            # Start the REST API server
```

## Architecture

```
agent/
├── api/               # FastAPI REST server
│   └── routes/        # Agent, positions, decisions endpoints
├── backtest/          # Historical backtesting framework
├── contracts/         # Contract addresses and ABIs
├── execution/         # Web3 client and transaction builder
├── hitl/              # Human-in-the-Loop controller
├── intelligence/      # Tavily AI market intelligence
├── models/            # Pydantic models (Position, Decision)
├── monitor/           # Metrics collector and alert manager
├── risk/              # Health monitor, position sizing, limits
├── strategy/          # LLM strategy and rule engine
├── websocket/         # Real-time event broadcasting
├── cache.py           # TTL-based in-memory cache
├── config.py          # Pydantic settings management
└── main.py            # Main agent loop
```

## HITL Modes

| Mode | Description |
|------|-------------|
| `autonomous` | Agent trades without human approval |
| `approval_required` | All trades require human approval |
| `approval_above_threshold` | Trades above $X USDC need approval |
| `notifications_only` | Agent only sends alerts, no execution |

Configure in `.env`:
```bash
HITL_MODE=approval_required
HITL_THRESHOLD_USDC=500
```

## Safety Guardrails

The agent applies **8 rules** before every trade:

1. **Max Leverage Rule**: Blocks if leverage exceeds limit
2. **Timing Rule**: Enforces cooldown between trades
3. **Health Guard**: Pauses trading if position health is low
4. **Divergence Gate**: Rejects trades when TWAP diverges >3%
5. **Daily Loss Limit**: Stops trading if daily losses exceed limit
6. **Confidence Threshold**: Requires minimum LLM confidence
7. **Liquidity Check**: Ensures sufficient pool liquidity
8. **Gas Price Cap**: Blocks during high gas conditions

## API Endpoints

Start the API server:
```bash
xlever-api
# Or: uvicorn agent.api.server:app --host 0.0.0.0 --port 8080
```

### Agent Control
- `GET /api/agent/status` - Agent status and health
- `POST /api/agent/mode` - Set HITL mode
- `GET /api/agent/pending` - List pending decisions
- `POST /api/agent/approve/{id}` - Approve/reject decision
- `POST /api/agent/start` - Start agent
- `POST /api/agent/stop` - Stop agent

### Positions
- `GET /api/positions` - List all positions
- `GET /api/positions/active` - Active positions only
- `GET /api/positions/summary` - P&L summary

### Decisions
- `GET /api/decisions` - Decision history
- `GET /api/decisions/stats` - Decision statistics
- `GET /api/decisions/{id}/rules` - Rule evaluation details

## WebSocket Events

Connect to `ws://localhost:8765` for real-time events:

```javascript
const ws = new WebSocket('ws://localhost:8765');
ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  console.log(event.type, event.data);
};
```

**Event Types:**
- `decision_pending` - New decision awaiting approval
- `decision_executed` - Trade executed
- `position_opened` - New position opened
- `position_closed` - Position closed
- `health_warning` - Health score alert

## Backtesting

Run historical backtests:

```python
from agent.backtest import BacktestSimulator, HistoricalDataLoader

# Load historical data
loader = HistoricalDataLoader()
data = await loader.load_yahoo("SPY", "2024-01-01", "2024-12-31")

# Run backtest
simulator = BacktestSimulator(initial_capital=10000)
results = await simulator.run(data, strategy)

print(f"Sharpe Ratio: {results.sharpe_ratio:.2f}")
print(f"Max Drawdown: {results.max_drawdown_pct:.1f}%")
print(f"Win Rate: {results.win_rate:.1f}%")
```

## Contract Addresses (Ink Sepolia)

| Contract | Address |
|----------|---------|
| EVC | `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c` |
| wSPYx Vault | `0xd0673BeB607CA2136b126d34ED0D3Ff7826c93EE` |
| wQQQx Vault | `0x3Bc3c0D268455aD7eAe1432f57f3C24f42EdC7C8` |
| USDC | `0x6b57475467cd854d36Be7FB614caDa5207838943` |
| wSPYx | `0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e` |
| wQQQx | `0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9` |

## Production Deployment

### Docker (Recommended)

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY agent/ ./agent/
RUN pip install -e ./agent
CMD ["xlever-agent"]
```

### Systemd Service

```ini
[Unit]
Description=xLever AI Trading Agent
After=network.target

[Service]
Type=simple
User=xlever
WorkingDirectory=/opt/xlever
ExecStart=/opt/xlever/venv/bin/xlever-agent
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Environment Variables

See `.env.example` for all configuration options.

**Critical for Production:**
```bash
AGENT_MODE=live           # Enable real trading
HITL_MODE=approval_required  # Require approvals
LOG_LEVEL=INFO
```

## Development

### Run Tests

```bash
pip install -e ".[dev]"
pytest tests/
```

### Code Quality

```bash
black agent/
ruff check agent/
```

## License

MIT

## Warning

This software executes financial transactions. **Use at your own risk.**

- Always start in `simulation` mode
- Use a dedicated wallet with limited funds
- Enable HITL approval modes in production
- Monitor health scores and set appropriate limits
