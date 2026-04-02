# xLever -- Hackathon Submission

> Fixed-entry leverage (-3.5x to +3.5x) on tokenized equities.
> No daily rebalancing. No volatility decay. Max loss = your deposit.
> **Live demo:** [xlever.markets](https://xlever.markets)

---

## What xLever Does

Leveraged ETFs like TQQQ reset daily. In volatile markets this causes **volatility decay** -- you can be right on direction and still lose money.

xLever locks leverage at your **entry price**:

```
PnL = Deposit x Leverage x (Current Price - Entry Price) / Entry Price
```

Users deposit USDC, pick an asset (SPY, QQQ, AAPL, etc.), set leverage from -3.5x to +3.5x, and trade against deployed vault contracts on Ink Sepolia.

---

## What Is Live (Verifiable On-Chain)

| Component | Status | How to verify |
|-----------|--------|---------------|
| 33 Vault contracts (VaultSimple) | **Deployed on Ink Sepolia** | [QQQ Vault on Explorer](https://explorer-sepolia.inkonchain.com/address/0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6) |
| Pyth Oracle (30+ real-time feeds) | **Live** | Connect wallet, prices update live on trading screen |
| Wallet connect (Reown AppKit) | **Live** | Click "Connect Wallet" on [xlever.markets](https://xlever.markets) |
| USDC approval + deposit tx | **Live on-chain** | Open a position, confirm in wallet, verify on explorer |
| Position read from contract | **Live on-chain** | After deposit, position card appears with on-chain data |
| Close position tx | **Live on-chain** | Close button triggers real withdrawal tx |
| Backtesting engine | **Live (client-side)** | Screen 6 -- pulls real Yahoo Finance OHLCV, computes LTAP vs daily-reset |
| Data proxy | **Live** | server.py on port 8000 -- Yahoo Finance CORS proxy for charts |

---

## What Is Simulated / Client-Side Only

These are clearly **not** on-chain and exist as research tools or UI scaffolding:

| Component | What it does | Why simulated |
|-----------|-------------|---------------|
| Backtesting comparison | Computes LTAP vs TQQQ-style returns from historical data | Research/proof tool, not a trading feature |
| Risk sentinel (4-state FSM) | NORMAL/WARNING/RESTRICTED/EMERGENCY state machine | Runs in browser JS, not enforced on-chain by VaultSimple |
| AI agent executor | 3 policy modes (Safe, Target Exposure, Accumulate) | Client-side, dry-run by default, no real trades unless user opts in |
| Dashboard portfolio values | Shows $0.00 until user has a real on-chain position | Placeholder until wallet connects and reads vault state |
| DCA strategy markers on chart | Visual overlay showing hypothetical dollar-cost-average entries | Only appears when user selects DCA strategy tool |

---

## What Was Built During the Hackathon

All code in this repository was created during the promotion period. The team:

- Designed and deployed the VaultSimple modular architecture on Ink Sepolia (33 vaults)
- Built the 10-screen frontend SPA from scratch (Vite + Vanilla JS)
- Integrated Pyth oracle for real-time pricing of 30+ tokenized assets
- Built the wallet-to-contract flow: connect, approve USDC, deposit, read position, close
- Created the backtesting engine comparing fixed-entry leverage vs daily-reset
- Built the AI agent executor (3 bounded policy modes, client-side)
- Built the risk sentinel state machine
- Wrote Solana (Anchor) and TON (Tact) contract ports (code-complete, not deployed)
- Wrote FastAPI backend with 66+ endpoints (code-complete, not deployed)

---

## Exact Demo Flow (2 minutes)

This is the verified working path a judge can reproduce:

### 1. Connect Wallet (0:00-0:15)
1. Go to [xlever.markets](https://xlever.markets)
2. Click **Connect Wallet**
3. Select MetaMask or any EVM wallet
4. Switch to **Ink Sepolia** when prompted

### 2. Open a Leveraged Position (0:15-0:50)
1. Go to **Trading Terminal** (Screen 2)
2. Select **QQQ** or **SPY**
3. See live Pyth price updating in real-time (green "Live Pyth Feed" badge)
4. Drag leverage slider (e.g. 2.0x long)
5. Enter USDC amount, click **Open Position**
6. Approve USDC spend in wallet, then confirm deposit tx
7. Wait for confirmation -- button shows lifecycle: Approving -> Submitted -> Confirming -> Confirmed

### 3. View Active Position (0:50-1:10)
1. Position card appears showing: asset, deposit amount, leverage, direction (LONG/SHORT)
2. All data read from on-chain contract state

### 4. Close Position (1:10-1:30)
1. Click **Close Position** on the position card
2. Confirm tx in wallet
3. Toast shows confirmation with explorer link
4. Position card disappears, USDC returned

### 5. Run a Backtest (1:30-1:55)
1. Go to **Analytics** (Screen 6)
2. Select QQQ, 3x leverage, 1-year timeframe
3. Click **Run Backtest** -- pulls real Yahoo Finance data
4. Compare green (LTAP fixed-entry) vs red (daily-reset TQQQ-style)
5. This proves the core thesis: fixed-entry leverage outperforms in trending markets

### 6. Closing (1:55-2:00)
> "xLever: fixed-entry leverage on tokenized assets. No volatility decay. Built on Ink Sepolia."

---

## Deployed Contract Addresses

**Network:** Ink Sepolia (Chain ID 763373)
**Explorer:** https://explorer-sepolia.inkonchain.com

| Contract | Address |
|----------|---------|
| EVC | `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c` |
| USDC | `0x6b57475467cd854d36Be7FB614caDa5207838943` |
| Pyth Oracle | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| PythOracleAdapter | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` |
| QQQ Vault | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` |
| SPY Vault | `0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228` |

**33 assets total:** QQQ, SPY, VUG, VGK, VXUS, SGOV, SMH, XLE, XOP, ITA, AAPL, NVDA, TSLA, DELL, SMCI, ANET, VRT, SNDK, KLAC, LRCX, AMAT, TER, CEG, GEV, SMR, ETN, PWR, APLD, SLV, PPLT, PALL, STRK, BTGO

Full manifest: [`deployment.json`](deployment.json)

---

## Known Limitations

1. **Testnet only.** All contracts on Ink Sepolia. Tokens have no real value.
2. **VaultSimple is minimal.** No dynamic fees, no junior tranche funding, no on-chain auto-deleverage, no Euler hedging loop. The modular Vault.sol with all 7 modules exists in code but exceeds deployment size limits without a proxy pattern.
3. **Risk sentinel is client-side.** The 4-state FSM runs in the browser, not enforced on-chain.
4. **AI agent defaults to dry-run.** Real tx execution is opt-in.
5. **No production backend.** FastAPI (PostgreSQL, Redis, SIWE auth) is code-complete but not hosted. The live site is frontend-only + data proxy.
6. **Solana and TON vaults are undeployed.** Anchor and Tact programs compile but haven't been deployed to devnet/testnet.
7. **PnL is deposit-only.** VaultSimple returns the deposit amount on close; real PnL tracking requires the full PositionModule + oracle integration in the modular Vault.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite, Vanilla JS (ES modules), TradingView Lightweight Charts v4 |
| Styling | Tailwind CSS v4, Bloomberg Terminal aesthetic |
| Wallet | Reown AppKit (multi-chain: Ethereum, Ink Sepolia, Solana, TON) |
| Blockchain | viem, Solidity ^0.8.0, Foundry, Euler V2 EVK + EVC |
| Oracle | Pyth Network (Hermes pull-oracle, 30+ feeds) |
| Data proxy | Python HTTP server (Yahoo Finance CORS proxy) |

---

## AI Usage Disclosure

| Tool | Purpose |
|------|---------|
| Claude Code | Code generation, architecture design, documentation |
| Stitch MCP | UI/UX design system and screen generation |

All AI-generated code was reviewed and integrated by the team.

---

## Team

- **Mads** -- Euler V2 EVK integration, smart contract deployment
- **Eric** -- AI agent architecture, backend, frontend
- **Maroua** -- AI agent, demo video, UI/UX
