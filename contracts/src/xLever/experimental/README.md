# Experimental — Modular Vault Architecture

These contracts represent the **planned production architecture** for xLever. They are **not deployed** and are under active development.

## What's here

| Contract | Purpose |
|----------|---------|
| `Vault.sol` | Full modular vault with module dispatch (replaces VaultSimple) |
| `modules/PositionModule.sol` | User position tracking and PnL |
| `modules/FeeEngine.sol` | Dynamic fee calculation |
| `modules/EulerHedgingModule.sol` | Euler V2 EVC atomic looping |
| `modules/RiskModule.sol` | Health monitoring + auto-deleverage |
| `modules/TWAPOracle.sol` | 15-min TWAP with dynamic spread |
| `modules/PythOracleAdapter.sol` | Pyth pull-oracle wrapper |
| `modules/JuniorTranche.sol` | First-loss capital pool (ERC-4626) |

## Why not deployed?

The full modular Vault exceeds contract size limits when compiled as a single deployment. Production deployment requires either:

1. Proxy pattern (BeaconProxy / diamond)
2. Splitting modules into standalone contracts with cross-contract calls
3. Solidity optimizer tuning + function selector optimization

## What's live instead?

**`VaultSimple.sol`** (in the parent directory) is the canonical deployed contract on Ink Sepolia. It provides core deposit/withdraw/leverage functionality without fees, hedging modules, or junior tranche logic.

## Migration path

VaultSimple → Modular Vault is planned for mainnet. The modular contracts here define the target architecture.
