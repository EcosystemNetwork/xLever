// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol"; // factory to create new vault proxies with oracle metadata baked in

contract ConfigureVaultOracles is Script { // redeploys vaults with oracle addresses embedded in proxy metadata since oracles cannot be set post-creation
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env -- must match factory admin
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for logging

        address oracle = vm.envOr("ORACLE_ADDRESS", address(0)); // load oracle address from .env -- required for vault price feeds
        require(oracle != address(0), "ORACLE_ADDRESS not set"); // oracle is mandatory -- vaults need it for LTV enforcement and liquidation

        address usdcVault = 0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53; // V1 USDC vault address (being replaced with oracle-aware version)
        address spyVault = 0x6d064558d58645439A64cE1e88989Dfba88AA052; // V1 wSPYx vault address (being replaced)
        address qqqVault = 0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9; // V1 wQQQx vault address (being replaced)

        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943; // USDC token on Ink Sepolia -- base asset and unit of account
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 token on Ink Sepolia
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // wrapped Nasdaq token on Ink Sepolia

        address factory = 0xba1240B966E20E16ca32BBFc189528787794F2A9; // GenericFactory address deployed in prior step

        console.log("=== Configuring Vault Oracles ==="); // visual header for this migration script
        console.log("Deployer:", deployer); // confirm deployer identity
        console.log("Oracle:", oracle); // confirm which oracle is being embedded

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting transactions

        console.log("\n--- Redeploying USDC Vault with Oracle ---"); // USDC vault needs oracle in metadata for price lookups
        bytes memory usdcMetadata = abi.encodePacked( // encode proxy metadata: asset + oracle + unit of account packed into bytes
            usdc, // asset: USDC is the underlying token this vault manages
            oracle, // oracle: price feed source for collateral valuation
            usdc // unit of account: prices are denominated in USDC
        );
        address newUsdcVault = GenericFactory(factory).createProxy( // create new vault proxy with oracle metadata baked in
            address(0), // no salt -- let factory assign deterministic address
            true, // upgradeable proxy -- allows future implementation upgrades
            usdcMetadata // metadata containing asset, oracle, and unit of account
        );
        console.log("New USDC Vault:", newUsdcVault); // log new address for .env update

        console.log("\n--- Redeploying wSPYx Vault with Oracle ---"); // wSPYx vault needs oracle to price SPY collateral
        bytes memory spyMetadata = abi.encodePacked( // encode proxy metadata for SPY vault
            wSPYx, // asset: wSPYx is the underlying token for this vault
            oracle, // oracle: same oracle instance provides SPY/USDC price
            usdc // unit of account: all prices denominated in USDC
        );
        address newSpyVault = GenericFactory(factory).createProxy( // create new SPY vault proxy with oracle
            address(0), // no salt -- factory assigns address
            true, // upgradeable proxy
            spyMetadata // metadata with asset, oracle, unit of account
        );
        console.log("New wSPYx Vault:", newSpyVault); // log new address for .env update

        console.log("\n--- Redeploying wQQQx Vault with Oracle ---"); // wQQQx vault needs oracle to price QQQ collateral
        bytes memory qqqMetadata = abi.encodePacked( // encode proxy metadata for QQQ vault
            wQQQx, // asset: wQQQx is the underlying token for this vault
            oracle, // oracle: same oracle instance provides QQQ/USDC price
            usdc // unit of account: all prices denominated in USDC
        );
        address newQqqVault = GenericFactory(factory).createProxy( // create new QQQ vault proxy with oracle
            address(0), // no salt -- factory assigns address
            true, // upgradeable proxy
            qqqMetadata // metadata with asset, oracle, unit of account
        );
        console.log("New wQQQx Vault:", newQqqVault); // log new address for .env update

        vm.stopBroadcast(); // end transaction broadcasting -- all redeployments submitted

        console.log("\n=== Configuration Complete ==="); // visual confirmation of successful migration
        console.log("\nNew Vault Addresses (with Oracle):"); // header for the new addresses section
        console.log("USDC_EVAULT_V2=", newUsdcVault); // copy-paste env var for USDC vault V2
        console.log("WSPY_EVAULT_V2=", newSpyVault); // copy-paste env var for SPY vault V2
        console.log("WQQQ_EVAULT_V2=", newQqqVault); // copy-paste env var for QQQ vault V2
        console.log("\nNote: Update hedging modules to use new vault addresses"); // hedging modules hardcode vault addresses and must be redeployed
    }
}
