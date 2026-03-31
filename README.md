# xLever — Leveraged Tokenized Asset Protocol

Continuous leverage from **-4x to +4x** on tokenized assets, built on **Euler V2 EVK** — no liquidation risk, no volatility decay.

> Fixed-entry leverage that outperforms daily-rebalanced ETFs (TQQQ, SPXL) in trending markets.

---

## Judge Quickstart

**Time to verify: ~2 minutes**

### 1. Run the frontend (30 seconds)

```bash
# Start the data proxy server
cd server && python3 server.py &

# Open the landing page
open frontend/index.html
# Or: python3 -m http.server 8080 --directory frontend
```

### 2. Demo path (90 seconds)

| Step | Screen | What to verify |
|------|--------|----------------|
| 1 | [Landing page](frontend/index.html) | Protocol overview, feature cards |
| 2 | [Dashboard](frontend/01-dashboard.html) | Portfolio PnL, asset allocation, protocol health metrics |
| 3 | [Trading Terminal](frontend/02-trading-terminal.html) | Real chart data (QQQ/SPY), -4x to +4x leverage slider, order entry |
| 4 | [Backtesting](frontend/06-analytics-backtesting.html) | **Key demo**: Run backtest with real Yahoo Finance data. Compare LTAP fixed-entry vs daily-reset leverage. Click any backtest result to "invest" |
| 5 | [Vault Management](frontend/04-vault-management.html) | Senior/Junior tranche deposit UI, Euler V2 vault visualization |
| 6 | [Risk Management](frontend/05-risk-management.html) | Correlation matrix, drawdown analysis, auto-deleverage triggers |
| 7 | [AI Agent Ops](frontend/03-ai-agent-operations.html) | AI agent control panel, strategy configuration, Perplexity API integration |
| 8 | [Operations Control](frontend/07-operations-control.html) | System health, transaction tracking, gas optimization |

### 3. Key technical proof

- **Backtesting engine** ([frontend/app.js](frontend/app.js)): 1,100+ lines implementing the full LTAP leverage simulation — fixed-entry vs daily-reset comparison using real market data
- **Real data**: Yahoo Finance API via local proxy, 25 years of daily OHLCV for QQQ and SPY
- **Protocol design**: 80KB architecture document covering vault mechanics, fee engine, circuit breakers, and Euler V2 integration ([protocol.md](protocol.md))

---

## What is Real vs What is Simulated

| Component | Status | Details |
|-----------|--------|---------|
| Frontend (7 screens) | **Live** | Fully functional UI with Bloomberg Terminal aesthetic |
| Backtesting engine | **Live** | Real Yahoo Finance data, LTAP fixed-entry leverage simulation, click-to-invest |
| Trading charts | **Live** | TradingView Lightweight Charts with real QQQ/SPY data |
| Data server | **Live** | Python proxy serving Yahoo Finance API with 24h localStorage cache |
| Protocol architecture | **Designed** | Complete in [protocol.md](protocol.md) — vault hierarchy, fee engine, risk model, oracle integration |
| Smart contracts | **Designed, not deployed** | Euler V2 EVK architecture fully specified, Solidity not yet written |
| Euler V2 integration | **Designed** | EVC batch manager, atomic looping, sub-accounts — architecture complete |
| AI agent trading | **Simulated** | UI operational, Perplexity API integrated for market intelligence, autonomous execution simulated |
| Wallet connection | **Not implemented** | No Web3 wallet integration yet |
| On-chain transactions | **Not implemented** | No testnet/mainnet deployment |

---

## Architecture

```
User Layer
  Senior Users (-4x to +4x leverage)  ←→  Junior LPs (first-loss buffer)
         │                                        │
         ▼                                        ▼
Core Protocol (Vault)
  Position Manager  │  Exposure Aggregator  │  Fee Engine
         │
         ▼
Hedging Engine
  Euler V2 Vault Interface  │  EVC Batch Manager  │  Rebalance Logic
         │
         ▼
External
  Pyth Oracle (15-min TWAP)  │  Euler V2 Markets  │  xStocks (xQQQ)
```

**How it works:**
1. Senior users deposit USDC, pick leverage (-4x to +4x)
2. Protocol handles lending/borrowing on Euler V2 atomically (single tx via EVC)
3. PnL = Deposit x Leverage x Price Change — no daily rebalancing, no volatility decay
4. Junior LPs provide first-loss capital, earn fees from all senior activity
5. No liquidations — auto-deleverage cascade protects the system

**Fee model:** `0.5% + 0.5% x |leverage - 1|` annually

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/JS/CSS, TradingView Charts, Tailwind CSS |
| Data | Yahoo Finance API (real), localStorage caching |
| Server | Python HTTP server (data proxy) |
| Contracts (planned) | Solidity, Euler V2 EVK + EVC |
| Oracle (planned) | Pyth Network (15-min TWAP) |
| AI Agent | Perplexity API for market intelligence |

---

## Project Structure

```
xLever/
├── frontend/
│   ├── index.html              # Landing page
│   ├── 01-dashboard.html       # Portfolio command center
│   ├── 02-trading-terminal.html # Trading + charting
│   ├── 03-ai-agent-operations.html # AI agent control
│   ├── 04-vault-management.html # Euler V2 vault UI
│   ├── 05-risk-management.html # Risk analysis
│   ├── 06-analytics-backtesting.html # Backtesting engine
│   ├── 07-operations-control.html # System operations
│   ├── app.js                  # Core LTAP simulation engine
│   └── styles.css              # Bloomberg Terminal theme
├── server/
│   └── server.py               # Yahoo Finance data proxy
├── protocol.md                 # Full protocol architecture (80KB)
├── hackPlan.md                 # Team plan & workstreams
└── README.md                   # You are here
```

---

## Deployment Manifest

See [deployment.json](deployment.json) for the machine-readable deployment manifest.

| Item | Value |
|------|-------|
| Network | Not yet deployed (Ethereum testnet planned) |
| Frontend | Static files, no build step required |
| Data server | `localhost:8000` (Python) |
| Contracts | Architecture complete, deployment pending |
| Repository | [github.com/madschristensen99/xLever](https://github.com/madschristensen99/xLever) |

---

## AI Usage Disclosure

This project uses AI tools transparently:

- **Claude Code**: Code generation, architecture design, frontend development, documentation
- **Stitch (MCP)**: UI/UX design system and screen generation
- **Perplexity API**: Real-time market intelligence for the AI agent component

All AI-generated code has been reviewed and integrated by team members. The protocol architecture, leverage math, and risk model were designed collaboratively with AI assistance.

---

## Team

- **Mads** — Euler V2 EVK integration & smart contract deployment
- **Eric** — AI agent architecture & trading logic
- **Maroua** — AI agent, demo video, UI/UX

---

## Run Locally

```bash
# 1. Start data server
cd server
python3 server.py
# Server runs on http://localhost:8000

# 2. Open frontend
# Option A: Open frontend/index.html directly in browser
# Option B: Serve with any static server
python3 -m http.server 8080 --directory frontend
```

No build step. No npm install. No dependencies beyond Python 3.

---

## License

MIT
