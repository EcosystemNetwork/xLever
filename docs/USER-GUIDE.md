# xLever User Guide

Complete walkthrough of the xLever platform. This guide covers every screen, feature, and workflow available at [xlever.markets](https://xlever.markets).

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Connecting Your Wallet](#connecting-your-wallet)
- [Screen 0: Landing Page](#screen-0-landing-page)
- [Screen 1: Dashboard](#screen-1-dashboard)
- [Screen 2: Trading Terminal](#screen-2-trading-terminal)
- [Screen 3: AI Agent Operations](#screen-3-ai-agent-operations)
- [Screen 4: Vault Management](#screen-4-vault-management)
- [Screen 5: Risk Management](#screen-5-risk-management)
- [Screen 6: Analytics & Backtesting](#screen-6-analytics--backtesting)
- [Screen 7: Operations Control](#screen-7-operations-control)
- [Screen 8: Admin Dashboard](#screen-8-admin-dashboard)
- [Screen 9: Cross-Chain Lending](#screen-9-cross-chain-lending)
- [Understanding Leverage](#understanding-leverage)
- [Understanding Risk States](#understanding-risk-states)
- [Tips & Best Practices](#tips--best-practices)

---

## Prerequisites

Before using xLever, you need:

1. **A Web3 wallet** — MetaMask, Coinbase Wallet, Rainbow, or any WalletConnect-compatible wallet
2. **Ink Sepolia testnet ETH** — for gas fees (this is free testnet ETH, not real money)
3. **Testnet USDC** — for deposits into vaults
4. **A modern browser** — Chrome, Firefox, Brave, or Edge

> xLever is currently on **testnet only**. No real money is at risk.

---

## Connecting Your Wallet

1. Visit [xlever.markets](https://xlever.markets)
2. Click **Connect Wallet** in the top-right corner
3. Choose your wallet provider from the Reown AppKit modal
4. Approve the connection in your wallet
5. When prompted, switch to **Ink Sepolia** network

Once connected, you'll see your wallet address in the navbar and the network badge showing "Ink Sepolia".

### Switching Networks

xLever supports multiple networks. To switch:
- Click the network badge in the navbar
- Select your desired network from the dropdown
- Approve the network switch in your wallet

Supported networks:
- **Ink Sepolia** (primary — all 33 vaults live)
- **Ethereum Sepolia** (mirror deployment)
- **Solana** (coming soon)
- **TON** (coming soon)

---

## Screen 0: Landing Page

**URL:** [xlever.markets](https://xlever.markets)

The landing page introduces the xLever protocol with:

- **3D Spline animation** — interactive protocol visualization
- **Protocol overview** — what xLever does and why it matters
- **1-Year comparison chart** — LTAP (fixed-entry) vs daily-reset leverage performance
- **Feature cards** — key protocol capabilities at a glance
- **Connect Wallet button** — entry point to the platform

### Key Actions
- Click **Connect Wallet** to get started
- Scroll down to see the protocol comparison chart
- Click any feature card to navigate to the relevant screen

---

## Screen 1: Dashboard

**URL:** `xlever.markets/01-dashboard.html`

Your portfolio command center. View all your positions, performance metrics, and protocol health at a glance.

### What You'll See

- **Portfolio Value** — total value across all positions
- **PnL Display** — profit/loss with percentage change, color-coded (green = profit, red = loss)
- **Asset Allocation** — breakdown of your holdings by asset
- **Protocol Health Metrics** — overall protocol status including TVL, utilization, and oracle status
- **Pyth Oracle Status** — live indicator showing oracle feed health and freshness

### How to Use

1. Connect your wallet to see your portfolio
2. Click any asset row to navigate to its trading terminal
3. Monitor the oracle status indicator — green means feeds are fresh and accurate
4. Use the time-range selector to view PnL over different periods

> **Note:** The dashboard shows demo data until you open your first real vault position.

---

## Screen 2: Trading Terminal

**URL:** `xlever.markets/02-trading-terminal.html`

The core trading interface. Open, manage, and close leveraged positions on 33 tokenized assets.

### Layout

- **Left panel** — Asset selector and watchlist
- **Center** — TradingView chart with real-time Pyth price data
- **Right panel** — Order entry form with leverage slider

### Opening a Position

1. **Select an asset** from the left panel (e.g., QQQ, AAPL, NVDA)
2. **Review the chart** — TradingView shows real-time price action
3. **Set your leverage** using the slider:
   - **+1x to +4x** = Long (profit when price goes up)
   - **-1x to -4x** = Short (profit when price goes down)
4. **Enter USDC amount** — this is your deposit/collateral
5. **Review the order summary** showing:
   - Entry price (from Pyth oracle)
   - Effective exposure (deposit x leverage)
   - Maximum possible loss (= your deposit)
   - Fee breakdown
6. **Click Submit** and confirm the transaction in your wallet

### Managing Existing Positions

- **Adjust leverage** — use the leverage slider to change your exposure without closing
- **Partial withdraw** — withdraw a portion of your deposit
- **Close position** — withdraw 100% to close and realize PnL

### Chart Features

- **Multiple timeframes** — 1m, 5m, 15m, 1H, 4H, 1D
- **Drawing tools** — trendlines, support/resistance levels
- **Strategy overlays** — visualize entry/exit points
- **Price alerts** — set notifications for price levels

### Important Notes

- All prices come from **Pyth Network** oracles, not exchange order books
- Your **max loss is always your deposit** — you cannot lose more than you put in
- Leverage is **fixed at entry** — it doesn't rebalance daily like leveraged ETFs
- Transactions happen on-chain — you'll need testnet ETH for gas

---

## Screen 3: AI Agent Operations

**URL:** `xlever.markets/03-ai-agent-operations.html`

Control panel for the autonomous AI trading agent. The agent monitors markets, evaluates risk, and can execute trades based on predefined policy rules.

### Policy Modes

| Mode | What It Does | Risk Level |
|------|-------------|------------|
| **Safe** | Monitor stop-losses and send risk alerts. Can only reduce leverage or close positions. | Lowest |
| **Target Exposure** | Automatically maintain your target leverage band. Can rebalance within bounds but cannot open new positions. | Medium |
| **Accumulate** | Dollar-cost-average into positions on a schedule. Can open new positions at fixed leverage. | Highest |

### Starting the Agent

1. Select a **policy mode** from the dropdown
2. Configure policy parameters:
   - **Safe:** Set stop-loss thresholds
   - **Target Exposure:** Set target leverage range (e.g., 1.5x - 2.5x)
   - **Accumulate:** Set DCA amount, interval, and max leverage
3. Click **Start Agent**
4. The agent starts in **dry-run mode** by default (no real transactions)

### Monitoring

- **Decision Tree** — visual representation of the agent's decision-making process
- **Execution Log** — timestamped log of every action and decision
- **Agent Status** — current state (idle, running, paused, stopped)
- **Policy Boundaries** — what the agent is and isn't allowed to do

### Dry-Run vs Live

- **Dry-run (default):** Agent simulates decisions without sending transactions. Perfect for testing strategies.
- **Live:** Agent sends real on-chain transactions. Requires explicit opt-in and a funded wallet.

> **Important:** Always test in dry-run mode before enabling live execution.

---

## Screen 4: Vault Management

**URL:** `xlever.markets/04-vault-management.html`

Manage your vault deposits and view the protocol's tranche structure.

### What You Can Do

- **Deposit USDC** into any of the 33 asset vaults
- **Withdraw USDC** from your positions
- **View vault state** — total deposits, utilization, aggregate exposure
- **Check Euler V2 health factor** — on-chain health metrics

### Tranche Structure (Designed)

xLever's full design includes a two-tranche system:

| Tranche | Role | Risk/Reward |
|---------|------|-------------|
| **Senior** | Leverage users (-3.5x to +3.5x) | Higher risk, leveraged returns |
| **Junior** | First-loss LP capital | Earns fees but absorbs losses first |

> **Note:** The junior tranche is designed but not yet deployed. Current vaults use the VaultSimple contract.

### Vault Health Indicators

- **Utilization** — percentage of vault capital in active use
- **Net Exposure** — aggregate long/short balance across all positions
- **Health Factor** — Euler V2 collateral health (>1.5 is healthy)

---

## Screen 5: Risk Management

**URL:** `xlever.markets/05-risk-management.html`

Real-time risk monitoring with the 4-state Risk Sentinel system.

### Risk Sentinel States

| State | Color | Max Leverage | What Happens |
|-------|-------|-------------|--------------|
| **NORMAL** | Green | 4.0x | All operations enabled |
| **WARNING** | Yellow | 3.0x | Dynamic fees activate, monitoring intensifies |
| **RESTRICTED** | Orange | 1.5x | New leverage increases paused |
| **EMERGENCY** | Red | 0.0x | Withdrawals only, all new activity blocked |

### What Triggers State Changes

| Metric | Normal | Warning | Restricted |
|--------|--------|---------|------------|
| Oracle staleness | < 5 min | > 5 min | > 15 min |
| Oracle divergence | < 1% | > 1% | > 3% |
| Drawdown | < 5% | > 5% | > 15% |
| Health factor | > 1.5 | < 1.5 | < 1.2 |
| Volatility (annual) | < 50% | > 50% | > 80% |
| Pool utilization | < 75% | > 75% | > 90% |

### What You Can Do

- **Monitor** the current sentinel state in real-time
- **View transition history** — see when and why states changed
- **Review circuit breakers** — automatic safety mechanisms
- **Run demo scenarios** — simulate different market conditions to see how the sentinel responds

### Auto-Deleverage Cascade (Designed)

The 5-level auto-deleverage system is designed but not yet deployed on-chain:

| Level | Action |
|-------|--------|
| 0 | No action |
| 1 | Reduce 25% of leverage |
| 2 | Reduce 50% of leverage |
| 3 | Reduce 75% of leverage |
| 4 | Force close to 0 leverage |

> **Note:** The risk sentinel runs **client-side** in the browser. It is not enforced on-chain in VaultSimple.

---

## Screen 6: Analytics & Backtesting

**URL:** `xlever.markets/06-analytics-backtesting.html`

Backtest xLever's fixed-entry leverage (LTAP) against traditional daily-reset leverage to see the volatility decay difference.

### Running a Backtest

1. **Select an asset** — any of the 33 supported assets
2. **Choose a date range** — from 1 month to 25 years of data
3. **Set leverage** — -3.5x to +3.5x
4. **Click Run Backtest**

The system pulls real historical OHLCV data from Yahoo Finance and calculates:

### Metrics Compared

| Metric | Description |
|--------|-------------|
| **Total Return** | Final PnL as percentage |
| **LTAP Return** | xLever's fixed-entry leverage return |
| **Daily-Reset Return** | Traditional leveraged ETF return (TQQQ-style) |
| **Volatility Decay** | How much daily rebalancing costs you |
| **Sharpe Ratio** | Risk-adjusted return |
| **Max Drawdown** | Largest peak-to-trough decline |
| **Win Rate** | Percentage of profitable periods |

### Reading the Results

- **Green area** between the two lines = xLever outperformance
- **Red area** = periods where daily-reset outperformed (rare in volatile markets)
- The longer the timeframe and higher the volatility, the more pronounced the LTAP advantage

### Tips

- Compare QQQ at 3x over 5+ years to see dramatic volatility decay in daily-reset
- Short-term backtests (< 1 month) show minimal difference between approaches
- Use commodities (SLV, PPLT) for high-volatility examples

---

## Screen 7: Operations Control

**URL:** `xlever.markets/07-operations-control.html`

System operations center for monitoring protocol state and transaction history.

### Features

- **Transaction History** — chronological log of all your on-chain transactions
- **Protocol State** — current configuration and parameters
- **System Health** — backend service status, oracle connectivity, API health
- **Emergency Controls** — (admin only) protocol-wide emergency actions

---

## Screen 8: Admin Dashboard

**URL:** `xlever.markets/08-admin-dashboard.html`

Platform-wide analytics and management tools.

### Metrics

- **Platform Stats** — total users, TVL, daily volume, active positions
- **Activity Charts** — hourly and daily activity visualization
- **User Management** — registered users and their activity
- **API Monitoring** — endpoint health, response times, error rates

> This screen is primarily for protocol operators and administrators.

---

## Screen 9: Cross-Chain Lending

**URL:** `xlever.markets/09-lending-borrowing.html`

Lending and borrowing across multiple chains and protocols.

### Supported Protocols

| Protocol | Chain | Features |
|----------|-------|----------|
| **Euler V2** | Ink Sepolia, Ethereum | Supply, borrow, health monitoring |
| **Kamino Finance** | Solana | Supply, borrow, yield optimization |
| **EVAA Protocol** | TON | Supply, borrow, jetton-based lending |

### What You Can Do

- **View markets** — see available lending markets across all protocols
- **Supply assets** — deposit to earn yield
- **Borrow assets** — borrow against your collateral
- **Monitor positions** — track health factor and APY across chains
- **Compare yields** — side-by-side APY comparison across protocols

### Agentic Lending

The lending screen includes AI agent integration with 4 policy modes:

| Mode | Strategy |
|------|----------|
| **Yield** | Optimize for highest APY across protocols |
| **Leverage** | Manage collateral for leveraged positions |
| **Hedge** | Offset xLever position risk with lending |
| **Monitor** | Alerts only, no automated actions |

---

## Understanding Leverage

### What is Fixed-Entry Leverage?

Traditional leveraged ETFs rebalance daily. This means:
- Your effective leverage changes every day
- In volatile markets, daily rebalancing **erodes returns** (volatility decay)
- A 3x leveraged ETF can lose money even if the underlying asset goes up over time

xLever fixes leverage at your **entry price**:
- Your leverage stays constant relative to when you opened the position
- No daily rebalancing = no volatility decay
- Your PnL is always: `Deposit x Leverage x Price Change from Entry`

### Leverage Examples

| Deposit | Leverage | Asset Move | Your PnL | Return |
|---------|----------|-----------|----------|--------|
| 1,000 USDC | +2x | +10% | +200 USDC | +20% |
| 1,000 USDC | +4x | +10% | +400 USDC | +40% |
| 1,000 USDC | -2x | +10% | -200 USDC | -20% |
| 1,000 USDC | +3x | -5% | -150 USDC | -15% |
| 1,000 USDC | -3x | -5% | +150 USDC | +15% |

### Key Rules

- **Max loss = your deposit.** You cannot lose more than you put in.
- **Leverage range:** -3.5x to +3.5x (reduced in WARNING/RESTRICTED states)
- **Short positions** (-1x to -4x) profit when the asset price goes down
- **Long positions** (+1x to +4x) profit when the asset price goes up

---

## Understanding Risk States

The Risk Sentinel continuously monitors 6 metrics and adjusts the protocol's operational state:

```
NORMAL ──→ WARNING ──→ RESTRICTED ──→ EMERGENCY
  ↑                                       │
  └───────────────────────────────────────┘
                (recovery)
```

### What Should I Do in Each State?

| State | Recommended Action |
|-------|-------------------|
| **NORMAL** | Trade freely, open new positions |
| **WARNING** | Review your positions, consider reducing leverage |
| **RESTRICTED** | Close or reduce high-leverage positions |
| **EMERGENCY** | Withdraw your funds if possible |

The state is visible at all times in the navbar's risk sentinel banner.

---

## Tips & Best Practices

### For New Users

1. **Start small** — open a low-leverage position (1x-2x) to understand the mechanics
2. **Use the backtester** — compare LTAP vs daily-reset on Screen 6 before committing to a strategy
3. **Run the AI agent in dry-run mode** — test strategies before going live
4. **Monitor the risk sentinel** — the navbar banner tells you the current protocol state

### For Active Traders

1. **Watch oracle freshness** — stale prices can indicate market disruptions
2. **Diversify across assets** — don't put all capital into one vault
3. **Use the AI agent's Safe mode** — set stop-losses even if you trade manually
4. **Check health factor regularly** — keep it above 1.5 for safety

### General Safety

- xLever is on **testnet** — no real money is at risk
- Always verify you're on **Ink Sepolia** network before transacting
- Never share your private key or seed phrase
- The risk sentinel is **advisory** — it runs in the browser, not on-chain
- AI agent defaults to **dry-run** — live execution requires explicit opt-in

---

## Need Help?

- **FAQ** — [docs/FAQ.md](FAQ.md) for common questions
- **Glossary** — [docs/GLOSSARY.md](GLOSSARY.md) for protocol terminology
- **Troubleshooting** — [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues
- **Protocol Mechanics** — [docs/PROTOCOL.md](PROTOCOL.md) for the technical deep-dive
