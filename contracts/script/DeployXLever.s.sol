// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {Vault} from "../src/xLever/Vault.sol";

/// @title DeployXLever
/// @notice Deploys the canonical xLever Vault (with modules, fees, oracle, risk)
/// @dev Replaces the former VaultSimple deployment path.
///      Run: forge script script/DeployXLever.s.sol --rpc-url $INK_SEPOLIA_RPC --broadcast
contract DeployXLever is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Token addresses on Ink Sepolia
        address usdc  = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;

        // Shared Pyth infrastructure on Ink Sepolia
        address pythAdapter = 0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f;

        // Pyth feed IDs for SPY and QQQ
        bytes32 feedSPY = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5;
        bytes32 feedQQQ = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d;

        console.log("=== Deploying xLever Canonical Vaults ===");
        console.log("Deployer:", deployer);
        console.log("USDC:", usdc);
        console.log("PythAdapter:", pythAdapter);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy canonical SPY vault with all modules
        Vault spyVault = new Vault(usdc, wSPYx, deployer, deployer, pythAdapter, feedSPY);
        console.log("\nwSPYx Vault:", address(spyVault));
        console.log("  Oracle:", address(spyVault.oracle()));
        console.log("  FeeEngine:", address(spyVault.feeEngine()));
        console.log("  JuniorTranche:", address(spyVault.juniorTranche()));
        console.log("  RiskModule:", address(spyVault.riskModule()));

        // Deploy canonical QQQ vault with all modules
        Vault qqqVault = new Vault(usdc, wQQQx, deployer, deployer, pythAdapter, feedQQQ);
        console.log("\nwQQQx Vault:", address(qqqVault));
        console.log("  Oracle:", address(qqqVault.oracle()));
        console.log("  FeeEngine:", address(qqqVault.feeEngine()));
        console.log("  JuniorTranche:", address(qqqVault.juniorTranche()));
        console.log("  RiskModule:", address(qqqVault.riskModule()));

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("\nAdd to .env:");
        console.log("WSPY_VAULT_ADDRESS=", address(spyVault));
        console.log("WQQQ_VAULT_ADDRESS=", address(qqqVault));
        console.log("\nUpdate frontend VAULT_REGISTRY in contracts.js:");
        console.log("SPY: '", address(spyVault), "',");
        console.log("QQQ: '", address(qqqVault), "'");
    }
}
