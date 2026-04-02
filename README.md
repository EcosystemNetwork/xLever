<p align="center">
  <img src="frontend/assets/xlever-logo.svg" alt="xLever" width="80" />
</p>

<h1 align="center">xLever</h1>
<p align="center">
  <strong>Fixed-Entry Leverage on Tokenized Assets</strong><br/>
  -4x to +4x leverage on 33 tokenized equities, ETFs & commodities via Euler V2 EVK
</p>

<p align="center">
  <a href="https://xlever.markets"><img src="https://img.shields.io/badge/Live_Demo-xlever.markets-blue?style=for-the-badge" alt="Live Demo" /></a>
  <img src="https://img.shields.io/badge/Chains-Ink_Sepolia_%7C_Ethereum_Sepolia-purple?style=for-the-badge" alt="Chains" />
  <img src="https://img.shields.io/badge/Vaults-33_Live-green?style=for-the-badge" alt="Vaults" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License" />
</p>

---

## The Problem

Leveraged ETFs like TQQQ and SPXL reset daily. In volatile markets this causes **volatility decay** — you can be right on direction and still lose money. A 3x leveraged ETF on an asset that goes +10% then -10% doesn't return to zero — it returns to **-3%**.

## The Solution

xLever locks leverage at your **entry price**, not at the daily close. Your PnL is always:

```
PnL = Deposit × Leverage × (Current Price - Entry Price) / Entry Price
```

No daily rebalancing. No volatility decay. Max loss = your deposit.

---

## How It Works

