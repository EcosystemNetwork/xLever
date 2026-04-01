// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";

interface IEVault {
    function setHookConfig(address newHookTarget, uint32 newHookedOps) external;
    function setCaps(uint16 supplyCap, uint16 borrowCap) external;
}

contract EnableVaultDeposits is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        // USDC Vault from latest deployment
        address usdcVault = 0xe5B808F4317B0fb00Ae38ec8592e43117a8B7390;
        
        console.log("=== Enabling Vault Operations ===");
        console.log("USDC Vault:", usdcVault);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Disable all hooks to allow operations
        IEVault(usdcVault).setHookConfig(address(0), 0);
        console.log("Hooks disabled");
        
        // Set caps to enable deposits and borrows (0 = no cap)
        IEVault(usdcVault).setCaps(0, 0);
        console.log("Caps set: unlimited deposits and borrows");
        
        vm.stopBroadcast();
        
        console.log("\n=== Vault Ready ===");
        console.log("Deposits and borrows are now enabled!");
    }
}
