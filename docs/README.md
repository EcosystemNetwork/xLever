# xLever Documentation

**Leveraged Tokenized Asset Protocol (LTAP)**

Continuous leverage from **-4x to +4x** on tokenized assets, built on **Euler V2 EVK** — zero liquidation risk, zero volatility decay.

---

## Table of Contents

| Document | Description |
|----------|-------------|
| [Protocol Mechanics](PROTOCOL.md) | Core protocol design — fixed-entry leverage, two-tranche system, fee model, exposure netting |
| [Smart Contracts](SMART-CONTRACTS.md) | Contract architecture, ABIs, deployed addresses, data structures |
| [Frontend Guide](FRONTEND.md) | Screens, components, UI architecture, wallet connection |
| [Risk Engine](RISK-ENGINE.md) | Risk sentinel FSM, auto-deleverage cascade, circuit breakers, loss waterfall |
| [API Integrations](API-INTEGRATIONS.md) | Pyth oracle, OpenBB intelligence, Yahoo Finance proxy, FastAPI backend |
| [Deployment](DEPLOYMENT.md) | Environment setup, build process, deployment targets, supported assets |

---

## Quick Start

```bash
# Prerequisites: Node.js 18+, Python 3

# 1. Install dependencies
npm install

# 2. Start data server (background)
cd server && python3 server.py &
cd ..

# 3. Start dev server
npm run dev
# → http://localhost:3000
```

---

## What is xLever?

xLever is a **Leveraged Tokenized Asset Protocol** that enables continuous leverage from **-4x to +4x** on tokenized assets (xStocks like wQQQx, wSPYx) without liquidation risk for users.

### Key Differentiators

- **Fixed-Entry Leverage** — Leverage is locked at entry, not rebalanced daily. No volatility decay.
- **No Liquidations** — Two-tranche system (Senior/Junior) socializes risk. Junior absorbs first losses.
- **Atomic Euler V2 Integration** — EVC enables leverage construction in a single transaction.
- **Deterministic Risk Management** — Auto-deleverage cascade based on health thresholds, not individual liquidations.

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
  Senior Users (-4x to +4x leverage)  <-->  Junior LPs (first-loss buffer)
         |                                        |
         v                                        v
Core Protocol (Vault on Ink Sepolia)
  Position Manager  |  Exposure Aggregator  |  Fee Engine
         |
         v
Oracle + Intelligence
  Pyth (on-chain execution oracle)  |  OpenBB (off-chain analytics)
         |
         v
External Protocols
  Euler V2 Markets  |  xStocks (wQQQx, wSPYx)  |  DEX Aggregator
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite + Vanilla JS/CSS, TradingView Lightweight Charts v4.1.3 |
| Styling | Tailwind CSS (Material Design 3 tokens), Bloomberg Terminal aesthetic |
| Wallet | Reown AppKit (Ethereum, Ink Sepolia, Solana, TON) |
| Blockchain Library | viem v2.47.6 + wagmi v3.6.0 |
| Smart Contracts | Solidity ^0.8.0, Foundry, Euler V2 EVK + EVC |
| Oracle | Pyth Network (Hermes pull-oracle) |
| Intelligence | OpenBB Platform (market data, options, agent context) |
| Backend | Python FastAPI + uvicorn, PostgreSQL, Redis |
| Data Proxy | Python CORS proxy for Yahoo Finance |

---

## Project Structure

```
xLever/
├── frontend/                          # Vite-bundled SPA (8 screens)
│   ├── index.html                     # Landing page
│   ├── 01-dashboard.html              # Portfolio command center
│   ├── 02-trading-terminal.html       # Trading + charting
│   ├── 03-ai-agent-operations.html    # AI agent control panel
│   ├── 04-vault-management.html       # Euler V2 vault UI
│   ├── 05-risk-management.html        # Risk sentinel dashboard
│   ├── 06-analytics-backtesting.html  # Backtesting engine
│   ├── 07-operations-control.html     # System operations
│   ├── app.js                         # LTAP backtesting engine (1,100+ lines)
│   ├── wallet.js                      # Reown AppKit (4-chain wallet)
│   ├── contracts.js                   # viem contract adapter
│   ├── pyth.js                        # Pyth Hermes client
│   ├── risk-engine.js                 # Risk sentinel FSM
│   ├── openbb.js                      # OpenBB intelligence client
│   ├── agent-executor.js              # Bounded AI agent automation
│   ├── ux.js                          # UX layer (toasts, modals)
│   └── styles.css                     # Global styles
├── contracts/                         # Solidity smart contracts
│   └── src/xLever/
│       ├── Vault.sol                  # Main vault (entry point)
│       ├── VaultFactory.sol           # Deploys & registers vaults
│       ├── interfaces/IVault.sol      # Vault interface
│       └── modules/
│           ├── PositionModule.sol     # Track user positions
│           ├── FeeEngine.sol          # Dynamic fee calculation
│           ├── EulerHedgingModule.sol # Euler V2 looping via EVC
│           ├── RiskModule.sol         # Health monitoring
│           ├── TWAPOracle.sol         # 15-min TWAP + dynamic spread
│           ├── PythOracleAdapter.sol  # Pyth pull-oracle wrapper
│           └── JuniorTranche.sol      # First-loss capital pool
├── server/                            # Data proxy & API
│   ├── server.py                      # Python CORS proxy (Yahoo Finance)
│   ├── api/main.py                    # FastAPI backend
│   └── api/routes/                    # API endpoints
├── docs/                              # Documentation (you are here)
├── protocol.md                        # 80KB architecture document
├── vite.config.js                     # Vite build config
├── package.json                       # Node dependencies
└── .env                               # Deployment configuration
```

---

## Team

- **Mads** — Euler V2 EVK integration & smart contract deployment
- **Eric** — AI agent architecture & trading logic
- **Maroua** — AI agent, demo video, UI/UX

---

## License

MIT
