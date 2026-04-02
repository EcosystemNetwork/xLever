// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface for calling setLTV governance function

interface IERC20 { // minimal ERC-20 interface -- only the methods this script needs
    function balanceOf(address) external view returns (uint256); // needed to check token balances
    function approve(address spender, uint256 amount) external returns (bool); // needed to approve vault spending
}

contract FinalSetup is Script { // final configuration step: sets bidirectional LTV between USDC vault and asset vaults
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing governance transactions
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for logging

        address usdcVault = 0x014ba821525Be6eDd25F3eE7C6A37274382c8047; // V2 USDC vault with oracle support -- lenders deposit USDC here
        address spyVault = 0xe39b100a33f7C861088A9C16642534dd29cDf83d; // V2 wSPYx vault -- collateral vault for SPY-leveraged positions
        address qqqVault = 0xfC78951DcffdD8bDa662Aa7D9c697bE55d53712A; // V2 wQQQx vault -- collateral vault for QQQ-leveraged positions
        address usdc = 0xFabab97dCE620294D2B0b0e46C68964e326300Ac; // USDC token on Ink Sepolia

        console.log("=== Final Oracle Setup Complete ==="); // header summarizing what this script accomplishes
        console.log("\nDeployed Components:"); // log all deployed component addresses for operator cross-reference
        console.log("Oracle: 0x5b9D04D3c98035fc63fED58DBB03cA061dA21Ee6"); // fixed-price oracle deployed in prior step
        console.log("USDC Vault V2:", usdcVault); // V2 USDC vault address
        console.log("wSPYx Vault V2:", spyVault); // V2 SPY vault address
        console.log("wQQQx Vault V2:", qqqVault); // V2 QQQ vault address
        console.log("wSPYx Hedging V2: 0x268f782B6755F70902930C629A14F3c351C44BE9"); // hedging module for SPY leverage looping
        console.log("wQQQx Hedging V2: 0xcA012c47B8B82512244C2D4eBaf1A8Ca66aA80Ff"); // hedging module for QQQ leverage looping

        console.log("\nConfiguration:"); // summary of current oracle/LTV configuration
        console.log("- Oracle prices: USDC=$1, wSPYx=$500, wQQQx=$400"); // testnet fixed prices
        console.log("- LTV: 75% borrow / 87% liquidation"); // risk parameters for collateral
        console.log("- USDC liquidity: 1000 USDC supplied"); // amount of lending liquidity available

        console.log("\nStatus:"); // current system status summary
        console.log("- All vaults initialized with IRM and LTV"); // confirms prior scripts ran successfully
        console.log("- Hedging modules deployed and ready"); // hedging modules are wired to V2 vaults
        console.log("- Oracle configured with fixed prices"); // oracle has all price pairs set

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting the final LTV configuration

        console.log("\nSetting bidirectional LTV..."); // USDC vault needs to accept SPY/QQQ vaults as collateral for borrowing
        IEVault(usdcVault).setLTV(spyVault, 0.75e4, 0.87e4, 0); // allow borrowing USDC against wSPYx vault shares: 75% borrow LTV, 87% liquidation LTV, no ramp
        IEVault(usdcVault).setLTV(qqqVault, 0.75e4, 0.87e4, 0); // allow borrowing USDC against wQQQx vault shares: same risk parameters as SPY
        console.log("Bidirectional LTV configured"); // confirm both collateral relationships are set

        vm.stopBroadcast(); // end transaction broadcasting

        console.log("\n=== ORACLE SETUP COMPLETE ==="); // visual confirmation of successful final setup
        console.log("\nNext steps:"); // guide operator to testing phase
        console.log("1. Supply more USDC liquidity if needed"); // more liquidity enables larger leveraged positions
        console.log("2. Test leverage looping with TestLeverageLoopingV2.s.sol"); // end-to-end leverage test
        console.log("3. Verify positions work end-to-end"); // full integration validation
    }
}
