// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultWithLooping} from "../src/xLever/VaultWithLooping.sol";
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract OpenLoopingPosition is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address user = vm.addr(deployerPrivateKey);
        
        // Deployed looping vault (with properly configured EVaults)
        address spyVault = 0xFeDf3406bB1498dA2D6b52a50409221EF1607730;
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        
        console.log("=== Opening Looping Position on Testnet ===");
        console.log("User:", user);
        console.log("Vault:", spyVault);
        
        // Check balance
        uint256 balance = IERC20(usdc).balanceOf(user);
        console.log("USDC Balance:", balance / 1e6);
        
        require(balance >= 1000000, "Insufficient USDC balance"); // 1 USDC
        
        // Position parameters
        uint256 depositAmount = 1000000; // 1 USDC (1000000 = 1 * 1e6)
        int32 leverage = 30000; // 3x leverage
        
        console.log("\nOpening Position:");
        console.log("Deposit:", depositAmount / 1e6, "USDC");
        console.log("Leverage:", uint256(int256(leverage)) / 100, "x");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Approve USDC
        IERC20(usdc).approve(spyVault, depositAmount);
        console.log("Approved USDC");
        
        // Open position (this will execute the loop!)
        VaultWithLooping vault = VaultWithLooping(spyVault);
        uint256 finalPosition = vault.deposit(depositAmount, leverage);
        
        vm.stopBroadcast();
        
        console.log("\n=== Position Opened! ===");
        console.log("Final Position Size:", finalPosition / 1e6, "USDC");
        
        // Check the position
        DataTypes.Position memory pos = vault.getPosition(user);
        console.log("\nPosition Details:");
        console.log("Deposit Amount:", pos.depositAmount / 1e6, "USDC");
        console.log("Leverage:", uint256(int256(pos.leverageBps)));
        console.log("Active:", pos.isActive);
        
        // Check Euler position
        DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
        console.log("\nEuler Position:");
        console.log("Collateral Shares:", eulerPos.collateralShares);
        console.log("Debt Amount:", eulerPos.debtAmount / 1e6, "USDC");
        console.log("Active:", eulerPos.isActive);
        
        // Check health
        (uint256 collateral, uint256 debt, uint256 healthFactor) = vault.getPositionHealth(user);
        console.log("\nPosition Health:");
        console.log("Collateral:", collateral / 1e6, "USDC");
        console.log("Debt:", debt / 1e6, "USDC");
        console.log("Health Factor:", healthFactor);
        
        console.log("\n=== SUCCESS! ===");
        console.log("Check the transaction on explorer for LoopExecuted events");
        console.log("Each event shows one iteration of the loop");
    }
}
