// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";

interface ITWAPOracle {
    function initializeBuffer(uint128 startPrice) external;
    function getTWAP() external view returns (uint128);
}

interface IVault {
    function oracle() external view returns (address);
}

contract InitializeOracles is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        // Vault addresses
        address spyVault = 0xC9202F82C3c42af5550C98979747B36b8fCd265d;
        address qqqVault = 0x1f0c30D3573Fa50d83B7b30A6285F3aBF71c646b;
        
        // Starting price: $100 = 100e8 (8 decimals)
        uint128 startPrice = 10000000000; // 100.00000000
        
        console.log("=== Initializing TWAP Oracles ===");
        console.log("Start price:", startPrice);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Get oracle addresses
        address spyOracle = IVault(spyVault).oracle();
        address qqqOracle = IVault(qqqVault).oracle();
        
        console.log("\nSPY Oracle:", spyOracle);
        console.log("QQQ Oracle:", qqqOracle);
        
        // Initialize SPY oracle
        ITWAPOracle(spyOracle).initializeBuffer(startPrice);
        console.log("SPY Oracle initialized, TWAP:", ITWAPOracle(spyOracle).getTWAP());
        
        // Initialize QQQ oracle
        ITWAPOracle(qqqOracle).initializeBuffer(startPrice);
        console.log("QQQ Oracle initialized, TWAP:", ITWAPOracle(qqqOracle).getTWAP());
        
        vm.stopBroadcast();
        
        console.log("\n=== Initialization Complete ===");
    }
}
