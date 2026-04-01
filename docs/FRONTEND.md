# Frontend Guide

xLever's frontend is a Vite-bundled multi-page app with 10 screens, Bloomberg Terminal aesthetic, and real-time blockchain interaction.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Bundler | Vite |
| Language | Vanilla JS (ES modules) |
| Charts | TradingView Lightweight Charts v4.1.3 |
| Styling | Tailwind CSS (Material Design 3 tokens) + custom CSS |
| Wallet | Reown AppKit (formerly WalletConnect v3) + wagmi |
| Blockchain | viem v2.47.6 |
| Fonts | Space Grotesk (headlines), DM Sans (body), JetBrains Mono (data) |

---

## Screens

| # | File | Screen | Purpose |
|---|------|--------|---------|
| 0 | `index.html` | Landing Page | Protocol overview, connect wallet, feature cards, 1Y comparison chart |
| 1 | `01-dashboard.html` | Portfolio Dashboard | PnL display, asset allocation, protocol health metrics, Pyth oracle status |
| 2 | `02-trading-terminal.html` | Trading Terminal | Real TradingView chart (QQQ/SPY), -4x to +4x leverage slider, order entry, position sizing |
| 3 | `03-ai-agent-operations.html` | AI Agent Control | Agent status, policy modes (Safe/Target/Accumulation), bounded execution, decision log |
| 4 | `04-vault-management.html` | Vault Management | Senior/Junior tranche visualization, Euler V2 health factor, deposit/withdraw UI |
| 5 | `05-risk-management.html` | Risk Management | Risk sentinel state display, circuit breakers, auto-deleverage triggers, oracle staleness |
| 6 | `06-analytics-backtesting.html` | Backtesting | LTAP simulations (1M-25Y), fixed-entry vs daily-reset comparison, fee drag, drawdown analysis |
| 7 | `07-operations-control.html` | Operations Control | System health, transaction history, protocol state, emergency controls |
| 8 | `08-admin-dashboard.html` | Admin Dashboard | Platform stats, activity charts, user management, API monitoring |
| 9 | `09-lending-borrowing.html` | Lending & Borrowing | Cross-chain lending markets, Euler V2/Kamino/EVAA adapters, agentic lending automation |

**Navigation:** Top nav bar across all pages. Current active page is highlighted.

---

## Frontend Modules

### app.js — LTAP Backtesting Engine

The core simulation engine (1,100+ lines). Implements the full LTAP leverage model with real market data.

**Key features:**
- Fixed-entry vs daily-reset leverage comparison
- Fee drag calculation (entry, carry, funding)
- Drawdown analysis with max drawdown tracking
- Configurable time periods (1M to 25Y)
- Real market data from Yahoo Finance proxy

### wallet.js — Wallet Connection

Initializes Reown AppKit with 4-chain support.

**Supported chains:**
1. Ethereum (mainnet)
2. Ink Sepolia (testnet, chain ID 763373) — primary deployment
3. Solana (mainnet) — future expansion
4. TON (mainnet) — future expansion

**Events:**
- `CONNECT_SUCCESS` — Stores address, initializes viem clients, fetches balances
- `DISCONNECT_SUCCESS` — Clears address and clients

### contracts.js — Contract Adapter

viem-based interface for on-chain interactions. Exports:
- `ADDRESSES` — All deployed contract addresses
- `VAULT_ABI` — Full vault ABI (read + write functions)
- `ERC20_ABI` — Standard ERC-20 ABI
- `inkSepolia` — Chain definition for viem

### pyth.js — Pyth Hermes Client

Fetches price updates from Pyth's off-chain Hermes API for on-chain pull-oracle transactions.

**Exports:**
- `getLatestPriceUpdate(feedIds)` — Fetch VAA bytes for contract calls
- `getPriceForFeed(feedId)` — Single feed convenience wrapper
- `getAllPrices()` — All registered xLever feeds at once
- `oracleAge(publishTime)` — Calculate oracle staleness
- `priceDivergence(a, b)` — Check divergence between two prices
- `PYTH_FEEDS` — Feed ID constants

