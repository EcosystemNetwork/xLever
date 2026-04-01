// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface for redeem and balanceOf calls

contract WithdrawUSDC is Script { // utility script to withdraw all USDC from a V2 Euler vault by redeeming all shares
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing the withdrawal
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address -- must be the share holder

        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047; // V2 USDC vault address -- where liquidity was previously supplied

        console.log("=== Withdrawing USDC from Vault ==="); // visual header for this operation
        console.log("Deployer:", deployer); // confirm which address is withdrawing

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting the withdrawal transaction

        uint256 shares = IEVault(usdcVault).balanceOf(deployer); // check how many vault shares the deployer holds
        console.log("Vault shares:", shares); // log share balance for operator awareness

        if (shares > 0) { // only attempt withdrawal if deployer has shares to redeem
            console.log("Withdrawing all shares..."); // signal redemption is starting
            uint256 assets = IEVault(usdcVault).redeem(shares, deployer, deployer); // redeem all shares: burn shares, receive USDC, deployer is both receiver and owner
            console.log("Withdrawn assets:", assets); // log actual USDC received (may differ from shares due to accrued interest)
            console.log("SUCCESS: USDC withdrawn"); // confirm withdrawal completed
        } else { // handle case where deployer has no shares
            console.log("No shares to withdraw"); // inform operator there is nothing to redeem
        }

        vm.stopBroadcast(); // end transaction broadcasting

        console.log("\n=== Withdrawal Complete ==="); // visual confirmation of successful withdrawal
    }
}
