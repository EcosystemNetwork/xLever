// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in leverage calculations

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {EulerHedgingModule} from "../src/xLever/modules/EulerHedgingModule.sol"; // hedging module that executes leverage looping via Euler V2 borrow/deposit cycles
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface to query vault balances and debt positions

interface IERC20 { // minimal ERC-20 interface for token operations needed in testing
    function balanceOf(address) external view returns (uint256); // check token balances before and after leverage operations
    function approve(address spender, uint256 amount) external returns (bool); // approve hedging module to pull collateral tokens
    function transfer(address to, uint256 amount) external returns (bool); // transfer tokens if needed for test setup
}

contract TestLeverageLooping is Script { // integration test script that validates real leverage looping on V1 Euler vaults
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing test transactions
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address -- acts as the test trader

        address spyHedging = 0xd0673BeB607CA2136b126d34ED0D3Ff7826c93EE; // V1 hedging module for wSPYx leverage looping
        address qqqHedging = 0x3Bc3c0D268455aD7eAe1432f57f3C24f42EdC7C8; // V1 hedging module for wQQQx leverage looping

        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943; // USDC on Ink Sepolia -- used for short position collateral
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 on Ink Sepolia -- used for long position collateral
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // wrapped Nasdaq on Ink Sepolia -- used for short position asset

        address usdcVault = 0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53; // V1 USDC Euler vault -- lending pool for USDC borrows
        address spyVault = 0x6d064558d58645439A64cE1e88989Dfba88AA052; // V1 wSPYx Euler vault -- collateral vault for long positions
        address qqqVault = 0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9; // V1 wQQQx Euler vault -- collateral vault for short positions

        console.log("=== Testing Real Leverage Looping ==="); // header identifying this as the V1 leverage looping test
        console.log("Trader:", deployer); // confirm which address is trading
        console.log("USDC Balance:", IERC20(usdc).balanceOf(deployer)); // show available USDC for potential short positions
        console.log("wSPYx Balance:", IERC20(wSPYx).balanceOf(deployer)); // show available wSPYx for long position collateral

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting test transactions

        console.log("\n=== Test 1: Open 3x Long Position on wSPYx ==="); // test long leverage: deposit wSPYx, borrow USDC, buy more wSPYx
        console.log("Initial collateral: 5 USDC worth of wSPYx"); // describe test scenario for operator
        console.log("Target leverage: 3x"); // 3x means 2x borrowed on top of 1x equity

        uint256 spyBalance = IERC20(wSPYx).balanceOf(deployer); // check how much wSPYx is available for collateral
        if (spyBalance > 0) { // only run test if deployer has wSPYx tokens
            uint256 collateral = spyBalance > 5e18 ? 5e18 : spyBalance; // use 5 wSPYx or all available if less -- caps risk in test

            IERC20(wSPYx).approve(spyHedging, collateral); // approve hedging module to pull wSPYx collateral for the leverage loop

            console.log("Opening long position..."); // signal that the leverage operation is starting
            try EulerHedgingModule(spyHedging).openLongPosition(collateral, 30000) { // attempt 3x long (30000 = 3.0x in basis points)
                console.log("SUCCESS: 3x long position opened!"); // confirm leverage loop completed without revert

                (uint256 totalCollateral, uint256 totalDebt, uint256 healthFactor) = // query position health from hedging module
                    EulerHedgingModule(spyHedging).getPositionHealth(); // health factor must be >100% to avoid liquidation

                console.log("Position Health:"); // header for health metrics
                console.log("  Total Collateral:", totalCollateral); // total collateral value in USD terms
                console.log("  Total Debt:", totalDebt); // total borrowed amount in USD terms
                console.log("  Health Factor:", healthFactor / 100, "%"); // health factor as percentage -- above 100% means safe

                console.log("\nVault Positions:"); // header for raw vault balance data
                console.log("  wSPYx Vault Balance:", IEVault(spyVault).balanceOf(spyHedging)); // shares held by hedging module in SPY vault (collateral side)
                console.log("  USDC Vault Debt:", IEVault(usdcVault).debtOf(spyHedging)); // USDC debt owed by hedging module (borrow side)
            } catch Error(string memory reason) { // catch Solidity revert strings for readable error messages
                console.log("FAILED:", reason); // log the specific revert reason for debugging
            } catch (bytes memory lowLevelData) { // catch low-level reverts (e.g., out of gas, custom errors)
                console.log("FAILED: Low-level error"); // indicate a non-string revert occurred
                console.logBytes(lowLevelData); // log raw revert data for decoding with cast or etherscan
            }
        } else { // handle case where deployer has no wSPYx
            console.log("SKIPPED: No wSPYx balance"); // inform operator why the test was skipped
        }

        console.log("\n=== Test 2: Open 2x Short Position on wQQQx ==="); // test short leverage: deposit USDC, borrow wQQQx, sell it
        console.log("Initial collateral: 10 USDC"); // describe test scenario
        console.log("Target leverage: 2x short"); // 2x short means borrowing 2x collateral value in wQQQx

        uint256 usdcBalance = IERC20(usdc).balanceOf(deployer); // check available USDC for short collateral
        if (usdcBalance >= 10e6) { // need at least 10 USDC to run this test
            IERC20(usdc).approve(qqqHedging, 10e6); // approve hedging module to pull 10 USDC for the short position

            console.log("Opening short position..."); // signal that the short leverage operation is starting
            try EulerHedgingModule(qqqHedging).openShortPosition(10e6, 20000) { // attempt 2x short (20000 = 2.0x in basis points)
                console.log("SUCCESS: 2x short position opened!"); // confirm short leverage loop completed

                (uint256 totalCollateral, uint256 totalDebt, uint256 healthFactor) = // query short position health
                    EulerHedgingModule(qqqHedging).getPositionHealth(); // health must be >100% for position to be safe

                console.log("Position Health:"); // header for health metrics
                console.log("  Total Collateral:", totalCollateral); // USDC collateral value
                console.log("  Total Debt:", totalDebt); // wQQQx borrowed value
                console.log("  Health Factor:", healthFactor / 100, "%"); // health as percentage

                console.log("\nVault Positions:"); // header for raw vault data
                console.log("  USDC Vault Balance:", IEVault(usdcVault).balanceOf(qqqHedging)); // USDC shares in collateral vault
                console.log("  wQQQx Vault Debt:", IEVault(qqqVault).debtOf(qqqHedging)); // wQQQx debt from borrowing
            } catch Error(string memory reason) { // catch revert strings
                console.log("FAILED:", reason); // log revert reason
            } catch (bytes memory lowLevelData) { // catch low-level errors
                console.log("FAILED: Low-level error"); // indicate non-string revert
                console.logBytes(lowLevelData); // log raw bytes for debugging
            }
        } else { // handle insufficient USDC case
            console.log("SKIPPED: Insufficient USDC balance"); // inform operator
        }

        vm.stopBroadcast(); // end transaction broadcasting -- all test transactions submitted

        console.log("\n=== Leverage Looping Tests Complete ==="); // visual confirmation tests finished
        console.log("\nNote: If tests failed, it may be due to:"); // troubleshooting guide for common failures
        console.log("  1. Insufficient token balances"); // deployer may not have enough tokens
        console.log("  2. Need to enable vaults as collateral/controller via EVC"); // EVC permissions may not be set
        console.log("  3. Oracle price feeds not configured"); // vaults need oracle prices for LTV checks
        console.log("  4. Vault liquidity constraints"); // not enough USDC in lending pool
    }
}
