// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in leverage calculations

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {EulerHedgingModule} from "../src/xLever/modules/EulerHedgingModule.sol"; // hedging module that implements leverage looping via Euler V2 borrow/deposit cycles

contract DeployHedgingModule is Script { // deploys V1 hedging modules for wSPYx and wQQQx leverage looping
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for logging

        address evc = 0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c; // EVC on Ink Sepolia -- hedging module needs EVC for batch operations
        address usdcVault = 0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53; // V1 USDC vault -- lending pool for USDC borrows during leverage loop
        address spyVault = 0x6d064558d58645439A64cE1e88989Dfba88AA052; // V1 wSPYx vault -- collateral vault for SPY long positions
        address qqqVault = 0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9; // V1 wQQQx vault -- collateral vault for QQQ positions

        address usdc = 0xFabab97dCE620294D2B0b0e46C68964e326300Ac; // USDC token -- base asset for borrowing and collateral
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 token -- leveraged asset for SPY module
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // wrapped Nasdaq token -- leveraged asset for QQQ module

        console.log("=== Deploying Euler Hedging Modules ==="); // header for hedging module deployment
        console.log("Deployer:", deployer); // confirm deployer
        console.log("EVC:", evc); // confirm EVC being used for batch operations

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting deployments

        console.log("\n--- Deploying wSPYx Hedging Module ---"); // SPY hedging module enables long/short leverage on SP500
        EulerHedgingModule spyHedging = new EulerHedgingModule( // deploy hedging module wired to SPY-specific vaults
            evc, // EVC for cross-vault batch calls during leverage loop
            usdcVault, // USDC vault: source of borrowed USDC for long positions
            spyVault, // wSPYx vault: destination for collateral deposits
            usdc, // USDC token address for approvals and transfers
            wSPYx // wSPYx token address for approvals and transfers
        );
        console.log("wSPYx Hedging Module:", address(spyHedging)); // log address for .env and frontend

        console.log("\n--- Deploying wQQQx Hedging Module ---"); // QQQ hedging module enables long/short leverage on Nasdaq
        EulerHedgingModule qqqHedging = new EulerHedgingModule( // deploy hedging module wired to QQQ-specific vaults
            evc, // EVC for cross-vault batch calls
            usdcVault, // USDC vault: same lending pool shared across assets
            qqqVault, // wQQQx vault: destination for QQQ collateral deposits
            usdc, // USDC token address
            wQQQx // wQQQx token address
        );
        console.log("wQQQx Hedging Module:", address(qqqHedging)); // log address for .env and frontend

        vm.stopBroadcast(); // end transaction broadcasting -- both modules deployed

        console.log("\n=== Deployment Complete ==="); // visual confirmation
        console.log("\nHedging Modules:"); // header for address summary
        console.log("WSPY_HEDGING=", address(spyHedging)); // copy-paste env var for SPY hedging
        console.log("WQQQ_HEDGING=", address(qqqHedging)); // copy-paste env var for QQQ hedging
        console.log("\nThese modules enable real 3x leverage via Euler V2 looping"); // explain what these modules unlock
    }
}
