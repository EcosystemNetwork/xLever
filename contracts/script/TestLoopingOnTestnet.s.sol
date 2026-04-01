// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultWithLooping} from "../src/xLever/VaultWithLooping.sol";
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract TestLoopingOnTestnet is Script {
    function run() external view {
        // Deployed looping vault addresses
        address spyVault = 0x93c0323D7133E2e9D57133a629a35Df17797d890;
        address qqqVault = 0x0C2c35ed457a4532794602a588eB0C086Ebd67DB;
        
        // Token addresses
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        
        // Test user (from private key)
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address user = vm.addr(deployerPrivateKey);
        
        console.log("=== Testing Looping Vault on Ink Sepolia ===");
        console.log("User:", user);
        console.log("SPY Vault:", spyVault);
        console.log("QQQ Vault:", qqqVault);
        
        // Check USDC balance
        uint256 usdcBalance = IERC20(usdc).balanceOf(user);
        console.log("\nUser USDC Balance:", usdcBalance / 1e6, "USDC");
        
        if (usdcBalance < 100e6) {
            console.log("\n[WARNING] Insufficient USDC balance for testing");
            console.log("Need at least 100 USDC");
            console.log("Get testnet USDC at:", usdc);
            return;
        }
        
        // Check existing positions
        VaultWithLooping vault = VaultWithLooping(spyVault);
        
        console.log("\n=== Checking Existing Position ===");
        DataTypes.Position memory pos = vault.getPosition(user);
        
        if (pos.isActive) {
            console.log("Active Position Found!");
            console.log("Deposit Amount (USDC):", pos.depositAmount / 1e6);
            console.log("Leverage (bps):", uint256(int256(pos.leverageBps)));
            
            // Check Euler position
            DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
            if (eulerPos.isActive) {
                console.log("\nEuler Position:");
                console.log("Collateral Shares:", eulerPos.collateralShares);
                console.log("Debt Amount (USDC):", eulerPos.debtAmount / 1e6);
                
                // Check health
                (uint256 collateral, uint256 debt, uint256 healthFactor) = vault.getPositionHealth(user);
                console.log("\nPosition Health:");
                console.log("Collateral (USDC):", collateral / 1e6);
                console.log("Debt (USDC):", debt / 1e6);
                console.log("Health Factor (bps):", healthFactor);
            }
        } else {
            console.log("No active position found");
        }
        
        // Check pool state
        console.log("\n=== Pool State ===");
        DataTypes.PoolState memory poolState = vault.getPoolState();
        console.log("Total Senior Deposits (USDC):", poolState.totalSeniorDeposits / 1e6);
        console.log("Total Junior Deposits (USDC):", poolState.totalJuniorDeposits / 1e6);
        console.log("Gross Long Exposure (USDC):", poolState.grossLongExposure / 1e6);
        console.log("Net Exposure (USDC):", uint256(poolState.netExposure) / 1e6);
        console.log("Max Leverage (bps):", poolState.currentMaxLeverageBps);
        
        console.log("\n=== Ready to Test ===");
        console.log("To open a 3x long position with 100 USDC:");
        console.log("1. Run: forge script script/OpenLoopingPosition.s.sol --rpc-url https://rpc-gel-sepolia.inkonchain.com --broadcast --legacy");
        console.log("2. Check transaction on explorer for LoopExecuted events");
        console.log("3. Verify position with this script again");
    }
}
