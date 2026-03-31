// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {EulerHedgingModule} from "../src/xLever/modules/EulerHedgingModule.sol";
import {IEVault} from "../src/EVault/IEVault.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract TestLeverageLooping is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Deployed addresses
        address spyHedging = 0xd0673BeB607CA2136b126d34ED0D3Ff7826c93EE;
        address qqqHedging = 0x3Bc3c0D268455aD7eAe1432f57f3C24f42EdC7C8;
        
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        address usdcVault = 0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53;
        address spyVault = 0x6d064558d58645439A64cE1e88989Dfba88AA052;
        address qqqVault = 0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9;
        
        console.log("=== Testing Real Leverage Looping ===");
        console.log("Trader:", deployer);
        console.log("USDC Balance:", IERC20(usdc).balanceOf(deployer));
        console.log("wSPYx Balance:", IERC20(wSPYx).balanceOf(deployer));
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Test 1: Open 3x long position on SPY with 5 USDC worth of wSPYx
        console.log("\n=== Test 1: Open 3x Long Position on wSPYx ===");
        console.log("Initial collateral: 5 USDC worth of wSPYx");
        console.log("Target leverage: 3x");
        
        uint256 spyBalance = IERC20(wSPYx).balanceOf(deployer);
        if (spyBalance > 0) {
            uint256 collateral = spyBalance > 5e18 ? 5e18 : spyBalance;
            
            IERC20(wSPYx).approve(spyHedging, collateral);
            
            console.log("Opening long position...");
            try EulerHedgingModule(spyHedging).openLongPosition(collateral, 30000) {
                console.log("SUCCESS: 3x long position opened!");
                
                (uint256 totalCollateral, uint256 totalDebt, uint256 healthFactor) = 
                    EulerHedgingModule(spyHedging).getPositionHealth();
                
                console.log("Position Health:");
                console.log("  Total Collateral:", totalCollateral);
                console.log("  Total Debt:", totalDebt);
                console.log("  Health Factor:", healthFactor / 100, "%");
                
                // Check vault balances
                console.log("\nVault Positions:");
                console.log("  wSPYx Vault Balance:", IEVault(spyVault).balanceOf(spyHedging));
                console.log("  USDC Vault Debt:", IEVault(usdcVault).debtOf(spyHedging));
            } catch Error(string memory reason) {
                console.log("FAILED:", reason);
            } catch (bytes memory lowLevelData) {
                console.log("FAILED: Low-level error");
                console.logBytes(lowLevelData);
            }
        } else {
            console.log("SKIPPED: No wSPYx balance");
        }
        
        // Test 2: Check if we can open a short position
        console.log("\n=== Test 2: Open 2x Short Position on wQQQx ===");
        console.log("Initial collateral: 10 USDC");
        console.log("Target leverage: 2x short");
        
        uint256 usdcBalance = IERC20(usdc).balanceOf(deployer);
        if (usdcBalance >= 10e6) {
            IERC20(usdc).approve(qqqHedging, 10e6);
            
            console.log("Opening short position...");
            try EulerHedgingModule(qqqHedging).openShortPosition(10e6, 20000) {
                console.log("SUCCESS: 2x short position opened!");
                
                (uint256 totalCollateral, uint256 totalDebt, uint256 healthFactor) = 
                    EulerHedgingModule(qqqHedging).getPositionHealth();
                
                console.log("Position Health:");
                console.log("  Total Collateral:", totalCollateral);
                console.log("  Total Debt:", totalDebt);
                console.log("  Health Factor:", healthFactor / 100, "%");
                
                console.log("\nVault Positions:");
                console.log("  USDC Vault Balance:", IEVault(usdcVault).balanceOf(qqqHedging));
                console.log("  wQQQx Vault Debt:", IEVault(qqqVault).debtOf(qqqHedging));
            } catch Error(string memory reason) {
                console.log("FAILED:", reason);
            } catch (bytes memory lowLevelData) {
                console.log("FAILED: Low-level error");
                console.logBytes(lowLevelData);
            }
        } else {
            console.log("SKIPPED: Insufficient USDC balance");
        }
        
        vm.stopBroadcast();
        
        console.log("\n=== Leverage Looping Tests Complete ===");
        console.log("\nNote: If tests failed, it may be due to:");
        console.log("  1. Insufficient token balances");
        console.log("  2. Need to enable vaults as collateral/controller via EVC");
        console.log("  3. Oracle price feeds not configured");
        console.log("  4. Vault liquidity constraints");
    }
}
