// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in financial math

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol"; // factory that deploys minimal proxy clones of EVault implementation
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface for calling governance/configuration methods on the new vault

contract CreateVault is Script { // generic script to create a single EVault proxy and configure its basic parameters
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for transaction signing

        address factoryAddress = vm.envAddress("EVAULT_FACTORY_ADDRESS"); // factory address from prior deployment -- creates vault proxies
        address assetAddress = vm.envAddress("ASSET_ADDRESS"); // underlying token for the new vault (e.g., USDC, wSPYx)
        address irmAddress = vm.envAddress("IRM_ADDRESS"); // interest rate model that governs borrow costs for this vault

        console.log("Creating vault for asset:", assetAddress); // confirm which asset the vault will manage
        console.log("Using factory:", factoryAddress); // confirm which factory is being used

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting transactions

        GenericFactory factory = GenericFactory(factoryAddress); // cast factory address to interface for calling createProxy

        address vaultProxy = factory.createProxy(address(0), true, abi.encodePacked(assetAddress)); // create vault proxy: no salt, upgradeable, asset address as metadata
        console.log("Vault created at:", vaultProxy); // log the new vault's address for downstream use

        IEVault vault = IEVault(vaultProxy); // cast proxy to EVault interface so we can configure it

        vault.setInterestRateModel(irmAddress); // assign IRM so the vault can calculate borrow interest rates
        console.log("IRM set to:", irmAddress); // confirm IRM assignment

        vault.setMaxLiquidationDiscount(0.1e4); // 10% max discount on collateral during liquidation -- incentivizes liquidators while limiting loss to borrowers
        console.log("Max liquidation discount set to 10%"); // confirm liquidation discount

        vault.setLiquidationCoolOffTime(1); // 1 second cool-off -- prevents MEV bots from sandwich-attacking liquidations while keeping response fast
        console.log("Liquidation cool-off time set"); // confirm cool-off was set

        vault.setHookConfig(address(0), 0); // no hooks enabled initially -- hooks can be added later for custom logic (e.g., KYC gates)
        console.log("Hook config set"); // confirm hooks are disabled

        vault.setInterestFee(0.1e4); // 10% of accrued interest goes to protocol treasury -- funds protocol development
        console.log("Interest fee set to 10%"); // confirm protocol fee rate

        vault.setCaps(0, 0); // no supply or borrow caps -- unlimited for testnet to avoid artificial constraints during testing
        console.log("Caps set (unlimited for testing)"); // confirm caps are disabled

        vm.stopBroadcast(); // end transaction broadcasting -- vault creation and config submitted

        console.log("\n=== Vault Configuration Complete ==="); // visual confirmation of successful creation
        console.log("Vault address:", vaultProxy); // summary: vault address
        console.log("Asset:", assetAddress); // summary: underlying asset
        console.log("IRM:", irmAddress); // summary: interest rate model
        console.log("\nNext steps:"); // guide operator through remaining configuration
        console.log("1. Add collateral assets using vault.setLTV()"); // vault needs to know which assets can back borrows
        console.log("2. Configure oracles for price feeds"); // oracle needed for LTV enforcement
        console.log("3. Test deposits and borrows"); // validate vault works end-to-end
    }
}
