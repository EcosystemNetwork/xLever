// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultSimple} from "../src/xLever/VaultSimple.sol";

/// @title DeployMainnet
/// @notice Deploys xLever VaultSimple instances to Ethereum mainnet
/// @dev Run: forge script script/DeployMainnet.s.sol --rpc-url $ETH_MAINNET_RPC --broadcast --verify
///
/// Prerequisites:
///   - ETH_MAINNET_RPC env var set (Alchemy/Infura endpoint)
///   - PRIVATE_KEY env var set (deployer wallet with ETH for gas)
///   - ETHERSCAN_API_KEY env var set (for contract verification)
///
/// Euler V2 canonical addresses on Ethereum mainnet:
///   EVC:             0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383
///   eVaultFactory:   0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e
///   ProtocolConfig:  0x4cD6BF1D183264c02Be7748Cb5cd3A47d013351b
///   Permit2:         0x000000000022D473030F116dDEE9F6B43aC78BA3

contract DeployMainnet is Script {

    // ── Mainnet token addresses ──
    address constant USDC   = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant WETH   = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDT   = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant wstETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;

    // ── Pyth mainnet ──
    address constant PYTH   = 0x4305FB66699C3B2702D4d05CF36551390A4c69C6;

    // ── Euler V2 mainnet ──
    address constant EVC    = 0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY_HEX", uint256(0));
        if (deployerPrivateKey == 0) {
            string memory pkStr = vm.envString("PRIVATE_KEY");
            deployerPrivateKey = vm.parseUint(string.concat("0x", pkStr));
        }
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== xLever Mainnet Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        require(block.chainid == 1, "Not on Ethereum mainnet");

        vm.startBroadcast(deployerPrivateKey);

        // ── Core asset vaults ──
        console.log("\n-- Deploying Core Vaults --");

        VaultSimple qqqVault = new VaultSimple(USDC, deployer, deployer);
        console.log("QQQ  Vault:", address(qqqVault));

        VaultSimple spyVault = new VaultSimple(USDC, deployer, deployer);
        console.log("SPY  Vault:", address(spyVault));

        // ── Index ETFs ──
        console.log("\n-- Index ETFs --");
        _deployVault(USDC, deployer, "VUG");
        _deployVault(USDC, deployer, "VGK");
        _deployVault(USDC, deployer, "VXUS");
        _deployVault(USDC, deployer, "SGOV");

        // ── Sector ETFs ──
        console.log("\n-- Sector ETFs --");
        _deployVault(USDC, deployer, "SMH");
        _deployVault(USDC, deployer, "XLE");
        _deployVault(USDC, deployer, "XOP");
        _deployVault(USDC, deployer, "ITA");

        // ── Mega-cap Tech ──
        console.log("\n-- Mega-cap Tech --");
        _deployVault(USDC, deployer, "AAPL");
        _deployVault(USDC, deployer, "NVDA");
        _deployVault(USDC, deployer, "TSLA");
        _deployVault(USDC, deployer, "DELL");
        _deployVault(USDC, deployer, "SMCI");
        _deployVault(USDC, deployer, "ANET");
        _deployVault(USDC, deployer, "VRT");
        _deployVault(USDC, deployer, "SNDK");

        // ── Semiconductors ──
        console.log("\n-- Semiconductors --");
        _deployVault(USDC, deployer, "KLAC");
        _deployVault(USDC, deployer, "LRCX");
        _deployVault(USDC, deployer, "AMAT");
        _deployVault(USDC, deployer, "TER");

        // ── Energy & Infrastructure ──
        console.log("\n-- Energy & Infrastructure --");
        _deployVault(USDC, deployer, "CEG");
        _deployVault(USDC, deployer, "GEV");
        _deployVault(USDC, deployer, "SMR");
        _deployVault(USDC, deployer, "ETN");
        _deployVault(USDC, deployer, "PWR");
        _deployVault(USDC, deployer, "APLD");

        // ── Commodities ──
        console.log("\n-- Commodities --");
        _deployVault(USDC, deployer, "SLV");
        _deployVault(USDC, deployer, "PPLT");
        _deployVault(USDC, deployer, "PALL");

        // ── Crypto-adjacent ──
        console.log("\n-- Crypto-adjacent --");
        _deployVault(USDC, deployer, "STRK");
        _deployVault(USDC, deployer, "BTGO");

        vm.stopBroadcast();

        console.log("\n=== Mainnet Deployment Complete ===");
        console.log("Next steps:");
        console.log("  1. Copy vault addresses to frontend/contracts.js VAULT_REGISTRY");
        console.log("  2. Update frontend/lending-adapters.js EULER_ADDRESSES[ethereum]");
        console.log("  3. Verify contracts on Etherscan");
        console.log("  4. Deploy PythOracleAdapter pointing to mainnet Pyth:", PYTH);
    }

    function _deployVault(address usdc, address deployer, string memory symbol) internal {
        VaultSimple vault = new VaultSimple(usdc, deployer, deployer);
        console.log(string.concat(symbol, " Vault: "), address(vault));
    }
}
