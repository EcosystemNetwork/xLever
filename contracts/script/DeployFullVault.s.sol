// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {Vault} from "../src/xLever/Vault.sol";

contract DeployFullVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Real token addresses on Ink Sepolia
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        console.log("=== Deploying Full xLever Vaults with Junior Tranche ===");
        console.log("Deployer:", deployer);
        console.log("USDC:", usdc);
        console.log("wSPYx:", wSPYx);
        console.log("wQQQx:", wQQQx);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy full vaults with junior tranche support
        console.log("\nDeploying wSPYx Vault...");
        Vault spyVault = new Vault(usdc, wSPYx, deployer, deployer);
        console.log("wSPYx Vault:", address(spyVault));
        console.log("wSPYx Junior Tranche:", address(spyVault.juniorTranche()));
        
        console.log("\nDeploying wQQQx Vault...");
        Vault qqqVault = new Vault(usdc, wQQQx, deployer, deployer);
        console.log("wQQQx Vault:", address(qqqVault));
        console.log("wQQQx Junior Tranche:", address(qqqVault.juniorTranche()));
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("\nUpdate frontend VAULT_ADDRESSES:");
        console.log("wSPYx: '", address(spyVault), "',");
        console.log("wQQQx: '", address(qqqVault), "'");
        
        console.log("\nJunior Tranche Addresses:");
        console.log("wSPYx Junior: ", address(spyVault.juniorTranche()));
        console.log("wQQQx Junior: ", address(qqqVault.juniorTranche()));
    }
}
