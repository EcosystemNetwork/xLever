// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {IEVault} from "../src/EVault/IEVault.sol";

contract ConfigureVaultForXLever is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        address seniorVaultAddress = vm.envAddress("SENIOR_VAULT_ADDRESS");
        address juniorVaultAddress = vm.envAddress("JUNIOR_VAULT_ADDRESS");
        address xQQQAddress = vm.envAddress("XQQQ_ADDRESS");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");

        console.log("Configuring vaults for xLever protocol");
        console.log("Senior Vault:", seniorVaultAddress);
        console.log("Junior Vault:", juniorVaultAddress);

        vm.startBroadcast(deployerPrivateKey);

        IEVault seniorVault = IEVault(seniorVaultAddress);
        IEVault juniorVault = IEVault(juniorVaultAddress);

        // Configure Senior Vault (Conservative, for leverage traders)
        console.log("\n=== Configuring Senior Vault ===");
        
        // Set xQQQ as collateral with 75% LTV
        seniorVault.setLTV(xQQQAddress, 0.75e4, 0.75e4, 0);
        console.log("xQQQ collateral LTV set to 75%");

        // Set USDC as collateral with 90% LTV (stable)
        seniorVault.setLTV(usdcAddress, 0.9e4, 0.9e4, 0);
        console.log("USDC collateral LTV set to 90%");

        // Set caps for senior vault (using AmountCap format)
        seniorVault.setCaps(0, 0); // 0 = no cap for testing
        console.log("Senior vault caps set");

        // Configure Junior Vault (Risk-absorbing, for LPs)
        console.log("\n=== Configuring Junior Vault ===");
        
        // Junior vault has higher risk tolerance
        juniorVault.setLTV(xQQQAddress, 0.85e4, 0.85e4, 0);
        console.log("xQQQ collateral LTV set to 85%");

        juniorVault.setLTV(usdcAddress, 0.95e4, 0.95e4, 0);
        console.log("USDC collateral LTV set to 95%");

        // Set caps for junior vault (using AmountCap format)
        juniorVault.setCaps(0, 0); // 0 = no cap for testing
        console.log("Junior vault caps set");

        // Configure cross-vault relationship
        // Senior vault can use Junior vault as collateral
        console.log("\n=== Configuring Cross-Vault Collateral ===");
        seniorVault.setLTV(juniorVaultAddress, 0.5e4, 0.5e4, 0);
        console.log("Junior vault set as collateral in Senior vault (50% LTV)");

        vm.stopBroadcast();

        console.log("\n=== Configuration Complete ===");
        console.log("Senior Vault configured for conservative leverage trading");
        console.log("Junior Vault configured to absorb risk and provide liquidity");
        console.log("\nNext steps:");
        console.log("1. Test deposit/withdraw operations");
        console.log("2. Test leverage loop construction");
        console.log("3. Verify oracle price feeds");
        console.log("4. Test liquidation scenarios");
    }
}
