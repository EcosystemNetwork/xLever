# What is Live vs What is Planned

Quick reference for reviewers and contributors.

---

## Live (Deployed & Functional)

| Component | Contract / Location | Network | Notes |
|-----------|-------------------|---------|-------|
| **Vault (modular)** | `contracts/src/xLever/Vault.sol` | Ink Sepolia | 33 asset vaults deployed with 5 modules each |
| **VaultFactory** | `contracts/src/xLever/VaultFactory.sol` | Ink Sepolia | Deploys and registers modular Vault instances |
| **TWAPOracle** | `contracts/src/xLever/modules/TWAPOracle.sol` | Ink Sepolia | 15-min TWAP from Pyth with circuit breaker |
| **PositionModule** | `contracts/src/xLever/modules/PositionModule.sol` | Ink Sepolia | Position tracking and PnL calculation |
| **FeeEngine** | `contracts/src/xLever/modules/FeeEngine.sol` | Ink Sepolia | Dynamic fee calculation |
| **JuniorTranche** | `contracts/src/xLever/modules/JuniorTranche.sol` | Ink Sepolia | First-loss capital layer (deployed, not yet funded) |
| **RiskModule** | `contracts/src/xLever/modules/RiskModule.sol` | Ink Sepolia | Health scoring and auto-deleverage triggers |
| **PythOracleAdapter** | `contracts/src/xLever/modules/PythOracleAdapter.sol` | Ink Sepolia | Pyth pull-oracle adapter for price updates |
| **EVC** | Euler V2 core | Ink Sepolia | Ethereum Vault Connector for atomic operations |
| **Ethereum Sepolia Mirror** | Euler V2 core + 33 VaultSimple | Ethereum Sepolia | Full mirror of Ink Sepolia deployment (Chain ID 11155111) |
| **Frontend** | `frontend/` (10 screens) | xlever.markets | Vite SPA, Bloomberg Terminal aesthetic |
| **Wallet** | `frontend/wallet.js` | — | Reown AppKit — Ethereum, Ink Sepolia, Solana, TON |
| **Pyth Oracle** | `frontend/pyth.js` | — | Hermes price feeds for 30+ assets |
| **Risk Sentinel** | `frontend/risk-engine.js` | — | Client-side 4-state FSM (NORMAL/WARNING/RESTRICTED/EMERGENCY) |
| **Backtesting** | `frontend/app.js` | — | LTAP vs daily-reset simulation with real Yahoo Finance data |
| **AI Agent** | `frontend/agent-executor.js` | — | Bounded policy executor (dry-run default) |
| **Data Server** | `server/server.py` | — | Yahoo Finance proxy with caching |

### Deployed Vault Addresses (Ink Sepolia)

33 asset vaults including: QQQ, SPY, VUG, VGK, VXUS, SGOV, SMH, XLE, XOP, ITA, AAPL, NVDA, TSLA, DELL, SMCI, ANET, VRT, SNDK, KLAC, LRCX, AMAT, TER, CEG, GEV, SMR, ETN, PWR, APLD, SLV, PPLT, PALL, STRK, BTGO.

Full address list in `deployment.json` and `frontend/contracts.js`.

---

## Planned (Designed, Not Deployed)

| Component | Location | Status | Blocker |
|-----------|----------|--------|---------|
| **EulerHedgingModule** | `contracts/src/xLever/modules/EulerHedgingModule.sol` | Designed | EVC atomic looping integration pending |
| **Kamino adapter** (Solana) | `frontend/lending-adapters.js` | Code written | SDK installed, needs full integration testing |
| **EVAA adapter** (TON) | `frontend/lending-adapters.js` | Code written | SDK installed, TL-B encoding needs verification |
| **Solana Vaults** | `solana/` | Code complete | Devnet deployment ready |
| **TON Vaults** | `ton/` | Code complete | Testnet deployment ready |
| **FastAPI Backend** | `server/api/` | Code complete | Production hosting pending |
| **Junior tranche funding** | — | Module deployed | No junior LPs yet |

### What's not yet active in the deployed modules

| Feature | Status |
|---------|--------|
| Junior tranche (first-loss) | Module deployed, not yet funded — no junior LPs |
| Auto-deleverage cascade | In RiskModule, triggers when junior tranche is active |
| Euler V2 hedging | EulerHedgingModule not yet deployed |

---

## VaultSimple (Testing Only)

`VaultSimple.sol` is retained for local testing — no oracle, no modules. It is **not deployed** to any chain. The live deployment uses the full modular Vault.
