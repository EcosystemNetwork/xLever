# What is Live vs What is Planned

Quick reference for reviewers and contributors.

---

## Live (Deployed & Functional)

| Component | Contract / Location | Network | Notes |
|-----------|-------------------|---------|-------|
| **VaultSimple** | `contracts/src/xLever/VaultSimple.sol` | Ink Sepolia | 33 asset vaults deployed — deposit, withdraw, adjust leverage |
| **VaultFactory** | `contracts/src/xLever/VaultFactory.sol` | Ink Sepolia | Deploys and registers VaultSimple instances |
| **PythOracleAdapter** | `contracts/src/xLever/experimental/modules/PythOracleAdapter.sol` | Ink Sepolia | Pyth pull-oracle adapter for price updates |
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
| **Vault.sol** (modular) | `contracts/src/xLever/experimental/Vault.sol` | Designed | Contract size exceeds deployment limits |
| **PositionModule** | `experimental/modules/PositionModule.sol` | Designed | Needs modular Vault deployment |
| **FeeEngine** | `experimental/modules/FeeEngine.sol` | Designed | Needs modular Vault deployment |
| **EulerHedgingModule** | `experimental/modules/EulerHedgingModule.sol` | Designed | Needs modular Vault deployment |
| **RiskModule** | `experimental/modules/RiskModule.sol` | Designed | Needs modular Vault deployment |
| **TWAPOracle** | `experimental/modules/TWAPOracle.sol` | Designed | Needs modular Vault deployment |
| **JuniorTranche** | `experimental/modules/JuniorTranche.sol` | Designed | Needs modular Vault deployment |
| **Kamino adapter** (Solana) | `frontend/lending-adapters.js` | Code written | SDK installed, needs full integration testing |
| **EVAA adapter** (TON) | `frontend/lending-adapters.js` | Code written | SDK installed, TL-B encoding needs verification |

### What the modular Vault adds over VaultSimple

| Feature | VaultSimple (live) | Modular Vault (planned) |
|---------|-------------------|------------------------|
| Deposit/withdraw/leverage | Yes | Yes |
| Pyth oracle pricing | Yes | Yes |
| Dynamic fee engine | No | Yes — `0.5% + 0.5% x \|leverage - 1\|` annually |
| Euler V2 hedging | No | Yes — EVC atomic looping |
| On-chain auto-deleverage | No | Yes — 5-level cascade |
| Junior tranche (first-loss) | No | Yes — ERC-4626 compatible |
| 15-min TWAP oracle | No | Yes — dynamic spread pricing |
| Circuit breaker | No | Yes — daily volume limits |

---

## Migration Path

**VaultSimple → Modular Vault** is planned for mainnet deployment. The modular architecture requires either proxy patterns (BeaconProxy/diamond) or splitting modules into standalone contracts to fit within deployment size limits.
