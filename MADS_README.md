# Hey Mads - Here's where we're at

Hope you got some good sleep. We've been cooking while you were out. Here's the full status so you can hit the ground running.

## What's done

### Frontend (8 screens, fully interactive)
All screens are in `frontend/` with consistent nav, wallet connect (Reown AppKit), and real xStocks data:

1. **Landing Page** — Protocol overview, feature cards, wallet connect, 4-chain support
2. **Dashboard** — Portfolio overview, PnL cards, live trades feed, health metrics
3. **Trading Terminal** — TradingView chart with real data, order book, -4x/+4x leverage slider, position entry
4. **AI Agent Operations** — Agent cards, execution log, deployment controls, 3 policy modes (Safe, Target, Accumulate)
5. **Vault Management** — Euler V2 vaults, senior/junior tranche deposit/withdraw, visualization
6. **Risk Management** — Correlation matrix, liquidation ladder, auto-deleverage cascade, 4-state sentinel alerts
7. **Analytics & Backtesting** — Strategy comparison, LTAP vs daily-reset with real Yahoo Finance data, circuit breaker markers
8. **Operations Control** — System health, tx history, governance, operational alerts

Run locally: `npm run dev` then open `http://localhost:3000`

### Wallet + Contract Layer
- **`wallet.js`** — Reown AppKit with wagmi adapter, dark themed, xLever branding. Supports Ethereum mainnet, Ink Sepolia, Solana, TON
- **`ux.js`** — Toast notifications, trade confirmation modal (with real tx flow when vault is deployed, simulated otherwise), interactive leverage slider (-4x to +4x with drag), skeleton loading
- **`contracts.js`** — Full viem adapter for your Vault contracts. Already has:
  - Ink Sepolia chain config
  - ABIs matching `Vault.sol` and `VaultSimple.sol` exactly (including Pyth priceUpdateData params)
  - `openPosition(amount, leverage)` — handles USDC approve + Pyth price fetch + deposit with fee
  - `closePosition(amount)` — withdraw flow with Pyth update
  - `adjustLeverage(newLeverage)` — adjust existing position with Pyth update
  - `depositJunior(amount)` / `withdrawJunior(shares)` — LP flows
  - All read functions: getPosition, getPositionValue, getPoolState, getTWAP, getMaxLeverage, getFundingRate, getJuniorValue
  - Pyth fee estimation via PythAdapter.getUpdateFee() with 10% buffer
  - Explorer URL helpers for Ink Sepolia

### Oracle Layer
- **`pyth.js`** — Full Hermes client with feed IDs for QQQ, SPY, AAPL, NVDA, TSLA, ETH. Fetches updateData bytes for on-chain vault calls. Includes staleness checker and price divergence calculator.

### Risk Engine
- **`risk-engine.js`** — Deterministic 4-state sentinel (NORMAL → WARNING → RESTRICTED → EMERGENCY). Monitors oracle freshness, divergence, drawdown, health factor, volatility, and pool utilization. Has 5-level auto-deleverage cascade. Includes 3 demo scenarios for the risk management screen.

### AI Agent
- **`agent-executor.js`** — Real decision loop that reads Pyth oracle + on-chain contracts + OpenBB, evaluates policy rules, and executes real transactions (or dry-run previews). Three modes: Safe (stop-loss), Target Exposure (maintain band), Accumulate (DCA). Permission boundaries enforced in code — not just UI.

### Backend
- **`server/server.py`** — Simple HTTP proxy for Yahoo Finance (used by backtester)
- **`server/api/`** — Full FastAPI app with routes for users, positions, agents, alerts, prices (DB-cached), and OpenBB intelligence. PostgreSQL + Redis via Docker.

### Code Documentation
- **Every line of code is commented** explaining WHY it exists — all JS, CSS, Python, and Solidity files

### Token Addresses (already in contracts.js)
```
EVC:   0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c
USDC:  0x6b57475467cd854d36Be7FB614caDa5207838943
wSPYx: 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e
wQQQx: 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9
Pyth:  0x2880aB155794e7179c9eE2e38200202908C17B43
PythAdapter: 0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f
QQQ Vault: 0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6
SPY Vault: 0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228
```

## What you need to do

### 1. Deploy the vaults (if redeploying)
The deployment script is ready at `contracts/script/DeployXLever.s.sol`. It deploys `VaultSimple` for both wSPYx and wQQQx:

