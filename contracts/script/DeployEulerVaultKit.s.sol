// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {EVault} from "../src/EVault/EVault.sol";
import {Dispatch} from "../src/EVault/Dispatch.sol";
import {Base} from "../src/EVault/shared/Base.sol";
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol";
import {ProtocolConfig} from "../src/ProtocolConfig/ProtocolConfig.sol";
import {SequenceRegistry} from "../src/SequenceRegistry/SequenceRegistry.sol";
import {IRMLinearKink} from "../src/InterestRateModels/IRMLinearKink.sol";

contract DeployEulerVaultKit is Script {
    struct DeploymentAddresses {
        address evc;
        address protocolConfig;
        address sequenceRegistry;
        address balanceTracker;
        address permit2;
        address eVaultImplementation;
        address eVaultFactory;
        address irmLinearKink;
    }

    DeploymentAddresses public deployed;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying Euler Vault Kit to Ink Sepolia");
        console.log("Deployer address:", deployer);
        console.log("Deployer balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy or use existing EVC (Ethereum Vault Connector)
        // For Ink Sepolia, we'll need to check if EVC is already deployed
        address evcAddress = vm.envOr("EVC_ADDRESS", address(0));
        if (evcAddress == address(0)) {
            console.log("WARNING: EVC_ADDRESS not set in .env");
            console.log("You need to deploy EVC separately or provide existing address");
            revert("EVC_ADDRESS required");
        }
        deployed.evc = evcAddress;
        console.log("Using EVC at:", deployed.evc);

        // 2. Deploy ProtocolConfig
        deployed.protocolConfig = address(new ProtocolConfig(deployer, deployer));
        console.log("ProtocolConfig deployed at:", deployed.protocolConfig);

        // 3. Deploy SequenceRegistry
        deployed.sequenceRegistry = address(new SequenceRegistry());
        console.log("SequenceRegistry deployed at:", deployed.sequenceRegistry);

        // 4. Set Balance Tracker (optional, can be address(0))
        deployed.balanceTracker = vm.envOr("BALANCE_TRACKER_ADDRESS", address(0));
        console.log("Balance Tracker:", deployed.balanceTracker);

        // 5. Set Permit2 (optional for now)
        deployed.permit2 = vm.envOr("PERMIT2_ADDRESS", address(0));
        console.log("Permit2:", deployed.permit2);

        // 6. Deploy EVault Implementation
        Base.Integrations memory integrations = Base.Integrations({
            evc: deployed.evc,
            protocolConfig: deployed.protocolConfig,
            sequenceRegistry: deployed.sequenceRegistry,
            balanceTracker: deployed.balanceTracker,
            permit2: deployed.permit2
        });

        // Module addresses - these need to be deployed separately or embedded
        // For simplicity, we'll use address(0) which means modules are embedded in EVault
        Dispatch.DeployedModules memory modules = Dispatch.DeployedModules({
            initialize: address(0),
            token: address(0),
            vault: address(0),
            borrowing: address(0),
            liquidation: address(0),
            riskManager: address(0),
            balanceForwarder: address(0),
            governance: address(0)
        });

        deployed.eVaultImplementation = address(new EVault(integrations, modules));
        console.log("EVault Implementation deployed at:", deployed.eVaultImplementation);

        // 7. Deploy GenericFactory for EVault
        deployed.eVaultFactory = address(new GenericFactory(deployer));
        console.log("EVault Factory deployed at:", deployed.eVaultFactory);

        // 8. Deploy Interest Rate Model (Linear Kink)
        // Parameters for IRMLinearKink: baseRate, slope1, slope2, kink
        // Example: 0% base, 5% at kink (80% utilization), 50% at 100%
        // Note: kink is in uint32.max scale, so 80% = 0.8 * type(uint32).max
        deployed.irmLinearKink = address(
            new IRMLinearKink(
                0, // baseRate: 0%
                uint256(5e16) / uint256(365 days), // slope1: 5% APY at kink
                uint256(45e16) / uint256(365 days), // slope2: additional 45% above kink
                uint32((uint256(type(uint32).max) * 80) / 100) // kink: 80% utilization
            )
        );
        console.log("IRM Linear Kink deployed at:", deployed.irmLinearKink);

        vm.stopBroadcast();

        // Save deployment addresses
        _saveDeployment();

        console.log("\n=== Deployment Complete ===");
        console.log("Next steps:");
        console.log("1. Create vaults using the factory");
        console.log("2. Configure vault parameters");
        console.log("3. Set up oracles for collateral assets");
        console.log("4. Test vault operations on testnet");
    }

    function _saveDeployment() internal {
        string memory deploymentJson = string.concat(
            '{\n',
            '  "network": "ink-sepolia",\n',
            '  "evc": "', vm.toString(deployed.evc), '",\n',
            '  "protocolConfig": "', vm.toString(deployed.protocolConfig), '",\n',
            '  "sequenceRegistry": "', vm.toString(deployed.sequenceRegistry), '",\n',
            '  "balanceTracker": "', vm.toString(deployed.balanceTracker), '",\n',
            '  "permit2": "', vm.toString(deployed.permit2), '",\n',
            '  "eVaultImplementation": "', vm.toString(deployed.eVaultImplementation), '",\n',
            '  "eVaultFactory": "', vm.toString(deployed.eVaultFactory), '",\n',
            '  "irmLinearKink": "', vm.toString(deployed.irmLinearKink), '"\n',
            '}\n'
        );

        vm.writeFile("deployments/ink-sepolia.json", deploymentJson);
        console.log("\nDeployment addresses saved to: deployments/ink-sepolia.json");
    }
}
