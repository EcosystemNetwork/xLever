# Hey Mads - Here's where we're at

Hope you got some good sleep. We've been cooking while you were out. Here's the full status so you can hit the ground running.

## What's done

### Frontend (7 screens, fully interactive)
All screens are in `frontend/` with consistent nav, wallet connect (Reown AppKit), and real xStocks data:

1. **Dashboard** — Portfolio overview, PnL cards, live trades feed
2. **Trading Terminal** — Chart, order book, -4x/+4x leverage slider, position entry
3. **AI Agent Operations** — Agent cards, execution log, deployment controls
4. **Vault Management** — Euler V2 vaults, deposit/withdraw, tranche visualization
5. **Risk Management** — Correlation matrix, liquidation ladder, auto-deleverage cascade
6. **Analytics & Backtesting** — Strategy comparison, Monte Carlo, LTAP vs daily reset
7. **Operations Control** — System health, tx history, governance, alerts

Run locally: `npx vite` then open `http://localhost:5173/frontend/01-dashboard.html`

### Wallet + Contract Layer
- **`wallet.js`** — Reown AppKit with wagmi adapter, dark themed, xLever branding
- **`ux.js`** — Toast notifications, trade confirmation modal (with real tx flow when vault is deployed, simulated otherwise), leverage slider, skeleton loading
- **`contracts.js`** — Full viem adapter for your Vault contracts. Already has:
  - Ink Sepolia chain config
  - ABIs matching `Vault.sol` and `VaultSimple.sol` exactly
  - `openPosition(amount, leverage)` — handles USDC approve + deposit
  - `closePosition(amount)` — withdraw flow
  - `adjustLeverage(newLeverage)` — adjust existing position
  - `depositJunior(amount)` / `withdrawJunior(shares)` — LP flows
  - All read functions: getPosition, getPositionValue, getPoolState, getTWAP, etc.
  - Explorer URL helpers for Ink Sepolia

### Token Addresses (already in contracts.js)
```
USDC:  0x6b57475467cd854d36Be7FB614caDa5207838943
wSPYx: 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e
wQQQx: 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9
EVC:   0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c
```

## What you need to do

### 1. Deploy the vaults
The deployment script is ready at `contracts/script/DeployXLever.s.sol`. It deploys `VaultSimple` for both wSPYx and wQQQx:

```bash
cd contracts
cp ../.env.example ../.env
# Fill in PRIVATE_KEY

forge script script/DeployXLever.s.sol --rpc-url https://rpc-gel-sepolia.inkonchain.com --broadcast
```

### 2. Tell the frontend about the vault addresses
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

### 3. Review the contracts
I didn't change any of your Solidity code — everything in `contracts/src/xLever/` is exactly as you left it. The frontend adapter (`contracts.js`) was built to match your ABI signatures:

- `deposit(uint256 amount, int32 leverageBps)` — leverage in basis points (-40000 to +40000)
- `withdraw(uint256 amount)`
- `adjustLeverage(int32 newLeverageBps)`
- `getPosition(address user)` — returns the Position struct
- `getPositionValue(address user)` — returns (value, pnl)
- `getPoolState()` — returns the PoolState struct

If you change any function signatures, just update the `VAULT_ABI` array in `contracts.js` to match.

### 4. Things to consider
- **VaultSimple vs Vault**: The deploy script uses `VaultSimple` (no fees, no hedging) for speed. If you want the full `Vault.sol` with all modules (FeeEngine, JuniorTranche, TWAPOracle, RiskModule), you'll need to verify contract size fits or split it.
- **Oracle initialization**: `TWAPOracle.initializeBuffer(startPrice)` needs to be called after deploy with the current xStocks price (8 decimals).
- **USDC approval**: The frontend handles `approve()` before `deposit()` automatically.

## Architecture
```
User Wallet (AppKit)
      │
      ▼
  contracts.js (viem)
      │
      ├── openPosition() ──→ USDC.approve() → Vault.deposit()
      ├── closePosition() ──→ Vault.withdraw()
      ├── adjustLeverage() ──→ Vault.adjustLeverage()
      └── getPosition() ──→ Vault.getPosition() [view]
      │
      ▼
  VaultSimple.sol (Ink Sepolia)
      ├── USDC transfers
      ├── Position tracking
      └── Pool state management
```

## Quick test after deploy
1. `npx vite` — start frontend
2. Connect wallet on Ink Sepolia
3. Get testnet USDC (faucet?)
4. Open a position on the Trading Terminal screen
5. Verify tx on Ink Sepolia explorer

LFG when you're up.

— The overnight crew
