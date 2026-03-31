// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol";
import {IEVault} from "../src/EVault/IEVault.sol";

contract DeployEulerVaults is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Deployed addresses
        address evc = 0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c;
        address factory = 0xba1240B966E20E16ca32BBFc189528787794F2A9;
        address evaultImpl = 0xd821A7D919e007b6b39925f672f1219dB4865Fba;
        address irm = 0xE91A4B01632a7D281fb3eB0E83Ad9D5F0305d48f;
        
        // Tokens
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        console.log("=== Deploying Euler Vaults with 75% LTV ===");
        console.log("Deployer:", deployer);
        console.log("Factory:", factory);
        console.log("EVault Implementation:", evaultImpl);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Set implementation in factory
        console.log("\n--- Setting EVault implementation in factory ---");
        GenericFactory(factory).setImplementation(evaultImpl);
        console.log("Implementation set to:", evaultImpl);
        
        // Deploy USDC vault
        console.log("\n--- Deploying USDC Vault ---");
        // Metadata: asset (20B) + oracle (20B) + unitOfAccount (20B) = 60B
        // Factory adds 4B prefix automatically to make 64B total
        bytes memory usdcMetadata = abi.encodePacked(
            usdc,           // asset
            address(0),     // oracle (none for now)
            address(0)      // unit of account (none for now)
        );
        address usdcVault = GenericFactory(factory).createProxy(
            address(0),
            true,
            usdcMetadata
        );
        console.log("USDC Vault created:", usdcVault);
        
        IEVault(usdcVault).setInterestRateModel(irm);
        IEVault(usdcVault).setMaxLiquidationDiscount(0.15e4);
        IEVault(usdcVault).setLiquidationCoolOffTime(1);
        IEVault(usdcVault).setHookConfig(address(0), 0);
        IEVault(usdcVault).setCaps(0, 0);
        
        // Deploy wSPYx vault
        console.log("\n--- Deploying wSPYx Vault ---");
        bytes memory spyMetadata = abi.encodePacked(
            wSPYx,
            address(0),
            address(0)
        );
        address spyVault = GenericFactory(factory).createProxy(
            address(0),
            true,
            spyMetadata
        );
        console.log("wSPYx Vault created:", spyVault);
        
        IEVault(spyVault).setInterestRateModel(irm);
        IEVault(spyVault).setMaxLiquidationDiscount(0.15e4);
        IEVault(spyVault).setLiquidationCoolOffTime(1);
        IEVault(spyVault).setHookConfig(address(0), 0);
        IEVault(spyVault).setCaps(0, 0);
        
        // Deploy wQQQx vault
        console.log("\n--- Deploying wQQQx Vault ---");
        bytes memory qqqMetadata = abi.encodePacked(
            wQQQx,
            address(0),
            address(0)
        );
        address qqqVault = GenericFactory(factory).createProxy(
            address(0),
            true,
            qqqMetadata
        );
        console.log("wQQQx Vault created:", qqqVault);
        
        IEVault(qqqVault).setInterestRateModel(irm);
        IEVault(qqqVault).setMaxLiquidationDiscount(0.15e4);
        IEVault(qqqVault).setLiquidationCoolOffTime(1);
        IEVault(qqqVault).setHookConfig(address(0), 0);
        IEVault(qqqVault).setCaps(0, 0);
        
        // Set LTV: 75% borrow, 87% liquidation (12% volatility buffer)
        console.log("\n--- Setting LTV: 75% borrow, 87% liquidation ---");
        
        // USDC can use wSPYx as collateral
        IEVault(usdcVault).setLTV(spyVault, 0.75e4, 0.87e4, 0);
        console.log("USDC vault: wSPYx collateral (75% borrow, 87% liq)");
        
        // USDC can use wQQQx as collateral
        IEVault(usdcVault).setLTV(qqqVault, 0.75e4, 0.87e4, 0);
        console.log("USDC vault: wQQQx collateral (75% borrow, 87% liq)");
        
        // wSPYx can use USDC as collateral
        IEVault(spyVault).setLTV(usdcVault, 0.75e4, 0.87e4, 0);
        console.log("wSPYx vault: USDC collateral (75% borrow, 87% liq)");
        
        // wQQQx can use USDC as collateral
        IEVault(qqqVault).setLTV(usdcVault, 0.75e4, 0.87e4, 0);
        console.log("wQQQx vault: USDC collateral (75% borrow, 87% liq)");
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("\nEuler Vaults:");
        console.log("USDC_EVAULT=", usdcVault);
        console.log("WSPY_EVAULT=", spyVault);
        console.log("WQQQ_EVAULT=", qqqVault);
        console.log("\nLTV Settings:");
        console.log("  Borrow LTV: 75% (max leverage: 3x safe, 4x theoretical)");
        console.log("  Liquidation LTV: 87% (12% volatility buffer)");
        console.log("  Buffer: Positions liquidated only if debt > 87% of collateral");
    }
}
