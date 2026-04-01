// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // use Solidity 0.8+ to get built-in overflow checks needed for financial math

import "forge-std/Script.sol"; // inherit Foundry Script base so we can use vm cheatcodes and console.log for deployment
import {VaultSimple} from "../src/xLever/VaultSimple.sol"; // import the simplified vault contract that stays under Ink Sepolia's contract size limit

contract DeployXLever is Script { // Foundry script contract that deploys the core xLever simplified vaults
    function run() external { // entry point called by `forge script`; external visibility is required by Foundry
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env so it never appears in source
        address deployer = vm.addr(deployerPrivateKey); // derive the deployer address from the private key for logging and ownership assignment

        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943; // USDC stablecoin on Ink Sepolia -- the quote/collateral asset for all vaults
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 tokenized equity on Ink Sepolia -- leveraged trading target
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // wrapped Nasdaq tokenized equity on Ink Sepolia -- second leveraged trading target

        console.log("=== Deploying xLever Protocol ==="); // header log to visually separate this deployment in forge output
        console.log("Deployer:", deployer); // confirm which address is deploying so operator can verify correct wallet
        console.log("USDC:", usdc); // log USDC address for cross-referencing with block explorer
        console.log("wSPYx:", wSPYx); // log wSPYx address for cross-referencing with block explorer
        console.log("wQQQx:", wQQQx); // log wQQQx address for cross-referencing with block explorer

        vm.startBroadcast(deployerPrivateKey); // begin broadcasting transactions signed by deployer to the live network

        VaultSimple spyVault = new VaultSimple(usdc, wSPYx, deployer); // deploy SPY vault: USDC is deposit token, wSPYx is the leveraged asset, deployer is admin
        console.log("\nwSPYx Vault:", address(spyVault)); // log deployed address so operator can save it to .env

        VaultSimple qqqVault = new VaultSimple(usdc, wQQQx, deployer); // deploy QQQ vault: same pattern but for Nasdaq exposure
        console.log("wQQQx Vault:", address(qqqVault)); // log deployed address for the QQQ vault

        vm.stopBroadcast(); // stop broadcasting -- all deployment transactions are now submitted

        console.log("\n=== Deployment Complete ==="); // visual separator indicating deployment finished successfully
        console.log("\nAdd to .env:"); // remind operator to persist addresses for downstream scripts
        console.log("WSPY_VAULT_ADDRESS=", address(spyVault)); // provide copy-paste-ready env var for the SPY vault
        console.log("WQQQ_VAULT_ADDRESS=", address(qqqVault)); // provide copy-paste-ready env var for the QQQ vault
    }
}
