# Frequently Asked Questions

---

## General

### What is xLever?

xLever is a leveraged tokenized asset protocol (LTAP) that provides fixed-entry leverage from -3.5x to +3.5x on 33 tokenized assets including equities (AAPL, NVDA, TSLA), ETFs (QQQ, SPY), and commodities (SLV, PPLT). It's built on Euler V2 EVK smart contracts deployed on Ink Sepolia.

### How is xLever different from leveraged ETFs like TQQQ?

Leveraged ETFs rebalance daily. In volatile markets, this daily reset causes **volatility decay** — you can be right on direction and still lose money over time. xLever locks leverage at your **entry price**, eliminating volatility decay entirely.

**Example:** An asset goes +10% then -10%.
- **3x Leveraged ETF:** Returns -3% (volatility decay)
- **xLever at 3x:** Returns -3% from entry (no decay — same math, but no compounding of daily resets over time)

The longer the holding period and the higher the volatility, the bigger the difference. Use the backtester (Screen 6) to see this in action.

### Is xLever live on mainnet?

No. xLever is currently deployed on **Ink Sepolia** and **Ethereum Sepolia** testnets. All tokens are testnet tokens with no real value. Mainnet deployment is planned for the future.

### Is my money at risk?

No real money is involved. xLever uses testnet tokens that are free and have no monetary value. Even within the testnet, your maximum loss on any position is limited to your deposit amount.

---

## Trading

### How do I open a position?

