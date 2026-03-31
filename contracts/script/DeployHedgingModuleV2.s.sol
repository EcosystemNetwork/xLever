// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {EulerHedgingModule} from "../src/xLever/modules/EulerHedgingModule.sol";

contract DeployHedgingModuleV2 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Deployed addresses (V2 with oracle)
        address evc = 0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c;
        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047;
        address spyVault = 0xe39b100a33f7C861088A9C16642534dd29cDf83d;
        address qqqVault = 0xfC78951DcffdD8bDa662Aa7D9c697bE55d53712A;
        
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        console.log("=== Deploying Euler Hedging Modules V2 (with Oracle) ===");
        console.log("Deployer:", deployer);
        console.log("EVC:", evc);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy hedging module for wSPYx
        console.log("\n--- Deploying wSPYx Hedging Module V2 ---");
        EulerHedgingModule spyHedging = new EulerHedgingModule(
            evc,
            usdcVault,
            spyVault,
            usdc,
            wSPYx
        );
        console.log("wSPYx Hedging Module V2:", address(spyHedging));
        
        // Deploy hedging module for wQQQx
        console.log("\n--- Deploying wQQQx Hedging Module V2 ---");
        EulerHedgingModule qqqHedging = new EulerHedgingModule(
            evc,
            usdcVault,
            qqqVault,
            usdc,
            wQQQx
        );
        console.log("wQQQx Hedging Module V2:", address(qqqHedging));
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("\nHedging Modules V2 (with Oracle):");
        console.log("WSPY_HEDGING_V2=", address(spyHedging));
        console.log("WQQQ_HEDGING_V2=", address(qqqHedging));
        console.log("\nThese modules enable real 3x leverage via Euler V2 looping with oracle support");
    }
}
