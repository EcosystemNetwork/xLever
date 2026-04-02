// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in leverage math

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {EulerHedgingModule} from "../src/xLever/modules/EulerHedgingModule.sol"; // hedging module that implements leverage looping via Euler V2

contract DeployHedgingModuleV2 is Script { // deploys V2 hedging modules wired to oracle-enabled vaults for production-ready leverage
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for logging

        address evc = 0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c; // EVC on Ink Sepolia -- same EVC instance shared across V1 and V2
        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047; // V2 USDC vault with oracle -- replaces V1 vault without price feeds
        address spyVault = 0xe39b100a33f7C861088A9C16642534dd29cDf83d; // V2 wSPYx vault with oracle -- enables oracle-based LTV enforcement
        address qqqVault = 0xfC78951DcffdD8bDa662Aa7D9c697bE55d53712A; // V2 wQQQx vault with oracle -- enables oracle-based LTV enforcement

        address usdc = 0xFabab97dCE620294D2B0b0e46C68964e326300Ac; // USDC token on Ink Sepolia
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 token on Ink Sepolia
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // wrapped Nasdaq token on Ink Sepolia

        console.log("=== Deploying Euler Hedging Modules V2 (with Oracle) ==="); // header distinguishing V2 from V1 deployment
        console.log("Deployer:", deployer); // confirm deployer
        console.log("EVC:", evc); // confirm EVC address

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting deployments

        console.log("\n--- Deploying wSPYx Hedging Module V2 ---"); // V2 SPY module uses oracle-enabled vaults for accurate pricing
        EulerHedgingModule spyHedging = new EulerHedgingModule( // deploy hedging module pointed at V2 vaults
            evc, // EVC for cross-vault batch operations during leverage loop
            usdcVault, // V2 USDC vault with oracle -- source of USDC borrows
            spyVault, // V2 wSPYx vault with oracle -- destination for SPY collateral
            usdc, // USDC token address for approvals
            wSPYx // wSPYx token address for approvals
        );
        console.log("wSPYx Hedging Module V2:", address(spyHedging)); // log deployed address

        console.log("\n--- Deploying wQQQx Hedging Module V2 ---"); // V2 QQQ module uses oracle-enabled vaults
        EulerHedgingModule qqqHedging = new EulerHedgingModule( // deploy hedging module pointed at V2 vaults
            evc, // EVC for cross-vault batch operations
            usdcVault, // V2 USDC vault -- same lending pool for both assets
            qqqVault, // V2 wQQQx vault with oracle -- destination for QQQ collateral
            usdc, // USDC token address
            wQQQx // wQQQx token address
        );
        console.log("wQQQx Hedging Module V2:", address(qqqHedging)); // log deployed address

        vm.stopBroadcast(); // end transaction broadcasting -- both V2 modules deployed

        console.log("\n=== Deployment Complete ==="); // visual confirmation
        console.log("\nHedging Modules V2 (with Oracle):"); // header for V2 address summary
        console.log("WSPY_HEDGING_V2=", address(spyHedging)); // copy-paste env var for V2 SPY hedging
        console.log("WQQQ_HEDGING_V2=", address(qqqHedging)); // copy-paste env var for V2 QQQ hedging
        console.log("\nThese modules enable real 3x leverage via Euler V2 looping with oracle support"); // explain improvement over V1
    }
}
