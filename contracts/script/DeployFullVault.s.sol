// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {Vault} from "../src/xLever/Vault.sol";

/// @title DeployFullVault
/// @notice Deploys canonical Vault instances for SPY and QQQ with Pyth oracle integration
contract DeployFullVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Real token addresses on Ink Sepolia
        address usdc  = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;

        // Shared Pyth infrastructure
        address pythAdapter = 0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f;

        // Pyth feed IDs
        bytes32 feedSPY = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5;
        bytes32 feedQQQ = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d;

        console.log("=== Deploying Canonical xLever Vaults ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy canonical SPY vault
        console.log("\nDeploying wSPYx Vault...");
        Vault spyVault = new Vault(usdc, wSPYx, deployer, deployer, pythAdapter, feedSPY);
        console.log("wSPYx Vault:", address(spyVault));
        console.log("  Oracle:", address(spyVault.oracle()));
        console.log("  FeeEngine:", address(spyVault.feeEngine()));
        console.log("  JuniorTranche:", address(spyVault.juniorTranche()));
        console.log("  RiskModule:", address(spyVault.riskModule()));

        // Deploy canonical QQQ vault
        console.log("\nDeploying wQQQx Vault...");
        Vault qqqVault = new Vault(usdc, wQQQx, deployer, deployer, pythAdapter, feedQQQ);
        console.log("wQQQx Vault:", address(qqqVault));
        console.log("  Oracle:", address(qqqVault.oracle()));
        console.log("  FeeEngine:", address(qqqVault.feeEngine()));
        console.log("  JuniorTranche:", address(qqqVault.juniorTranche()));
        console.log("  RiskModule:", address(qqqVault.riskModule()));

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("\nUpdate frontend VAULT_ADDRESSES:");
        console.log("wSPYx: '", address(spyVault), "',");
        console.log("wQQQx: '", address(qqqVault), "'");
    }
}
