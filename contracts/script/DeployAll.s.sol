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

contract DeployAll is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address evc = vm.envAddress("EVC_ADDRESS");

        console.log("=== Deploying Euler Vault Kit ===");
        console.log("Deployer:", deployer);
        console.log("EVC:", evc);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy ProtocolConfig
        ProtocolConfig protocolConfig = new ProtocolConfig(deployer, deployer);
        console.log("ProtocolConfig:", address(protocolConfig));

        // 2. Deploy SequenceRegistry
        SequenceRegistry sequenceRegistry = new SequenceRegistry();
        console.log("SequenceRegistry:", address(sequenceRegistry));

        // 3. Create integrations struct
        Base.Integrations memory integrations = Base.Integrations({
            evc: evc,
            protocolConfig: address(protocolConfig),
            sequenceRegistry: address(sequenceRegistry),
            balanceTracker: address(0),
            permit2: address(0)
        });

        // 4. Deploy all modules
        console.log("\n=== Deploying Modules ===");
        address initializeModule = address(new InitializeModule(integrations));
        console.log("Initialize:", initializeModule);

        address tokenModule = address(new TokenModule(integrations));
        console.log("Token:", tokenModule);

        address vaultModule = address(new VaultModule(integrations));
        console.log("Vault:", vaultModule);

        address borrowingModule = address(new BorrowingModule(integrations));
        console.log("Borrowing:", borrowingModule);

        address liquidationModule = address(new LiquidationModule(integrations));
        console.log("Liquidation:", liquidationModule);

        address riskManagerModule = address(new RiskManagerModule(integrations));
        console.log("RiskManager:", riskManagerModule);

        address balanceForwarderModule = address(new BalanceForwarderModule(integrations));
        console.log("BalanceForwarder:", balanceForwarderModule);

        address governanceModule = address(new GovernanceModule(integrations));
        console.log("Governance:", governanceModule);

        // 5. Deploy EVault implementation
        console.log("\n=== Deploying EVault Implementation ===");
        Dispatch.DeployedModules memory modules = Dispatch.DeployedModules({
            initialize: initializeModule,
            token: tokenModule,
            vault: vaultModule,
            borrowing: borrowingModule,
            liquidation: liquidationModule,
            riskManager: riskManagerModule,
            balanceForwarder: balanceForwarderModule,
            governance: governanceModule
        });

        EVault eVaultImpl = new EVault(integrations, modules);
        console.log("EVault Implementation:", address(eVaultImpl));

        // 6. Deploy GenericFactory
        GenericFactory factory = new GenericFactory(deployer);
        console.log("GenericFactory:", address(factory));

        // 7. Deploy IRM
        IRMLinearKink irm = new IRMLinearKink(
            0, // baseRate
            uint256(5e16) / uint256(365 days), // slope1
            uint256(45e16) / uint256(365 days), // slope2
            uint32((uint256(type(uint32).max) * 80) / 100) // kink at 80%
        );
        console.log("IRM Linear Kink:", address(irm));

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("ProtocolConfig:", address(protocolConfig));
        console.log("SequenceRegistry:", address(sequenceRegistry));
        console.log("EVault Impl:", address(eVaultImpl));
        console.log("Factory:", address(factory));
        console.log("IRM:", address(irm));
    }
}
