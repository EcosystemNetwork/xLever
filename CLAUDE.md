# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

xLever is a leveraged tokenized asset protocol (-4× to +4×) built on top of the **Euler Vault Kit (EVK)**. It provides continuous leverage on tokenized assets (wSPYx, wQQQx) without liquidation risk through a two-tranche system.

## Build & Test Commands

### Smart Contracts (Foundry)

```bash
cd contracts

# Install dependencies
forge install

# Build contracts
forge build

# Run all tests
forge test

# Run specific test file
forge test --match-path test/VaultSimple.t.sol -vvv

# Run specific test function
forge test --match-test testDeposit -vvv

# Run tests with gas reporting
forge test --gas-report

# Run tests against live fork
forge test --fork-url https://rpc-gel-sepolia.inkonchain.com -vvv

# Format code
forge fmt

# Coverage
./test/scripts/coverage.sh

# Invariant tests
./test/scripts/echidna.sh
./test/scripts/medusa.sh
```

### Deployment Scripts

```bash
cd contracts

# Deploy Euler Vault Kit infrastructure
forge script script/DeployEulerVaultKit.s.sol \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com \
  --broadcast --private-key $PRIVATE_KEY -vvvv

# Deploy xLever vaults
forge script script/DeployXLever.s.sol \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com \
  --broadcast --private-key $PRIVATE_KEY --legacy

# Deploy hedging modules
forge script script/DeployHedgingModule.s.sol \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com \
  --broadcast --private-key $PRIVATE_KEY -vvvv

# Deploy oracle and configure vault prices
forge script script/DeployOracle.s.sol \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com \
  --broadcast --private-key $PRIVATE_KEY -vvvv

# Test leverage looping on-chain
forge script script/TestLeverageLooping.s.sol \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com \
  --broadcast --private-key $PRIVATE_KEY -vvvv
```

### Frontend

```bash
cd frontend
# Static HTML/JS - open index.html directly in browser
```

### Backend

```bash
cd server
python server.py
```

## Architecture

### Contract Structure

```
contracts/src/
├── xLever/                    # xLever protocol (custom)
│   ├── Vault.sol              # Main vault with leverage tracking
│   ├── VaultSimple.sol        # Simplified vault (<24KB limit)
│   ├── VaultFactory.sol       # Factory for vault deployment
│   └── modules/
│       ├── EulerHedgingModule.sol  # Leverage looping via Euler V2
│       ├── PositionModule.sol      # Fixed-entry leverage tracking
│       ├── FeeEngine.sol           # Dynamic fees + funding rates
│       ├── JuniorTranche.sol       # First-loss capital pool
│       ├── RiskModule.sol          # Auto-deleverage + circuit breakers
│       └── TWAPOracle.sol          # 15-min TWAP with dynamic spread
│
├── EVault/                    # Euler Vault Kit (forked)
│   ├── EVault.sol             # Core vault implementation
│   ├── Dispatch.sol           # Module dispatch system
│   └── modules/               # Modular vault functionality
│       ├── Borrowing.sol
│       ├── Liquidation.sol
│       ├── Governance.sol
│       ├── RiskManager.sol
│       ├── Token.sol
│       └── Vault.sol
│
├── GenericFactory/            # EVault factory
├── InterestRateModels/        # IRM implementations
├── oracles/                   # Price oracles
│   └── FixedPriceOracle.sol   # Testnet fixed-price oracle
└── interfaces/                # Protocol interfaces
```

### Key Architectural Concepts

1. **Two-Tranche System**
   - **Senior**: Leveraged traders, protected from liquidation
   - **Junior**: First-loss LPs earning fee revenue

2. **Fixed-Entry Leverage** (vs daily rebalanced ETFs)
   - PnL = Deposit × Leverage × (Price Change from Entry)
   - No volatility decay in choppy markets

3. **Euler V2 Integration (EVC)**
   - Hedging via leverage looping: USDC ↔ tokenized assets
   - EVC batch operations for atomic position construction
   - LTV: 75% borrow / 87% liquidation

4. **Module Dispatch Pattern** (EVault)
   - EVault uses delegate calls to separate modules
   - Each module handles specific functionality
   - Keeps main contract under size limits

## Network Configuration

- **Network**: Ink Sepolia (testnet)
- **Chain ID**: 763373
- **RPC**: https://rpc-gel-sepolia.inkonchain.com
- **Explorer**: https://explorer-sepolia.inkonchain.com

## Environment Setup

Copy `.env.example` to `.env` and fill in:
- `PRIVATE_KEY`: Deployment wallet key
- `EVC_ADDRESS`: Ethereum Vault Connector (deployed: `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c`)

## Key Deployed Contracts (Ink Sepolia)

See README.md for full list. Key addresses:
- **EVC**: `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c`
- **wSPYx Hedging**: `0xd0673BeB607CA2136b126d34ED0D3Ff7826c93EE`
- **wQQQx Hedging**: `0x3Bc3c0D268455aD7eAe1432f57f3C24f42EdC7C8`

## Foundry Configuration

Key settings in `contracts/foundry.toml`:
- Optimizer enabled with 20,000 runs
- `via_ir = true` for complex contracts
- Fuzz runs: 1000
- Invariant depth: 50
