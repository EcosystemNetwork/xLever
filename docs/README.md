# xLever Documentation

**Leveraged Tokenized Asset Protocol (LTAP)**

Continuous leverage from **-4x to +4x** on 33 tokenized assets, built on **Euler V2 EVK** — zero liquidation risk, zero volatility decay.

**Live at [xlever.markets](https://xlever.markets)**

---

## Table of Contents

| Document | Description |
|----------|-------------|
| [Protocol Mechanics](PROTOCOL.md) | Core protocol design — fixed-entry leverage, two-tranche system, fee model, exposure netting |
| [Smart Contracts](SMART-CONTRACTS.md) | Contract architecture, ABIs, deployed addresses (33 vaults), data structures |
| [Frontend Guide](FRONTEND.md) | 10 screens, components, UI architecture, wallet connection |
| [Risk Engine](RISK-ENGINE.md) | Risk sentinel FSM, auto-deleverage cascade, circuit breakers, loss waterfall |
| [API Integrations](API-INTEGRATIONS.md) | Pyth oracle, OpenBB intelligence, Yahoo Finance proxy, FastAPI backend |
| [Multi-Chain Lending](MULTI-CHAIN-LENDING.md) | Lending adapters — Euler V2 (EVM), Kamino (Solana), EVAA (TON) |
| [Deployment](DEPLOYMENT.md) | Environment setup, build process, deployment targets, supported assets |
| [Live vs Planned](LIVE-VS-PLANNED.md) | What's deployed vs in design phase |

---

## Quick Start

```bash
# Prerequisites: Node.js 18+, Python 3.10+

# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env   # then fill in your keys

# 3. Start data server (Yahoo Finance proxy)
cd server && python3 server.py &
cd ..

# 4. Start dev server
npm run dev
# → http://localhost:3000
```

**Optional — FastAPI backend:**
```bash
cd server && pip install -r requirements.txt
uvicorn api.main:app --port 8080
```

---

## What is xLever?

xLever is a **Leveraged Tokenized Asset Protocol** that enables continuous leverage from **-4x to +4x** on tokenized assets (xStocks like wQQQx, wSPYx, and 31 more) without liquidation risk for users.

### Key Differentiators

- **Fixed-Entry Leverage** — Leverage is locked at entry, not rebalanced daily. No volatility decay.
- **No Liquidations** — Two-tranche system (Senior/Junior) socializes risk. Junior absorbs first losses.
- **Atomic Euler V2 Integration** — EVC enables leverage construction in a single transaction.
- **Deterministic Risk Management** — Auto-deleverage cascade based on health thresholds, not individual liquidations.
- **33 Assets** — ETFs, stocks, and commodities with Pyth oracle price feeds.

### How It Works

**For Senior Users (Leverage Traders):**
1. Deposit USDC, pick leverage (-4x to +4x)
2. Protocol handles all lending/borrowing on Euler V2 behind the scenes
3. PnL = Deposit x Leverage x (Price Change %)
4. Increase, decrease, or exit at any time
5. Max loss = your deposit (no debt, no liquidation)

**For Junior LPs (First-Loss Capital):**
1. Deposit USDC as a risk buffer protecting senior users
2. Earn fees from all senior activity (70% of protocol revenue)
3. First to absorb losses if the pool loses money
4. Can be fully wiped in extreme events — high risk, high yield

### Why No Liquidation?

Traditional leveraged lending liquidates individual users. xLever instead socializes risk through the **junior tranche** — a pool of first-loss capital that absorbs drawdowns before they reach senior users. Junior LPs accept this risk in exchange for fee revenue. The protocol auto-deleverages the entire pool as health degrades, rather than liquidating individuals.

---

## Architecture Overview

```
User Layer
  Senior Users (-4x to +4x)     Junior LPs (first-loss buffer)
         |                               |
         v                               v
Protocol Layer (33 VaultSimple contracts on Ink Sepolia)
  Position Manager  |  Fee Engine  |  Exposure Aggregator
         |
         v
Oracle + Intelligence
  Pyth (on-chain TWAP)  |  OpenBB (off-chain analytics)  |  Tavily (AI intel)
         |
         v
External Protocols
  Euler V2 (EVM)  |  Kamino (Solana)  |  EVAA (TON)  |  xStocks (wQQQx, wSPYx)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 8 + Vanilla JS, TradingView Lightweight Charts v4.1.3 |
| Styling | Tailwind CSS 4.2.2, Bloomberg Terminal aesthetic |
| Wallet | Reown AppKit v1.8.19 (Ethereum, Ink Sepolia, Solana, TON) |
| Blockchain | viem v2.47.6, wagmi v3.6.0, @solana/web3.js, @ton/ton |
| Smart Contracts | Solidity ^0.8.0, Foundry, Euler V2 EVK + EVC |
| Lending Protocols | Euler V2 (EVM), Kamino Finance (Solana), EVAA Protocol (TON) |
| Oracle | Pyth Network (Hermes pull-oracle, 30+ feeds) |
| Intelligence | OpenBB Platform, Tavily AI |
| Backend | Python FastAPI + uvicorn, PostgreSQL, Redis |
| Auth | SIWE (Sign-In with Ethereum) |
| Data Proxy | Python CORS proxy for Yahoo Finance |

---

## Project Structure

```
xLever/
├── frontend/                          # Vite-bundled SPA
│   ├── index.html                     # Landing page
│   ├── 01-dashboard.html              # Portfolio command center
│   ├── 02-trading-terminal.html       # Trading + charting
│   ├── 03-ai-agent-operations.html    # AI agent control panel
│   ├── 04-vault-management.html       # Euler V2 vault UI
│   ├── 05-risk-management.html        # Risk sentinel dashboard
│   ├── 06-analytics-backtesting.html  # Backtesting engine
│   ├── 07-operations-control.html     # System operations
│   ├── 08-admin-dashboard.html        # Admin controls
│   ├── 09-lending-borrowing.html      # Cross-chain lending
│   ├── app.js                         # LTAP backtesting engine
│   ├── wallet.js                      # Reown AppKit (4-chain wallet)
│   ├── contracts.js                   # viem contract adapter (33 vaults)
│   ├── lending-adapters.js            # Multi-chain lending (Euler/Kamino/EVAA)
│   ├── lending-agent.js               # Chain-agnostic lending automation
│   ├── pyth.js                        # Pyth Hermes client
│   ├── risk-engine.js                 # Risk sentinel FSM
│   ├── openbb.js                      # OpenBB intelligence client
│   ├── agent-executor.js              # Bounded AI agent automation
│   ├── agent-coordinator.js           # Multi-agent swarm coordinator
│   ├── news-ingest.js                 # News aggregation pipeline
│   ├── news-analysts.js               # Multi-analyst sentiment scoring
│   ├── news-verifier.js               # Source credibility verification
│   ├── signal-aggregator.js           # Weighted signal generation
│   ├── position-manager.js            # Position tracking & PnL
│   ├── llm-analyst.js                 # LLM-powered analysis
│   ├── ux.js                          # UX layer (toasts, modals, slider)
│   └── styles.css                     # Global styles
├── contracts/                         # Solidity smart contracts
│   └── src/xLever/
│       ├── VaultSimple.sol            # Deployed — 33 vaults on Ink Sepolia
│       ├── VaultFactory.sol           # Deploys & registers vaults
│       ├── VaultWithLooping.sol       # EVC recursive looping variant
│       ├── VaultWithHedging.sol       # Hedging-enabled variant
│       └── experimental/modules/      # Modular vault components (planned)
├── server/                            # Data proxy & API
│   ├── server.py                      # Python CORS proxy (Yahoo Finance)
│   ├── api/main.py                    # FastAPI backend
│   └── api/routes/                    # API endpoints
├── agent/                             # Autonomous Python AI agent
│   ├── strategy/                      # LLM strategy & rule engine
│   ├── execution/                     # Web3 client & tx builder
│   ├── risk/                          # Health monitor & position sizing
│   ├── intelligence/                  # Tavily market intelligence
│   ├── hitl/                          # Human-in-the-Loop controller
│   ├── monitor/                       # Metrics & alerts
│   └── websocket/                     # Real-time event broadcasting
├── solana/                            # Anchor program (Solana port)
├── ton/                               # Tact contracts (TON port)
├── docs/                              # Documentation (you are here)
├── protocol.md                        # 80KB architecture document
├── deployment.json                    # Machine-readable deployment manifest
├── vite.config.js                     # Vite build configuration
└── docker-compose.yml                 # Container orchestration
```

---

## Multi-Chain Status

| Chain | Network | Vaults | Status |
|-------|---------|--------|--------|
| Ink Sepolia | 763373 | 33 | Live |
| Ethereum Sepolia | 11155111 | 33 | Live (mirrored) |
| Solana | Devnet | — | Ready to deploy |
| TON | Testnet | — | Ready to deploy |

See [MULTI-CHAIN-LENDING.md](MULTI-CHAIN-LENDING.md) and the root [MULTI_CHAIN_STATUS.md](../MULTI_CHAIN_STATUS.md) for details.

---

## Team

- **Mads** — Euler V2 EVK integration & smart contract deployment
- **Eric** — AI agent architecture, backend, frontend
- **Maroua** — AI agent, demo video, UI/UX

---

## License

MIT
