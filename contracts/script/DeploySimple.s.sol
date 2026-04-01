// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultSimple} from "../src/xLever/VaultSimple.sol";

/// @notice Simple deployment script that doesn't require Euler vaults
/// @dev This deploys basic vaults that can accept deposits without Euler integration
contract DeploySimple is Script {
    function run() external {
        // Token addresses on Ink Sepolia
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        console.log("=== Deploying xLever Simple Vaults ===");
        console.log("Deployer:", msg.sender);
        console.log("USDC:", usdc);
        console.log("wSPYx:", wSPYx);
        console.log("wQQQx:", wQQQx);
        
        vm.startBroadcast();
        
        // Deploy SPY vault
        VaultSimple spyVault = new VaultSimple(usdc, wSPYx, msg.sender);
        console.log("\nwSPYx Vault:", address(spyVault));
        
        // Deploy QQQ vault
        VaultSimple qqqVault = new VaultSimple(usdc, wQQQx, msg.sender);
        console.log("wQQQx Vault:", address(qqqVault));
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("\nVault Addresses:");
        console.log("SPY_VAULT=", address(spyVault));
        console.log("QQQ_VAULT=", address(qqqVault));
        console.log("\nAdd these to your frontend app.js:");
        console.log("const VAULT_ADDRESSES = {");
        console.log("  wSPYx: '", address(spyVault), "',");
        console.log("  wQQQx: '", address(qqqVault), "'");
        console.log("};");
    }
}
