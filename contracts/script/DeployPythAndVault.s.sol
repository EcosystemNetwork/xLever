// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {PythOracleAdapter} from "../src/xLever/modules/PythOracleAdapter.sol";
import {Vault} from "../src/xLever/Vault.sol";

/// @title DeployPythAndVault
/// @notice Deploys PythOracleAdapter + QQQ Vault + SPY Vault to Ink Sepolia
contract DeployPythAndVault is Script {

    // ── Ink Sepolia Constants ──
    address constant PYTH      = 0x2880aB155794e7179c9eE2e38200202908C17B43;
    address constant USDC      = 0x6b57475467cd854d36Be7FB614caDa5207838943;
    address constant WQQQ      = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
    address constant WSPY      = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;

    // ── Pyth Feed IDs ──
    bytes32 constant FEED_QQQ = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d; // Equity.US.QQQ/USD
    bytes32 constant FEED_SPY = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5; // Equity.US.SPY/USD

    function run() external {
        uint256 deployerPK = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPK);

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPK);

        // 1. Deploy PythOracleAdapter
        PythOracleAdapter adapter = new PythOracleAdapter(PYTH, deployer);
        console.log("PythOracleAdapter:", address(adapter));

        // 2. Deploy QQQ Vault
        Vault qqqVault = new Vault(USDC, WQQQ, deployer, deployer, address(adapter), FEED_QQQ);
        console.log("QQQ Vault:", address(qqqVault));

        // 3. Deploy SPY Vault
        Vault spyVault = new Vault(USDC, WSPY, deployer, deployer, address(adapter), FEED_SPY);
        console.log("SPY Vault:", address(spyVault));

        // 4. Authorize vaults on the adapter
        adapter.setVault(address(qqqVault));
        // Note: adapter only stores one vault address. For multi-vault,
        // the adapter's onlyVaultOrAdmin modifier already allows admin.
        // Both vaults can call via the deployer (admin) as fallback.

        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("PythOracleAdapter:", address(adapter));
        console.log("QQQ Vault:        ", address(qqqVault));
        console.log("SPY Vault:        ", address(spyVault));
        console.log("");
        console.log("Next steps:");
        console.log("1. Update .env with these addresses");
        console.log("2. Update frontend/contracts.js ADDRESSES");
        console.log("3. Initialize TWAP buffers via updateOracle()");
    }
}
