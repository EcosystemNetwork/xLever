// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {IEVault} from "../src/EVault/IEVault.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract SupplyLiquidity is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // V2 vault addresses
        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047;
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        
        console.log("=== Supplying Liquidity to USDC Vault ===");
        console.log("Deployer:", deployer);
        console.log("USDC Balance:", IERC20(usdc).balanceOf(deployer));
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Supply 1000 USDC to vault for lending
        uint256 usdcBalance = IERC20(usdc).balanceOf(deployer);
        uint256 supplyAmount = usdcBalance > 1000e6 ? 1000e6 : usdcBalance;
        
        if (supplyAmount > 0) {
            console.log("Supplying", supplyAmount, "USDC to vault");
            IERC20(usdc).approve(usdcVault, supplyAmount);
            IEVault(usdcVault).deposit(supplyAmount, deployer);
            console.log("SUCCESS: Liquidity supplied");
            console.log("Vault shares received:", IEVault(usdcVault).balanceOf(deployer));
        } else {
            console.log("SKIPPED: No USDC balance");
        }
        
        vm.stopBroadcast();
        
        console.log("\n=== Liquidity Supply Complete ===");
    }
}
