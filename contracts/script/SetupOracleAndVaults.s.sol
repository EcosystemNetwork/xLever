// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {FixedPriceOracle} from "../src/oracles/FixedPriceOracle.sol";
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol";

interface IEVault {
    function setLTV(address collateral, uint16 borrowLTV, uint16 liquidationLTV, uint32 rampDuration) external;
    function setInterestRateModel(address newModel) external;
}

contract SetupOracleAndVaults is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Token addresses
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        address factory = 0xba1240B966E20E16ca32BBFc189528787794F2A9;
        
        console.log("=== Setting up Oracle and Vaults ===");
        console.log("Deployer:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // 1. Deploy FixedPriceOracle
        console.log("\n--- Deploying FixedPriceOracle ---");
        FixedPriceOracle oracle = new FixedPriceOracle();
        console.log("Oracle deployed:", address(oracle));
        
        // 2. Set prices (1:1 for USDC, $500 for SPY, $400 for QQQ in USDC terms)
        // Price format: 1e18 = 1:1 ratio
        oracle.setPrice(usdc, usdc, 1e18); // USDC = 1 USDC
        oracle.setPrice(wSPYx, usdc, 500e18); // 1 SPY = 500 USDC (scaled by 1e18)
        oracle.setPrice(wQQQx, usdc, 400e18); // 1 QQQ = 400 USDC
        console.log("Prices set");
        
        // 3. Redeploy USDC Vault with Oracle
        console.log("\n--- Deploying USDC Vault with Oracle ---");
        bytes memory usdcMetadata = abi.encodePacked(
            usdc,               // asset
            address(oracle),    // oracle
            usdc                // unit of account
        );
        address newUsdcVault = GenericFactory(factory).createProxy(
            address(0),
            true,
            usdcMetadata
        );
        console.log("New USDC Vault:", newUsdcVault);
        
        // 4. Redeploy wSPYx Vault with Oracle
        console.log("\n--- Deploying wSPYx Vault with Oracle ---");
        bytes memory spyMetadata = abi.encodePacked(
            wSPYx,
            address(oracle),
            usdc
        );
        address newSpyVault = GenericFactory(factory).createProxy(
            address(0),
            true,
            spyMetadata
        );
        console.log("New wSPYx Vault:", newSpyVault);
        
        // 5. Redeploy wQQQx Vault with Oracle
        console.log("\n--- Deploying wQQQx Vault with Oracle ---");
        bytes memory qqqMetadata = abi.encodePacked(
            wQQQx,
            address(oracle),
            usdc
        );
        address newQqqVault = GenericFactory(factory).createProxy(
            address(0),
            true,
            qqqMetadata
        );
        console.log("New wQQQx Vault:", newQqqVault);
        
        // 6. Configure LTV for USDC vault (allow borrowing against USDC collateral)
        console.log("\n--- Configuring LTV ---");
        IEVault(newUsdcVault).setLTV(
            newUsdcVault,  // collateral = USDC vault shares
            0.75e4,        // 75% borrow LTV
            0.80e4,        // 80% liquidation LTV
            0              // no ramp
        );
        console.log("USDC vault LTV configured");
        
        vm.stopBroadcast();
        
        console.log("\n=== Setup Complete ===");
        console.log("\nNew Addresses:");
        console.log("ORACLE=", address(oracle));
        console.log("USDC_EVAULT=", newUsdcVault);
        console.log("SPY_EVAULT=", newSpyVault);
        console.log("QQQ_EVAULT=", newQqqVault);
        console.log("\nNext: Redeploy looping vaults with new EVault addresses");
    }
}