### risk-engine.js — Risk Sentinel

Deterministic 4-state risk machine:

```
NORMAL -> WARNING -> RESTRICTED -> EMERGENCY
```

**Inputs evaluated:**
- Oracle age (seconds since last update)
- Oracle divergence (% between feeds)
- Drawdown (underlying price from peak)
- Health factor (Euler vault health)
- Volatility (annualized)
- Pool utilization ratio

**Outputs:**
- Current risk state
- Reasons array (why this state)
- Leverage cap for current state
- Deleverage level recommendation
- State metadata (color, icon, label)

### openbb.js — OpenBB Intelligence

Market data client for AI agent context and dashboard intelligence.

**Functions:**
- `getQuote(symbol)` — Real-time quote
- `getHistorical(symbol, period)` — Historical OHLCV
- `getDashboardContext()` — Aggregated market snapshot

### agent-executor.js — AI Agent Automation

Bounded policy-based execution engine for automated trading.

**Policy modes:**
- **Safe** — Conservative, reduce-only
- **Target** — Maintain target leverage
- **Accumulation** — Dollar-cost averaging

### ux.js — UX Components

Shared UI utilities:
- **Toast notifications** — Bottom-right popups (success, error, warning, pending)
- **Modal system** — Transaction confirmations, settings dialogs
- **Skeleton loading** — Placeholder animations while data loads

### nav.js — Navigation System
Unified navigation component (`XNav`) with two modes: landing (minimal bar with logo and CTA) and app (full bar with Trade/Research mode toggle, page links, network badge, wallet connector). Includes Judge Mode for demo walkthroughs.

### agent-coordinator.js — Multi-Agent Orchestrator
Coordinates multiple AI agent subsystems: trading agent, lending agent, and risk monitoring. Manages agent lifecycle, inter-agent communication, and execution priorities.

### news-ingest.js — News Pipeline
SSE streaming news ingestion with priority classification. Feeds into the multi-analyst scoring system for real-time market intelligence.

### news-analysts.js — Multi-Analyst Sentiment
Multiple analyst personas score news items independently. Produces weighted sentiment signals for the signal aggregator.

### news-verifier.js — Source Credibility
Verifies news source credibility and cross-references claims. Filters unreliable signals before they reach the trading agent.

### signal-aggregator.js — Signal Generation
Aggregates weighted signals from news analysts, market data, and risk metrics into actionable trading signals for the agent executor.

### llm-analyst.js — LLM Market Analysis
LLM-powered market analysis providing qualitative insights, pattern recognition, and narrative interpretation for agent decisions.

### position-manager.js — Position Tracking
Tracks open positions, calculates PnL, manages position lifecycle (open, adjust, close). Syncs with on-chain state.

### lending-adapters.js — Multi-Chain Lending
Adapter interface + implementations for Euler V2 (EVM), Kamino Finance (Solana), and EVAA Protocol (TON). Registry pattern for chain-agnostic lending operations.

### lending-agent.js — Lending Automation
Chain-agnostic lending automation with 4 policy modes: Yield (auto-supply), Leverage (collateral management), Hedge (risk offset), Monitor (read-only alerts).

### risk-live.js — Live Risk Monitoring
Real-time risk metric streaming and monitoring. Feeds live data into the risk sentinel FSM for continuous evaluation.

### oracle-health.js — Oracle Health Monitor
Monitors Pyth oracle freshness, divergence, and reliability across all registered price feeds.

### assets.js — Asset Registry
Registry of all 33 supported assets with Pyth feed IDs, symbol mappings, and vault address lookups.

### vault-functions.js — Vault Interactions
High-level vault interaction helpers: deposit, withdraw, adjust leverage, approve tokens. Wraps raw viem contract calls with Pyth price update bundling.

### toast.js — Toast Notifications
Standalone toast notification system for transaction confirmations, errors, and status updates.

### chart-strategy-tools.js — Chart Strategy Tools
TradingView chart overlay tools for visualizing trading strategies, entry/exit points, and leverage bands.

