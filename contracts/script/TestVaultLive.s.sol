// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultSimple} from "../src/xLever/VaultSimple.sol";
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract TestVaultLive is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Deployed addresses
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        address spyVault = 0x95822416e61Ad6b45Fc45c7540947b6eF080D5a1;
        address qqqVault = 0x1034259f355566fcE4571F792d239a99BBa1b9b4;
        
        console.log("=== Testing xLever Vaults on Ink Sepolia ===");
        console.log("Tester:", deployer);
        console.log("USDC Balance:", IERC20(usdc).balanceOf(deployer));
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Test 1: Deposit into wSPYx vault with 3x long
        console.log("\n--- Test 1: Deposit 10 USDC into wSPYx vault (3x long) ---");
        uint256 depositAmount = 10e6; // 10 USDC
        int32 leverage = 30000; // 3x
        
        console.log("Approving USDC...");
        IERC20(usdc).approve(spyVault, depositAmount);
        console.log("Depositing...");
        VaultSimple(spyVault).deposit(depositAmount, leverage);
        
        DataTypes.Position memory spyPos = VaultSimple(spyVault).getPosition(deployer);
        console.log("Position created:");
        console.log("  Deposit:", spyPos.depositAmount);
        console.log("  Leverage:", uint256(int256(spyPos.leverageBps)));
        console.log("  Active:", spyPos.isActive);
        
        // Test 2: Deposit into wQQQx vault with 2x short
        console.log("\n--- Test 2: Deposit 15 USDC into wQQQx vault (2x short) ---");
        uint256 depositAmount2 = 15e6; // 15 USDC
        int32 leverage2 = -20000; // -2x
        
        IERC20(usdc).approve(qqqVault, depositAmount2);
        VaultSimple(qqqVault).deposit(depositAmount2, leverage2);
        
        DataTypes.Position memory qqqPos = VaultSimple(qqqVault).getPosition(deployer);
        console.log("Position created:");
        console.log("  Deposit:", qqqPos.depositAmount);
        console.log("  Leverage:", uint256(int256(qqqPos.leverageBps)));
        console.log("  Active:", qqqPos.isActive);
        
        // Test 3: Check pool states
        console.log("\n--- Test 3: Pool States ---");
        DataTypes.PoolState memory spyPool = VaultSimple(spyVault).getPoolState();
        DataTypes.PoolState memory qqqPool = VaultSimple(qqqVault).getPoolState();
        
        console.log("wSPYx Vault:");
        console.log("  Total Deposits:", spyPool.totalSeniorDeposits);
        console.log("  Max Leverage:", spyPool.currentMaxLeverageBps);
        console.log("  Protocol State:", spyPool.protocolState);
        
        console.log("wQQQx Vault:");
        console.log("  Total Deposits:", qqqPool.totalSeniorDeposits);
        console.log("  Max Leverage:", qqqPool.currentMaxLeverageBps);
        console.log("  Protocol State:", qqqPool.protocolState);
        
        // Test 4: Partial withdrawal from wSPYx
        console.log("\n--- Test 4: Withdraw 5 USDC from wSPYx vault ---");
        uint256 withdrawAmount = 5e6; // 5 USDC
        uint256 balanceBefore = IERC20(usdc).balanceOf(deployer);
        
        VaultSimple(spyVault).withdraw(withdrawAmount);
        
        uint256 balanceAfter = IERC20(usdc).balanceOf(deployer);
        console.log("USDC received:", balanceAfter - balanceBefore);
        
        DataTypes.Position memory spyPosAfter = VaultSimple(spyVault).getPosition(deployer);
        console.log("Remaining deposit:", spyPosAfter.depositAmount);
        console.log("Still active:", spyPosAfter.isActive);
        
        // Test 5: Full withdrawal from wQQQx
        console.log("\n--- Test 5: Full withdrawal from wQQQx vault ---");
        VaultSimple(qqqVault).withdraw(depositAmount2);
        
        DataTypes.Position memory qqqPosAfter = VaultSimple(qqqVault).getPosition(deployer);
        console.log("Remaining deposit:", qqqPosAfter.depositAmount);
        console.log("Still active:", qqqPosAfter.isActive);
        
        vm.stopBroadcast();
        
        console.log("\n=== All Tests Completed Successfully ===");
    }
}
