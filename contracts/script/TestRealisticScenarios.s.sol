// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultSimple} from "../src/xLever/VaultSimple.sol";
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title TestRealisticScenarios
/// @notice Realistic leveraged trading scenarios on Ink Sepolia
contract TestRealisticScenarios is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Deployed addresses
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address spyVault = 0x95822416e61Ad6b45Fc45c7540947b6eF080D5a1; // wSPYx
        address qqqVault = 0x1034259f355566fcE4571F792d239a99BBa1b9b4; // wQQQx
        
        console.log("=== Realistic xLever Trading Scenarios ===");
        console.log("Trader:", deployer);
        console.log("Starting USDC:", IERC20(usdc).balanceOf(deployer));
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Scenario 1: Bullish trader goes 4x long on SPY
        console.log("\n=== Scenario 1: Bullish SPY Trader (4x Long) ===");
        console.log("Alice believes SPY will rally, goes max leverage long");
        
        uint256 aliceDeposit = 5e6; // 5 USDC
        int32 aliceLeverage = 40000; // 4x long
        
        IERC20(usdc).approve(spyVault, aliceDeposit);
        VaultSimple(spyVault).deposit(aliceDeposit, aliceLeverage);
        
        DataTypes.Position memory alicePos = VaultSimple(spyVault).getPosition(deployer);
        console.log("Position opened:");
        console.log("  Capital: $5 USDC");
        console.log("  Leverage: 4x long");
        console.log("  Notional exposure: $20 (4x * $5)");
        console.log("  Entry TWAP:", alicePos.entryTWAP);
        
        // Scenario 2: Bearish trader goes 3x short on QQQ
        console.log("\n=== Scenario 2: Bearish QQQ Trader (3x Short) ===");
        console.log("Bob expects tech selloff, shorts QQQ with 3x leverage");
        
        uint256 bobDeposit = 7e6; // 7 USDC
        int32 bobLeverage = -30000; // 3x short
        
        IERC20(usdc).approve(qqqVault, bobDeposit);
        VaultSimple(qqqVault).deposit(bobDeposit, bobLeverage);
        
        DataTypes.Position memory bobPos = VaultSimple(qqqVault).getPosition(deployer);
        console.log("Position opened:");
        console.log("  Capital: $7 USDC");
        console.log("  Leverage: 3x short");
        console.log("  Notional exposure: $21 short (3x * $7)");
        console.log("  Entry TWAP:", bobPos.entryTWAP);
        
        // Scenario 3: Conservative trader with 1.5x long
        console.log("\n=== Scenario 3: Conservative SPY Trader (1.5x Long) ===");
        console.log("Carol wants SPY exposure but keeps leverage low");
        
        // First close Alice's position to reuse funds
        VaultSimple(spyVault).withdraw(aliceDeposit);
        
        uint256 carolDeposit = 5e6; // 5 USDC
        int32 carolLeverage = 15000; // 1.5x long
        
        IERC20(usdc).approve(spyVault, carolDeposit);
        VaultSimple(spyVault).deposit(carolDeposit, carolLeverage);
        
        DataTypes.Position memory carolPos = VaultSimple(spyVault).getPosition(deployer);
        console.log("Position opened:");
        console.log("  Capital: $5 USDC");
        console.log("  Leverage: 1.5x long");
        console.log("  Notional exposure: $7.50 (1.5x * $5)");
        console.log("  Entry TWAP:", carolPos.entryTWAP);
        
        // Scenario 4: Aggressive swing trader flips from long to short
        console.log("\n=== Scenario 4: Swing Trader Flips Position ===");
        console.log("Dave closes conservative long, opens aggressive short");
        
        // Close Carol's position
        VaultSimple(spyVault).withdraw(carolDeposit);
        console.log("Closed 1.5x long position");
        
        // Open aggressive short
        uint256 daveDeposit = 5e6; // 5 USDC
        int32 daveLeverage = -35000; // 3.5x short
        
        IERC20(usdc).approve(spyVault, daveDeposit);
        VaultSimple(spyVault).deposit(daveDeposit, daveLeverage);
        
        DataTypes.Position memory davePos = VaultSimple(spyVault).getPosition(deployer);
        console.log("New position opened:");
        console.log("  Capital: $5 USDC");
        console.log("  Leverage: 3.5x short");
        console.log("  Notional exposure: $17.50 short (3.5x * $5)");
        console.log("  Entry TWAP:", davePos.entryTWAP);
        
        // Scenario 5: Check pool states after all activity
        console.log("\n=== Scenario 5: Pool Analytics ===");
        
        DataTypes.PoolState memory spyPool = VaultSimple(spyVault).getPoolState();
        DataTypes.PoolState memory qqqPool = VaultSimple(qqqVault).getPoolState();
        
        console.log("SPY Vault (wSPYx):");
        console.log("  Total deposits:", spyPool.totalSeniorDeposits, "USDC");
        console.log("  Active positions: 1 (Dave's 3.5x short)");
        console.log("  Max leverage allowed:", spyPool.currentMaxLeverageBps / 100, "x");
        
        console.log("\nQQQ Vault (wQQQx):");
        console.log("  Total deposits:", qqqPool.totalSeniorDeposits, "USDC");
        console.log("  Active positions: 1 (Bob's 3x short)");
        console.log("  Max leverage allowed:", qqqPool.currentMaxLeverageBps / 100, "x");
        
        // Scenario 6: Partial position management
        console.log("\n=== Scenario 6: Position Management ===");
        console.log("Bob reduces his QQQ short position by 50%");
        
        uint256 bobWithdraw = 3.5e6; // Withdraw half
        VaultSimple(qqqVault).withdraw(bobWithdraw);
        
        DataTypes.Position memory bobPosAfter = VaultSimple(qqqVault).getPosition(deployer);
        console.log("Position after partial close:");
        console.log("  Remaining capital:", bobPosAfter.depositAmount, "USDC");
        console.log("  Leverage: still 3x short");
        console.log("  New notional:", (bobPosAfter.depositAmount * 3) / 1e6, "USDC");
        
        // Final cleanup
        console.log("\n=== Final Cleanup ===");
        VaultSimple(spyVault).withdraw(daveDeposit);
        VaultSimple(qqqVault).withdraw(bobPosAfter.depositAmount);
        
        console.log("All positions closed");
        console.log("Final USDC balance:", IERC20(usdc).balanceOf(deployer));
        
        vm.stopBroadcast();
        
        console.log("\n=== Trading Scenarios Complete ===");
        console.log("\nDemonstrated:");
        console.log("  - Max leverage long (4x)");
        console.log("  - Aggressive short (3x, 3.5x)");
        console.log("  - Conservative long (1.5x)");
        console.log("  - Position flipping (long -> short)");
        console.log("  - Partial position closes");
        console.log("  - Multi-vault trading");
    }
}
