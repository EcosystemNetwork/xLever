// SPDX-License-Identifier: GPL-2.0-or-later // required license header for Euler-derived code compatibility
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface for deposit and balanceOf calls

interface IERC20 { // minimal ERC-20 interface -- only the methods needed for supply operations
    function balanceOf(address) external view returns (uint256); // check deployer's USDC balance before supplying
    function approve(address spender, uint256 amount) external returns (bool); // approve vault to pull USDC during deposit
}

contract SupplyLiquidity is Script { // seeds the USDC vault with lending liquidity so borrowers can open leveraged positions
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for deposit recipient and logging

        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047; // V2 USDC vault that lends USDC to leveraged traders
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943; // USDC token on Ink Sepolia -- the asset being supplied

        console.log("=== Supplying Liquidity to USDC Vault ==="); // visual header for this operation
        console.log("Deployer:", deployer); // confirm which address is supplying
        console.log("USDC Balance:", IERC20(usdc).balanceOf(deployer)); // show available USDC before supply to verify sufficient funds

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting transactions

        uint256 usdcBalance = IERC20(usdc).balanceOf(deployer); // read deployer's USDC balance to determine how much to supply
        uint256 supplyAmount = usdcBalance > 1000e6 ? 1000e6 : usdcBalance; // cap at 1000 USDC to preserve some balance, or use all if less than 1000

        if (supplyAmount > 0) { // only proceed if there is USDC to supply
            console.log("Supplying", supplyAmount, "USDC to vault"); // log the exact amount being supplied
            IERC20(usdc).approve(usdcVault, supplyAmount); // approve vault to transfer USDC from deployer during deposit call
            IEVault(usdcVault).deposit(supplyAmount, deployer); // deposit USDC into vault; deployer receives vault shares as receipt
            console.log("SUCCESS: Liquidity supplied"); // confirm deposit succeeded
            console.log("Vault shares received:", IEVault(usdcVault).balanceOf(deployer)); // log shares received to verify deposit was credited
        } else { // handle edge case where deployer has no USDC
            console.log("SKIPPED: No USDC balance"); // inform operator why supply was skipped
        }

        vm.stopBroadcast(); // end transaction broadcasting

        console.log("\n=== Liquidity Supply Complete ==="); // visual confirmation of successful supply
    }
}