```bash
cd contracts
cp ../.env.example ../.env
# Fill in PRIVATE_KEY

forge script script/DeployXLever.s.sol --rpc-url https://rpc-gel-sepolia.inkonchain.com --broadcast
```

### 2. Tell the frontend about new vault addresses (only if redeploying)
After deployment, update `frontend/contracts.js` — find the `ADDRESSES` object and fill in:
```js
spyVault: '0x_YOUR_DEPLOYED_SPY_VAULT',
qqqVault: '0x_YOUR_DEPLOYED_QQQ_VAULT',
```

Or at runtime:
```js
window.xLeverContracts.setAddress('vault', '0x_YOUR_VAULT')
```

Once `vault` is set, the trade confirmation modal automatically switches from simulated to real on-chain transactions.

### 3. Review the contract adapter
I didn't change any of your Solidity code — everything in `contracts/src/xLever/` is exactly as you left it (now with comments on every line). The frontend adapter (`contracts.js`) was built to match your ABI signatures:

- `deposit(uint256 amount, int32 leverageBps, bytes[] priceUpdateData)` — leverage in basis points (-40000 to +40000), includes Pyth update
- `withdraw(uint256 amount, bytes[] priceUpdateData)` — with Pyth update
- `adjustLeverage(int32 newLeverageBps, bytes[] priceUpdateData)` — with Pyth update
- `getPosition(address user)` — returns the Position struct
- `getPositionValue(address user)` — returns (value, pnl)
- `getPoolState()` — returns the PoolState struct
- `getCurrentTWAP()` — returns (twap, spreadBps)
- `getMaxLeverage()` / `getFundingRate()` / `getCarryRate()` / `getJuniorValue()`

If you change any function signatures, just update the `VAULT_ABI` array in `contracts.js` to match.

### 4. Things to consider
- **VaultSimple vs Vault**: The deploy script uses `VaultSimple` (no fees, no hedging) for speed. If you want the full `Vault.sol` with all modules (FeeEngine, JuniorTranche, TWAPOracle, RiskModule, EulerHedgingModule), you'll need to verify contract size fits or split it.
- **Oracle initialization**: `TWAPOracle.initializeBuffer(startPrice)` needs to be called after deploy with the current xStocks price (8 decimals).
- **USDC approval**: The frontend handles `approve()` before `deposit()` automatically.
- **Pyth fees**: The frontend fetches the update fee from PythAdapter.getUpdateFee() and adds a 10% buffer. If the adapter isn't deployed, it falls back to 0.001 ETH.
- **Risk sentinel**: The risk engine runs client-side and reads from on-chain state + Pyth. It's deterministic — same inputs always produce same outputs. Demo scenarios are in `risk-engine.js` for the risk management screen.

## Architecture
```
User Wallet (Reown AppKit — 4 chains)
      │
      ▼
  contracts.js (viem)
      │
      ├── openPosition() ──→ Pyth.getPriceUpdate() → USDC.approve() → Vault.deposit{value: fee}()
      ├── closePosition() ──→ Pyth.getPriceUpdate() → Vault.withdraw{value: fee}()
      ├── adjustLeverage() ──→ Pyth.getPriceUpdate() → Vault.adjustLeverage{value: fee}()
      ├── depositJunior() ──→ USDC.approve() → Vault.depositJunior()
      └── getPosition() ──→ Vault.getPosition() [view]
      │
      ▼
  VaultSimple.sol / Vault.sol (Ink Sepolia)
      ├── USDC transfers
      ├── Position tracking (PositionModule)
      ├── Euler V2 hedging (EulerHedgingModule via EVC)
      ├── Fee calculation (FeeEngine)
      ├── Risk monitoring (RiskModule)
      ├── Junior tranche (JuniorTranche)
      └── Oracle (PythOracleAdapter + TWAPOracle)
```

## Quick test after deploy
1. `npm run dev` — start frontend
2. Connect wallet on Ink Sepolia
3. Get testnet USDC (faucet?)
4. Open a position on the Trading Terminal screen
5. Verify tx on Ink Sepolia explorer: https://explorer-sepolia.inkonchain.com
6. Check risk management screen — sentinel should show NORMAL state with live oracle data

LFG when you're up.

— The overnight crew
