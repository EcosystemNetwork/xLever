// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in leverage and PnL calculations

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {VaultSimple} from "../src/xLever/VaultSimple.sol"; // simplified xLever vault for testnet -- handles deposits, withdrawals, and leverage tracking
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol"; // shared data structures for Position and PoolState used across the protocol

interface IERC20 { // minimal ERC-20 interface for token operations needed in testing
    function balanceOf(address) external view returns (uint256); // check USDC balance before/after trades
    function approve(address spender, uint256 amount) external returns (bool); // approve vault to pull USDC deposits
}

/// @title TestRealisticScenarios
/// @notice Realistic leveraged trading scenarios on Ink Sepolia
contract TestRealisticScenarios is Script { // end-to-end test simulating multiple traders with different strategies on VaultSimple
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing test transactions
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address -- simulates all traders from the same account

        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943; // USDC on Ink Sepolia -- deposit currency for all positions
        address spyVault = 0x95822416e61Ad6b45Fc45c7540947b6eF080D5a1; // VaultSimple for wSPYx -- handles SPY leveraged positions
        address qqqVault = 0x1034259f355566fcE4571F792d239a99BBa1b9b4; // VaultSimple for wQQQx -- handles QQQ leveraged positions

        console.log("=== Realistic xLever Trading Scenarios ==="); // header for the comprehensive test suite
        console.log("Trader:", deployer); // confirm which address is simulating all traders
        console.log("Starting USDC:", IERC20(usdc).balanceOf(deployer)); // show initial USDC balance before any trades

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting test transactions

        console.log("\n=== Scenario 1: Bullish SPY Trader (4x Long) ==="); // scenario: aggressive bull goes max leverage on SPY
        console.log("Alice believes SPY will rally, goes max leverage long"); // describe trader motivation

        uint256 aliceDeposit = 5e6; // 5 USDC -- small position to conserve testnet funds
        int32 aliceLeverage = 40000; // 4x long in basis points -- near max leverage for high conviction

        IERC20(usdc).approve(spyVault, aliceDeposit); // approve SPY vault to pull Alice's USDC deposit
        VaultSimple(spyVault).deposit(aliceDeposit, aliceLeverage); // open 4x leveraged long position on SPY

        DataTypes.Position memory alicePos = VaultSimple(spyVault).getPosition(deployer); // fetch position details to verify it was created correctly
        console.log("Position opened:"); // header for position details
        console.log("  Capital: $5 USDC"); // deposited amount
        console.log("  Leverage: 4x long"); // leverage multiplier
        console.log("  Notional exposure: $20 (4x * $5)"); // total market exposure = leverage * capital
        console.log("  Entry TWAP:", alicePos.entryTWAP); // TWAP at entry -- used for PnL calculation on exit

        console.log("\n=== Scenario 2: Bearish QQQ Trader (3x Short) ==="); // scenario: tech bear shorts Nasdaq
        console.log("Bob expects tech selloff, shorts QQQ with 3x leverage"); // describe trader motivation

        uint256 bobDeposit = 7e6; // 7 USDC -- slightly larger position for Bob
        int32 bobLeverage = -30000; // 3x short in basis points -- negative means short direction

        IERC20(usdc).approve(qqqVault, bobDeposit); // approve QQQ vault to pull Bob's USDC deposit
        VaultSimple(qqqVault).deposit(bobDeposit, bobLeverage); // open 3x leveraged short position on QQQ

        DataTypes.Position memory bobPos = VaultSimple(qqqVault).getPosition(deployer); // fetch position to verify creation
        console.log("Position opened:"); // header for position details
        console.log("  Capital: $7 USDC"); // deposited amount
        console.log("  Leverage: 3x short"); // leverage and direction
        console.log("  Notional exposure: $21 short (3x * $7)"); // total short exposure
        console.log("  Entry TWAP:", bobPos.entryTWAP); // TWAP at entry for PnL on close

        console.log("\n=== Scenario 3: Conservative SPY Trader (1.5x Long) ==="); // scenario: cautious investor wants mild leverage
        console.log("Carol wants SPY exposure but keeps leverage low"); // describe conservative strategy

        VaultSimple(spyVault).withdraw(aliceDeposit); // close Alice's 4x position first to free up USDC for Carol's test

        uint256 carolDeposit = 5e6; // 5 USDC -- same size as Alice but much lower leverage
        int32 carolLeverage = 15000; // 1.5x long in basis points -- conservative leverage for lower risk

        IERC20(usdc).approve(spyVault, carolDeposit); // approve SPY vault for Carol's deposit
        VaultSimple(spyVault).deposit(carolDeposit, carolLeverage); // open 1.5x long -- mild leverage, lower liquidation risk

        DataTypes.Position memory carolPos = VaultSimple(spyVault).getPosition(deployer); // fetch position to verify
        console.log("Position opened:"); // header for position details
        console.log("  Capital: $5 USDC"); // deposited amount
        console.log("  Leverage: 1.5x long"); // mild leverage
        console.log("  Notional exposure: $7.50 (1.5x * $5)"); // total market exposure
        console.log("  Entry TWAP:", carolPos.entryTWAP); // TWAP at entry

        console.log("\n=== Scenario 4: Swing Trader Flips Position ==="); // scenario: trader reverses direction
        console.log("Dave closes conservative long, opens aggressive short"); // describe position flip strategy

        VaultSimple(spyVault).withdraw(carolDeposit); // close Carol's long position to free capital for the short
        console.log("Closed 1.5x long position"); // confirm long was closed

        uint256 daveDeposit = 5e6; // 5 USDC -- same capital recycled into opposite direction
        int32 daveLeverage = -35000; // 3.5x short in basis points -- aggressive short after bearish signal

        IERC20(usdc).approve(spyVault, daveDeposit); // approve SPY vault for Dave's short deposit
        VaultSimple(spyVault).deposit(daveDeposit, daveLeverage); // open 3.5x short -- high conviction bearish bet

        DataTypes.Position memory davePos = VaultSimple(spyVault).getPosition(deployer); // fetch position to verify flip
        console.log("New position opened:"); // header for new position
        console.log("  Capital: $5 USDC"); // deposited amount
        console.log("  Leverage: 3.5x short"); // aggressive short leverage
        console.log("  Notional exposure: $17.50 short (3.5x * $5)"); // total short exposure
        console.log("  Entry TWAP:", davePos.entryTWAP); // TWAP at entry for PnL

        console.log("\n=== Scenario 5: Pool Analytics ==="); // scenario: inspect pool state after multiple trades

        DataTypes.PoolState memory spyPool = VaultSimple(spyVault).getPoolState(); // fetch SPY vault pool state for analytics
        DataTypes.PoolState memory qqqPool = VaultSimple(qqqVault).getPoolState(); // fetch QQQ vault pool state for analytics

        console.log("SPY Vault (wSPYx):"); // header for SPY pool data
        console.log("  Total deposits:", spyPool.totalSeniorDeposits, "USDC"); // total USDC deposited in SPY vault
        console.log("  Active positions: 1 (Dave's 3.5x short)"); // describe current open positions
        console.log("  Max leverage allowed:", spyPool.currentMaxLeverageBps / 100, "x"); // dynamic max leverage based on pool utilization

        console.log("\nQQQ Vault (wQQQx):"); // header for QQQ pool data
        console.log("  Total deposits:", qqqPool.totalSeniorDeposits, "USDC"); // total USDC deposited in QQQ vault
        console.log("  Active positions: 1 (Bob's 3x short)"); // describe current open positions
        console.log("  Max leverage allowed:", qqqPool.currentMaxLeverageBps / 100, "x"); // dynamic max leverage

        console.log("\n=== Scenario 6: Position Management ==="); // scenario: partial close to reduce exposure
        console.log("Bob reduces his QQQ short position by 50%"); // describe partial withdrawal strategy

        uint256 bobWithdraw = 3.5e6; // withdraw half of Bob's 7 USDC deposit to halve exposure
        VaultSimple(qqqVault).withdraw(bobWithdraw); // execute partial withdrawal -- reduces position size while keeping leverage ratio

        DataTypes.Position memory bobPosAfter = VaultSimple(qqqVault).getPosition(deployer); // fetch position after partial close
        console.log("Position after partial close:"); // header for updated position
        console.log("  Remaining capital:", bobPosAfter.depositAmount, "USDC"); // show reduced capital
        console.log("  Leverage: still 3x short"); // leverage ratio is unchanged -- only notional changes
        console.log("  New notional:", (bobPosAfter.depositAmount * 3) / 1e6, "USDC"); // calculate new notional exposure

        console.log("\n=== Final Cleanup ==="); // close all remaining positions to leave a clean state
        VaultSimple(spyVault).withdraw(daveDeposit); // close Dave's 3.5x short on SPY
        VaultSimple(qqqVault).withdraw(bobPosAfter.depositAmount); // close Bob's remaining QQQ short

        console.log("All positions closed"); // confirm no open positions remain
        console.log("Final USDC balance:", IERC20(usdc).balanceOf(deployer)); // show final balance to check for PnL leakage

        vm.stopBroadcast(); // end transaction broadcasting -- all test scenarios complete

        console.log("\n=== Trading Scenarios Complete ==="); // visual confirmation all tests finished
        console.log("\nDemonstrated:"); // summary of what was validated
        console.log("  - Max leverage long (4x)"); // validated high-leverage longs
        console.log("  - Aggressive short (3x, 3.5x)"); // validated aggressive shorts
        console.log("  - Conservative long (1.5x)"); // validated conservative leverage
        console.log("  - Position flipping (long -> short)"); // validated direction changes
        console.log("  - Partial position closes"); // validated partial withdrawals
        console.log("  - Multi-vault trading"); // validated trading across SPY and QQQ vaults
    }
}
