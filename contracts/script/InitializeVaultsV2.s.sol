// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in LTV and interest calculations

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface for governance calls to configure vault parameters

contract InitializeVaultsV2 is Script { // configures V2 oracle-enabled vaults with IRM, liquidation params, and cross-collateral LTV
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env -- must be vault governor
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for logging

        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047; // V2 USDC vault with oracle -- lending pool for leveraged borrowing
        address spyVault = 0xe39b100a33f7C861088A9C16642534dd29cDf83d; // V2 wSPYx vault with oracle -- collateral vault for SPY positions
        address qqqVault = 0xfC78951DcffdD8bDa662Aa7D9c697bE55d53712A; // V2 wQQQx vault with oracle -- collateral vault for QQQ positions

        address irm = 0xE91A4B01632a7D281fb3eB0E83Ad9D5F0305d48f; // IRMLinearKink deployed earlier -- governs borrow interest rates

        console.log("=== Initializing Euler Vaults V2 ==="); // header for V2 initialization
        console.log("Deployer:", deployer); // confirm deployer identity

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting governance transactions

        console.log("\n--- Initializing USDC Vault ---"); // USDC vault needs IRM and liquidation params before it can accept deposits
        IEVault(usdcVault).setInterestRateModel(irm); // assign IRM so vault can compute borrow rates based on utilization
        IEVault(usdcVault).setMaxLiquidationDiscount(0.15e4); // 15% max discount -- rewards liquidators generously to ensure fast liquidation on testnet
        IEVault(usdcVault).setLiquidationCoolOffTime(1); // 1 second cool-off -- minimal delay since testnet does not need MEV protection
        IEVault(usdcVault).setHookConfig(address(0), 0); // no hooks -- keep vault behavior simple for initial deployment
        IEVault(usdcVault).setCaps(0, 0); // no supply/borrow caps -- unlimited for testnet flexibility
        console.log("USDC Vault initialized"); // confirm all USDC vault parameters set

        console.log("\n--- Initializing wSPYx Vault ---"); // wSPYx vault needs same base params plus LTV for USDC collateral
        IEVault(spyVault).setInterestRateModel(irm); // assign IRM for consistent interest behavior across all vaults
        IEVault(spyVault).setMaxLiquidationDiscount(0.15e4); // 15% liquidation discount -- same as USDC vault for consistency
        IEVault(spyVault).setLiquidationCoolOffTime(1); // 1 second cool-off
        IEVault(spyVault).setHookConfig(address(0), 0); // no hooks
        IEVault(spyVault).setCaps(0, 0); // no caps

        IEVault(spyVault).setLTV(usdcVault, 0.75e4, 0.87e4, 0); // accept USDC vault shares as collateral: 75% borrow LTV, 87% liquidation threshold, no ramp delay
        console.log("wSPYx Vault initialized with 75%/87% LTV"); // confirm params and LTV set

        console.log("\n--- Initializing wQQQx Vault ---"); // wQQQx vault follows same pattern as wSPYx
        IEVault(qqqVault).setInterestRateModel(irm); // assign IRM
        IEVault(qqqVault).setMaxLiquidationDiscount(0.15e4); // 15% liquidation discount
        IEVault(qqqVault).setLiquidationCoolOffTime(1); // 1 second cool-off
        IEVault(qqqVault).setHookConfig(address(0), 0); // no hooks
        IEVault(qqqVault).setCaps(0, 0); // no caps

        IEVault(qqqVault).setLTV(usdcVault, 0.75e4, 0.87e4, 0); // accept USDC vault shares as collateral: same risk params as SPY vault for uniformity
        console.log("wQQQx Vault initialized with 75%/87% LTV"); // confirm params and LTV set

        vm.stopBroadcast(); // end transaction broadcasting -- all V2 vaults fully configured

        console.log("\n=== Initialization Complete ==="); // visual confirmation of successful initialization
        console.log("All vaults configured with:"); // summary of what was set
        console.log("  - Interest Rate Model"); // IRM drives borrow cost dynamics
        console.log("  - 15% max liquidation discount"); // generous liquidator incentive for testnet
        console.log("  - 75% borrow LTV / 87% liquidation LTV"); // risk parameters enabling ~3-4x leverage
        console.log("  - No caps"); // unlimited for testnet
    }
}
