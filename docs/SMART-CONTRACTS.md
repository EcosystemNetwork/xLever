# Smart Contracts Reference

Complete reference for xLever's Solidity contracts.

> **Canonical deployed contract: `VaultSimple.sol`** — 33 asset vaults on Ink Sepolia.
> The full modular `Vault.sol` with 7 modules is in `contracts/src/xLever/experimental/` and is **not yet deployed**.

---

## Deployed Addresses (Ink Sepolia — Chain ID 763373)

All vaults below are **VaultSimple** instances (lightweight, no fees/hedging modules).

| Contract | Address | Role |
|----------|---------|------|
| EVC | `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c` | Ethereum Vault Connector (atomic batch executor) |
| QQQ Vault | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` | VaultSimple for wQQQx leverage |
| SPY Vault | `0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228` | VaultSimple for wSPYx leverage |
| USDC | `0x6b57475467cd854d36Be7FB614caDa5207838943` | Base collateral (6 decimals) |
| wQQQx | `0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9` | Wrapped Nasdaq-100 xStock |
| wSPYx | `0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e` | Wrapped S&P 500 xStock |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` | Pyth price oracle (on-chain) |
| PythAdapter | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` | Pyth pull-oracle adapter + fee handler |

### Euler V2 Core (Ethereum Mainnet — Reference)

| Contract | Address |
|----------|---------|
| EVC | `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383` |
| eVault Factory | `0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e` |
| Protocol Config | `0x4cD6BF1D183264c02Be7748Cb5cd3A47d013351b` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

### xStocks ERC-20 (Ethereum Mainnet)

| Token | Address |
|-------|---------|
| QQQx | `0xa753a7395cae905cd615da0b82a53e0560f250af` |
| SPYx | `0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48` |

---

## Contract Hierarchy

### Deployed (VaultSimple)

```
VaultFactory
  |-- deploys --> VaultSimple (per asset)
                    |-- deposit / withdraw / adjustLeverage
                    |-- Pyth oracle price updates
                    |-- No fees, no hedging modules, no junior tranche
```

### Planned (experimental/Vault.sol — not deployed)

```
VaultFactory
  |-- deploys --> Vault (per asset)
                    |-- PositionModule     (track user positions)
                    |-- EulerHedgingModule (Euler V2 looping via EVC)
                    |-- RiskModule         (health monitoring)
                    |-- FeeEngine          (dynamic fee calculation)
                    |-- TWAPOracle         (15-min TWAP + dynamic spread)
                    |-- PythOracleAdapter  (Pyth pull-oracle wrapper)
                    |-- JuniorTranche     (first-loss capital pool)
