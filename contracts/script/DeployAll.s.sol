// SPDX-License-Identifier: GPL-2.0-or-later // required license header for Euler-derived code compatibility
pragma solidity ^0.8.0; // Solidity 0.8+ provides built-in overflow checks essential for interest rate and LTV math

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast functionality
import {EVault} from "../src/EVault/EVault.sol"; // Euler V2 vault implementation -- the core lending/borrowing logic
import {Dispatch} from "../src/EVault/Dispatch.sol"; // dispatch contract that routes calls to the correct module via delegatecall
import {Base} from "../src/EVault/shared/Base.sol"; // shared base that defines the Integrations struct connecting all protocol pieces
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol"; // factory that creates EVault proxies with minimal clones for gas efficiency
import {ProtocolConfig} from "../src/ProtocolConfig/ProtocolConfig.sol"; // global protocol configuration holding admin and fee receiver addresses
import {SequenceRegistry} from "../src/SequenceRegistry/SequenceRegistry.sol"; // registry that assigns unique sequence numbers to each new vault for identification
import {IRMLinearKink} from "../src/InterestRateModels/IRMLinearKink.sol"; // interest rate model with a kink -- rates jump sharply above target utilization to protect lenders
import { // import all eight EVault module wrappers needed for the modular vault architecture
    InitializeModule, // handles vault proxy initialization logic
    TokenModule, // handles ERC-4626 token operations (mint, burn, transfer)
    VaultModule, // handles deposit/withdraw/supply asset operations
    BorrowingModule, // handles borrow/repay operations for leverage
    LiquidationModule, // handles underwater position liquidation to maintain solvency
    RiskManagerModule, // enforces LTV limits and account health checks
    BalanceForwarderModule, // forwards balance changes to external trackers (e.g., rewards)
    GovernanceModule // handles vault admin operations like setting parameters
} from "../src/deployment/ModuleWrappers.sol"; // wrapper contracts that make modules deployable as standalone contracts

