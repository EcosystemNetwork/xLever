// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultSimple} from "../src/xLever/VaultSimple.sol";

contract DeployXLever is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Real token addresses on Ink Sepolia
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // Wrapped SP500
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // Wrapped Nasdaq
        
        console.log("=== Deploying xLever Protocol ===");
        console.log("Deployer:", deployer);
        console.log("USDC:", usdc);
        console.log("wSPYx:", wSPYx);
        console.log("wQQQx:", wQQQx);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy simplified vaults (under contract size limit)
        VaultSimple spyVault = new VaultSimple(usdc, wSPYx, deployer);
        console.log("\nwSPYx Vault:", address(spyVault));
        
        VaultSimple qqqVault = new VaultSimple(usdc, wQQQx, deployer);
        console.log("wQQQx Vault:", address(qqqVault));
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("\nAdd to .env:");
        console.log("WSPY_VAULT_ADDRESS=", address(spyVault));
        console.log("WQQQ_VAULT_ADDRESS=", address(qqqVault));
    }
}
