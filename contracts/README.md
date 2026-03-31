# xLever Contracts (Euler Vault Kit Fork)

**This is a fork of [Euler Vault Kit](https://github.com/euler-xyz/euler-vault-kit) with custom xLever protocol contracts.**

## xLever Custom Contracts

The xLever protocol contracts are located in:
- **`src/xLever/`** - Core xLever protocol contracts
  - `Vault.sol` - Main vault contract with leverage tracking
  - `VaultFactory.sol` - Factory for deploying vaults
  - `VaultSimple.sol` - Simplified vault (under 24KB contract size limit)
  - `modules/EulerHedgingModule.sol` - **Leverage looping module** for real 3x positions via Euler V2
  - `modules/` - Fee engine, junior tranche, position tracking, risk management
  - `libraries/DataTypes.sol` - Shared data structures
  - `interfaces/` - Protocol interfaces

- **`script/`** - Deployment scripts for xLever
  - `DeployXLever.s.sol` - Deploy xLever vaults
  - `DeployEulerVaults.s.sol` - Deploy Euler vaults with 75%/87% LTV
  - `DeployHedgingModule.s.sol` - Deploy hedging modules
  - `TestLeverageLooping.s.sol` - Test leverage looping on-chain

- **`test/`** - Test suite
  - `VaultSimple.t.sol` - Unit tests for simplified vault
  - `EulerHedging.t.sol` - Unit tests for hedging module

## Deployed Contracts (Ink Sepolia)

See the main [xLever README](../README.md) for all deployed contract addresses.

---

# Euler Vault Kit

The Euler Vault Kit is a system for constructing credit vaults. Credit vaults are ERC-4626 vaults with added borrowing functionality. Unlike typical ERC-4626 vaults which earn yield by actively investing deposited funds, credit vaults are passive lending pools. See the [whitepaper](https://docs.euler.finance/euler-vault-kit-white-paper/) for more details.

## Install

To install Euler Vault Kit in a [Foundry](https://github.com/foundry-rs/foundry) project:

```sh
forge install euler-xyz/euler-vault-kit
```

## Usage

To install Foundry:

```sh
curl -L https://foundry.paradigm.xyz | bash
```

This will download foundryup. To start Foundry, run:

```sh
foundryup
```

To clone the repo:

```sh
git clone https://github.com/euler-xyz/euler-vault-kit.git && cd euler-vault-kit
```

## Testing

### in `default` mode

To run the tests in a `default` mode:

```sh
forge test
```

### in `coverage` mode

```sh
./test/scripts/coverage.sh
```

### invariants tests (`/tests/invariants`)
```sh
./test/scripts/echidna.sh # property mode
./test/scripts/echidna-assert.sh # assertion mode
./test/scripts/medusa.sh 
```

## Safety

This software is **experimental** and is provided "as is" and "as available".

**No warranties are provided** and **no liability will be accepted for any loss** incurred through the use of this codebase.

Always include thorough tests when using the Euler Vault Kit to ensure it interacts correctly with your code.

## Known limitations

Refer to the [whitepaper](https://docs.euler.finance/euler-vault-kit-white-paper/) for a list of known limitations and security considerations.

## License

(c) 2024 Euler Labs Ltd.

The Euler Vault Kit code is licensed under GPL-2.0 or later except for the files in `src/EVault/modules/`, which are licensed under Business Source License 1.1 (see the file `LICENSE`). These files will be automatically re-licensed under GPL-2.0 or later on April 24th, 2029.
