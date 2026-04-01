# xLever — Leveraged Tokenized Asset Protocol

Continuous leverage from **-4x to +4x** on tokenized assets, built on **Euler V2 EVK** — no liquidation risk, no volatility decay.

> Fixed-entry leverage that outperforms daily-rebalanced ETFs (TQQQ, SPXL) in trending markets.

---

## Judge Quickstart

**Time to verify: ~2 minutes**

### 1. Run the app (30 seconds)

```bash
# Install dependencies (first time only)
npm install

# Start the data server (background)
cd server && python3 server.py &
cd ..

# Start the frontend dev server
npm run dev
# → opens http://localhost:3000
```

### 2. Demo path (90 seconds)

| Step | Screen | What to verify |
|------|--------|----------------|
| 1 | Landing page | Protocol overview, connect wallet (4 chains supported) |
| 2 | Dashboard | Portfolio PnL, asset allocation, Pyth oracle status |
| 3 | Trading Terminal | Real chart data (QQQ/SPY), -4x to +4x leverage slider, order entry |
| 4 | Backtesting | **Key demo**: Run backtest with real market data. Compare LTAP fixed-entry vs daily-reset leverage |
| 5 | Vault Management | Senior/Junior tranche deposit UI, Euler V2 vault visualization |
| 6 | Risk Management | Risk sentinel live state, auto-deleverage triggers, oracle health |
| 7 | AI Agent Ops | Smart agent control panel, bounded policy execution |
| 8 | Operations Control | System health, transaction tracking |
| 9 | Admin Dashboard | Platform stats, user activity, session tracking |

### 3. Key technical proof

- **Backtesting engine** ([frontend/app.js](frontend/app.js)): 1,400+ lines implementing the full LTAP leverage simulation — fixed-entry vs daily-reset comparison using real Yahoo Finance data via Python proxy, with circuit breakers, 5-level auto-deleverage, slippage modeling, and releveraging logic
- **Pyth oracle integration** ([frontend/pyth.js](frontend/pyth.js)): Live Hermes client fetching price update data (QQQ, SPY, AAPL, NVDA, TSLA, ETH) for on-chain pull-oracle transactions with staleness and divergence checks
- **Contract adapter** ([frontend/contracts.js](frontend/contracts.js)): viem-based interface for deployed Vault + ERC-20 + Pyth adapter contracts on Ink Sepolia — handles approve flows, Pyth fee estimation, position formatting
- **Risk engine** ([frontend/risk-engine.js](frontend/risk-engine.js)): Deterministic 4-state risk sentinel (NORMAL → WARNING → RESTRICTED → EMERGENCY) with auto-deleverage recommendations, oracle health checks, and scenario simulation runner
- **AI agent executor** ([frontend/agent-executor.js](frontend/agent-executor.js)): Bounded smart-account automation with 3 policy modes (Safe, Target Exposure, Accumulation) — gathers live state from Pyth + on-chain + OpenBB, enforces permission boundaries in code
- **OpenBB intelligence** ([frontend/openbb.js](frontend/openbb.js)): Market intelligence client providing real-time quotes, historical data, options chains, and curated dashboard context for agent decision-making
- **News intelligence pipeline** ([frontend/news-ingest.js](frontend/news-ingest.js), [frontend/news-analysts.js](frontend/news-analysts.js), [frontend/news-verifier.js](frontend/news-verifier.js)): Real-time news ingestion via SSE, multi-analyst scoring, source credibility verification, and signal extraction for agent context
- **Signal aggregator** ([frontend/signal-aggregator.js](frontend/signal-aggregator.js)): Combines signals from news, oracle, and market data into weighted trading signals for agent decision-making
- **Agent coordinator** ([frontend/agent-coordinator.js](frontend/agent-coordinator.js)): Multi-agent swarm orchestration — coordinates multiple bounded agents with shared state and conflict resolution
- **Shared navigation** ([frontend/nav.js](frontend/nav.js)): Reusable navigation component with mobile drawer, network badge, and risk sentinel banner across all pages
- **Admin dashboard** ([frontend/08-admin-dashboard.html](frontend/08-admin-dashboard.html)): Platform-wide analytics — user stats, daily/hourly activity charts, session tracking
- **Consumer UX** ([frontend/ux.js](frontend/ux.js)): Production-grade UX layer with toast notifications, trade confirmation modals (real + simulated tx paths), interactive leverage slider, and skeleton loading states
- **Protocol design**: 80KB architecture document covering vault mechanics, fee engine, circuit breakers, and Euler V2 integration ([protocol.md](protocol.md))

---

## What is Real vs What is Simulated

