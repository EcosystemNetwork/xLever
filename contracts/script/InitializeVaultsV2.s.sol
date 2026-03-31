// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {IEVault} from "../src/EVault/IEVault.sol";

contract InitializeVaultsV2 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // V2 vault addresses (with oracle)
        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047;
        address spyVault = 0xe39b100a33f7C861088A9C16642534dd29cDf83d;
        address qqqVault = 0xfC78951DcffdD8bDa662Aa7D9c697bE55d53712A;
        
        address irm = 0xE91A4B01632a7D281fb3eB0E83Ad9D5F0305d48f;
        
        console.log("=== Initializing Euler Vaults V2 ===");
        console.log("Deployer:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Initialize USDC Vault
        console.log("\n--- Initializing USDC Vault ---");
        IEVault(usdcVault).setInterestRateModel(irm);
        IEVault(usdcVault).setMaxLiquidationDiscount(0.15e4); // 15%
        IEVault(usdcVault).setLiquidationCoolOffTime(1);
        IEVault(usdcVault).setHookConfig(address(0), 0);
        IEVault(usdcVault).setCaps(0, 0); // No caps
        console.log("USDC Vault initialized");
        
        // Initialize wSPYx Vault with LTV settings
        console.log("\n--- Initializing wSPYx Vault ---");
        IEVault(spyVault).setInterestRateModel(irm);
        IEVault(spyVault).setMaxLiquidationDiscount(0.15e4); // 15%
        IEVault(spyVault).setLiquidationCoolOffTime(1);
        IEVault(spyVault).setHookConfig(address(0), 0);
        IEVault(spyVault).setCaps(0, 0); // No caps
        
        // Set LTV: 75% borrow, 87% liquidation
        IEVault(spyVault).setLTV(usdcVault, 0.75e4, 0.87e4, 0);
        console.log("wSPYx Vault initialized with 75%/87% LTV");
        
        // Initialize wQQQx Vault with LTV settings
        console.log("\n--- Initializing wQQQx Vault ---");
        IEVault(qqqVault).setInterestRateModel(irm);
        IEVault(qqqVault).setMaxLiquidationDiscount(0.15e4); // 15%
        IEVault(qqqVault).setLiquidationCoolOffTime(1);
        IEVault(qqqVault).setHookConfig(address(0), 0);
        IEVault(qqqVault).setCaps(0, 0); // No caps
        
        // Set LTV: 75% borrow, 87% liquidation
        IEVault(qqqVault).setLTV(usdcVault, 0.75e4, 0.87e4, 0);
        console.log("wQQQx Vault initialized with 75%/87% LTV");
        
        vm.stopBroadcast();
        
        console.log("\n=== Initialization Complete ===");
        console.log("All vaults configured with:");
        console.log("  - Interest Rate Model");
        console.log("  - 15% max liquidation discount");
        console.log("  - 75% borrow LTV / 87% liquidation LTV");
        console.log("  - No caps");
    }
}
