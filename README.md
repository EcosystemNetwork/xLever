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

### 3. Key technical proof

- **Backtesting engine** ([frontend/app.js](frontend/app.js)): 1,100+ lines implementing the full LTAP leverage simulation — fixed-entry vs daily-reset comparison using real market data
- **Pyth oracle integration** ([frontend/pyth.js](frontend/pyth.js)): Live Hermes client fetching price update data for on-chain pull-oracle transactions
- **Contract adapter** ([frontend/contracts.js](frontend/contracts.js)): viem-based interface for deployed Vault + ERC-20 + Pyth adapter contracts on Ink Sepolia
- **Risk engine** ([frontend/risk-engine.js](frontend/risk-engine.js)): Deterministic 4-state risk sentinel with auto-deleverage policy
- **Protocol design**: 80KB architecture document covering vault mechanics, fee engine, circuit breakers, and Euler V2 integration ([protocol.md](protocol.md))

---

## What is Real vs What is Simulated

| Component | Status | Details |
|-----------|--------|---------|
| Frontend (8 screens) | **Live** | Vite-bundled, Bloomberg Terminal aesthetic |
| Wallet connection | **Live** | Reown AppKit — Ethereum, Ink Sepolia, Solana, TON |
| Smart contracts | **Deployed** | Vault, VaultFactory, PythOracleAdapter on Ink Sepolia |
| Pyth oracle | **Live** | Hermes price feeds for QQQ, SPY, AAPL, NVDA, TSLA |
| Risk engine | **Live** | Deterministic 4-state sentinel with live oracle/position inputs |
| Backtesting engine | **Live** | Real market data, LTAP fixed-entry leverage simulation |
| Trading charts | **Live** | TradingView Lightweight Charts with real QQQ/SPY data |
| Data server | **Live** | Python proxy serving market data with caching |
| OpenBB intelligence | **Live** | Market snapshots, options context, agent tooling |
| AI agent trading | **Bounded** | Policy-based executor with real tx capabilities |

---

## Architecture

```
User Layer
  Senior Users (-4x to +4x leverage)  ←→  Junior LPs (first-loss buffer)
         │                                        │
         ▼                                        ▼
Core Protocol (Vault on Ink Sepolia)
  Position Manager  │  Exposure Aggregator  │  Fee Engine
         │
         ▼
Oracle + Intelligence
  Pyth (on-chain execution oracle)  │  OpenBB (off-chain analytics/agent context)
         │
         ▼
External
  Euler V2 Markets  │  xStocks (wQQQx, wSPYx)
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
| Frontend | Vite + Vanilla JS/CSS, TradingView Charts, Tailwind CSS |
| Wallet | Reown AppKit (Ethereum, Ink Sepolia, Solana, TON) |
| Contracts | Solidity, Euler V2 EVK + EVC, deployed on Ink Sepolia |
| Oracle | Pyth Network (Hermes pull-oracle) |
| Intelligence | OpenBB Platform (market data, options, agent context) |
| Data | Market data proxy with caching |
| Risk | Deterministic 4-state sentinel engine |

---

## Project Structure

```
xLever/
├── frontend/
│   ├── index.html              # Landing page
│   ├── 01-dashboard.html       # Portfolio command center
│   ├── 02-trading-terminal.html # Trading + charting
│   ├── 03-ai-agent-operations.html # Smart agent control
│   ├── 04-vault-management.html # Euler V2 vault UI
│   ├── 05-risk-management.html # Risk sentinel
│   ├── 06-analytics-backtesting.html # Backtesting engine
│   ├── 07-operations-control.html # System operations
│   ├── wallet.js               # Reown AppKit (4-chain wallet)
│   ├── contracts.js            # viem contract adapter
│   ├── pyth.js                 # Pyth Hermes client
│   ├── risk-engine.js          # Risk sentinel engine
│   ├── openbb.js               # OpenBB intelligence service
│   ├── app.js                  # LTAP backtesting engine
│   └── ux.js                   # UX layer (toasts, modals)
├── contracts/
│   └── src/xLever/             # Solidity contracts
├── server/
│   ├── server.py               # Data proxy server
│   └── api/                    # API routes
├── protocol.md                 # Full protocol architecture (80KB)
└── README.md                   # You are here
```

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

# 2. Start data server
cd server && python3 server.py &
cd ..

# 3. Start dev server
npm run dev
# → http://localhost:3000

# 4. Build for production
npm run build
# → output in dist/
```

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
