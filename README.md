<p align="center">
  <img src="frontend/assets/xlever-logo.svg" alt="xLever" width="80" />
</p>

<h1 align="center">xLever</h1>
<p align="center">
  <strong>Fixed-Entry Leverage on Tokenized Assets</strong><br/>
  -3.5x to +3.5x leverage on 33 tokenized equities, ETFs & commodities via Euler V2 EVK
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
3. **Set leverage** from -3.5x (short) to +3.5x (long) using the slider
4. **Monitor** your position with real-time Pyth oracle prices and backtesting tools
5. **Withdraw** anytime — PnL is calculated from your entry price, not daily closes

---

## Quick Start

```bash
# Prerequisites: Node.js 18+, Python 3.10+

# 1. Clone & install
git clone https://github.com/madschristensen99/xLever.git && cd xLever
npm install

# 2. Start the data proxy (Yahoo Finance for backtesting charts)
cd server && python3 server.py &
cd ..

# 3. Launch the frontend
npm run dev
# → http://localhost:3000
```

---

## Architecture (what's actually running)

```
                     xlever.markets
                          │
             ┌────────────┼────────────┐
             │            │            │
      ┌──────┴──────┐ ┌───┴───┐       │
      │  Frontend   │ │ Data  │       │
      │  Vite SPA   │ │ Proxy │       │
      │  10 screens │ │ :8000 │       │
      └──────┬──────┘ └───────┘       │
             │                        │
 ┌───────────┼───────────┐            │
 │           │           │            │
┌──┴──┐  ┌────┴────┐  ┌───┴───┐      │
│Reown│  │  Pyth   │  │  AI   │      │
│Wallet│  │ Oracle  │  │ Agent │      │
│AppKit│  │ Hermes  │  │client │      │
└──┬──┘  └────┬────┘  └───────┘      │
   │          │                       │
   └──────────┼───────────────────────┘
              │
┌─────────────┼─────────────┐
│    Ink Sepolia (live)     │
│    33 modular Vaults      │
│    EVC + PythOracleAdapter│
│    USDC + tokenized assets│
└───────────────────────────┘
```

The **Data Proxy** (`server/server.py`, port 8000) is a lightweight Yahoo Finance CORS proxy used only for backtesting chart data. All trading operations go directly from the browser to the blockchain via viem.

> **Note:** A FastAPI backend with PostgreSQL exists in `server/api/` but is **not deployed** in production. The live site is frontend-only with direct on-chain interactions.

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

Full vault addresses: [`deployment.json`](deployment.json)

### Ethereum Sepolia — 33 vaults mirrored

Full mirror deployment on Chain ID 11155111. Frontend supports chain switching.

### Solana (Devnet) — Code written, not deployed

Anchor program at [`solana/`](solana/). Mirrors EVM vault logic with Pyth oracle integration.

### TON (Testnet) — Code written, not deployed

Tact contracts at [`ton/`](ton/). All 33 Pyth feed IDs pre-configured.

---

## Smart Contracts

The deployed vaults use the **modular Vault** architecture (via `DeploySimple.s.sol`), with 5 pre-deployed modules per vault:

| Module | Purpose |
|--------|---------|
| **TWAPOracle** | 15-min TWAP from Pyth with circuit breaker |
| **PositionModule** | Position tracking and PnL calculation |
| **FeeEngine** | Dynamic fee calculation |
| **JuniorTranche** | First-loss capital layer (module deployed, not yet funded) |
| **RiskModule** | Health scoring and auto-deleverage triggers |

A simplified `VaultSimple.sol` also exists for local testing (no oracle, no modules).

```bash
# Run contract tests
cd contracts && forge test
```

---

## AI Agent System

### Frontend Agent ([`agent-executor.js`](frontend/agent-executor.js))

Three bounded policy modes running **client-side** (dry-run by default):

| Mode | Behavior | Can Open Positions? |
|------|----------|-------------------|
| **Safe** | Stop-loss monitoring, risk alerts | No (reduce/close only) |
| **Target Exposure** | Maintain leverage band automatically | No (rebalance only) |
| **Accumulate** | DCA into positions on schedule | Yes (fixed leverage) |

### Backend Agent ([`agent/`](agent/))

Python agent code exists but is **not deployed** in the live demo.

---

## Risk Management

Four-state deterministic sentinel (**client-side FSM**, not enforced on-chain):

| State | Max Leverage | Behavior |
|-------|-------------|----------|
| **NORMAL** | 4.0x | Full operations |
| **WARNING** | 3.0x | Elevated monitoring |
| **RESTRICTED** | 1.5x | New positions paused |
| **EMERGENCY** | 0.0x | Withdrawals only |

---

## What's Live vs What's Not

| Component | Status | Details |
|-----------|--------|---------|
| 33 modular Vault contracts | **Live on-chain** | Ink Sepolia + Ethereum Sepolia |
| Pyth oracle prices | **Live** | Real-time Hermes feeds for 30+ assets |
| Wallet & transactions | **Live** | Real on-chain via Reown AppKit |
| TradingView charts | **Live** | Real market data via Pyth |
| Backtesting engine | **Live** | Historical OHLCV from Yahoo Finance (research mode) |
| Data proxy server | **Live** | Yahoo Finance CORS proxy for backtesting |
| Risk sentinel | **Client-side only** | Browser FSM, not enforced on-chain |
| AI agent | **Client-side, dry-run default** | Real tx opt-in, requires private key |
| FastAPI backend | **Code exists, not deployed** | PostgreSQL + Redis, 66+ endpoints |
| Junior tranche funding | **Not active** | Module deployed but no junior LPs |
| Auto-deleverage | **In contract, not triggered** | Requires junior tranche activity |
| Solana/TON vaults | **Code written, not deployed** | Ready for future deployment |
| SIWE authentication | **Code exists, not deployed** | Requires FastAPI backend |
| News intelligence | **Code exists, not deployed** | Requires FastAPI backend |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite, Vanilla JS (ES modules), TradingView Lightweight Charts v4 |
| Styling | Tailwind CSS, Bloomberg Terminal aesthetic |
| Wallet | Reown AppKit (Ethereum, Ink Sepolia, Solana, TON) |
| Blockchain | viem, Solidity ^0.8.0, Foundry, Euler V2 EVK + EVC |
| Oracle | Pyth Network (Hermes pull-oracle, 30+ feeds) |
| Data proxy | Python HTTP server (Yahoo Finance CORS proxy) |

---

## Project Structure

```
xLever/
├── frontend/              # Vite SPA — 10 HTML screens, JS modules
├── contracts/             # Solidity — modular Vault (deployed) + VaultSimple (testing)
├── server/
│   ├── server.py          # Data proxy (Yahoo Finance CORS) — deployed
│   └── api/               # FastAPI backend — code exists, not deployed
├── agent/                 # Python AI agent — code exists, not deployed
├── solana/                # Anchor program (Solana port)
├── ton/                   # Tact contracts (TON port)
├── docs/                  # Documentation suite
├── deployment.json        # Machine-readable vault manifest
├── vite.config.js         # Vite multi-page build config
└── docker-compose.yml     # PostgreSQL + Redis (for local FastAPI dev)
```

---

## AI Usage Disclosure

| Tool | Purpose |
|------|---------|
| Claude Code | Code generation, architecture design, documentation |
| Stitch MCP | UI/UX design system and screen generation |

All AI-generated code was reviewed and integrated by the team.

---

## Team

- **Mads** — Euler V2 EVK integration & smart contract deployment
- **Eric** — AI agent architecture, backend, frontend
- **Maroua** — AI agent, demo video, UI/UX

---

## License

MIT
