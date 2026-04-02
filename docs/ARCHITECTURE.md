# xLever Architecture One-Pager

## System Overview

```
                           xlever.markets
                          (Vite SPA, 10 screens)
                                 |
                 +---------------+---------------+
                 |               |               |
            [Frontend]     [Data Proxy]    [FastAPI Backend]
            Vanilla JS     server.py       server/api/
            TradingView    port 8000       port 8080
            Tailwind CSS   Yahoo Finance   PostgreSQL + Redis
                 |          OHLCV data     SIWE auth, positions
                 |                         (code-complete,
                 |                          not in production)
        +--------+--------+
        |        |        |
   [Wallet]  [Oracle]  [Intelligence]
   Reown     Pyth      OpenBB Platform
   AppKit    Hermes    Tavily AI
   4 chains  30+ feeds Market snapshots
        |        |
        v        v
   +----+--------+----+
   | Ink Sepolia      |
   | Chain ID 763373  |
   |                  |
   | EVC              |  <-- Euler V2 core
   | VaultFactory     |  <-- Deploys vaults
   | 33 modular Vaults |  <-- Deposit/withdraw/leverage
   | PythOracleAdapter|  <-- On-chain price feed
   | USDC, wQQQx,     |
   | wSPYx + 31 more  |
   +------------------+
```

## Shipped Components (Solid)

| Component | Tech | Entry Point |
|-----------|------|-------------|
| Frontend | Vite 8, Vanilla JS, Tailwind, TradingView | `frontend/index.html` (10 screens) |
| Wallet | Reown AppKit v1.8.19 | `frontend/wallet.js` |
| Oracle | Pyth Hermes pull-oracle | `frontend/pyth.js` + PythOracleAdapter contract |
| Contracts | Solidity, Foundry, Euler V2 EVK | `contracts/src/xLever/Vault.sol` (modular, 5 modules) |
| Backtesting | Client-side LTAP simulation | `frontend/app.js` |
| Risk Sentinel | Client-side 4-state FSM | `frontend/risk-engine.js` |
| AI Agent | Bounded policy executor (JS) | `frontend/agent-executor.js` |
| Data Server | Python HTTP proxy | `server/server.py` |

## Designed but Not Deployed

| Component | Tech | Location | Status |
|-----------|------|----------|--------|
| Solana Vaults | Anchor program | `solana/` | Code complete, devnet deploy ready |
| TON Vaults | Tact contracts | `ton/` | Code complete, testnet deploy ready |
| FastAPI Backend | Python, PostgreSQL, Redis | `server/api/` | Production hosting pending |

## Data Flow

```
User connects wallet (Reown AppKit)
  |
  +--> Wallet signs transaction
  |      |
  |      +--> viem encodes VaultSimple.deposit(amount, leverage)
  |      |      |
  |      |      +--> EVC routes call to VaultSimple on Ink Sepolia
  |      |             |
  |      |             +--> PythOracleAdapter fetches Pyth price
  |      |             +--> Vault records position (leverage, entry price)
  |      |             +--> USDC transferred from user to vault
  |      |
  |      +--> viem encodes VaultSimple.adjustLeverage(newLeverage)
  |      +--> viem encodes VaultSimple.withdraw(amount)
  |
  +--> Frontend reads Pyth prices via Hermes (off-chain, real-time)
  +--> Frontend reads Yahoo Finance via Data Proxy (backtesting)
  +--> Frontend runs Risk Sentinel FSM (client-side only)
  +--> Frontend runs AI Agent policies (dry-run default)
```

## Network Configuration

| Network | Chain ID | Role | Status |
|---------|----------|------|--------|
| Ink Sepolia | 763373 | Primary — 33 vaults | **Live** |
| Ethereum Sepolia | 11155111 | Mirror deployment | Deployed |
| Solana Devnet | — | Expansion | Code written |
| TON Testnet | — | Expansion | Code written |

## Key Architectural Decisions

1. **Modular Vault architecture** — 33 vaults deployed with 5 modules each (TWAPOracle, PositionModule, FeeEngine, JuniorTranche, RiskModule). VaultSimple retained for local testing only.
2. **Client-side risk engine** — 4-state FSM runs in browser; on-chain RiskModule deployed but client-side FSM is primary UX layer.
3. **Pyth pull-oracle** — Users pay for price updates, ensuring freshness without keeper infrastructure.
4. **Vanilla JS over React** — Faster iteration, no build complexity beyond Vite.
5. **Multi-page SPA** — Each screen is its own HTML file, sharing JS modules. Simpler than client-side routing.