1. **Connect** your wallet to Ink Sepolia via [xlever.markets](https://xlever.markets)
2. **Deposit** USDC into any of 33 asset vaults (QQQ, SPY, AAPL, NVDA, TSLA, and 28 more)
3. **Set leverage** from -4x (short) to +4x (long) using the slider
4. **Monitor** your position with real-time Pyth oracle prices, AI-powered risk alerts, and backtesting tools
5. **Withdraw** anytime — PnL is calculated from your entry price, not daily closes

---

## Quick Start

```bash
# Prerequisites: Node.js 18+, Python 3.10+

# 1. Clone & install
git clone https://github.com/your-org/xlever.git && cd xlever
npm install

# 2. Configure environment
cp .env.example .env    # fill in API keys (Pyth, OpenBB, etc.)

# 3. Start the data proxy (Yahoo Finance for backtesting)
cd server && python3 server.py &
cd ..

# 4. Launch the frontend
npm run dev
# → http://localhost:3000
```

### Optional: Full Backend (positions, auth, lending APIs)

```bash
# Start PostgreSQL + Redis
docker compose up -d

# Install Python deps & run FastAPI
cd server && pip install -r requirements.txt
uvicorn api.main:app --port 8080
```

---

## Platform Overview

xLever is a 10-screen Bloomberg-terminal-style platform:

| # | Screen | What You Can Do |
|---|--------|----------------|
| 0 | **Landing** | Connect wallet, see protocol overview, 1Y comparison chart |
| 1 | **Dashboard** | View portfolio PnL, asset allocation, protocol health metrics |
| 2 | **Trading Terminal** | Open/close positions, TradingView charts, -4x to +4x leverage |
| 3 | **AI Agent** | Run autonomous trading agents in 3 policy modes |
| 4 | **Vault Management** | Deposit/withdraw, view tranche structure, Euler V2 health |
| 5 | **Risk Management** | Monitor 4-state risk sentinel, circuit breakers, auto-deleverage |
| 6 | **Analytics** | Backtest LTAP vs daily-reset strategies with real market data |
| 7 | **Operations** | Transaction history, protocol state, emergency controls |
| 8 | **Admin** | Platform stats, activity charts, user management |
| 9 | **Lending** | Cross-chain lending markets (Euler V2 / Kamino / EVAA) |

> See the full [User Guide](docs/USER-GUIDE.md) for detailed walkthroughs of each screen.

---

## Architecture

```
                         xlever.markets
                              │
                 ┌────────────┼────────────┐
                 │            │            │
          ┌──────┴──────┐ ┌───┴───┐ ┌──────┴──────┐
          │  Frontend   │ │ Data  │ │  FastAPI    │
          │  Vite SPA   │ │ Proxy │ │  Backend    │
          │  10 screens │ │ :8000 │ │  :8080      │
          └──────┬──────┘ └───────┘ └──────┬──────┘
                 │                         │
     ┌───────────┼───────────┐        PostgreSQL
     │           │           │        + Redis
  ┌──┴──┐  ┌────┴────┐  ┌───┴───┐
  │Reown│  │  Pyth   │  │  AI   │
  │Wallet│  │ Oracle  │  │ Agent │
  │AppKit│  │ Hermes  │  │ 3 modes│
  └──┬──┘  └────┬────┘  └───┬───┘
     │          │            │
     └──────────┼────────────┘
                │
  ┌─────────────┼─────────────┐
  │    Ink Sepolia (live)     │
  │    33 VaultSimple vaults  │
  │    EVC + PythOracleAdapter│
  │    USDC + wQQQx/wSPYx    │
  └───────────────────────────┘
```

---

## Multi-Chain Deployments

### Ink Sepolia (Primary) — 33 vaults live

| Contract | Address |
|----------|---------|
| EVC | `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c` |
| USDC | `0x6b57475467cd854d36Be7FB614caDa5207838943` |
| Pyth Oracle | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| PythOracleAdapter | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` |
| QQQ Vault | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` |
| SPY Vault | `0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228` |

**33 assets supported:** QQQ, SPY, VUG, VGK, VXUS, SGOV, SMH, XLE, XOP, ITA, AAPL, NVDA, TSLA, DELL, SMCI, ANET, VRT, SNDK, KLAC, LRCX, AMAT, TER, CEG, GEV, SMR, ETN, PWR, APLD, SLV, PPLT, PALL, STRK, BTGO

Full vault addresses: [`deployment.json`](deployment.json) | [`frontend/contracts.js`](frontend/contracts.js)

### Ethereum Sepolia — 33 vaults mirrored

Full mirror deployment on Chain ID 11155111. Frontend supports chain switching.

### Solana (Devnet) — Ready to deploy

Anchor program at [`solana/`](solana/). Mirrors EVM vault logic with Pyth oracle integration.

### TON (Testnet) — Ready to deploy

Tact contracts at [`ton/`](ton/). All 33 Pyth feed IDs pre-configured.

---

## Smart Contracts

| Contract | Status | Description |
|----------|--------|-------------|
| **VaultSimple** | Deployed | Deposit, withdraw, adjust leverage, Pyth pricing |
| **Modular Vault** | Designed | 7 modules: PositionModule, FeeEngine, EulerHedgingModule, RiskModule, TWAPOracle, JuniorTranche, PythOracleAdapter |

The modular vault exceeds deployment size limits and is planned for mainnet via proxy patterns. See [Live vs Planned](docs/LIVE-VS-PLANNED.md).

```bash
# Run contract tests
cd contracts && forge test

# Looping tests
forge test --match-contract VaultWithLoopingTest -vv
```

---

## AI Agent System

### Frontend Agent ([`agent-executor.js`](frontend/agent-executor.js))

Three bounded policy modes running client-side:

| Mode | Behavior | Can Open Positions? |
|------|----------|-------------------|
| **Safe** | Stop-loss monitoring, risk alerts | No (reduce/close only) |
| **Target Exposure** | Maintain leverage band automatically | No (rebalance only) |
| **Accumulate** | DCA into positions on schedule | Yes (fixed leverage) |

### Backend Agent ([`agent/`](agent/))

Autonomous Python agent with 8 safety guardrails, 4 human-in-the-loop modes, Tavily market intelligence, and a backtesting framework. REST API at `/api/autonomous/*`.

### News Intelligence Pipeline

Real-time market intelligence via SSE streaming, multi-analyst sentiment scoring, source verification, and weighted signal aggregation.

---

## Risk Management

Four-state deterministic sentinel (client-side FSM):

| State | Max Leverage | Behavior |
|-------|-------------|----------|
| **NORMAL** | 4.0x | Full operations |
| **WARNING** | 3.0x | Dynamic fees, elevated monitoring |
| **RESTRICTED** | 1.5x | New positions paused |
| **EMERGENCY** | 0.0x | Withdrawals only |

Transitions based on oracle staleness, price divergence, drawdown, health factor, volatility, and pool utilization. See [Risk Engine docs](docs/RISK-ENGINE.md).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 8, Vanilla JS (ES modules), TradingView Lightweight Charts v4 |
| Styling | Tailwind CSS 4, Bloomberg Terminal aesthetic |
| Wallet | Reown AppKit v1.8 (Ethereum, Ink Sepolia, Solana, TON) |
| Blockchain | viem v2, wagmi v3, @solana/web3.js, @ton/ton |
| Contracts | Solidity ^0.8.0, Foundry, Euler V2 EVK + EVC |
| Oracle | Pyth Network (Hermes pull-oracle, 30+ feeds) |
| Backend | Python FastAPI, PostgreSQL 16, Redis 7 |
| Intelligence | OpenBB Platform, Tavily AI, LLM Analyst |
| Auth | SIWE (Sign-In with Ethereum) |

---

## API Reference

**Data Proxy** ([`server/server.py`](server/server.py) — port 8000): Yahoo Finance CORS proxy for backtesting.

**FastAPI Backend** ([`server/api/main.py`](server/api/main.py) — port 8080):

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/siwe` | Wallet-based authentication |
| `GET /api/positions/{wallet}` | Position history & tracking |
| `GET /api/lending/markets` | Multi-chain lending market data |
| `GET /api/lending/positions/{wallet}` | Cross-chain lending positions |
| `GET/POST /api/agents/{wallet}/runs` | Agent execution history |
| `GET /api/openbb/quote/{symbol}` | Real-time quotes via OpenBB |
| `GET /api/news/trending` | Trending news & sentiment |
| `SSE /api/news/stream` | Real-time news stream |
| `GET /api/prices/{symbol}` | Real-time + historical prices |
| `GET /api/alerts` | Risk alert management |
| `GET /api/admin/stats` | Platform statistics |
| `GET /api/live/oracle` | Live oracle feeds |
| `GET /api/live/risk` | Live risk state |

---

## What's Real vs Simulated

| Component | Status | Details |
|-----------|--------|---------|
| Smart contracts (33 vaults) | **Live** | Deployed on Ink Sepolia + Ethereum Sepolia |
| Pyth oracle prices | **Live** | Real-time Hermes feeds for 30+ assets |
| Backtesting data | **Live** | Historical OHLCV from Yahoo Finance |
| Wallet & transactions | **Live** | Real on-chain via Reown AppKit |
| TradingView charts | **Live** | Real market data |
| Risk sentinel | **Client-side** | Deterministic FSM, not enforced on-chain |
| AI agent | **Dry-run default** | Real tx opt-in, requires private key |
| Junior tranche | **Designed** | In experimental contracts, not deployed |
| Auto-deleverage | **Designed** | In experimental contracts, not deployed |
| Solana/TON vaults | **Ready** | Programs written, not yet deployed |

---

## Project Structure

```
xLever/
├── frontend/              # Vite SPA — 10 HTML screens, 34 JS modules
├── contracts/             # Solidity — VaultSimple (deployed) + experimental modules
├── server/                # Python data proxy + FastAPI backend
├── agent/                 # Autonomous Python AI agent (14 subdirectories)
├── solana/                # Anchor program (Solana port)
├── ton/                   # Tact contracts (TON port)
├── docs/                  # Documentation suite
│   ├── USER-GUIDE.md      # End-user walkthrough
│   ├── GETTING-STARTED.md # Quick start for new users
│   ├── PROTOCOL.md        # Core protocol mechanics
│   ├── SMART-CONTRACTS.md # Contract reference & addresses
│   ├── FRONTEND.md        # UI architecture & modules
│   ├── RISK-ENGINE.md     # Risk sentinel & auto-deleverage
│   ├── API-INTEGRATIONS.md# Oracle, data, backend APIs
│   ├── MULTI-CHAIN-LENDING.md # Cross-chain lending adapters
│   ├── DEPLOYMENT.md      # Build & deployment guide
│   ├── LIVE-VS-PLANNED.md # Deployed vs designed
│   ├── FAQ.md             # Frequently asked questions
│   ├── GLOSSARY.md        # Protocol terminology
│   └── TROUBLESHOOTING.md # Common issues & solutions
├── deployment.json        # Machine-readable vault manifest
├── vite.config.js         # Vite multi-page build config
└── docker-compose.yml     # PostgreSQL + Redis orchestration
```

---

## Documentation

| Doc | For | Link |
|-----|-----|------|
| **User Guide** | End users | [docs/USER-GUIDE.md](docs/USER-GUIDE.md) |
| **Getting Started** | New users | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) |
| **FAQ** | Everyone | [docs/FAQ.md](docs/FAQ.md) |
| **Glossary** | Everyone | [docs/GLOSSARY.md](docs/GLOSSARY.md) |
| **Troubleshooting** | Users & devs | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| **Protocol Mechanics** | Developers | [docs/PROTOCOL.md](docs/PROTOCOL.md) |
| **Smart Contracts** | Developers | [docs/SMART-CONTRACTS.md](docs/SMART-CONTRACTS.md) |
| **Frontend Guide** | Developers | [docs/FRONTEND.md](docs/FRONTEND.md) |
| **Risk Engine** | Developers | [docs/RISK-ENGINE.md](docs/RISK-ENGINE.md) |
| **API Integrations** | Developers | [docs/API-INTEGRATIONS.md](docs/API-INTEGRATIONS.md) |
| **Multi-Chain Lending** | Developers | [docs/MULTI-CHAIN-LENDING.md](docs/MULTI-CHAIN-LENDING.md) |
| **Deployment** | DevOps | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| **Architecture** | Developers | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **Live vs Planned** | Everyone | [docs/LIVE-VS-PLANNED.md](docs/LIVE-VS-PLANNED.md) |

---

## AI Usage Disclosure

| Tool | Purpose |
|------|---------|
| Claude Code | Code generation, architecture design, documentation |
| Stitch MCP | UI/UX design system and screen generation |
| Perplexity API | Real-time market intelligence (in-app integration) |

All AI-generated code was reviewed and integrated by the team.

---

## Team

- **Mads** — Euler V2 EVK integration & smart contract deployment
- **Eric** — AI agent architecture, backend, frontend
- **Maroua** — AI agent, demo video, UI/UX

---

## License

MIT
