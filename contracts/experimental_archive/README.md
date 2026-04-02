# Experimental Archive — Previous Modular Vault Iterations

These contracts are **archived copies** of earlier iterations of the modular vault architecture. The canonical modular Vault and its 5 modules are now deployed from `contracts/src/xLever/`.

## What's here

Archived versions of contracts that have since been finalized and deployed:

| Contract | Purpose |
|----------|---------|
| `Vault.sol` | Earlier modular vault iteration |
| `modules/PositionModule.sol` | User position tracking and PnL |
| `modules/FeeEngine.sol` | Dynamic fee calculation |
| `modules/EulerHedgingModule.sol` | Euler V2 EVC atomic looping |
| `modules/RiskModule.sol` | Health monitoring + auto-deleverage |
| `modules/TWAPOracle.sol` | 15-min TWAP with dynamic spread |
| `modules/PythOracleAdapter.sol` | Pyth pull-oracle wrapper |
| `modules/JuniorTranche.sol` | First-loss capital pool (ERC-4626) |

## What's live?

The canonical **modular Vault** (`contracts/src/xLever/Vault.sol`) with 5 modules is deployed on Ink Sepolia (33 vaults). `VaultSimple.sol` is retained for local testing only.
