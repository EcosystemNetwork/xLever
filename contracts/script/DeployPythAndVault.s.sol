// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ gives us built-in overflow protection critical for price math

import "forge-std/Script.sol"; // Foundry Script base provides vm cheatcodes and console.log for deployment scripting
import {PythOracleAdapter} from "../src/xLever/modules/PythOracleAdapter.sol"; // adapter that bridges Pyth Network price feeds into xLever vaults
import {Vault} from "../src/xLever/Vault.sol"; // full-featured xLever vault with oracle integration (unlike VaultSimple)

/// @title DeployPythAndVault
/// @notice Deploys PythOracleAdapter + QQQ Vault + SPY Vault to Ink Sepolia
contract DeployPythAndVault is Script { // Foundry script that wires up Pyth oracle and both leveraged-asset vaults in one tx batch

    address constant PYTH      = 0x2880aB155794e7179c9eE2e38200202908C17B43; // Pyth Network contract on Ink Sepolia -- source of truth for real-time price feeds
    address constant USDC      = 0x6b57475467cd854d36Be7FB614caDa5207838943; // USDC stablecoin on Ink Sepolia -- serves as collateral and unit of account
    address constant WQQQ      = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // wrapped Nasdaq token on Ink Sepolia -- leveraged trading target
    address constant WSPY      = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 token on Ink Sepolia -- leveraged trading target

    bytes32 constant FEED_QQQ = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d; // Pyth feed ID for QQQ/USD so the adapter knows which price stream to consume
    bytes32 constant FEED_SPY = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5; // Pyth feed ID for SPY/USD so the adapter knows which price stream to consume

    function run() external { // Foundry entry point; called by `forge script`
        uint256 deployerPK = vm.envUint("PRIVATE_KEY"); // load deployer private key from environment to avoid hardcoding secrets
        address deployer = vm.addr(deployerPK); // derive deployer address for ownership assignment and logging

        console.log("Deployer:", deployer); // confirm deployer identity before spending gas
        console.log("Balance:", deployer.balance); // verify deployer has enough ETH to cover deployment gas costs

        vm.startBroadcast(deployerPK); // begin signing and broadcasting transactions to the live network

        PythOracleAdapter adapter = new PythOracleAdapter(PYTH, deployer); // deploy oracle adapter pointed at Ink Sepolia Pyth contract, deployer is admin
        console.log("PythOracleAdapter:", address(adapter)); // log adapter address for .env and frontend config

        Vault qqqVault = new Vault(USDC, WQQQ, deployer, deployer, address(adapter), FEED_QQQ); // deploy QQQ vault: USDC collateral, WQQQ asset, deployer as owner and fee receiver, adapter for pricing, QQQ feed
        console.log("QQQ Vault:", address(qqqVault)); // log QQQ vault address for downstream script references

        Vault spyVault = new Vault(USDC, WSPY, deployer, deployer, address(adapter), FEED_SPY); // deploy SPY vault: same pattern but for SP500 exposure via SPY feed
        console.log("SPY Vault:", address(spyVault)); // log SPY vault address for downstream script references

        adapter.setVault(address(qqqVault)); // register QQQ vault in the adapter so it can pull prices autonomously
        // Note: adapter only stores one vault address. For multi-vault,
        // the adapter's onlyVaultOrAdmin modifier already allows admin.
        // Both vaults can call via the deployer (admin) as fallback.

        // Initialize TWAP buffers with starting prices so oracle reads are valid immediately
        // QQQ ~$480, SPY ~$530 (8 decimals)
        uint128 QQQ_START_PRICE = 48000000000; // $480.00
        uint128 SPY_START_PRICE = 53000000000; // $530.00
        qqqVault.initializeOracle(QQQ_START_PRICE);
        spyVault.initializeOracle(SPY_START_PRICE);

        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("PythOracleAdapter:", address(adapter));
        console.log("QQQ Vault:        ", address(qqqVault));
        console.log("SPY Vault:        ", address(spyVault));
        console.log("");
        console.log("TWAP buffers initialized:");
        console.log("  QQQ start price: $480.00");
        console.log("  SPY start price: $530.00");
        console.log("");
        console.log("Next steps:");
        console.log("1. Update .env with these addresses");
        console.log("2. Update frontend/contracts.js ADDRESSES");
        console.log("3. Send first updateOracle() tx with live Pyth data to begin real price tracking");
    }
}
