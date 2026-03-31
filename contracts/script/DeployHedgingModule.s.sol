// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {EulerHedgingModule} from "../src/xLever/modules/EulerHedgingModule.sol";

contract DeployHedgingModule is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Deployed addresses
        address evc = 0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c;
        address usdcVault = 0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53;
        address spyVault = 0x6d064558d58645439A64cE1e88989Dfba88AA052;
        address qqqVault = 0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9;
        
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        console.log("=== Deploying Euler Hedging Modules ===");
        console.log("Deployer:", deployer);
        console.log("EVC:", evc);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy hedging module for wSPYx
        console.log("\n--- Deploying wSPYx Hedging Module ---");
        EulerHedgingModule spyHedging = new EulerHedgingModule(
            evc,
            usdcVault,
            spyVault,
            usdc,
            wSPYx
        );
        console.log("wSPYx Hedging Module:", address(spyHedging));
        
        // Deploy hedging module for wQQQx
        console.log("\n--- Deploying wQQQx Hedging Module ---");
        EulerHedgingModule qqqHedging = new EulerHedgingModule(
            evc,
            usdcVault,
            qqqVault,
            usdc,
            wQQQx
        );
        console.log("wQQQx Hedging Module:", address(qqqHedging));
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("\nHedging Modules:");
        console.log("WSPY_HEDGING=", address(spyHedging));
        console.log("WQQQ_HEDGING=", address(qqqHedging));
        console.log("\nThese modules enable real 3x leverage via Euler V2 looping");
    }
}
