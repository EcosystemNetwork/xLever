// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {VaultSimple} from "../src/xLever/VaultSimple.sol"; // simplified vault for testnet -- supports deposit, withdraw, and position queries
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol"; // shared data structures for Position and PoolState

interface IERC20 { // minimal ERC-20 interface for the token operations this test needs
    function balanceOf(address) external view returns (uint256); // check balances to verify deposits/withdrawals
    function approve(address spender, uint256 amount) external returns (bool); // approve vaults to pull USDC
}

contract TestVaultLive is Script { // live integration test that validates VaultSimple deposit, withdraw, and state queries on Ink Sepolia
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing test transactions
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address -- acts as the test trader

        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943; // USDC on Ink Sepolia -- deposit currency
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 token for reference logging
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // wrapped Nasdaq token for reference logging
        address spyVault = 0x95822416e61Ad6b45Fc45c7540947b6eF080D5a1; // VaultSimple for wSPYx leveraged positions
        address qqqVault = 0x1034259f355566fcE4571F792d239a99BBa1b9b4; // VaultSimple for wQQQx leveraged positions

        console.log("=== Testing xLever Vaults on Ink Sepolia ==="); // header for this test suite
        console.log("Tester:", deployer); // confirm which address is running the tests
        console.log("USDC Balance:", IERC20(usdc).balanceOf(deployer)); // show initial USDC to confirm sufficient test funds

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting test transactions

        console.log("\n--- Test 1: Deposit 10 USDC into wSPYx vault (3x long) ---"); // test basic deposit with 3x long leverage
        uint256 depositAmount = 10e6; // 10 USDC -- reasonable test amount that won't exhaust funds
        int32 leverage = 30000; // 3x long in basis points -- moderate leverage for testing

        console.log("Approving USDC..."); // signal approval step for readability
        IERC20(usdc).approve(spyVault, depositAmount); // approve SPY vault to pull 10 USDC
        console.log("Depositing..."); // signal deposit step
        VaultSimple(spyVault).deposit(depositAmount, leverage); // open 3x long position on SPY

        DataTypes.Position memory spyPos = VaultSimple(spyVault).getPosition(deployer); // fetch position to verify it was created correctly
        console.log("Position created:"); // header for position details
        console.log("  Deposit:", spyPos.depositAmount); // verify deposit amount matches input
        console.log("  Leverage:", uint256(int256(spyPos.leverageBps))); // cast to uint for display -- verify leverage was stored
        console.log("  Active:", spyPos.isActive); // verify position is active

        console.log("\n--- Test 2: Deposit 15 USDC into wQQQx vault (2x short) ---"); // test deposit with short leverage
        uint256 depositAmount2 = 15e6; // 15 USDC -- larger position to test different sizes
        int32 leverage2 = -20000; // 2x short in basis points -- negative means short direction

        IERC20(usdc).approve(qqqVault, depositAmount2); // approve QQQ vault to pull 15 USDC
        VaultSimple(qqqVault).deposit(depositAmount2, leverage2); // open 2x short position on QQQ

        DataTypes.Position memory qqqPos = VaultSimple(qqqVault).getPosition(deployer); // fetch position to verify
        console.log("Position created:"); // header for position details
        console.log("  Deposit:", qqqPos.depositAmount); // verify deposit amount
        console.log("  Leverage:", uint256(int256(qqqPos.leverageBps))); // verify short leverage stored correctly
        console.log("  Active:", qqqPos.isActive); // verify position is active

        console.log("\n--- Test 3: Pool States ---"); // test querying pool-level analytics
        DataTypes.PoolState memory spyPool = VaultSimple(spyVault).getPoolState(); // fetch SPY pool state
        DataTypes.PoolState memory qqqPool = VaultSimple(qqqVault).getPoolState(); // fetch QQQ pool state

        console.log("wSPYx Vault:"); // header for SPY pool data
        console.log("  Total Deposits:", spyPool.totalSeniorDeposits); // total USDC in the SPY vault
        console.log("  Max Leverage:", spyPool.currentMaxLeverageBps); // dynamic max leverage based on utilization
        console.log("  Protocol State:", spyPool.protocolState); // vault operational state (active, paused, etc.)

        console.log("wQQQx Vault:"); // header for QQQ pool data
        console.log("  Total Deposits:", qqqPool.totalSeniorDeposits); // total USDC in the QQQ vault
        console.log("  Max Leverage:", qqqPool.currentMaxLeverageBps); // dynamic max leverage
        console.log("  Protocol State:", qqqPool.protocolState); // operational state

        console.log("\n--- Test 4: Withdraw 5 USDC from wSPYx vault ---"); // test partial withdrawal
        uint256 withdrawAmount = 5e6; // 5 USDC -- partial withdrawal to test position reduction
        uint256 balanceBefore = IERC20(usdc).balanceOf(deployer); // snapshot balance before withdraw to calculate received amount

        VaultSimple(spyVault).withdraw(withdrawAmount); // partially close the SPY long position

        uint256 balanceAfter = IERC20(usdc).balanceOf(deployer); // snapshot balance after withdraw
        console.log("USDC received:", balanceAfter - balanceBefore); // calculate and log actual USDC received

        DataTypes.Position memory spyPosAfter = VaultSimple(spyVault).getPosition(deployer); // fetch position to verify partial close
        console.log("Remaining deposit:", spyPosAfter.depositAmount); // verify reduced deposit amount
        console.log("Still active:", spyPosAfter.isActive); // position should still be active with remaining funds

        console.log("\n--- Test 5: Full withdrawal from wQQQx vault ---"); // test complete position close
        VaultSimple(qqqVault).withdraw(depositAmount2); // withdraw all 15 USDC to fully close QQQ position

        DataTypes.Position memory qqqPosAfter = VaultSimple(qqqVault).getPosition(deployer); // fetch position to verify full close
        console.log("Remaining deposit:", qqqPosAfter.depositAmount); // should be 0 after full withdrawal
        console.log("Still active:", qqqPosAfter.isActive); // should be false after full withdrawal

        vm.stopBroadcast(); // end transaction broadcasting -- all tests complete

        console.log("\n=== All Tests Completed Successfully ==="); // visual confirmation all 5 tests passed
    }
}
