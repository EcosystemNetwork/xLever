// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultWithLooping} from "../src/xLever/VaultWithLooping.sol";

contract DeployLoopingVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Token addresses on Ink Sepolia
        address usdc = 0xFabab97dCE620294D2B0b0e46C68964e326300Ac;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        
        // Euler V2 infrastructure addresses from README
        address evc = 0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c;
        // Euler Vault addresses (with oracle support)
        address usdcVault = 0xe5B808F4317B0fb00Ae38ec8592e43117a8B7390;
        address spyVault = 0xe0c4FfA982604e86705fEE5d050c608b5f2A4286;
        address qqqVault = 0xcE96b6d9097437ECE99a3Bf0502B33DA894A5C97;
        
        console.log("=== Deploying xLever Vaults with ACTUAL LOOPING ===");
        console.log("Deployer:", deployer);
        console.log("USDC:", usdc);
        console.log("wSPYx:", wSPYx);
        console.log("wQQQx:", wQQQx);
        console.log("EVC:", evc);
        console.log("USDC EVault:", usdcVault);
        console.log("SPY EVault:", spyVault);
        console.log("QQQ EVault:", qqqVault);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy looping vault for wSPYx
        console.log("\nDeploying wSPYx Looping Vault...");
        VaultWithLooping spyLoopVault = new VaultWithLooping(
            usdc,
            wSPYx,
            evc,
            usdcVault,
            spyVault,
            deployer
        );
        console.log("wSPYx Looping Vault:", address(spyLoopVault));
        
        // Deploy looping vault for wQQQx
        console.log("\nDeploying wQQQx Looping Vault...");
        VaultWithLooping qqqLoopVault = new VaultWithLooping(
            usdc,
            wQQQx,
            evc,
            usdcVault,
            qqqVault,
            deployer
        );
        console.log("wQQQx Looping Vault:", address(qqqLoopVault));
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("\nUpdate frontend VAULT_ADDRESSES:");
        console.log("wSPYx: '", address(spyLoopVault), "',");
        console.log("wQQQx: '", address(qqqLoopVault), "'");
        
        console.log("\n=== LOOPING FEATURES ===");
        console.log("- Actual recursive deposit->borrow->deposit->borrow loops");
        console.log("- Up to 10 iterations to reach target leverage");
        console.log("- 75% LTV with 1% safety margin");
        console.log("- Automatic loop unwinding on withdrawal");
        console.log("- LoopExecuted events for transparency");
    }
}