### chart-triggers.js — Chart Event Triggers
Price-based event triggers for automated chart annotations and agent notifications.

### live-state.js — Live State Manager
Manages live application state: positions, balances, oracle prices, risk metrics. Provides reactive updates to UI components.

### ws-broadcast.js — WebSocket Broadcast
WebSocket client for real-time event broadcasting from the backend agent system.

### judge-mode.js — Demo Walkthrough
Guided demo mode that overrides navigation to show a curated numbered-step flow for reviewers and judges.

---

## Design System

### Bloomberg Terminal Aesthetic

- Dark monochrome background with neon accent colors
- Monospace fonts for price/data display
- Minimal shadows, sharp borders
- Status indicators: green dot = live, red = error, yellow = warning

### Color Palette (Material Design 3)

| Token | Hex | Usage |
|-------|-----|-------|
| Primary | `#7c4dff` | Purple — buttons, links, active states |
| Success | `#00e676` | Green — positive PnL, healthy status |
| Error | `#ff5252` | Red — negative PnL, errors, emergency |
| Warning | `#ffd740` | Yellow — warnings, caution states |
| Background | `#0a0b0e` | Near black — page background |
| Surface | `#121316` | Dark gray — card backgrounds |
| Surface-variant | `#1a1d26` | Slightly lighter — elevated surfaces |
| Surface-high | `#292a2d` | Lighter — hover states, borders |

### Typography

| Role | Font | Weight |
|------|------|--------|
| Headlines | Space Grotesk | 300-700 |
| Body text | DM Sans | 100-1000 |
| Monospace/data | JetBrains Mono | 100-800 |

### Border Radius

| Token | Value |
|-------|-------|
| Default | 0.125rem (sharp) |
| Large | 0.25rem |
| XL | 0.5rem |
| Full | 0.75rem |

---

## Key UI Components

### Leverage Slider

Interactive slider from -4x to +4x with notch buttons at key levels (-4, -3, -2, -1, 0, +1, +2, +3, +4). Color transitions from red (short) through neutral to green (long).

### Risk Meter

Color-coded health indicator cycling through the 4 risk states:
- NORMAL (green) — Full operations
- WARNING (yellow) — Elevated monitoring
- RESTRICTED (orange) — Limited operations
- EMERGENCY (red) — Withdrawals only

### TradingView Charts

Real candlestick/area/line charts using TradingView Lightweight Charts v4.1.3. Data sourced from Yahoo Finance proxy for historical and Pyth for real-time.

### Balance Display

Header shows wallet balances: ETH, USDC, wQQQx, wSPYx. Updates on wallet connection and after transactions.

---

## Wallet Connection Flow

1. User clicks "Connect Wallet" button (renders Reown AppKit modal)
2. Selects wallet provider (MetaMask, Ledger, WalletConnect QR, etc.)
3. `wallet.js` initializes wagmi + Reown AppKit with 4-chain config
4. On successful connection:
   - Address stored globally
   - viem `publicClient` and `walletClient` initialized for Ink Sepolia
   - Token balances fetched and displayed in header
5. On disconnect: address and clients cleared

**No traditional auth** — uses EVM wallet signatures for all transactions.

---

## Transaction Flow (Example: Open Position)

1. User enters deposit amount and selects leverage on Trading Terminal
2. Frontend fetches latest Pyth price update via `pyth.js`
3. Frontend checks USDC allowance, prompts approval if needed
4. Frontend calls `vault.deposit(amount, leverageBps, priceUpdateData)` with `msg.value` for Pyth fee
5. Transaction confirmed — toast notification shown
6. Position displayed on Dashboard with real-time PnL updates

---

## Development

```bash
# Install dependencies
npm install

# Start dev server (hot reload)
npm run dev
# -> http://localhost:3000

# Build for production
npm run build
# -> output in dist/

# Preview production build
npm run preview
```

### Vite Configuration

- **Root:** `frontend/`
- **Output:** `dist/`
- **Entries:** All 10 HTML screens as separate entry points
- **Dev proxy:** `/api/*` -> `http://localhost:8000` (data server)
- **Dev port:** 3000