```

---

## Contract Reference

### VaultFactory

Deploys and registers new asset vaults.

| Function | Params | Returns | Description |
|----------|--------|---------|-------------|
| `createVault()` | asset, oracle config | vault address | Deploy a new vault for an asset |
| `getVault()` | asset address | vault address | Look up vault by asset |
| `updateGlobalParams()` | params struct | -- | Update protocol-wide parameters |

### Vault (Planned — experimental/Vault.sol, not deployed)

> The functions below describe the **planned** modular Vault interface. The deployed VaultSimple exposes a subset of these (deposit, withdraw, adjustLeverage) without fees or junior tranche.

All write functions accept `priceUpdateData` (Pyth VAA bytes) and require `msg.value` for the Pyth update fee.

#### Write Functions

| Function | Params | Returns | Description |
|----------|--------|---------|-------------|
| `deposit` | `amount` (uint256), `leverageBps` (int32), `priceUpdateData` (bytes[]) | `positionValue` (uint256) | Open a leveraged position. Leverage in basis points: +20000 = +2x, -30000 = -3x |
| `withdraw` | `amount` (uint256), `priceUpdateData` (bytes[]) | `received` (uint256) | Close or reduce position |
| `adjustLeverage` | `newLeverageBps` (int32), `priceUpdateData` (bytes[]) | -- | Change leverage (subject to cooldowns) |
| `depositJunior` | `amount` (uint256) | `shares` (uint256) | Deposit into junior tranche |
| `withdrawJunior` | `shares` (uint256) | `amount` (uint256) | Withdraw from junior tranche |
| `updateOracle` | `priceUpdateData` (bytes[]) | -- | Manual oracle refresh |

#### Read Functions

| Function | Params | Returns | Description |
|----------|--------|---------|-------------|
| `getPosition` | `user` (address) | Position struct | Get user's current position |
| `getPositionValue` | `user` (address) | `value`, `pnl` | Current position value and PnL |
| `getPoolState` | -- | PoolState struct | Total deposits, exposure, health |
| `getCurrentTWAP` | -- | uint128 | 15-min TWAP price |
| `getMaxLeverage` | -- | int32 | Current dynamic max leverage |
| `getFundingRate` | -- | int256 | Current funding rate (signed) |
| `getCarryRate` | -- | uint256 | Current carry fee rate |
| `getJuniorValue` | -- | uint256, uint256 | Junior tranche total value & share price |

### Other Contracts (Planned — in experimental/modules/, not deployed)

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| PositionModule | Track user positions | `getPosition()`, `updatePosition()`, `applyDeleverage()` |
| FeeEngine | Dynamic fee calculation | `calcDynamicEntryFee()`, `calcContinuousFee()`, `getFundingRate()` |
| EulerHedgingModule | Manage Euler V2 positions via EVC | `hedge()`, `rebalance()`, `executeBatchLoop()` |
| RiskModule | Monitor and mitigate risk | `checkHealth()`, `autoDeleverage()`, `triggerCircuitBreaker()` |
| TWAPOracle | 15-min price averaging | `getTWAP()`, `updatePrice()`, `getDynamicSpread()` |
| EVCBatchManager | Atomic looping via EVC multicall | `buildLoopBatch()`, `executeAtomicLeverage()` |
| CircuitBreaker | Emergency pause controls | `checkLimits()`, `triggerPause()`, `graduatedResponse()` |
| JuniorTranche | First-loss capital | `deposit()`, `withdraw()`, `absorbLoss()` |

---

## Data Structures

### Position

```solidity
struct Position {
    uint128 depositAmount;        // USDC deposited (6 decimals)
    int32   leverageBps;          // -40000 to +40000 (basis points)
    uint128 entryTWAP;            // TWAP at position open/adjust (8 decimals)
    uint64  lastFeeTimestamp;     // Last fee settlement time
    uint128 settledFees;          // Fees already deducted
    uint32  leverageLockExpiry;   // Earliest time to increase leverage (unix)
    bool    isActive;             // Position exists
}
```

### PoolState

```solidity
struct PoolState {
    uint128 totalSeniorDeposits;    // Total senior USDC
    uint128 totalJuniorDeposits;    // Total junior USDC
    uint128 insuranceFund;          // Protocol backstop reserve
    int256  netExposure;            // Net long/short in asset terms
    uint128 grossLongExposure;      // Total long notional
    uint128 grossShortExposure;     // Total short notional
    uint64  lastRebalanceTime;      // Last hedging sync
    uint32  currentMaxLeverageBps;  // Dynamic cap based on junior ratio
    int64   fundingRateBps;         // Current funding rate (signed)
    uint8   protocolState;          // 0=active, 1=stressed, 2=paused, 3=emergency
}
```

### EulerPosition

```solidity
struct EulerPosition {
    address collateralVault;        // EVK vault holding collateral
    address debtVault;              // EVK vault from which we borrow
    uint256 subAccountId;           // EVC sub-account (0-255)
    uint128 collateralShares;       // Shares in collateral vault
    uint128 debtAmount;             // Borrowed amount
    uint256 healthScore;            // Euler health score (>1 = safe)
    bool    isActive;               // Position open
}
```

### TWAPBuffer

```solidity
struct TWAPBuffer {
    uint128[75] prices;             // 15 min of 12-sec samples
    uint8       currentIndex;       // Circular buffer pointer
    uint128     runningSum;         // For O(1) average calculation
    uint64      lastUpdateTime;     // Staleness check
    uint128     lastSpotPrice;      // Latest spot for divergence check
    uint16      dynamicSpreadBps;   // Current spread based on divergence
}
```

### CircuitBreaker

```solidity
struct CircuitBreaker {
    uint256 dailyVolume;            // Rolling 24h notional volume
    uint256 dailyVolumeLimit;       // Max notional per day
    uint256 lastJuniorValue;        // Junior NAV 24h ago
    uint256 maxDrawdownBps;         // Max daily junior drawdown
    uint256 volatility24h;          // Realized volatility
    uint256 volatilityThresholdBps; // Pause if exceeded
    uint64  lastVolumeReset;        // Daily reset timestamp
    uint8   state;                  // 0=normal, 1=warning, 2=triggered
}
```

### SlowWithdrawal

```solidity
struct SlowWithdrawal {
    address user;
    uint256 totalAmount;        // Total notional to unwind
    uint256 executedAmount;     // Amount unwound so far
    uint256 chunksRemaining;    // Number of execution chunks left
    uint64  nextExecutionTime;  // Earliest time for next chunk
    uint64  chunkInterval;      // Seconds between chunks (default: 15 min)
}
```

---

## ERC-20 ABI (USDC, wQQQx, wSPYx)

```json
[
  { "name": "approve",      "inputs": ["address spender", "uint256 amount"],         "outputs": ["bool"] },
  { "name": "allowance",    "inputs": ["address owner", "address spender"],          "outputs": ["uint256"] },
  { "name": "balanceOf",    "inputs": ["address account"],                           "outputs": ["uint256"] },
  { "name": "decimals",     "inputs": [],                                            "outputs": ["uint8"] },
  { "name": "symbol",       "inputs": [],                                            "outputs": ["string"] },
  { "name": "totalSupply",  "inputs": [],                                            "outputs": ["uint256"] }
]
```

---

## Frontend Contract Adapter

The frontend uses `viem` to interact with deployed contracts. See `frontend/contracts.js` for the full adapter.

```javascript
import { ADDRESSES, VAULT_ABI, ERC20_ABI } from './contracts.js'

// Read a position
const position = await publicClient.readContract({
  address: ADDRESSES.vault,
  abi: VAULT_ABI,
  functionName: 'getPosition',
  args: [userAddress],
})

// Deposit with leverage (requires Pyth price update)
const { updateData } = await getLatestPriceUpdate([PYTH_FEEDS['QQQ/USD']])
await walletClient.writeContract({
  address: ADDRESSES.vault,
  abi: VAULT_ABI,
  functionName: 'deposit',
  args: [parseUnits('1000', 6), 20000, updateData],  // $1000, +2x
  value: parseEther('0.001'),  // Pyth update fee
})
```

---

## Rebalancing Triggers

| Trigger | Threshold | Action |
|---------|-----------|--------|
| Leverage drift | +/-10% from target | Rebalance to target |
| Health score low | < 1.5 | Reduce exposure |
| Health score critical | < 1.3 | Emergency deleverage |
| Large user adjustment | > 5% of pool | Immediate hedge |
| Time-based | Every 4 hours | Sync if drift > 2% |

---

## Euler LTV Change Monitoring

Euler governance can change vault LTV at any time. The protocol monitors for this:

- Called by keeper every 4 hours and can be triggered permissionlessly
- If LTV drops, positions exceeding the new max are force-deleveraged
- No penalty on users — this is a protocol-level parameter change
- Entry price resets to current TWAP on forced reduction
