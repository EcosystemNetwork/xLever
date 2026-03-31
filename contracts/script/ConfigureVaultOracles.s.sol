// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol";

contract ConfigureVaultOracles is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Get oracle address from environment or use deployed address
        address oracle = vm.envOr("ORACLE_ADDRESS", address(0));
        require(oracle != address(0), "ORACLE_ADDRESS not set");
        
        // Vault addresses
        address usdcVault = 0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53;
        address spyVault = 0x6d064558d58645439A64cE1e88989Dfba88AA052;
        address qqqVault = 0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9;
        
        // Token addresses
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        address factory = 0xba1240B966E20E16ca32BBFc189528787794F2A9;
        
        console.log("=== Configuring Vault Oracles ===");
        console.log("Deployer:", deployer);
        console.log("Oracle:", oracle);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // We need to redeploy the vaults with oracle in metadata
        // The oracle is set during vault creation via proxy metadata
        
        console.log("\n--- Redeploying USDC Vault with Oracle ---");
        bytes memory usdcMetadata = abi.encodePacked(
            usdc,           // asset
            oracle,         // oracle
            usdc            // unit of account (USDC)
        );
        address newUsdcVault = GenericFactory(factory).createProxy(
            address(0),
            true,
            usdcMetadata
        );
        console.log("New USDC Vault:", newUsdcVault);
        
        console.log("\n--- Redeploying wSPYx Vault with Oracle ---");
        bytes memory spyMetadata = abi.encodePacked(
            wSPYx,
            oracle,
            usdc            // price in USDC
        );
        address newSpyVault = GenericFactory(factory).createProxy(
            address(0),
            true,
            spyMetadata
        );
        console.log("New wSPYx Vault:", newSpyVault);
        
        console.log("\n--- Redeploying wQQQx Vault with Oracle ---");
        bytes memory qqqMetadata = abi.encodePacked(
            wQQQx,
            oracle,
            usdc            // price in USDC
        );
        address newQqqVault = GenericFactory(factory).createProxy(
            address(0),
            true,
            qqqMetadata
        );
        console.log("New wQQQx Vault:", newQqqVault);
        
        vm.stopBroadcast();
        
        console.log("\n=== Configuration Complete ===");
        console.log("\nNew Vault Addresses (with Oracle):");
        console.log("USDC_EVAULT_V2=", newUsdcVault);
        console.log("WSPY_EVAULT_V2=", newSpyVault);
        console.log("WQQQ_EVAULT_V2=", newQqqVault);
        console.log("\nNote: Update hedging modules to use new vault addresses");
    }
}
