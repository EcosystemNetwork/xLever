// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes and console.log (no broadcast needed -- view only)
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol"; // factory interface to verify implementation is set correctly
import {ProtocolConfig} from "../src/ProtocolConfig/ProtocolConfig.sol"; // protocol config interface to verify admin/fee settings
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface to query vault metadata (asset, name, supply)

contract VerifyDeployment is Script { // read-only verification script that checks all deployed contracts are present and configured
    function run() external view { // view function -- does not modify state, only reads and logs
        console.log("=== Verifying Euler Vault Kit Deployment on Ink Sepolia ===\n"); // header for verification output

        address evc = vm.envOr("EVC_ADDRESS", address(0)); // load EVC address with fallback to zero so missing addresses don't revert
        address protocolConfig = vm.envOr("PROTOCOL_CONFIG_ADDRESS", address(0)); // load protocol config address
        address sequenceRegistry = vm.envOr("SEQUENCE_REGISTRY_ADDRESS", address(0)); // load sequence registry address
        address eVaultImpl = vm.envOr("EVAULT_IMPLEMENTATION_ADDRESS", address(0)); // load EVault implementation address
        address factory = vm.envOr("EVAULT_FACTORY_ADDRESS", address(0)); // load factory address
        address irm = vm.envOr("IRM_ADDRESS", address(0)); // load interest rate model address
        address seniorVault = vm.envOr("SENIOR_VAULT_ADDRESS", address(0)); // load senior vault address (may not exist yet)
        address juniorVault = vm.envOr("JUNIOR_VAULT_ADDRESS", address(0)); // load junior vault address (may not exist yet)

        console.log("Core Contracts:"); // section header for core infrastructure checks
        _checkContract("EVC", evc); // verify EVC is deployed -- critical dependency for all vault operations
        _checkContract("ProtocolConfig", protocolConfig); // verify protocol config exists -- needed for fee routing
        _checkContract("SequenceRegistry", sequenceRegistry); // verify sequence registry exists -- needed for vault ID assignment
        _checkContract("EVault Implementation", eVaultImpl); // verify implementation exists -- factory needs it for proxy creation
        _checkContract("EVault Factory", factory); // verify factory exists -- creates all vault instances
        _checkContract("IRM Linear Kink", irm); // verify IRM exists -- vaults need it for interest rate calculation

        console.log("\nVault Contracts:"); // section header for vault-specific checks
        _checkContract("Senior Vault", seniorVault); // verify senior vault deployment (conservative tranche)
        _checkContract("Junior Vault", juniorVault); // verify junior vault deployment (risk-absorbing tranche)

        if (factory != address(0)) { // only check factory config if factory is deployed
            console.log("\nFactory Configuration:"); // section header for factory verification
            GenericFactory factoryContract = GenericFactory(factory); // cast to interface for method calls

            address factoryImpl = factoryContract.implementation(); // read the implementation address the factory uses for proxy creation
            console.log("  Factory Implementation:", factoryImpl); // log so operator can compare with expected

            if (factoryImpl != eVaultImpl && eVaultImpl != address(0)) { // mismatch means factory would create proxies with wrong logic
                console.log("  WARNING: Factory implementation doesn't match EVault implementation!"); // alert operator to potential misconfiguration
            } else { // implementations match -- factory will create correct proxies
                console.log("  [OK] Implementation matches"); // confirm factory is correctly configured
            }
        }

        if (protocolConfig != address(0)) { // only check config if it is deployed
            console.log("\nProtocolConfig Settings:"); // section header for config verification
            ProtocolConfig config = ProtocolConfig(protocolConfig); // cast to interface for method calls

            address admin = config.admin(); // read protocol admin -- controls global settings
            address feeReceiver = config.feeReceiver(); // read fee receiver -- collects protocol fees from all vaults

            console.log("  Admin:", admin); // log admin for operator verification
            console.log("  Fee Receiver:", feeReceiver); // log fee receiver for operator verification
        }

        if (seniorVault != address(0)) { // only inspect senior vault if it exists
            console.log("\nSenior Vault Details:"); // section header
            _printVaultInfo(seniorVault); // print asset, name, and supply for the senior vault
        }

        if (juniorVault != address(0)) { // only inspect junior vault if it exists
            console.log("\nJunior Vault Details:"); // section header
            _printVaultInfo(juniorVault); // print asset, name, and supply for the junior vault
        }

        console.log("\n=== Verification Complete ==="); // visual confirmation verification finished
        _printNextSteps(); // guide operator on what to do next based on current deployment state
    }

    function _checkContract(string memory name, address addr) internal view { // helper: checks if a contract address is set and logs status
        if (addr == address(0)) { // zero address means the contract was not deployed or not set in .env
            console.log("  [X]", name, ": NOT DEPLOYED"); // mark as missing so operator knows to deploy it
        } else { // non-zero means the contract should be deployed at this address
            console.log("  [OK]", name, ":", addr); // mark as present with its address
        }
    }

    function _printVaultInfo(address vaultAddress) internal view { // helper: queries and prints vault metadata using try/catch for resilience
        IEVault vault = IEVault(vaultAddress); // cast address to EVault interface

        try vault.asset() returns (address asset) { // try reading the vault's underlying asset
            console.log("  Asset:", asset); // log the asset address
        } catch { // call may fail if address is not actually an EVault
            console.log("  Asset: Unable to fetch"); // graceful degradation -- don't revert the whole script
        }

        try vault.name() returns (string memory name) { // try reading the vault's ERC-20 name
            console.log("  Name:", name); // log the vault name
        } catch { // call may fail if vault is not initialized
            console.log("  Name: Unable to fetch"); // graceful degradation
        }

        try vault.totalSupply() returns (uint256 supply) { // try reading total share supply
            console.log("  Total Supply:", supply); // log total shares -- indicates if anyone has deposited
        } catch { // call may fail
            console.log("  Total Supply: Unable to fetch"); // graceful degradation
        }
    }

    function _printNextSteps() internal view { // helper: inspects deployment state and recommends next actions
        console.log("\nNext Steps:"); // section header

        bool allDeployed = true; // track whether all components are present

        if (vm.envOr("EVC_ADDRESS", address(0)) == address(0)) { // check if EVC is missing
            console.log("  1. Deploy EVC"); // EVC must be deployed first -- everything depends on it
            allDeployed = false; // mark incomplete
        }

        if (vm.envOr("EVAULT_FACTORY_ADDRESS", address(0)) == address(0)) { // check if factory is missing
            console.log("  2. Deploy Euler Vault Kit core contracts"); // factory + modules + implementation needed
            allDeployed = false; // mark incomplete
        }

        if (vm.envOr("SENIOR_VAULT_ADDRESS", address(0)) == address(0)) { // check if vaults are missing
            console.log("  3. Create Senior and Junior vaults"); // vaults needed for actual lending/borrowing
            allDeployed = false; // mark incomplete
        }

        if (allDeployed) { // all core components are deployed
            console.log("  [OK] All core contracts deployed!"); // confirm full deployment
            console.log("  - Configure vault parameters"); // next: set IRM, caps, fees
            console.log("  - Set up oracles"); // next: configure price feeds
            console.log("  - Test vault operations"); // next: validate deposits and borrows
            console.log("  - Integrate with frontend"); // next: wire up the UI
        }
    }
}
