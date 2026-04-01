// SPDX-License-Identifier: GPL-2.0-or-later // required license header for Euler-derived code compatibility
pragma solidity ^0.8.0; // Solidity 0.8+ for built-in overflow protection in LTV and interest calculations

import "forge-std/Script.sol"; // Foundry Script base for vm cheatcodes, console.log, and broadcast
import {GenericFactory} from "../src/GenericFactory/GenericFactory.sol"; // factory for creating vault proxies with metadata
import {IEVault} from "../src/EVault/IEVault.sol"; // EVault interface for governance calls (setIRM, setLTV, etc.)

contract DeployEulerVaults is Script { // deploys three Euler vaults (USDC, wSPYx, wQQQx) and configures cross-collateral LTV
    function run() external { // Foundry entry point called by `forge script`
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY"); // load deployer key from .env for signing
        address deployer = vm.addr(deployerPrivateKey); // derive deployer address for logging

        address evc = 0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c; // EVC on Ink Sepolia -- deployed in prior step
        address factory = 0xba1240B966E20E16ca32BBFc189528787794F2A9; // GenericFactory on Ink Sepolia -- creates vault proxies
        address evaultImpl = 0xd821A7D919e007b6b39925f672f1219dB4865Fba; // EVault implementation -- all proxies delegatecall into this
        address irm = 0xE91A4B01632a7D281fb3eB0E83Ad9D5F0305d48f; // IRMLinearKink -- interest rate model for all vaults

        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943; // USDC on Ink Sepolia -- lending/borrowing base asset
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e; // wrapped SP500 token -- leveraged trading asset
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9; // wrapped Nasdaq token -- leveraged trading asset

        console.log("=== Deploying Euler Vaults with 75% LTV ==="); // header including the key risk parameter
        console.log("Deployer:", deployer); // confirm deployer identity
        console.log("Factory:", factory); // confirm factory address
        console.log("EVault Implementation:", evaultImpl); // confirm implementation the factory will use

        vm.startBroadcast(deployerPrivateKey); // begin signing and broadcasting transactions

        console.log("\n--- Setting EVault implementation in factory ---"); // factory must know which implementation to clone
        GenericFactory(factory).setImplementation(evaultImpl); // register implementation in factory -- all subsequent createProxy calls use this
        console.log("Implementation set to:", evaultImpl); // confirm implementation was registered

        console.log("\n--- Deploying USDC Vault ---"); // USDC vault is the lending pool that leveraged traders borrow from
        bytes memory usdcMetadata = abi.encodePacked( // encode proxy metadata: 3 addresses packed into 60 bytes
            usdc, // asset: USDC is the underlying token
            address(0), // oracle: not set yet -- will be configured in ConfigureVaultOracles
            address(0) // unit of account: not set yet
        );
        address usdcVault = GenericFactory(factory).createProxy( // create USDC vault proxy via minimal clone
            address(0), // no salt -- deterministic address from factory nonce
            true, // upgradeable -- allows future implementation swaps
            usdcMetadata // metadata baked into proxy for initialization
        );
        console.log("USDC Vault created:", usdcVault); // log address for .env

        IEVault(usdcVault).setInterestRateModel(irm); // assign IRM so vault can calculate borrow interest
        IEVault(usdcVault).setMaxLiquidationDiscount(0.15e4); // 15% liquidation discount -- generous incentive for liquidators on testnet
        IEVault(usdcVault).setLiquidationCoolOffTime(1); // 1 second cool-off -- fast liquidation response, minimal MEV protection needed on testnet
        IEVault(usdcVault).setHookConfig(address(0), 0); // no hooks -- clean vault without custom interceptors
        IEVault(usdcVault).setCaps(0, 0); // no caps -- unlimited deposits and borrows for testnet

        console.log("\n--- Deploying wSPYx Vault ---"); // wSPYx vault holds SPY collateral for long positions
        bytes memory spyMetadata = abi.encodePacked( // encode proxy metadata for SPY vault
            wSPYx, // asset: wSPYx is the underlying token
            address(0), // oracle: not set yet
            address(0) // unit of account: not set yet
        );
        address spyVault = GenericFactory(factory).createProxy( // create wSPYx vault proxy
            address(0), // no salt
            true, // upgradeable
            spyMetadata // metadata with wSPYx as asset
        );
        console.log("wSPYx Vault created:", spyVault); // log address for .env

        IEVault(spyVault).setInterestRateModel(irm); // same IRM for consistent interest behavior across vaults
        IEVault(spyVault).setMaxLiquidationDiscount(0.15e4); // 15% liquidation discount -- matches USDC vault
        IEVault(spyVault).setLiquidationCoolOffTime(1); // 1 second cool-off for fast liquidation
        IEVault(spyVault).setHookConfig(address(0), 0); // no hooks
        IEVault(spyVault).setCaps(0, 0); // no caps for testnet

        console.log("\n--- Deploying wQQQx Vault ---"); // wQQQx vault holds QQQ collateral for Nasdaq positions
        bytes memory qqqMetadata = abi.encodePacked( // encode proxy metadata for QQQ vault
            wQQQx, // asset: wQQQx is the underlying token
            address(0), // oracle: not set yet
            address(0) // unit of account: not set yet
        );
        address qqqVault = GenericFactory(factory).createProxy( // create wQQQx vault proxy
            address(0), // no salt
            true, // upgradeable
            qqqMetadata // metadata with wQQQx as asset
        );
        console.log("wQQQx Vault created:", qqqVault); // log address for .env

        IEVault(qqqVault).setInterestRateModel(irm); // same IRM for consistent behavior
        IEVault(qqqVault).setMaxLiquidationDiscount(0.15e4); // 15% liquidation discount
        IEVault(qqqVault).setLiquidationCoolOffTime(1); // 1 second cool-off
        IEVault(qqqVault).setHookConfig(address(0), 0); // no hooks
        IEVault(qqqVault).setCaps(0, 0); // no caps for testnet

        console.log("\n--- Setting LTV: 75% borrow, 87% liquidation ---"); // configure cross-collateral relationships with 12% liquidation buffer

        IEVault(usdcVault).setLTV(spyVault, 0.75e4, 0.87e4, 0); // USDC vault accepts wSPYx vault shares: 75% borrow LTV, 87% liquidation threshold, no ramp delay
        console.log("USDC vault: wSPYx collateral (75% borrow, 87% liq)"); // confirm collateral relationship

        IEVault(usdcVault).setLTV(qqqVault, 0.75e4, 0.87e4, 0); // USDC vault accepts wQQQx vault shares: same risk parameters
        console.log("USDC vault: wQQQx collateral (75% borrow, 87% liq)"); // confirm collateral relationship

        IEVault(spyVault).setLTV(usdcVault, 0.75e4, 0.87e4, 0); // wSPYx vault accepts USDC vault shares: enables reverse leverage direction
        console.log("wSPYx vault: USDC collateral (75% borrow, 87% liq)"); // confirm bidirectional collateral

        IEVault(qqqVault).setLTV(usdcVault, 0.75e4, 0.87e4, 0); // wQQQx vault accepts USDC vault shares: enables short positions via QQQ
        console.log("wQQQx vault: USDC collateral (75% borrow, 87% liq)"); // confirm bidirectional collateral

        vm.stopBroadcast(); // end transaction broadcasting -- all deployments and configs submitted

        console.log("\n=== Deployment Complete ==="); // visual confirmation of successful deployment
        console.log("\nEuler Vaults:"); // header for vault address summary
        console.log("USDC_EVAULT=", usdcVault); // copy-paste env var for USDC vault
        console.log("WSPY_EVAULT=", spyVault); // copy-paste env var for SPY vault
        console.log("WQQQ_EVAULT=", qqqVault); // copy-paste env var for QQQ vault
        console.log("\nLTV Settings:"); // header for risk parameter summary
        console.log("  Borrow LTV: 75% (max leverage: 3x safe, 4x theoretical)"); // 75% LTV = 1/(1-0.75) = 4x max theoretical leverage
        console.log("  Liquidation LTV: 87% (12% volatility buffer)"); // 12% gap between borrow and liquidation protects against sudden price moves
        console.log("  Buffer: Positions liquidated only if debt > 87% of collateral"); // explanation of when liquidation triggers
    }
}
