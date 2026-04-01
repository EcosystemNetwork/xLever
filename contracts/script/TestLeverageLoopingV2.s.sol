// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in leverage math

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {EulerHedgingModule} from "../src/xLever/modules/EulerHedgingModule.sol"; // hedging module that loops borrow/deposit cycles for leverage
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface for querying vault positions and debt

interface IERC20 { // minimal ERC-20 interface for the token operations this test needs
    function balanceOf(address) external view returns (uint256); // check balances before opening positions
    function approve(address spender, uint256 amount) external returns (bool); // approve hedging module to spend collateral
    function transfer(address to, uint256 amount) external returns (bool); // transfer tokens if needed for test setup
}

contract TestLeverageLoopingV2 is Script { // V2 integration test: validates leverage looping on oracle-enabled vaults
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address -- acts as the test trader

        address spyHedging = 0x268f782B6755F70902930C629A14F3c351C44BE9; // V2 hedging module for wSPYx -- wired to oracle-enabled vaults
        address qqqHedging = 0xcA012c47B8B82512244C2D4eBaf1A8Ca66aA80Ff; // V2 hedging module for wQQQx -- wired to oracle-enabled vaults

        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943; // USDC on Ink Sepolia -- stablecoin used in leverage operations
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 on Ink Sepolia -- leveraged asset

        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047; // V2 USDC vault with oracle -- lending pool for USDC borrows
        address spyVault = 0xe39b100a33f7C861088A9C16642534dd29cDf83d; // V2 wSPYx vault with oracle -- collateral vault for long positions

        console.log("=== Testing Real Leverage Looping V2 (with Oracle) ==="); // header identifying this as the V2 (oracle-enabled) test
        console.log("Trader:", deployer); // confirm which address is the test trader
        console.log("USDC Balance:", IERC20(usdc).balanceOf(deployer)); // show available USDC for reference
        console.log("wSPYx Balance:", IERC20(wSPYx).balanceOf(deployer)); // show available wSPYx for long position collateral

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting test transactions

        console.log("\n=== Test: Open 2x Long Position on wSPYx ==="); // single focused test: 2x long with 1 wSPYx collateral
        console.log("Initial collateral: 1 wSPYx"); // 1 wSPYx ~$500 at testnet price -- meaningful test amount
        console.log("Target leverage: 2x"); // 2x means 1x borrowed on top of 1x equity

        uint256 spyBalance = IERC20(wSPYx).balanceOf(deployer); // check deployer's wSPYx balance
        if (spyBalance >= 1e18) { // need at least 1 full wSPYx token to run this test
            uint256 collateral = 1e18; // use exactly 1 wSPYx as collateral for reproducible test results

            IERC20(wSPYx).approve(spyHedging, collateral); // approve hedging module to pull 1 wSPYx for the leverage loop

            console.log("Opening long position..."); // signal leverage operation is starting
            try EulerHedgingModule(spyHedging).openLongPosition(collateral, 20000) { // attempt 2x long (20000 = 2.0x in basis points)
                console.log("SUCCESS: 2x long position opened!"); // confirm leverage loop completed without revert

                (uint256 totalCollateral, uint256 totalDebt, uint256 healthFactor) = // query position health to verify it is safe
                    EulerHedgingModule(spyHedging).getPositionHealth(); // health >100% means position is solvent

                console.log("\nPosition Health:"); // header for position health metrics
                console.log("  Total Collateral:", totalCollateral); // total collateral value in USD terms
                console.log("  Total Debt:", totalDebt); // total debt value in USD terms
                console.log("  Health Factor:", healthFactor / 100, "%"); // health as percentage -- must be above 100%

                console.log("\nVault Positions:"); // header for raw vault balance data
                console.log("  wSPYx Vault Balance:", IEVault(spyVault).balanceOf(spyHedging)); // wSPYx vault shares held (collateral)
                console.log("  USDC Vault Debt:", IEVault(usdcVault).debtOf(spyHedging)); // USDC debt owed (borrow)

                console.log("\nLEVERAGE LOOPING WORKING!"); // prominent success message for quick visual confirmation
            } catch Error(string memory reason) { // catch Solidity revert strings
                console.log("FAILED:", reason); // log the revert reason for debugging
            } catch (bytes memory lowLevelData) { // catch low-level/custom error reverts
                console.log("FAILED: Low-level error"); // indicate a non-string revert
                console.logBytes(lowLevelData); // log raw bytes for post-mortem analysis
            }
        } else { // handle case where deployer lacks sufficient wSPYx
            console.log("SKIPPED: Insufficient wSPYx balance (need 1 wSPYx)"); // explain why test was skipped
            console.log("Current balance:", spyBalance); // show actual balance so operator knows how much is missing
        }

        vm.stopBroadcast(); // end transaction broadcasting

        console.log("\n=== Leverage Looping Test Complete ==="); // visual confirmation test finished
    }
}
