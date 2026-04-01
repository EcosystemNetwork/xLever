// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";

interface IEVault {
    function setLTV(address collateral, uint16 borrowLTV, uint16 liquidationLTV, uint32 rampDuration) external;
}

contract ConfigureUSDCVaultLTV is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        // USDC Vault with oracle
        address usdcVault = 0xe5B808F4317B0fb00Ae38ec8592e43117a8B7390;
        
        console.log("=== Configuring USDC Vault LTV ===");
        console.log("USDC Vault:", usdcVault);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Set LTV for USDC vault shares as collateral
        // This allows borrowing USDC against USDC vault shares
        IEVault(usdcVault).setLTV(
            usdcVault,  // collateral = USDC vault itself (shares)
            0.75e4,     // 75% borrow LTV (7500 in basis points)
            0.80e4,     // 80% liquidation LTV
            0           // no ramp duration
        );
        
        console.log("LTV configured: 75% borrow, 80% liquidation");
        
        vm.stopBroadcast();
        
        console.log("\n=== Configuration Complete ===");
        console.log("USDC vault can now be used for looping!");
    }
}
