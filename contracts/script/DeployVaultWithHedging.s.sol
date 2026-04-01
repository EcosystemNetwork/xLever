// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultWithHedging} from "../src/xLever/VaultWithHedging.sol";

contract DeployVaultWithHedging is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Token addresses on Ink Sepolia
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        // Euler V2 addresses (you'll need to get these from Euler deployment)
        address evc = vm.envOr("EVC_ADDRESS", address(0));
        address usdcVault = vm.envOr("EULER_USDC_VAULT", address(0));
        address spyVault = vm.envOr("EULER_SPY_VAULT", address(0));
        address qqqVault = vm.envOr("EULER_QQQ_VAULT", address(0));
        
        require(evc != address(0), "EVC_ADDRESS not set");
        require(usdcVault != address(0), "EULER_USDC_VAULT not set");
        require(spyVault != address(0), "EULER_SPY_VAULT not set");
        require(qqqVault != address(0), "EULER_QQQ_VAULT not set");
        
        console.log("=== Deploying xLever Vault With Hedging ===");
        console.log("Deployer:", deployer);
        console.log("USDC:", usdc);
        console.log("EVC:", evc);
        console.log("Euler USDC Vault:", usdcVault);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy SPY vault with hedging
        VaultWithHedging spyVaultWithHedging = new VaultWithHedging(
            usdc,
            wSPYx,
            evc,
            usdcVault,
            spyVault,
            deployer
        );
        console.log("\nwSPYx Vault With Hedging:", address(spyVaultWithHedging));
        
        // Deploy QQQ vault with hedging
        VaultWithHedging qqqVaultWithHedging = new VaultWithHedging(
            usdc,
            wQQQx,
            evc,
            usdcVault,
            qqqVault,
            deployer
        );
        console.log("wQQQx Vault With Hedging:", address(qqqVaultWithHedging));
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("\nAdd to .env:");
        console.log("WSPY_VAULT_HEDGING_ADDRESS=", address(spyVaultWithHedging));
        console.log("WQQQ_VAULT_HEDGING_ADDRESS=", address(qqqVaultWithHedging));
    }
}
