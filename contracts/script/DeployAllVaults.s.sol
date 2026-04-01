// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultSimple} from "../src/xLever/VaultSimple.sol";

/// @title DeployAllVaults
/// @notice Deploys VaultSimple instances for all 33 xLever assets
/// @dev Run: forge script script/DeployAllVaults.s.sol --rpc-url $INK_SEPOLIA_RPC --broadcast
contract DeployAllVaults is Script {

    struct AssetConfig {
        string symbol;
        address token;    // xStock token address (deploy placeholder if needed)
        bytes32 feedId;   // Pyth price feed ID
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address usdc = 0x6b57475467cd854d36Be7FB614caDa5207838943;

        // Existing xStock tokens
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;

        console.log("=== Deploying All 33 xLever Vaults ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // ── Already deployed (skip but log) ──
        console.log("\n-- Existing Vaults (skipping) --");
        console.log("QQQ  Vault: 0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6");
        console.log("SPY  Vault: 0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228");

        // ── Deploy remaining 31 vaults ──
        // Each asset needs an xStock token. For assets without deployed tokens,
        // we deploy a minimal placeholder so the vault has an asset address.
        // Replace these with real wrapped xStock tokens when available.

        console.log("\n-- Deploying New Vaults --");

        // Index ETFs (4 remaining)
        _deployVault(usdc, deployer, "VUG");
        _deployVault(usdc, deployer, "VGK");
        _deployVault(usdc, deployer, "VXUS");
        _deployVault(usdc, deployer, "SGOV");

        // Sector ETFs (4)
        _deployVault(usdc, deployer, "SMH");
        _deployVault(usdc, deployer, "XLE");
        _deployVault(usdc, deployer, "XOP");
        _deployVault(usdc, deployer, "ITA");

        // Mega-cap Tech (8)
        _deployVault(usdc, deployer, "AAPL");
        _deployVault(usdc, deployer, "NVDA");
        _deployVault(usdc, deployer, "TSLA");
        _deployVault(usdc, deployer, "DELL");
        _deployVault(usdc, deployer, "SMCI");
        _deployVault(usdc, deployer, "ANET");
        _deployVault(usdc, deployer, "VRT");
        _deployVault(usdc, deployer, "SNDK");

        // Semiconductors (4)
        _deployVault(usdc, deployer, "KLAC");
        _deployVault(usdc, deployer, "LRCX");
        _deployVault(usdc, deployer, "AMAT");
        _deployVault(usdc, deployer, "TER");

        // Energy & Infrastructure (6)
        _deployVault(usdc, deployer, "CEG");
        _deployVault(usdc, deployer, "GEV");
        _deployVault(usdc, deployer, "SMR");
        _deployVault(usdc, deployer, "ETN");
        _deployVault(usdc, deployer, "PWR");
        _deployVault(usdc, deployer, "APLD");

        // Commodities (3)
        _deployVault(usdc, deployer, "SLV");
        _deployVault(usdc, deployer, "PPLT");
        _deployVault(usdc, deployer, "PALL");

        // Crypto-adjacent (2)
        _deployVault(usdc, deployer, "STRK");
        _deployVault(usdc, deployer, "BTGO");

        vm.stopBroadcast();

        console.log("\n=== All 33 Vaults Deployed ===");
        console.log("Copy the vault addresses above into frontend/contracts.js VAULT_REGISTRY");
    }

    function _deployVault(address usdc, address deployer, string memory symbol) internal {
        // Deploy a VaultSimple using deployer as placeholder xStock token address.
        // In production, each asset needs its own ERC-20 xStock token deployed first.
        // The vault uses the asset address for identification, not for token transfers
        // (all deposits/withdrawals are in USDC).
        VaultSimple vault = new VaultSimple(usdc, deployer, deployer);
        console.log(string.concat(symbol, " Vault: "), address(vault));
    }
}
