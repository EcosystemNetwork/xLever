// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in price calculations

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {FixedPriceOracle} from "../src/oracles/FixedPriceOracle.sol"; // simple oracle with admin-set fixed prices -- suitable for testnet before Pyth integration

contract DeployOracle is Script { // deploys and configures a fixed-price oracle with hardcoded testnet prices
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env to avoid hardcoding secrets
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for logging

        address usdc = 0xFabab97dCE620294D2B0b0e46C68964e326300Ac; // USDC on Ink Sepolia -- the base quote currency for all price pairs
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 on Ink Sepolia -- needs a USD price for LTV calculations
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // wrapped Nasdaq on Ink Sepolia -- needs a USD price for LTV calculations

        console.log("=== Deploying Fixed Price Oracle ==="); // visual header for this deployment section
        console.log("Deployer:", deployer); // confirm deployer identity before spending gas

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting transactions

        FixedPriceOracle oracle = new FixedPriceOracle(); // deploy oracle contract -- starts with no prices, must be configured below
        console.log("Oracle deployed:", address(oracle)); // log address for .env and downstream scripts

        // Set prices (all in 18 decimals) // 18-decimal precision matches Euler's internal price representation
        // USDC = $1.00 // stablecoin pegged to 1 USD
        // wSPYx = $500 (SP500 proxy) // approximate SP500 ETF price for testnet simulation
        // wQQQx = $400 (Nasdaq proxy) // approximate QQQ ETF price for testnet simulation

        oracle.setPrice(usdc, usdc, 1e18); // USDC/USDC = 1:1 -- identity price needed when vault's unit of account is USDC
        console.log("Set USDC/USDC = 1.0"); // confirm price was set

        oracle.setPrice(wSPYx, usdc, 500e18); // wSPYx/USDC = 500 -- each wSPYx token represents $500 of SP500 exposure
        console.log("Set wSPYx/USDC = 500.0"); // confirm price was set

        oracle.setPrice(wQQQx, usdc, 400e18); // wQQQx/USDC = 400 -- each wQQQx token represents $400 of Nasdaq exposure
        console.log("Set wQQQx/USDC = 400.0"); // confirm price was set

        oracle.setPrice(usdc, wSPYx, 1e18 / 500); // USDC/wSPYx reverse price -- needed when vault needs to price USDC in wSPYx terms
        console.log("Set USDC/wSPYx = 0.002"); // confirm reverse price was set

        oracle.setPrice(usdc, wQQQx, 1e18 / 400); // USDC/wQQQx reverse price -- needed when vault needs to price USDC in wQQQx terms
        console.log("Set USDC/wQQQx = 0.0025"); // confirm reverse price was set

        oracle.setPrice(wSPYx, wSPYx, 1e18); // wSPYx/wSPYx = 1:1 -- identity price required for self-referencing vault operations
        console.log("Set wSPYx/wSPYx = 1.0"); // confirm identity price

        oracle.setPrice(wQQQx, wQQQx, 1e18); // wQQQx/wQQQx = 1:1 -- identity price required for self-referencing vault operations
        console.log("Set wQQQx/wQQQx = 1.0"); // confirm identity price

        vm.stopBroadcast(); // end transaction broadcasting -- oracle is fully configured

        console.log("\n=== Deployment Complete ==="); // visual confirmation of successful deployment
        console.log("ORACLE_ADDRESS=", address(oracle)); // copy-paste env var for other scripts
        console.log("\nPrices configured:"); // summary of all configured prices for operator verification
        console.log("  USDC = $1.00"); // USDC price summary
        console.log("  wSPYx = $500.00"); // wSPYx price summary
        console.log("  wQQQx = $400.00"); // wQQQx price summary
    }
}
