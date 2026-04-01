// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in LTV calculations

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface to call governance functions like setLTV and setCaps

contract ConfigureVaultForXLever is Script { // configures senior/junior vault pair with LTV and collateral relationships for xLever
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env -- must be vault governor

        address seniorVaultAddress = vm.envAddress("SENIOR_VAULT_ADDRESS"); // senior vault serves conservative leverage traders with lower risk
        address juniorVaultAddress = vm.envAddress("JUNIOR_VAULT_ADDRESS"); // junior vault absorbs first-loss risk and provides liquidity buffer
        address xQQQAddress = vm.envAddress("XQQQ_ADDRESS"); // leveraged QQQ token used as collateral in both vaults
        address usdcAddress = vm.envAddress("USDC_ADDRESS"); // USDC stablecoin used as collateral and borrow asset

        console.log("Configuring vaults for xLever protocol"); // log operation start
        console.log("Senior Vault:", seniorVaultAddress); // confirm senior vault address for operator
        console.log("Junior Vault:", juniorVaultAddress); // confirm junior vault address for operator

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting governance transactions

        IEVault seniorVault = IEVault(seniorVaultAddress); // cast to EVault interface to call governance methods
        IEVault juniorVault = IEVault(juniorVaultAddress); // cast to EVault interface to call governance methods

        console.log("\n=== Configuring Senior Vault ==="); // visual separator for senior vault config section

        seniorVault.setLTV(xQQQAddress, 0.75e4, 0.75e4, 0); // 75% LTV for xQQQ collateral -- conservative because leveraged tokens are volatile
        console.log("xQQQ collateral LTV set to 75%"); // confirm LTV was set

        seniorVault.setLTV(usdcAddress, 0.9e4, 0.9e4, 0); // 90% LTV for USDC collateral -- higher because stablecoins have minimal price risk
        console.log("USDC collateral LTV set to 90%"); // confirm LTV was set

        seniorVault.setCaps(0, 0); // no supply/borrow caps -- unlimited for testnet to avoid artificial constraints
        console.log("Senior vault caps set"); // confirm caps were set

        console.log("\n=== Configuring Junior Vault ==="); // visual separator for junior vault config section

        juniorVault.setLTV(xQQQAddress, 0.85e4, 0.85e4, 0); // 85% LTV for xQQQ -- junior vault accepts more risk since it absorbs first losses
        console.log("xQQQ collateral LTV set to 85%"); // confirm higher LTV for risk-absorbing vault

        juniorVault.setLTV(usdcAddress, 0.95e4, 0.95e4, 0); // 95% LTV for USDC -- junior vault can take near-full USDC collateral since it bears first loss
        console.log("USDC collateral LTV set to 95%"); // confirm LTV was set

        juniorVault.setCaps(0, 0); // no caps on junior vault -- unlimited for testnet flexibility
        console.log("Junior vault caps set"); // confirm caps were set

        console.log("\n=== Configuring Cross-Vault Collateral ==="); // visual separator for cross-vault relationship

        seniorVault.setLTV(juniorVaultAddress, 0.5e4, 0.5e4, 0); // 50% LTV for junior vault shares as collateral -- low because junior vault value depends on its own solvency
        console.log("Junior vault set as collateral in Senior vault (50% LTV)"); // confirm cross-vault collateral was configured

        vm.stopBroadcast(); // end transaction broadcasting -- all configuration submitted

        console.log("\n=== Configuration Complete ==="); // visual confirmation of successful configuration
        console.log("Senior Vault configured for conservative leverage trading"); // summary of senior vault role
        console.log("Junior Vault configured to absorb risk and provide liquidity"); // summary of junior vault role
        console.log("\nNext steps:"); // guide operator through post-configuration testing
        console.log("1. Test deposit/withdraw operations"); // verify basic vault operations work
        console.log("2. Test leverage loop construction"); // verify hedging module can loop borrows
        console.log("3. Verify oracle price feeds"); // ensure prices are correct for LTV enforcement
        console.log("4. Test liquidation scenarios"); // ensure unhealthy positions can be liquidated
    }
}
