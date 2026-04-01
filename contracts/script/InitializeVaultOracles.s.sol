// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";

interface IVault {
    function initializeOracle(uint128 startPrice) external;
}

contract InitializeVaultOracles is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        // New vault addresses
        address spyVault = 0xe96adcFA329f40ACFb73AdD9CCCA957686b9712d;
        address qqqVault = 0x5861B179Ed373eF0A4A79D4a1C0a0eDd40096955;
        
        // Starting price: $100 = 100e8 (8 decimals)
        uint128 startPrice = 10000000000; // 100.00000000
        
        console.log("=== Initializing Vault Oracles ===");
        console.log("Start price: $100.00");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Initialize SPY vault oracle
        IVault(spyVault).initializeOracle(startPrice);
        console.log("SPY Vault oracle initialized:", spyVault);
        
        // Initialize QQQ vault oracle
        IVault(qqqVault).initializeOracle(startPrice);
        console.log("QQQ Vault oracle initialized:", qqqVault);
        
        vm.stopBroadcast();
        
        console.log("\n=== Initialization Complete ===");
    }
}
