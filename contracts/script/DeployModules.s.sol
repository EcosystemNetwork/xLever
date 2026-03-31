// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {Base} from "../src/EVault/shared/Base.sol";
import {
    InitializeModule,
    TokenModule,
    VaultModule,
    BorrowingModule,
    LiquidationModule,
    RiskManagerModule,
    BalanceForwarderModule,
    GovernanceModule
} from "../src/deployment/ModuleWrappers.sol";

contract DeployModules is Script {
    struct DeployedModules {
        address initialize;
        address token;
        address vault;
        address borrowing;
        address liquidation;
        address riskManager;
        address balanceForwarder;
        address governance;
    }

    function run() external returns (DeployedModules memory modules) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address evc = vm.envAddress("EVC_ADDRESS");
        address protocolConfig = vm.envAddress("PROTOCOL_CONFIG_ADDRESS");
        address sequenceRegistry = vm.envAddress("SEQUENCE_REGISTRY_ADDRESS");

        console.log("Deploying EVault Modules");

        vm.startBroadcast(deployerPrivateKey);

        // Create integrations struct for modules
        Base.Integrations memory integrations = Base.Integrations({
            evc: evc,
            protocolConfig: protocolConfig,
            sequenceRegistry: sequenceRegistry,
            balanceTracker: address(0),
            permit2: address(0)
        });

        // Deploy all modules
        modules.initialize = address(new InitializeModule(integrations));
        console.log("Initialize Module:", modules.initialize);

        modules.token = address(new TokenModule(integrations));
        console.log("Token Module:", modules.token);

        modules.vault = address(new VaultModule(integrations));
        console.log("Vault Module:", modules.vault);

        modules.borrowing = address(new BorrowingModule(integrations));
        console.log("Borrowing Module:", modules.borrowing);

        modules.liquidation = address(new LiquidationModule(integrations));
        console.log("Liquidation Module:", modules.liquidation);

        modules.riskManager = address(new RiskManagerModule(integrations));
        console.log("RiskManager Module:", modules.riskManager);

        modules.balanceForwarder = address(new BalanceForwarderModule(integrations));
        console.log("BalanceForwarder Module:", modules.balanceForwarder);

        modules.governance = address(new GovernanceModule(integrations));
        console.log("Governance Module:", modules.governance);

        vm.stopBroadcast();

        console.log("\n=== All Modules Deployed ===");
        console.log("Add these to your .env file:");
        console.log("MODULE_INITIALIZE=", modules.initialize);
        console.log("MODULE_TOKEN=", modules.token);
        console.log("MODULE_VAULT=", modules.vault);
        console.log("MODULE_BORROWING=", modules.borrowing);
        console.log("MODULE_LIQUIDATION=", modules.liquidation);
        console.log("MODULE_RISKMANAGER=", modules.riskManager);
        console.log("MODULE_BALANCE_FORWARDER=", modules.balanceForwarder);
        console.log("MODULE_GOVERNANCE=", modules.governance);
    }
}