1. Connect your wallet on [xlever.markets](https://xlever.markets)
2. Go to the Trading Terminal (Screen 2)
3. Select an asset, set leverage (-3.5x to +3.5x), enter USDC amount
4. Submit and confirm the transaction in your wallet

See the [Getting Started guide](GETTING-STARTED.md) for a detailed walkthrough.

### What leverage options are available?

- **Long:** +1x to +4x (profit when price goes up)
- **Short:** -1x to -4x (profit when price goes down)

During elevated risk states, maximum leverage is reduced:
- WARNING: max 3.0x
- RESTRICTED: max 1.5x
- EMERGENCY: 0.0x (withdrawals only)

### Can I lose more than my deposit?

**No.** Your maximum loss is always equal to your deposit. This is a fundamental design principle of xLever — there are no margin calls or liquidation penalties that exceed your initial deposit.

### How is my PnL calculated?

```
PnL = Deposit × Leverage × (Current Price - Entry Price) / Entry Price
```

Your entry price is locked when you open the position and never changes. PnL is always measured from that fixed point.

### Can I adjust my leverage after opening a position?

Yes. Use the leverage slider on the Trading Terminal to adjust your leverage. This calls the `adjustLeverage` function on the smart contract and requires a wallet transaction.

### What assets can I trade?

33 tokenized assets across multiple categories:

| Category | Assets |
|----------|--------|
| **Broad Market ETFs** | QQQ, SPY, VUG, VGK, VXUS, SGOV |
| **Sector ETFs** | SMH, XLE, XOP, ITA |
| **Tech Stocks** | AAPL, NVDA, TSLA, DELL, SMCI, ANET |
| **Semiconductor** | VRT, SNDK, KLAC, LRCX, AMAT, TER |
| **Energy/Nuclear** | CEG, GEV, SMR, ETN, PWR, APLD |
| **Commodities** | SLV, PPLT, PALL |
| **Crypto-Adjacent** | STRK, BTGO |

### Where do prices come from?

All prices come from **Pyth Network** oracles via the Hermes pull-oracle model. Prices are updated on-chain when you submit a transaction. The oracle status indicator in the UI shows feed freshness.

---

## AI Agent

### What is the AI agent?

The AI agent is an autonomous trading assistant that monitors markets and can execute trades based on predefined policy rules. It runs in the browser (frontend) with a Python backend for advanced features.

### Will the agent trade without my permission?

**No.** The agent defaults to **dry-run mode**, which simulates decisions without sending any transactions. You must explicitly opt into live execution mode, which requires a funded wallet.

### What are the policy modes?

| Mode | What It Does | Permissions |
|------|-------------|-------------|
| **Safe** | Monitors stop-losses, sends risk alerts | Can only reduce/close positions |
| **Target Exposure** | Maintains a leverage band automatically | Can rebalance, cannot open new |
| **Accumulate** | Dollar-cost-averages on a schedule | Can open new positions |

### Can the agent go rogue?

The agent has **hard-coded permission boundaries**:
- Each policy mode has specific allowed actions (cannot exceed its permissions)
- 8 safety guardrails including max leverage, daily loss limits, and position size caps
- Human-in-the-loop modes available for approval workflows
- All decisions are logged in the execution log

---

## Risk Management

### What is the Risk Sentinel?

A 4-state deterministic state machine that monitors protocol health and adjusts allowed operations:

| State | Meaning |
|-------|---------|
| NORMAL (green) | Everything healthy, full operations |
| WARNING (yellow) | Elevated risk detected, dynamic fees activate |
| RESTRICTED (orange) | Significant risk, new leverage increases paused |
| EMERGENCY (red) | Critical risk, withdrawals only |

### Is the Risk Sentinel enforced on-chain?

No. The current Risk Sentinel runs **client-side** in the browser. It's a monitoring and advisory system. On-chain enforcement is planned for the modular vault deployment.

### What triggers a state change?

Six metrics are continuously monitored: oracle staleness, oracle price divergence, portfolio drawdown, health factor, annualized volatility, and pool utilization. Thresholds for each metric determine state transitions.

### What should I do during an EMERGENCY state?

Withdraw your funds if possible. The EMERGENCY state indicates critical risk conditions where normal trading should not occur. Review the risk dashboard (Screen 5) for details on what triggered the state.

---

## Vaults & Smart Contracts

### What is the modular Vault?

The deployed vault architecture uses 5 modules per vault: TWAPOracle (15-min TWAP from Pyth), PositionModule (position tracking & PnL), FeeEngine (dynamic fees), JuniorTranche (first-loss capital), and RiskModule (health scoring & auto-deleverage). All 33 asset vaults on Ink Sepolia use this architecture. `VaultSimple.sol` is retained for local testing only.

### What is the junior tranche?

The junior tranche is a **first-loss capital buffer** in xLever's two-tranche design. Junior LPs deposit capital that absorbs losses before senior (leverage) users are affected. In return, junior LPs earn fees. The JuniorTranche module is deployed but not yet funded — no junior LPs have deposited yet.

### Are the contracts audited?

The contracts have not undergone a formal security audit. xLever is currently a testnet-only protocol. No real funds are at risk.

---

## Cross-Chain & Lending

### What chains does xLever support?

| Chain | Status |
|-------|--------|
| **Ink Sepolia** | Live — 33 vaults deployed |
| **Ethereum Sepolia** | Live — 33 vaults mirrored |
| **Solana (Devnet)** | Ready — Anchor program written, not deployed |
| **TON (Testnet)** | Ready — Tact contracts written, not deployed |

### What lending protocols are integrated?

| Protocol | Chain | Status |
|----------|-------|--------|
| **Euler V2** | EVM (Ink Sepolia, Ethereum) | Integrated |
| **Kamino Finance** | Solana | Adapter written |
| **EVAA Protocol** | TON | Adapter written |

### Can I lend and leverage at the same time?

Yes — the lending screen (Screen 9) includes AI agent integration that can manage lending positions alongside your leverage positions. The "Hedge" policy mode specifically offsets xLever position risk using lending protocols.

---

## Technical

### What do I need to run xLever locally?

- Node.js 18+
- Python 3.10+
- A Web3 wallet

Optional (for full backend):
- Docker (for PostgreSQL + Redis)

See the [Deployment guide](DEPLOYMENT.md) for complete setup instructions.

### What tech stack does xLever use?

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 8, Vanilla JS, TradingView Charts, Tailwind CSS |
| Wallet | Reown AppKit (formerly WalletConnect) |
| Contracts | Solidity, Foundry, Euler V2 EVK |
| Oracle | Pyth Network (Hermes) |
| Backend | Python FastAPI, PostgreSQL, Redis |
| Intelligence | OpenBB, Tavily AI |

### How do I run the contract tests?

```bash
cd contracts && forge test
```

### Where can I find contract addresses?

- In the README under "Multi-Chain Deployments"
- In `deployment.json` (machine-readable manifest)
- In `frontend/contracts.js` (frontend vault registry)
- In [docs/SMART-CONTRACTS.md](SMART-CONTRACTS.md) (full reference)
