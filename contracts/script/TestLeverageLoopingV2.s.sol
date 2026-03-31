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

contract TestLeverageLoopingV2 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // V2 addresses with oracle
        address spyHedging = 0x268f782B6755F70902930C629A14F3c351C44BE9;
        address qqqHedging = 0xcA012c47B8B82512244C2D4eBaf1A8Ca66aA80Ff;
        
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        
        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047;
        address spyVault = 0xe39b100a33f7C861088A9C16642534dd29cDf83d;
        
        console.log("=== Testing Real Leverage Looping V2 (with Oracle) ===");
        console.log("Trader:", deployer);
        console.log("USDC Balance:", IERC20(usdc).balanceOf(deployer));
        console.log("wSPYx Balance:", IERC20(wSPYx).balanceOf(deployer));
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Test: Open 2x long position on SPY with 1 wSPYx
        console.log("\n=== Test: Open 2x Long Position on wSPYx ===");
        console.log("Initial collateral: 1 wSPYx");
        console.log("Target leverage: 2x");
        
        uint256 spyBalance = IERC20(wSPYx).balanceOf(deployer);
        if (spyBalance >= 1e18) {
            uint256 collateral = 1e18; // 1 wSPYx
            
            IERC20(wSPYx).approve(spyHedging, collateral);
            
            console.log("Opening long position...");
            try EulerHedgingModule(spyHedging).openLongPosition(collateral, 20000) {
                console.log("SUCCESS: 2x long position opened!");
                
                (uint256 totalCollateral, uint256 totalDebt, uint256 healthFactor) = 
                    EulerHedgingModule(spyHedging).getPositionHealth();
                
                console.log("\nPosition Health:");
                console.log("  Total Collateral:", totalCollateral);
                console.log("  Total Debt:", totalDebt);
                console.log("  Health Factor:", healthFactor / 100, "%");
                
                console.log("\nVault Positions:");
                console.log("  wSPYx Vault Balance:", IEVault(spyVault).balanceOf(spyHedging));
                console.log("  USDC Vault Debt:", IEVault(usdcVault).debtOf(spyHedging));
                
                console.log("\nLEVERAGE LOOPING WORKING!");
            } catch Error(string memory reason) {
                console.log("FAILED:", reason);
            } catch (bytes memory lowLevelData) {
                console.log("FAILED: Low-level error");
                console.logBytes(lowLevelData);
            }
        } else {
            console.log("SKIPPED: Insufficient wSPYx balance (need 1 wSPYx)");
            console.log("Current balance:", spyBalance);
        }
        
        vm.stopBroadcast();
        
        console.log("\n=== Leverage Looping Test Complete ===");
    }
}