| Component | Status | Details |
|-----------|--------|---------|
| Frontend (9 screens) | **Live** | Vite-bundled, Bloomberg Terminal aesthetic |
| Wallet connection | **Live** | Reown AppKit — Ethereum, Ink Sepolia, Solana, TON |
| Smart contracts | **Deployed** | Vault, VaultFactory, PythOracleAdapter on Ink Sepolia |
| Pyth oracle | **Live** | Hermes price feeds for QQQ, SPY, AAPL, NVDA, TSLA, ETH |
| Risk engine | **Live** | Deterministic 4-state sentinel with live oracle/position inputs |
| Backtesting engine | **Live** | Real Yahoo Finance data, LTAP fixed-entry leverage simulation |
| Trading charts | **Live** | TradingView Lightweight Charts with real QQQ/SPY data |
| Data server | **Live** | Python proxy serving Yahoo Finance data with caching |
| OpenBB intelligence | **Live** | Market snapshots, options context, agent tooling |
| News intelligence | **Live** | Real-time news ingestion, analyst scoring, signal aggregation |
| AI agent trading | **Bounded** | Policy-based executor with real tx capabilities (dry-run default) |
| Admin dashboard | **Live** | User stats, activity charts, session tracking |

---

## Architecture

```
User Layer
  Senior Users (-4x to +4x leverage)  ←→  Junior LPs (first-loss buffer)
         │                                        │
         ▼                                        ▼
Core Protocol (Vault on Ink Sepolia)
  Position Manager  │  Exposure Aggregator  │  Fee Engine  │  Risk Sentinel
         │
         ▼
Oracle + Intelligence
  Pyth Hermes (on-chain pull-oracle)  │  OpenBB (off-chain analytics/agent context)
         │
         ▼
External Protocols
  Euler V2 Markets (EVC atomic looping)  │  xStocks (wQQQx, wSPYx)
```

**How it works:**
1. Senior users deposit USDC, pick leverage (-4x to +4x)
2. Protocol handles lending/borrowing on Euler V2 atomically (single tx via EVC)
3. PnL = Deposit x Leverage x Price Change — no daily rebalancing, no volatility decay
4. Junior LPs provide first-loss capital, earn 70% of fee revenue
5. No liquidations — 5-level auto-deleverage cascade protects the system
6. Risk sentinel monitors oracle freshness, drawdown, health factor, volatility, and pool utilization

**Fee model:** `0.5% + 0.5% x |leverage - 1|` annually

**Auto-deleverage cascade:**
| Level | Trigger (Underlying DD) | Action |
|-------|------------------------|--------|
| 0 | < 10% | No action |
| 1 | 10% | Reduce leverage 25% |
| 2 | 15% | Reduce leverage 50% |
| 3 | 22% | Cap at 1.5x |
| 4 | 30% | Force to 1.0x |
| 5 | 40% | Full liquidation |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite + Vanilla JS/CSS, TradingView Lightweight Charts |
| Wallet | Reown AppKit (Ethereum, Ink Sepolia, Solana, TON) |
| Contracts | Solidity, Euler V2 EVK + EVC, deployed on Ink Sepolia |
| Oracle | Pyth Network (Hermes pull-oracle) |
| Intelligence | OpenBB Platform (market data, options, agent context) |
| News | Real-time ingestion, analyst scoring, signal aggregation |
| Backend | Python — simple HTTP proxy + FastAPI with PostgreSQL |
| Risk | Deterministic 4-state sentinel engine |
| Styling | Bloomberg Terminal dark aesthetic (custom CSS) |

---

## Project Structure