contract DeployAll is Script { // single-script deployment of the entire Euler Vault Kit infrastructure
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env to keep it out of source control
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for ownership and logging
        address evc = vm.envAddress("EVC_ADDRESS"); // load pre-deployed EVC address -- EVC must exist before vault kit deployment

        console.log("=== Deploying Euler Vault Kit ==="); // visual header for deployment log
        console.log("Deployer:", deployer); // confirm deployer identity before spending gas
        console.log("EVC:", evc); // confirm EVC address to ensure vaults will connect to the right connector

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting transactions to live network

        ProtocolConfig protocolConfig = new ProtocolConfig(deployer, deployer); // deploy protocol config with deployer as both admin and fee receiver (testnet convenience)
        console.log("ProtocolConfig:", address(protocolConfig)); // log address for .env persistence

        SequenceRegistry sequenceRegistry = new SequenceRegistry(); // deploy registry that assigns unique IDs to each vault created by the factory
        console.log("SequenceRegistry:", address(sequenceRegistry)); // log address for .env persistence

        Base.Integrations memory integrations = Base.Integrations({ // bundle all integration addresses into a struct that every module needs
            evc: evc, // EVC enables cross-vault account management and batch operations
            protocolConfig: address(protocolConfig), // protocol config provides fee and admin settings to vaults
            sequenceRegistry: address(sequenceRegistry), // sequence registry assigns unique IDs to new vault proxies
            balanceTracker: address(0), // no external balance tracker needed on testnet -- set to zero
            permit2: address(0) // permit2 gasless approvals not needed on testnet -- set to zero
        });

        console.log("\n=== Deploying Modules ==="); // visual separator for the module deployment section
        address initializeModule = address(new InitializeModule(integrations)); // deploy initialization module -- called once when a vault proxy is created
        console.log("Initialize:", initializeModule); // log for verification and debugging

        address tokenModule = address(new TokenModule(integrations)); // deploy token module -- handles ERC-20/ERC-4626 share token logic
        console.log("Token:", tokenModule); // log for verification

        address vaultModule = address(new VaultModule(integrations)); // deploy vault module -- handles deposit, withdraw, and asset accounting
        console.log("Vault:", vaultModule); // log for verification

        address borrowingModule = address(new BorrowingModule(integrations)); // deploy borrowing module -- enables leveraged positions by allowing borrows against collateral
        console.log("Borrowing:", borrowingModule); // log for verification

        address liquidationModule = address(new LiquidationModule(integrations)); // deploy liquidation module -- protects protocol solvency by liquidating unhealthy positions
        console.log("Liquidation:", liquidationModule); // log for verification

        address riskManagerModule = address(new RiskManagerModule(integrations)); // deploy risk manager -- enforces LTV limits to prevent over-leveraging
        console.log("RiskManager:", riskManagerModule); // log for verification

        address balanceForwarderModule = address(new BalanceForwarderModule(integrations)); // deploy balance forwarder -- notifies external reward systems of balance changes
        console.log("BalanceForwarder:", balanceForwarderModule); // log for verification

        address governanceModule = address(new GovernanceModule(integrations)); // deploy governance module -- allows admin to configure vault parameters post-deployment
        console.log("Governance:", governanceModule); // log for verification

        console.log("\n=== Deploying EVault Implementation ==="); // visual separator for the main vault implementation deployment
        Dispatch.DeployedModules memory modules = Dispatch.DeployedModules({ // bundle all module addresses into a struct so EVault knows where to delegatecall
            initialize: initializeModule, // point to initialization module for proxy setup
            token: tokenModule, // point to token module for ERC-20 operations
            vault: vaultModule, // point to vault module for deposit/withdraw
            borrowing: borrowingModule, // point to borrowing module for leverage operations
            liquidation: liquidationModule, // point to liquidation module for health enforcement
            riskManager: riskManagerModule, // point to risk manager for LTV checking
            balanceForwarder: balanceForwarderModule, // point to balance forwarder for reward tracking
            governance: governanceModule // point to governance module for admin operations
        });

        EVault eVaultImpl = new EVault(integrations, modules); // deploy the master EVault implementation that all vault proxies will delegatecall into
        console.log("EVault Implementation:", address(eVaultImpl)); // log implementation address -- factory needs this to create proxies

        GenericFactory factory = new GenericFactory(deployer); // deploy factory that creates minimal proxy clones of the EVault implementation
        console.log("GenericFactory:", address(factory)); // log factory address -- used by all vault creation scripts

        IRMLinearKink irm = new IRMLinearKink( // deploy the interest rate model that governs borrow costs for leveraged positions
            0, // baseRate: 0% annual rate at zero utilization -- no cost when pool is idle
            uint256(5e16) / uint256(365 days), // slope1: 5% APY converted to per-second rate below the kink -- gentle increase to attract borrowers
            uint256(45e16) / uint256(365 days), // slope2: 45% additional APY per-second above the kink -- steep to discourage full utilization and protect lenders
            uint32((uint256(type(uint32).max) * 80) / 100) // kink at 80% utilization -- rates jump sharply above this to keep reserves available for withdrawals
        );
        console.log("IRM Linear Kink:", address(irm)); // log IRM address -- every vault needs this set during initialization

        vm.stopBroadcast(); // end transaction broadcasting -- all deployments are submitted

        console.log("\n=== Deployment Complete ==="); // visual confirmation of successful deployment
        console.log("ProtocolConfig:", address(protocolConfig)); // summary: protocol config address
        console.log("SequenceRegistry:", address(sequenceRegistry)); // summary: sequence registry address
        console.log("EVault Impl:", address(eVaultImpl)); // summary: implementation address
        console.log("Factory:", address(factory)); // summary: factory address
        console.log("IRM:", address(irm)); // summary: interest rate model address
    }
}
