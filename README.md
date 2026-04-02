<p align="center">
  <img src="frontend/public/logowors.png" alt="xLever" width="80" />
</p>

<h1 align="center">xLever</h1>
<p align="center">
  <strong>Fixed-Entry Leverage on Tokenized Assets</strong><br/>
  -3.5x to +3.5x leverage on 33 tokenized equities, ETFs & commodities
</p>

<p align="center">
  <a href="https://xlever.markets"><img src="https://img.shields.io/badge/Live_Demo-xlever.markets-blue?style=for-the-badge" alt="Live Demo" /></a>
  <img src="https://img.shields.io/badge/Chain-Ink_Sepolia-purple?style=for-the-badge" alt="Chain" />
  <img src="https://img.shields.io/badge/Vaults-33_Deployed-green?style=for-the-badge" alt="Vaults" />
</p>

---

## The Problem

Leveraged ETFs like TQQQ and SPXL reset daily. In volatile markets this causes **volatility decay** -- you can be right on direction and still lose money. A 3x leveraged ETF on an asset that goes +10% then -10% doesn't return to zero -- it returns to **-3%**.

## The Solution

xLever locks leverage at your **entry price**, not at the daily close:

```
PnL = Deposit x Leverage x (Current Price - Entry Price) / Entry Price
```

No daily rebalancing. No volatility decay. Max loss = your deposit.

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
# -> http://localhost:3000
```

---

## What's Live (Deployed & Verifiable)

| Component | Details |
|-----------|---------|
| **33 VaultSimple contracts** | Deployed on Ink Sepolia. Deposit USDC, set leverage, withdraw. |
| **Pyth oracle (30+ feeds)** | Real-time Hermes pull-oracle for all 33 assets |
| **Wallet connection** | Reown AppKit -- MetaMask, WalletConnect, etc. |
| **Full tx flow** | Approve USDC -> deposit -> read position -> close position |
| **Backtesting engine** | LTAP vs daily-reset comparison with real Yahoo Finance data |
| **Data proxy** | Python HTTP server (Yahoo Finance CORS proxy for charts) |
| **10-screen frontend** | Vite SPA with Bloomberg Terminal aesthetic |

## What's Client-Side / Simulated

| Component | Details |
|-----------|---------|
| **Risk sentinel** | 4-state FSM (NORMAL/WARNING/RESTRICTED/EMERGENCY) runs in browser, not on-chain |
| **AI agent** | 3 bounded policy modes, dry-run by default, no real trades unless opted in |
| **Dashboard values** | Show $0.00 until user opens a real position |
| **Backtesting output** | Computed from historical data, labeled as backtest |

## What's Code-Complete But Not Deployed

| Component | Details |
|-----------|---------|
| **Modular Vault.sol** | 7 modules (TWAP, Position, Fee, Junior, Risk, Euler Hedging, Pyth Adapter) -- exceeds deployment size limit |
| **FastAPI backend** | 66+ endpoints, PostgreSQL, Redis, SIWE auth |
| **Solana vaults** | Anchor program, mirrors EVM logic |
| **TON vaults** | Tact contracts, 33 Pyth feeds configured |

---

## Architecture

```
                     xlever.markets
                          |
             +------------+------------+
             |            |            |
      +------+------+ +---+---+       |
      |  Frontend   | | Data  |       |
      |  Vite SPA   | | Proxy |       |
      |  10 screens | | :8000 |       |
      +------+------+ +-------+       |
             |                        |
 +-----------+-----------+            |
 |           |           |            |
+--+--+  +---+----+  +--+---+        |
|Reown|  | Pyth   |  |  AI  |        |
|Wallet|  | Oracle |  | Agent|        |
|AppKit|  | Hermes |  |client|        |
+--+--+  +---+----+  +------+        |
   |          |                       |
   +----------+-----------------------+
              |
+-------------+-------------+
|    Ink Sepolia (live)     |
|    33 VaultSimple         |
|    EVC + PythOracleAdapter|
|    USDC + tokenized assets|
+---------------------------+
```

---

## Deployed Contracts

**Network:** Ink Sepolia (Chain ID 763373) | **Explorer:** https://explorer-sepolia.inkonchain.com

| Contract | Address |
|----------|---------|
| EVC | `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c` |
| USDC | `0x6b57475467cd854d36Be7FB614caDa5207838943` |
| Pyth Oracle | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| PythOracleAdapter | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` |
| QQQ Vault | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` |
| SPY Vault | `0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228` |

**33 assets:** QQQ, SPY, VUG, VGK, VXUS, SGOV, SMH, XLE, XOP, ITA, AAPL, NVDA, TSLA, DELL, SMCI, ANET, VRT, SNDK, KLAC, LRCX, AMAT, TER, CEG, GEV, SMR, ETN, PWR, APLD, SLV, PPLT, PALL, STRK, BTGO

Full manifest: [`deployment.json`](deployment.json)

---

## Known Limitations

1. **Testnet only.** All contracts on Ink Sepolia. Tokens have no real value.
2. **VaultSimple is minimal.** No dynamic fees, no junior tranche, no on-chain auto-deleverage. The full modular Vault with 7 modules exists in code but exceeds deployment size limits.
3. **Risk sentinel is client-side.** Browser FSM, not enforced on-chain.
4. **AI agent defaults to dry-run.** Real tx execution is opt-in.
5. **PnL is deposit-only.** VaultSimple returns deposit on close; real PnL requires full PositionModule + oracle.
6. **Solana/TON vaults undeployed.** Code compiles, not yet on devnet/testnet.
7. **No production backend.** FastAPI is code-complete but not hosted.

---

## Project Structure

```
xLever/
+-- frontend/              # Vite SPA -- 10 HTML screens, 38 JS modules
+-- contracts/             # Solidity -- VaultSimple (deployed) + modular Vault (code-complete)
+-- server/
|   +-- server.py          # Data proxy (Yahoo Finance CORS) -- deployed
|   +-- api/               # FastAPI backend -- code exists, not deployed
+-- agent/                 # Python AI agent -- code exists, not deployed
+-- solana/                # Anchor program (Solana port)
+-- ton/                   # Tact contracts (TON port)
+-- deployment.json        # Machine-readable vault manifest
+-- SUBMISSION.md          # Hackathon submission details
+-- DEMO_SCRIPT.md         # 2-minute demo walkthrough
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite, Vanilla JS (ES modules), TradingView Lightweight Charts v4 |
| Styling | Tailwind CSS v4, Bloomberg Terminal aesthetic |
| Wallet | Reown AppKit (Ethereum, Ink Sepolia, Solana, TON) |
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

- **Mads** -- Euler V2 EVK integration & smart contract deployment
- **Eric** -- AI agent architecture, backend, frontend
- **Maroua** -- AI agent, demo video, UI/UX

---

## License

MIT
