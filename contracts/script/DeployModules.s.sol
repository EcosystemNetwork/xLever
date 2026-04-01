// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in financial math

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {Base} from "../src/EVault/shared/Base.sol"; // shared base defining Integrations struct needed by all modules
import { // import all eight EVault module wrappers for standalone deployment
    InitializeModule, // handles one-time proxy initialization during vault creation
    TokenModule, // ERC-20/ERC-4626 share token operations
    VaultModule, // deposit, withdraw, and asset accounting
    BorrowingModule, // borrow and repay for leveraged positions
    LiquidationModule, // liquidation of unhealthy positions to maintain solvency
    RiskManagerModule, // LTV enforcement and health factor checks
    BalanceForwarderModule, // external balance tracking for reward distribution
    GovernanceModule // admin parameter configuration
} from "../src/deployment/ModuleWrappers.sol"; // wrappers that make modules individually deployable

contract DeployModules is Script { // deploys all EVault modules as standalone contracts for the modular architecture
    struct DeployedModules { // struct to collect and return all module addresses
        address initialize; // initialization module address
        address token; // token module address
        address vault; // vault module address
        address borrowing; // borrowing module address
        address liquidation; // liquidation module address
        address riskManager; // risk manager module address
        address balanceForwarder; // balance forwarder module address
        address governance; // governance module address
    }

    function run() external returns (DeployedModules memory modules) { // returns module addresses so calling scripts can compose with them
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env to keep secrets out of source control
        address evc = vm.envAddress("EVC_ADDRESS"); // EVC must be pre-deployed -- modules need it for cross-vault integration
        address protocolConfig = vm.envAddress("PROTOCOL_CONFIG_ADDRESS"); // protocol config must exist -- modules read fee/admin settings from it
        address sequenceRegistry = vm.envAddress("SEQUENCE_REGISTRY_ADDRESS"); // sequence registry must exist -- modules use it to assign vault IDs

        console.log("Deploying EVault Modules"); // log deployment start for operator awareness

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting transactions

        Base.Integrations memory integrations = Base.Integrations({ // bundle all protocol dependencies for module constructors
            evc: evc, // EVC enables cross-vault account management and batch calls
            protocolConfig: protocolConfig, // provides fee and admin config to modules
            sequenceRegistry: sequenceRegistry, // assigns unique IDs during vault creation
            balanceTracker: address(0), // no external balance tracker on testnet -- set to zero
            permit2: address(0) // no Permit2 needed on testnet -- set to zero
        });

        modules.initialize = address(new InitializeModule(integrations)); // deploy init module -- called once per vault proxy to set up storage
        console.log("Initialize Module:", modules.initialize); // log for .env persistence

        modules.token = address(new TokenModule(integrations)); // deploy token module -- handles share minting, burning, and transfers
        console.log("Token Module:", modules.token); // log for .env persistence

        modules.vault = address(new VaultModule(integrations)); // deploy vault module -- handles deposit/withdraw asset flows
        console.log("Vault Module:", modules.vault); // log for .env persistence

        modules.borrowing = address(new BorrowingModule(integrations)); // deploy borrowing module -- enables leverage by allowing borrows against collateral
        console.log("Borrowing Module:", modules.borrowing); // log for .env persistence

        modules.liquidation = address(new LiquidationModule(integrations)); // deploy liquidation module -- protects protocol from bad debt by liquidating unhealthy positions
        console.log("Liquidation Module:", modules.liquidation); // log for .env persistence

        modules.riskManager = address(new RiskManagerModule(integrations)); // deploy risk manager -- enforces LTV constraints and blocks over-leveraged operations
        console.log("RiskManager Module:", modules.riskManager); // log for .env persistence

        modules.balanceForwarder = address(new BalanceForwarderModule(integrations)); // deploy balance forwarder -- notifies external systems of balance changes for reward distribution
        console.log("BalanceForwarder Module:", modules.balanceForwarder); // log for .env persistence

        modules.governance = address(new GovernanceModule(integrations)); // deploy governance module -- allows admin to change vault parameters after deployment
        console.log("Governance Module:", modules.governance); // log for .env persistence

        vm.stopBroadcast(); // end transaction broadcasting -- all module deployments submitted

        console.log("\n=== All Modules Deployed ==="); // visual confirmation of successful deployment
        console.log("Add these to your .env file:"); // operator must persist these addresses for EVault implementation deployment
        console.log("MODULE_INITIALIZE=", modules.initialize); // copy-paste env var for initialize module
        console.log("MODULE_TOKEN=", modules.token); // copy-paste env var for token module
        console.log("MODULE_VAULT=", modules.vault); // copy-paste env var for vault module
        console.log("MODULE_BORROWING=", modules.borrowing); // copy-paste env var for borrowing module
        console.log("MODULE_LIQUIDATION=", modules.liquidation); // copy-paste env var for liquidation module
        console.log("MODULE_RISKMANAGER=", modules.riskManager); // copy-paste env var for risk manager module
        console.log("MODULE_BALANCE_FORWARDER=", modules.balanceForwarder); // copy-paste env var for balance forwarder module
        console.log("MODULE_GOVERNANCE=", modules.governance); // copy-paste env var for governance module
    }
}
