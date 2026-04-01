// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {Vault} from "../src/xLever/Vault.sol";

/// @title DeploySimple
/// @notice DEPRECATED — now deploys the canonical Vault (not VaultSimple).
///         Kept for backward compatibility with existing CI/deployment scripts.
///         Prefer DeployXLever.s.sol for new deployments.
contract DeploySimple is Script {
    function run() external {
        // Token addresses on Ink Sepolia
        address usdc  = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;

        // Shared Pyth infrastructure on Ink Sepolia
        address pythAdapter = 0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f;

        // Pyth feed IDs
        bytes32 feedSPY = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5;
        bytes32 feedQQQ = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d;

        console.log("=== DeploySimple (canonical Vault path) ===");
        console.log("NOTE: VaultSimple is retired. Deploying canonical Vault with modules.");
        console.log("Deployer:", msg.sender);

        vm.startBroadcast();

        // Deploy canonical SPY vault
        Vault spyVault = new Vault(usdc, wSPYx, msg.sender, msg.sender, pythAdapter, feedSPY);
        console.log("\nwSPYx Vault:", address(spyVault));

        // Deploy canonical QQQ vault
        Vault qqqVault = new Vault(usdc, wQQQx, msg.sender, msg.sender, pythAdapter, feedQQQ);
        console.log("wQQQx Vault:", address(qqqVault));

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("SPY_VAULT=", address(spyVault));
        console.log("QQQ_VAULT=", address(qqqVault));
    }
}
