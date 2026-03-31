// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol";
import {ProtocolConfig} from "../src/ProtocolConfig/ProtocolConfig.sol";
import {IEVault} from "../src/EVault/IEVault.sol";

contract VerifyDeployment is Script {
    function run() external view {
        console.log("=== Verifying Euler Vault Kit Deployment on Ink Sepolia ===\n");

        // Load addresses from environment
        address evc = vm.envOr("EVC_ADDRESS", address(0));
        address protocolConfig = vm.envOr("PROTOCOL_CONFIG_ADDRESS", address(0));
        address sequenceRegistry = vm.envOr("SEQUENCE_REGISTRY_ADDRESS", address(0));
        address eVaultImpl = vm.envOr("EVAULT_IMPLEMENTATION_ADDRESS", address(0));
        address factory = vm.envOr("EVAULT_FACTORY_ADDRESS", address(0));
        address irm = vm.envOr("IRM_ADDRESS", address(0));
        address seniorVault = vm.envOr("SENIOR_VAULT_ADDRESS", address(0));
        address juniorVault = vm.envOr("JUNIOR_VAULT_ADDRESS", address(0));

        // Check core contracts
        console.log("Core Contracts:");
        _checkContract("EVC", evc);
        _checkContract("ProtocolConfig", protocolConfig);
        _checkContract("SequenceRegistry", sequenceRegistry);
        _checkContract("EVault Implementation", eVaultImpl);
        _checkContract("EVault Factory", factory);
        _checkContract("IRM Linear Kink", irm);

        console.log("\nVault Contracts:");
        _checkContract("Senior Vault", seniorVault);
        _checkContract("Junior Vault", juniorVault);

        // Verify factory configuration
        if (factory != address(0)) {
            console.log("\nFactory Configuration:");
            GenericFactory factoryContract = GenericFactory(factory);
            
            address factoryImpl = factoryContract.implementation();
            console.log("  Factory Implementation:", factoryImpl);
            
            if (factoryImpl != eVaultImpl && eVaultImpl != address(0)) {
                console.log("  WARNING: Factory implementation doesn't match EVault implementation!");
            } else {
                console.log("  [OK] Implementation matches");
            }
        }

        // Verify protocol config
        if (protocolConfig != address(0)) {
            console.log("\nProtocolConfig Settings:");
            ProtocolConfig config = ProtocolConfig(protocolConfig);
            
            address admin = config.admin();
            address feeReceiver = config.feeReceiver();
            
            console.log("  Admin:", admin);
            console.log("  Fee Receiver:", feeReceiver);
        }

        // Verify vaults if deployed
        if (seniorVault != address(0)) {
            console.log("\nSenior Vault Details:");
            _printVaultInfo(seniorVault);
        }

        if (juniorVault != address(0)) {
            console.log("\nJunior Vault Details:");
            _printVaultInfo(juniorVault);
        }

        console.log("\n=== Verification Complete ===");
        _printNextSteps();
    }

    function _checkContract(string memory name, address addr) internal view {
        if (addr == address(0)) {
            console.log("  [X]", name, ": NOT DEPLOYED");
        } else {
            console.log("  [OK]", name, ":", addr);
        }
    }

    function _printVaultInfo(address vaultAddress) internal view {
        IEVault vault = IEVault(vaultAddress);
        
        try vault.asset() returns (address asset) {
            console.log("  Asset:", asset);
        } catch {
            console.log("  Asset: Unable to fetch");
        }

        try vault.name() returns (string memory name) {
            console.log("  Name:", name);
        } catch {
            console.log("  Name: Unable to fetch");
        }

        try vault.totalSupply() returns (uint256 supply) {
            console.log("  Total Supply:", supply);
        } catch {
            console.log("  Total Supply: Unable to fetch");
        }
    }

    function _printNextSteps() internal view {
        console.log("\nNext Steps:");
        
        bool allDeployed = true;
        
        if (vm.envOr("EVC_ADDRESS", address(0)) == address(0)) {
            console.log("  1. Deploy EVC");
            allDeployed = false;
        }
        
        if (vm.envOr("EVAULT_FACTORY_ADDRESS", address(0)) == address(0)) {
            console.log("  2. Deploy Euler Vault Kit core contracts");
            allDeployed = false;
        }
        
        if (vm.envOr("SENIOR_VAULT_ADDRESS", address(0)) == address(0)) {
            console.log("  3. Create Senior and Junior vaults");
            allDeployed = false;
        }
        
        if (allDeployed) {
            console.log("  [OK] All core contracts deployed!");
            console.log("  - Configure vault parameters");
            console.log("  - Set up oracles");
            console.log("  - Test vault operations");
            console.log("  - Integrate with frontend");
        }
    }
}