```
xLever/
├── frontend/                           # 12,000+ LOC interactive UI
│   ├── index.html                      # Landing page with protocol overview
│   ├── 01-dashboard.html               # Portfolio command center
│   ├── 02-trading-terminal.html        # TradingView charts + leverage trading
│   ├── 03-ai-agent-operations.html     # Bounded agent control panel
│   ├── 04-vault-management.html        # Euler V2 vault deposit/withdraw
│   ├── 05-risk-management.html         # Risk sentinel visualization
│   ├── 06-analytics-backtesting.html   # LTAP vs daily-reset backtesting
│   ├── 07-operations-control.html      # System health + tx tracking
│   ├── 08-admin-dashboard.html         # Admin panel — user stats, activity
│   ├── risk-engine.test.html           # Risk engine test harness
│   ├── wallet.js                       # Reown AppKit (4-chain wallet)
│   ├── contracts.js                    # viem contract adapter (Vault + ERC-20)
│   ├── pyth.js                         # Pyth Hermes oracle client
│   ├── assets.js                       # Canonical Pyth feed IDs per asset
│   ├── risk-engine.js                  # 4-state risk sentinel engine
│   ├── risk-live.js                    # Live risk dashboard polling
│   ├── agent-executor.js               # AI agent with bounded policies
│   ├── agent-coordinator.js            # Multi-agent swarm coordinator
│   ├── news-ingest.js                  # Real-time news ingestion + SSE stream
│   ├── news-analysts.js                # News analyst scoring pipeline
│   ├── news-verifier.js                # Source verification / credibility
│   ├── signal-aggregator.js            # Trading signal aggregation
│   ├── nav.js                          # Shared navigation component
│   ├── openbb.js                       # OpenBB market intelligence client
│   ├── app.js                          # LTAP backtesting engine (1,400+ LOC)
│   ├── ux.js                           # UX layer (toasts, modals, slider)
│   ├── viem-shim.js                    # viem window bridge for non-module scripts
│   └── styles.css                      # Bloomberg Terminal aesthetic CSS
│
├── contracts/                          # Solidity smart contracts
│   ├── src/xLever/                     # Core protocol contracts
│   │   ├── Vault.sol                   # Main vault with module dispatch
│   │   ├── VaultSimple.sol             # Lightweight vault (no fees/hedging)
│   │   ├── VaultFactory.sol            # Deploy and register vaults
│   │   ├── modules/                    # Protocol modules
│   │   │   ├── PositionModule.sol      # User position tracking
│   │   │   ├── EulerHedgingModule.sol  # Euler V2 EVC looping
│   │   │   ├── FeeEngine.sol           # Dynamic fee calculation
│   │   │   ├── RiskModule.sol          # Health monitor + auto-deleverage
│   │   │   ├── JuniorTranche.sol       # First-loss capital pool
│   │   │   ├── PythOracleAdapter.sol   # Pyth price feeds
│   │   │   └── TWAPOracle.sol          # 15-min TWAP with dynamic spread
│   │   ├── interfaces/                 # Contract interfaces
│   │   └── libraries/DataTypes.sol     # Shared data structures
│   ├── script/                         # 23 Foundry deployment scripts
│   ├── test/                           # Foundry tests
│   ├── audits/                         # 13 security audit PDFs
│   └── lib/                            # Git submodules (EVC, OZ, Permit2)
│
├── server/                             # Python backend
│   ├── server.py                       # Simple HTTP + Yahoo Finance proxy
│   └── api/                            # FastAPI application
│       ├── main.py                     # App entry point
│       ├── config.py                   # Pydantic settings
│       ├── database.py                 # SQLAlchemy async engine
│       ├── models.py                   # ORM models (User, Position, Agent, Alert)
│       ├── schemas.py                  # Pydantic request/response schemas
│       └── routes/                     # API endpoints
│           ├── prices.py               # Yahoo Finance proxy with DB cache
│           ├── positions.py            # Position history + stats
│           ├── agents.py               # Agent run lifecycle
│           ├── alerts.py               # Risk/price alert management
│           ├── openbb.py               # OpenBB market intelligence
│           ├── news.py                 # News ingestion + SSE streaming
│           ├── admin.py                # Admin stats + activity tracking
│           └── users.py                # Wallet-based user management
│
├── dist/                               # Vite production build output
├── vite.config.js                      # Vite bundler + dev server config
├── package.json                        # npm dependencies
├── docker-compose.yml                  # PostgreSQL + Redis for backend
├── vercel.json                         # Vercel deployment config
├── deployment.json                     # Current deployed contract addresses
├── protocol.md                         # Full protocol architecture (80KB)
├── MADS_README.md                      # Status update for Mads (Euler V2 specialist)
├── DEMO_SCRIPT.md                      # 2-minute demo shot list
├── SUBMISSION_CHECKLIST.md             # Judge verification checklist
└── README.md                           # You are here
```

---

## Code Documentation

Every line of code in the codebase is commented explaining **why** it exists — not just what it does. This includes:
- All frontend JavaScript modules (wallet, contracts, pyth, risk engine, agent, UX, backtesting)
- All Solidity smart contracts and deployment scripts
- All Python backend files (server, API routes, models, schemas)
- CSS styles and configuration files

---

## Deployed Contracts (Ink Sepolia)

| Contract | Address |
|----------|---------|
| EVC | `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c` |
| QQQ Vault | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` |
| SPY Vault | `0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228` |
| USDC | `0x6b57475467cd854d36Be7FB614caDa5207838943` |
| wQQQx | `0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9` |
| wSPYx | `0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e` |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| PythAdapter | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` |

---

## Run Locally

```bash
# Prerequisites: Node.js 18+, Python 3

# 1. Install dependencies
npm install

# 2. Start data server (serves Yahoo Finance data for backtesting)
cd server && python3 server.py &
cd ..

# 3. Start dev server (Vite, opens browser automatically)
npm run dev
# → http://localhost:3000

# 4. (Optional) Start backend services for full API
docker compose up -d          # PostgreSQL + Redis
pip install -r server/requirements.txt
uvicorn server.api.main:app --reload --port 8000

# 5. Build for production
npm run build
# → output in dist/
```

---

## Risk Sentinel States

| State | Color | Max Leverage | Trigger Conditions |
|-------|-------|-------------|-------------------|
| NORMAL | Green | 4.0x | All metrics healthy |
| WARNING | Yellow | 3.0x | Oracle aging (>5m), 1% divergence, 5% drawdown, health <1.5, vol >50%, util >75% |
| RESTRICTED | Orange | 1.5x | Oracle stale (>15m), 3% divergence, 15% drawdown, health <1.2, vol >80%, util >90% |
| EMERGENCY | Red | 0.0x | 30%+ drawdown, health <1.05 |

---

## AI Agent Policy Modes

| Mode | Can Open | Can Close | Can Adjust | Use Case |
|------|----------|-----------|------------|----------|
| Safe | No | Yes | Reduce only | Stop-loss, vol protection |
| Target Exposure | No | No | Within band | Maintain target leverage |
| Accumulate | Yes (bounded) | Profit-take | No | DCA with auto take-profit |

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

## License

MIT
