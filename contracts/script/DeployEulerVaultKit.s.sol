// SPDX-License-Identifier: GPL-2.0-or-later // required license header for Euler-derived code compatibility
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in financial calculations

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and tx broadcasting
import {EVault} from "../src/EVault/EVault.sol"; // Euler V2 vault implementation that all proxies delegatecall into
import {Dispatch} from "../src/EVault/Dispatch.sol"; // routes function calls to the appropriate module via delegatecall
import {Base} from "../src/EVault/shared/Base.sol"; // defines the Integrations struct that bundles protocol dependencies
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol"; // minimal-proxy factory for gas-efficient vault creation
import {ProtocolConfig} from "../src/ProtocolConfig/ProtocolConfig.sol"; // global config holding admin/fee settings shared across all vaults
import {SequenceRegistry} from "../src/SequenceRegistry/SequenceRegistry.sol"; // assigns unique sequence numbers to each vault for identification
import {IRMLinearKink} from "../src/InterestRateModels/IRMLinearKink.sol"; // interest rate model with a kink to penalize high utilization

contract DeployEulerVaultKit is Script { // comprehensive deployment script for the full Euler Vault Kit with JSON output
    struct DeploymentAddresses { // struct to collect all deployed addresses for organized output and JSON serialization
        address evc; // Ethereum Vault Connector -- enables cross-vault operations and batch calls
        address protocolConfig; // global protocol settings (admin, fee receiver)
        address sequenceRegistry; // assigns unique IDs to vaults
        address balanceTracker; // optional external balance tracker for reward distribution
        address permit2; // optional Uniswap Permit2 for gasless token approvals
        address eVaultImplementation; // master vault implementation that proxies delegatecall into
        address eVaultFactory; // factory that deploys minimal proxy clones of the implementation
        address irmLinearKink; // interest rate model governing borrow costs
    }

    DeploymentAddresses public deployed; // public storage so other scripts or tests can read deployed addresses

    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load private key from .env to keep secrets out of source
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for ownership and gas verification

        console.log("Deploying Euler Vault Kit to Ink Sepolia"); // identify target network in output
        console.log("Deployer address:", deployer); // confirm deployer identity before spending gas
        console.log("Deployer balance:", deployer.balance); // verify sufficient ETH for deployment gas costs

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting transactions

        address evcAddress = vm.envOr("EVC_ADDRESS", address(0)); // try loading pre-deployed EVC address; default to zero if missing
        if (evcAddress == address(0)) { // EVC is a hard dependency -- vaults cannot function without it
            console.log("WARNING: EVC_ADDRESS not set in .env"); // warn operator about the missing dependency
            console.log("You need to deploy EVC separately or provide existing address"); // guide operator to resolve
            revert("EVC_ADDRESS required"); // halt deployment because proceeding without EVC would create broken vaults
        }
        deployed.evc = evcAddress; // store EVC address for later use in integrations struct and JSON output
        console.log("Using EVC at:", deployed.evc); // confirm which EVC instance we are connecting to

        deployed.protocolConfig = address(new ProtocolConfig(deployer, deployer)); // deploy protocol config: deployer is both admin and fee receiver for testnet simplicity
        console.log("ProtocolConfig deployed at:", deployed.protocolConfig); // log for operator reference

        deployed.sequenceRegistry = address(new SequenceRegistry()); // deploy sequence registry -- stateless constructor, just needs to exist on-chain
        console.log("SequenceRegistry deployed at:", deployed.sequenceRegistry); // log for operator reference

        deployed.balanceTracker = vm.envOr("BALANCE_TRACKER_ADDRESS", address(0)); // optionally load external balance tracker; zero means no reward forwarding
        console.log("Balance Tracker:", deployed.balanceTracker); // log whether balance tracking is enabled

        deployed.permit2 = vm.envOr("PERMIT2_ADDRESS", address(0)); // optionally load Permit2 address; zero means gasless approvals are disabled
        console.log("Permit2:", deployed.permit2); // log whether Permit2 is configured

        Base.Integrations memory integrations = Base.Integrations({ // bundle all integration addresses for the EVault constructor
            evc: deployed.evc, // EVC enables cross-vault account management
            protocolConfig: deployed.protocolConfig, // provides fee and admin config to vaults
            sequenceRegistry: deployed.sequenceRegistry, // assigns unique IDs during vault creation
            balanceTracker: deployed.balanceTracker, // forwards balance changes to external reward systems
            permit2: deployed.permit2 // enables gasless ERC-20 approvals via signatures
        });

        Dispatch.DeployedModules memory modules = Dispatch.DeployedModules({ // module addresses for delegatecall routing
            initialize: address(0), // zero means initialization logic is embedded in EVault rather than a separate module
            token: address(0), // zero means token logic is embedded in EVault
            vault: address(0), // zero means vault logic is embedded in EVault
            borrowing: address(0), // zero means borrowing logic is embedded in EVault
            liquidation: address(0), // zero means liquidation logic is embedded in EVault
            riskManager: address(0), // zero means risk manager logic is embedded in EVault
            balanceForwarder: address(0), // zero means balance forwarder logic is embedded in EVault
            governance: address(0) // zero means governance logic is embedded in EVault
        });

        deployed.eVaultImplementation = address(new EVault(integrations, modules)); // deploy master vault implementation that all proxy vaults will delegatecall into
        console.log("EVault Implementation deployed at:", deployed.eVaultImplementation); // log for factory configuration

        deployed.eVaultFactory = address(new GenericFactory(deployer)); // deploy factory with deployer as admin who can set/update implementation
        console.log("EVault Factory deployed at:", deployed.eVaultFactory); // log for vault creation scripts

        deployed.irmLinearKink = address( // deploy interest rate model that governs borrow costs for leveraged positions
            new IRMLinearKink(
                0, // baseRate: 0% at zero utilization -- borrowers pay nothing when pool is idle
                uint256(5e16) / uint256(365 days), // slope1: 5% APY converted to per-second rate -- gentle increase below kink to attract borrowers
                uint256(45e16) / uint256(365 days), // slope2: 45% additional APY per-second above kink -- steep to discourage full utilization
                uint32((uint256(type(uint32).max) * 80) / 100) // kink at 80% utilization -- rates spike above this to preserve withdrawal liquidity for lenders
            )
        );
        console.log("IRM Linear Kink deployed at:", deployed.irmLinearKink); // log IRM address for vault initialization scripts

        vm.stopBroadcast(); // end transaction broadcasting -- all deployments submitted

        _saveDeployment(); // persist all deployed addresses to a JSON file for reproducibility and downstream tooling

        console.log("\n=== Deployment Complete ==="); // visual confirmation of successful deployment
        console.log("Next steps:"); // guide operator through required post-deployment actions
        console.log("1. Create vaults using the factory"); // vaults must be created as proxies via the factory
        console.log("2. Configure vault parameters"); // each vault needs IRM, LTV, caps, etc.
        console.log("3. Set up oracles for collateral assets"); // oracles are required for LTV enforcement and liquidation
        console.log("4. Test vault operations on testnet"); // always test on testnet before mainnet deployment
    }

    function _saveDeployment() internal { // helper function to serialize deployment addresses to JSON
        string memory deploymentJson = string.concat( // build JSON string manually since Foundry lacks native JSON builders
            '{\n', // open JSON object
            '  "network": "ink-sepolia",\n', // record target network for deployment provenance
            '  "evc": "', vm.toString(deployed.evc), '",\n', // serialize EVC address
            '  "protocolConfig": "', vm.toString(deployed.protocolConfig), '",\n', // serialize protocol config address
            '  "sequenceRegistry": "', vm.toString(deployed.sequenceRegistry), '",\n', // serialize sequence registry address
            '  "balanceTracker": "', vm.toString(deployed.balanceTracker), '",\n', // serialize balance tracker address (may be zero)
            '  "permit2": "', vm.toString(deployed.permit2), '",\n', // serialize permit2 address (may be zero)
            '  "eVaultImplementation": "', vm.toString(deployed.eVaultImplementation), '",\n', // serialize vault implementation address
            '  "eVaultFactory": "', vm.toString(deployed.eVaultFactory), '",\n', // serialize factory address
            '  "irmLinearKink": "', vm.toString(deployed.irmLinearKink), '"\n', // serialize IRM address (no trailing comma -- last field)
            '}\n' // close JSON object
        );

        vm.writeFile("deployments/ink-sepolia.json", deploymentJson); // write JSON to disk so CI and other scripts can read deployed addresses
        console.log("\nDeployment addresses saved to: deployments/ink-sepolia.json"); // confirm file was written
    }
}
