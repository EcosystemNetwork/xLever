// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {IEVault} from "../src/EVault/IEVault.sol";

contract WithdrawUSDC is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047;
        
        console.log("=== Withdrawing USDC from Vault ===");
        console.log("Deployer:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);
        
        uint256 shares = IEVault(usdcVault).balanceOf(deployer);
        console.log("Vault shares:", shares);
        
        if (shares > 0) {
            console.log("Withdrawing all shares...");
            uint256 assets = IEVault(usdcVault).redeem(shares, deployer, deployer);
            console.log("Withdrawn assets:", assets);
            console.log("SUCCESS: USDC withdrawn");
        } else {
            console.log("No shares to withdraw");
        }
        
        vm.stopBroadcast();
        
        console.log("\n=== Withdrawal Complete ===");
    }
}
