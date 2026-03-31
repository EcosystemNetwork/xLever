// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {IEVault} from "../src/EVault/IEVault.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract FinalSetup is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // V2 addresses
        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047;
        address spyVault = 0xe39b100a33f7C861088A9C16642534dd29cDf83d;
        address qqqVault = 0xfC78951DcffdD8bDa662Aa7D9c697bE55d53712A;
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        
        console.log("=== Final Oracle Setup Complete ===");
        console.log("\nDeployed Components:");
        console.log("Oracle: 0x5b9D04D3c98035fc63fED58DBB03cA061dA21Ee6");
        console.log("USDC Vault V2:", usdcVault);
        console.log("wSPYx Vault V2:", spyVault);
        console.log("wQQQx Vault V2:", qqqVault);
        console.log("wSPYx Hedging V2: 0x268f782B6755F70902930C629A14F3c351C44BE9");
        console.log("wQQQx Hedging V2: 0xcA012c47B8B82512244C2D4eBaf1A8Ca66aA80Ff");
        
        console.log("\nConfiguration:");
        console.log("- Oracle prices: USDC=$1, wSPYx=$500, wQQQx=$400");
        console.log("- LTV: 75% borrow / 87% liquidation");
        console.log("- USDC liquidity: 1000 USDC supplied");
        
        console.log("\nStatus:");
        console.log("- All vaults initialized with IRM and LTV");
        console.log("- Hedging modules deployed and ready");
        console.log("- Oracle configured with fixed prices");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Set bidirectional LTV between USDC and asset vaults
        console.log("\nSetting bidirectional LTV...");
        IEVault(usdcVault).setLTV(spyVault, 0.75e4, 0.87e4, 0);
        IEVault(usdcVault).setLTV(qqqVault, 0.75e4, 0.87e4, 0);
        console.log("Bidirectional LTV configured");
        
        vm.stopBroadcast();
        
        console.log("\n=== ORACLE SETUP COMPLETE ===");
        console.log("\nNext steps:");
        console.log("1. Supply more USDC liquidity if needed");
        console.log("2. Test leverage looping with TestLeverageLoopingV2.s.sol");
        console.log("3. Verify positions work end-to-end");
    }
}
