# xLever — Leveraged Tokenized Asset Protocol

Continuous leverage from **-4x to +4x** on 33 tokenized assets without liquidation risk, powered by Euler V2 EVK.

**Live at [xlever.markets](https://xlever.markets)**

---

## What is xLever?

xLever enables fixed-entry leverage on tokenized assets (wQQQx, wSPYx, and 31 more) through a two-tranche system built on Euler V2. Unlike daily-rebalanced ETFs (TQQQ, SPXL), leverage is locked at entry — no volatility decay, no daily reset.

**For Traders (Senior Tranche):** Deposit USDC, pick leverage (-4x to +4x), and your PnL = Deposit x Leverage x Price Change. Max loss = your deposit. No liquidation, no debt.

**For LPs (Junior Tranche):** Deposit USDC as first-loss capital protecting traders. Earn 70% of protocol fees. Higher risk, higher yield.

**Why no liquidation?** Risk is socialized through the junior tranche instead of liquidating individuals. The protocol auto-deleverages the entire pool as health degrades.

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

**Optional — FastAPI backend (positions, auth, lending):**
```bash
cd server && pip install -r requirements.txt
uvicorn api.main:app --port 8080
```

---

## Architecture

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

## Frontend (9 Screens)

| Screen | File | Description |
|--------|------|-------------|
| Landing | `index.html` | Protocol overview, wallet connect, 1Y comparison chart |
| Dashboard | `01-dashboard.html` | Portfolio PnL, asset allocation, health metrics |
| Trading Terminal | `02-trading-terminal.html` | TradingView charts, leverage slider, order entry |
| AI Agent | `03-ai-agent-operations.html` | Agent control panel, 3 policy modes, execution log |
| Vault Management | `04-vault-management.html` | Senior/Junior tranche deposits, Euler V2 health |
| Risk Management | `05-risk-management.html` | 4-state sentinel, circuit breakers, auto-deleverage |
| Analytics | `06-analytics-backtesting.html` | LTAP vs daily-reset backtesting with real data |
| Operations | `07-operations-control.html` | Transaction history, protocol state, governance |
| Admin | `08-admin-dashboard.html` | Platform stats, activity charts, user management |
| Lending | `09-lending-borrowing.html` | Cross-chain lending markets (Euler/Kamino/EVAA) |

---

## Multi-Chain Deployments

### Ink Sepolia (Primary) — 33 vaults live

| Contract | Address |
|----------|---------|
| EVC | `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c` |
| USDC | `0x6b57475467cd854d36Be7FB614caDa5207838943` |
| wQQQx | `0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9` |
| wSPYx | `0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e` |
| Pyth Oracle | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| PythOracleAdapter | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` |
| QQQ Vault | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` |
| SPY Vault | `0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228` |

**33 supported assets:** QQQ, SPY, VUG, VGK, VXUS, SGOV, SMH, XLE, XOP, ITA, AAPL, NVDA, TSLA, DELL, SMCI, ANET, VRT, SNDK, KLAC, LRCX, AMAT, TER, CEG, GEV, SMR, ETN, PWR, APLD, SLV, PPLT, PALL, STRK, BTGO

Full vault address list in `deployment.json` and `frontend/contracts.js`.

### Ethereum Sepolia — 33 vaults mirrored

Full mirror deployment. Frontend supports chain switching via `switchChain(11155111)`.

### Solana (Devnet) — Ready to deploy

Anchor program at `solana/`. Mirrors EVM vault logic with Pyth oracle integration.

```bash
cd solana && anchor build && anchor deploy --provider.cluster devnet
```

### TON (Testnet) — Ready to deploy

Tact contracts at `ton/`. All 33 Pyth feed IDs configured.

```bash
cd ton && npm install && npx tact --config tact.config.json
npx ts-node scripts/deployFactory.ts && npx ts-node scripts/deployAllVaults.ts
```

---

## Smart Contracts

**Deployed:** `VaultSimple.sol` — lightweight vault with deposit, withdraw, adjust leverage, Pyth oracle pricing.

**Experimental (designed, not deployed):** Modular `Vault.sol` with PositionModule, FeeEngine, EulerHedgingModule, RiskModule, TWAPOracle, JuniorTranche, PythOracleAdapter. Exceeds deployment size limits — planned for mainnet via proxy patterns.

See [docs/LIVE-VS-PLANNED.md](docs/LIVE-VS-PLANNED.md) for details.

### Testing

```bash
cd contracts && forge test
# Looping tests specifically:
forge test --match-contract VaultWithLoopingTest -vv
```

---

## AI Agent System

### Frontend Agent (`frontend/agent-executor.js`)
Bounded policy executor running client-side with 3 modes:
- **Safe** — Stop-loss monitoring, risk alerts
- **Target Exposure** — Maintain leverage band automatically
- **Accumulate** — DCA into positions on schedule

### Backend Agent (`agent/`)
Autonomous Python agent with:
- 8 safety guardrails (max leverage, health guard, daily loss limit, etc.)
- 4 HITL modes (autonomous, approval_required, approval_above_threshold, notifications_only)
- Tavily market intelligence integration
- Backtesting framework with Sharpe ratio, drawdown analysis
- WebSocket real-time event broadcasting
- REST API at `/api/autonomous/*`

### News Intelligence Pipeline
- `news-ingest.js` — SSE streaming, priority classification
- `news-analysts.js` — Multi-analyst sentiment scoring
- `news-verifier.js` — Source credibility verification
- `signal-aggregator.js` — Weighted signal generation for agent decisions

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 8 + Vanilla JS, TradingView Lightweight Charts v4.1.3 |
| Styling | Tailwind CSS 4.2.2, Bloomberg Terminal aesthetic |
| Wallet | Reown AppKit v1.8.19 (4 chains) |
| Blockchain | viem v2.47.6, wagmi v3.6.0, @solana/web3.js, @ton/ton |
| Contracts | Solidity ^0.8.0, Foundry, Euler V2 EVK + EVC |
| Lending | Euler V2 (EVM), Kamino Finance (Solana), EVAA Protocol (TON) |
| Oracle | Pyth Network (Hermes pull-oracle, 30+ feeds) |
| Intelligence | OpenBB Platform, Tavily AI |
| Backend | Python FastAPI, PostgreSQL, Redis |
| Auth | SIWE (Sign-In with Ethereum) |

---

## Server API

**Data Proxy** (`server/server.py` — port 8000): Yahoo Finance CORS proxy with caching.

**FastAPI Backend** (`server/api/main.py` — port 8080):

| Endpoint Group | Description |
|----------------|-------------|
| `POST /api/auth/siwe` | Wallet-based authentication |
| `GET /api/positions/{wallet}` | Position history & tracking |
| `GET /api/lending/markets` | Multi-chain lending market data |
| `GET /api/lending/positions/{wallet}` | Cross-chain positions |
| `GET/POST /api/agents/{wallet}/runs` | Agent execution history |
| `GET /api/openbb/quote/{symbol}` | Real-time quotes via OpenBB |
| `GET /api/news/trending` | Trending news & sentiment |
| `GET /api/alerts` | Risk alert management |

---

## Project Structure

```
xLever/
├── frontend/              # Vite SPA (10 HTML screens, 30+ JS modules)
├── contracts/             # Solidity — VaultSimple (deployed), experimental modules
├── server/                # Python data proxy + FastAPI backend
├── agent/                 # Autonomous Python AI agent
├── solana/                # Anchor program (Solana port)
├── ton/                   # Tact contracts (TON port)
├── docs/                  # Full documentation suite
│   ├── PROTOCOL.md        # Core protocol mechanics
│   ├── SMART-CONTRACTS.md # Contract reference & addresses
│   ├── FRONTEND.md        # UI architecture & screens
│   ├── RISK-ENGINE.md     # Risk sentinel & auto-deleverage
│   ├── API-INTEGRATIONS.md# Oracle, data, backend APIs
│   ├── MULTI-CHAIN-LENDING.md # Cross-chain lending adapters
│   ├── DEPLOYMENT.md      # Build & deployment guide
│   └── LIVE-VS-PLANNED.md # What's deployed vs designed
├── protocol.md            # 80KB architecture document
├── deployment.json        # Machine-readable deployment manifest
├── vite.config.js         # Vite build configuration
└── docker-compose.yml     # Container orchestration
```

---

## What is Real vs Simulated

| Component | Status | Details |
|-----------|--------|---------|
| Smart contracts | **Real** | 33 VaultSimple vaults deployed on Ink Sepolia + Ethereum Sepolia |
| Pyth oracle prices | **Real** | Live Hermes price feeds for 30+ assets |
| Backtesting data | **Real** | Historical OHLCV from Yahoo Finance |
| OpenBB market data | **Real** | Live quotes, options chains |
| Wallet connection | **Real** | Reown AppKit with on-chain transactions |
| Trading terminal charts | **Real** | TradingView with live data |
| Risk sentinel | **Simulated** | Client-side FSM with demo scenarios |
| AI agent execution | **Simulated** | Dry-run default, real tx opt-in |
| Junior tranche | **Simulated** | Designed but not in VaultSimple |
| Auto-deleverage | **Simulated** | In experimental contracts, not deployed |
| Solana/TON vaults | **Ready** | Programs written, not yet deployed |

---

## AI Usage Disclosure

This project was built with AI assistance:
- **Claude Code** — Code generation, architecture design, documentation
- **Stitch MCP** — UI/UX design system and screen generation
- **Perplexity API** — Market research and intelligence integration

All AI-generated code was reviewed and integrated by the team.

---

## Team

- **Mads** — Euler V2 EVK integration & smart contract deployment
- **Eric** — AI agent architecture, backend, frontend
- **Maroua** — AI agent, demo video, UI/UX

---

## Documentation

Full docs at [docs/](docs/):
- [Protocol Mechanics](docs/PROTOCOL.md) — Core design, fee model, exposure netting
- [Smart Contracts](docs/SMART-CONTRACTS.md) — ABIs, addresses, data structures
- [Frontend Guide](docs/FRONTEND.md) — Screens, components, wallet flow
- [Risk Engine](docs/RISK-ENGINE.md) — Sentinel FSM, circuit breakers
- [API Integrations](docs/API-INTEGRATIONS.md) — Pyth, OpenBB, Yahoo, FastAPI
- [Multi-Chain Lending](docs/MULTI-CHAIN-LENDING.md) — Euler, Kamino, EVAA adapters
- [Deployment Guide](docs/DEPLOYMENT.md) — Environment, build, deploy
- [Live vs Planned](docs/LIVE-VS-PLANNED.md) — What's deployed vs designed

---

## License

MIT
