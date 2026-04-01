// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {FixedPriceOracle} from "../src/oracles/FixedPriceOracle.sol";
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol";
import {VaultWithLooping} from "../src/xLever/VaultWithLooping.sol";

interface IEVault {
    function setLTV(address collateral, uint16 borrowLTV, uint16 liquidationLTV, uint32 rampDuration) external;
    function setGovernorAdmin(address newGovernorAdmin) external;
}

contract DeployCompleteTestnetSetup is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Token addresses
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        address evc = 0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c;
        address factory = 0xba1240B966E20E16ca32BBFc189528787794F2A9;
        
        console.log("=== Complete Testnet Setup for Looping ===");
        console.log("Deployer:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // 1. Deploy Oracle
        console.log("\n[1/5] Deploying FixedPriceOracle...");
        FixedPriceOracle oracle = new FixedPriceOracle();
        console.log("Oracle:", address(oracle));
        
        // Set prices (1:1 for simplicity in testing)
        oracle.setPrice(usdc, usdc, 1e18);
        oracle.setPrice(wSPYx, usdc, 1e18); // 1:1 for testing
        oracle.setPrice(wQQQx, usdc, 1e18);
        console.log("Prices configured");
        
        // 2. Deploy USDC Vault with Oracle
        console.log("\n[2/5] Deploying USDC EVault with Oracle...");
        bytes memory usdcMetadata = abi.encodePacked(usdc, address(oracle), usdc);
        address usdcVault = GenericFactory(factory).createProxy(address(0), true, usdcMetadata);
        console.log("USDC EVault:", usdcVault);
        
        // 3. Configure USDC Vault LTV (allow borrowing against USDC)
        console.log("\n[3/5] Configuring USDC Vault LTV...");
        IEVault(usdcVault).setLTV(
            usdc,       // USDC token as collateral
            0.74e4,     // 74% borrow LTV (safe for looping)
            0.80e4,     // 80% liquidation LTV
            0           // No ramp
        );
        console.log("LTV set: 74% borrow, 80% liquidation");
        
        // 4. Deploy Looping Vault for wSPYx
        console.log("\n[4/5] Deploying wSPYx Looping Vault...");
        VaultWithLooping spyLoopVault = new VaultWithLooping(
            usdc,
            wSPYx,
            evc,
            usdcVault,
            usdcVault,  // Use same vault for both (simplified)
            deployer
        );
        console.log("wSPYx Looping Vault:", address(spyLoopVault));
        
        // 5. Deploy Looping Vault for wQQQx
        console.log("\n[5/5] Deploying wQQQx Looping Vault...");
        VaultWithLooping qqqLoopVault = new VaultWithLooping(
            usdc,
            wQQQx,
            evc,
            usdcVault,
            usdcVault,
            deployer
        );
        console.log("wQQQx Looping Vault:", address(qqqLoopVault));
        
        vm.stopBroadcast();
        
        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("\nAddresses to use:");
        console.log("ORACLE=", address(oracle));
        console.log("USDC_EVAULT=", usdcVault);
        console.log("SPY_LOOPING_VAULT=", address(spyLoopVault));
        console.log("QQQ_LOOPING_VAULT=", address(qqqLoopVault));
        
        console.log("\nReady to test looping!");
        console.log("Run: forge script script/OpenLoopingPosition.s.sol --rpc-url https://rpc-gel-sepolia.inkonchain.com --broadcast --legacy");
    }
}
