// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {VaultFactory} from "../src/xLever/VaultFactory.sol";

/// @title DeployAllVaults
/// @notice Deploys VaultFactory + creates canonical Vault instances for all 33 xLever assets
/// @dev Replaces the former VaultSimple batch deployment.
///      Run: forge script script/DeployAllVaults.s.sol --rpc-url $INK_SEPOLIA_RPC --broadcast
contract DeployAllVaults is Script {

    struct AssetConfig {
        string symbol;
        address token;
        bytes32 feedId;
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address usdc = 0xFabab97dCE620294D2B0b0e46C68964e326300Ac;
        address pythAdapter = 0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f;

        // Existing xStock token addresses
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;

        // Pyth feed IDs for core assets
        bytes32 feedQQQ = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d;
        bytes32 feedSPY = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5;
        bytes32 feedAAPL = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688;
        bytes32 feedNVDA = 0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593;
        bytes32 feedTSLA = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;
        bytes32 feedETH  = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;

        console.log("=== Deploying All xLever Canonical Vaults via VaultFactory ===");
        console.log("Deployer:", deployer);
        console.log("PythAdapter:", pythAdapter);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy VaultFactory
        VaultFactory factory = new VaultFactory(usdc, deployer, deployer, pythAdapter);
        console.log("\nVaultFactory:", address(factory));

        // Deploy core vaults with real Pyth feeds
        console.log("\n-- Core Vaults (real Pyth feeds) --");
        address qqqVault = factory.createVault(wQQQx, feedQQQ);
        console.log("QQQ  Vault:", qqqVault);

        address spyVault = factory.createVault(wSPYx, feedSPY);
        console.log("SPY  Vault:", spyVault);

        // Deploy remaining vaults using deployer as placeholder token address.
        // Each asset needs its own ERC-20 xStock token deployed first in production.
        // The feedId uses a placeholder (feedETH) for assets without dedicated Pyth feeds yet.
        // Replace with real feed IDs when Pyth publishes them.
        console.log("\n-- Additional Vaults (placeholder tokens, update feed IDs before production) --");

        // Index ETFs
        _createVault(factory, deployer, "VUG",  feedETH);
        _createVault(factory, deployer, "VGK",  feedETH);
        _createVault(factory, deployer, "VXUS", feedETH);
        _createVault(factory, deployer, "SGOV", feedETH);

        // Sector ETFs
        _createVault(factory, deployer, "SMH",  feedETH);
        _createVault(factory, deployer, "XLE",  feedETH);
        _createVault(factory, deployer, "XOP",  feedETH);
        _createVault(factory, deployer, "ITA",  feedETH);

        // Mega-cap Tech
        _createVault(factory, deployer, "AAPL", feedAAPL);
        _createVault(factory, deployer, "NVDA", feedNVDA);
        _createVault(factory, deployer, "TSLA", feedTSLA);
        _createVault(factory, deployer, "DELL", feedETH);
        _createVault(factory, deployer, "SMCI", feedETH);
        _createVault(factory, deployer, "ANET", feedETH);
        _createVault(factory, deployer, "VRT",  feedETH);
        _createVault(factory, deployer, "SNDK", feedETH);

        // Semiconductors
        _createVault(factory, deployer, "KLAC", feedETH);
        _createVault(factory, deployer, "LRCX", feedETH);
        _createVault(factory, deployer, "AMAT", feedETH);
        _createVault(factory, deployer, "TER",  feedETH);

        // Energy & Infrastructure
        _createVault(factory, deployer, "CEG",  feedETH);
        _createVault(factory, deployer, "GEV",  feedETH);
        _createVault(factory, deployer, "SMR",  feedETH);
        _createVault(factory, deployer, "ETN",  feedETH);
        _createVault(factory, deployer, "PWR",  feedETH);
        _createVault(factory, deployer, "APLD", feedETH);

        // Commodities
        _createVault(factory, deployer, "SLV",  feedETH);
        _createVault(factory, deployer, "PPLT", feedETH);
        _createVault(factory, deployer, "PALL", feedETH);

        // Crypto-adjacent
        _createVault(factory, deployer, "STRK", feedETH);
        _createVault(factory, deployer, "BTGO", feedETH);

        vm.stopBroadcast();

        console.log("\n=== All 33 Canonical Vaults Deployed ===");
        console.log("VaultFactory:", address(factory));
        console.log("Total vaults:", factory.vaultCount());
        console.log("\nCopy vault addresses into frontend/contracts.js VAULT_REGISTRY");
    }

    function _createVault(
        VaultFactory factory,
        address,
        string memory symbol,
        bytes32 feedId_
    ) internal {
        // Derive a unique placeholder token address from the symbol hash
        // so VaultFactory doesn't reject duplicates. Replace with real
        // ERC-20 xStock tokens when available.
        address placeholderToken = address(uint160(uint256(keccak256(abi.encodePacked("xLever:", symbol)))));
        address vault = factory.createVault(placeholderToken, feedId_);
        console.log(string.concat(symbol, " Vault: "), vault);
    }
}
