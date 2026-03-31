// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol";
import {IEVault} from "../src/EVault/IEVault.sol";

contract CreateVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Load deployment addresses
        address factoryAddress = vm.envAddress("EVAULT_FACTORY_ADDRESS");
        address assetAddress = vm.envAddress("ASSET_ADDRESS"); // e.g., USDC
        address irmAddress = vm.envAddress("IRM_ADDRESS");

        console.log("Creating vault for asset:", assetAddress);
        console.log("Using factory:", factoryAddress);

        vm.startBroadcast(deployerPrivateKey);

        GenericFactory factory = GenericFactory(factoryAddress);

        // Create vault
        address vaultProxy = factory.createProxy(address(0), true, abi.encodePacked(assetAddress));
        
        console.log("Vault created at:", vaultProxy);

        // Initialize vault with basic configuration
        IEVault vault = IEVault(vaultProxy);

        // Set Interest Rate Model
        vault.setInterestRateModel(irmAddress);
        console.log("IRM set to:", irmAddress);

        // Set max liquidation discount (e.g., 10%)
        vault.setMaxLiquidationDiscount(0.1e4); // 10% in basis points (1e4 = 100%)
        console.log("Max liquidation discount set to 10%");

        // Set liquidation cool-off time (e.g., 1 second)
        vault.setLiquidationCoolOffTime(1);
        console.log("Liquidation cool-off time set");

        // Set hook config (no hooks initially)
        vault.setHookConfig(address(0), 0);
        console.log("Hook config set");

        // Set interest fee (e.g., 10% of interest goes to protocol)
        vault.setInterestFee(0.1e4); // 10%
        console.log("Interest fee set to 10%");

        // Set caps (max deposit/borrow)
        // For testnet, set reasonable caps
        // Note: setCaps uses AmountCap format (uint16)
        vault.setCaps(0, 0); // 0 = no cap (unlimited for testing)
        console.log("Caps set (unlimited for testing)");

        vm.stopBroadcast();

        console.log("\n=== Vault Configuration Complete ===");
        console.log("Vault address:", vaultProxy);
        console.log("Asset:", assetAddress);
        console.log("IRM:", irmAddress);
        console.log("\nNext steps:");
        console.log("1. Add collateral assets using vault.setLTV()");
        console.log("2. Configure oracles for price feeds");
        console.log("3. Test deposits and borrows");
    }
}
