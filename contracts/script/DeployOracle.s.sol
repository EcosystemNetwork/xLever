// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {FixedPriceOracle} from "../src/oracles/FixedPriceOracle.sol";

contract DeployOracle is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Token addresses
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        console.log("=== Deploying Fixed Price Oracle ===");
        console.log("Deployer:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy oracle
        FixedPriceOracle oracle = new FixedPriceOracle();
        console.log("Oracle deployed:", address(oracle));
        
        // Set prices (all in 18 decimals)
        // USDC = $1.00
        // wSPYx = $500 (SP500 proxy)
        // wQQQx = $400 (Nasdaq proxy)
        
        // USDC/USDC = 1:1
        oracle.setPrice(usdc, usdc, 1e18);
        console.log("Set USDC/USDC = 1.0");
        
        // wSPYx/USDC = 500:1
        oracle.setPrice(wSPYx, usdc, 500e18);
        console.log("Set wSPYx/USDC = 500.0");
        
        // wQQQx/USDC = 400:1
        oracle.setPrice(wQQQx, usdc, 400e18);
        console.log("Set wQQQx/USDC = 400.0");
        
        // Reverse prices for bidirectional support
        // USDC/wSPYx = 1/500
        oracle.setPrice(usdc, wSPYx, 1e18 / 500);
        console.log("Set USDC/wSPYx = 0.002");
        
        // USDC/wQQQx = 1/400
        oracle.setPrice(usdc, wQQQx, 1e18 / 400);
        console.log("Set USDC/wQQQx = 0.0025");
        
        // wSPYx/wSPYx = 1:1
        oracle.setPrice(wSPYx, wSPYx, 1e18);
        console.log("Set wSPYx/wSPYx = 1.0");
        
        // wQQQx/wQQQx = 1:1
        oracle.setPrice(wQQQx, wQQQx, 1e18);
        console.log("Set wQQQx/wQQQx = 1.0");
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("ORACLE_ADDRESS=", address(oracle));
        console.log("\nPrices configured:");
        console.log("  USDC = $1.00");
        console.log("  wSPYx = $500.00");
        console.log("  wQQQx = $400.00");
    }
}
