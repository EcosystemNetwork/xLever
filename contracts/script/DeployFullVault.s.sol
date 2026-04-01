// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {Vault} from "../src/xLever/Vault.sol";
import {TWAPOracle} from "../src/xLever/modules/TWAPOracle.sol";
import {PositionModule} from "../src/xLever/modules/PositionModule.sol";
import {FeeEngine} from "../src/xLever/modules/FeeEngine.sol";
import {JuniorTranche} from "../src/xLever/modules/JuniorTranche.sol";
import {RiskModule} from "../src/xLever/modules/RiskModule.sol";

/// @title DeployFullVault
/// @notice Deploys canonical Vault instances for SPY and QQQ with pre-deployed modules
contract DeployFullVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Real token addresses on Ink Sepolia
        address usdc  = 0x6b57475467cd854d36Be7FB614caDa5207838943;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;

        // Shared Pyth infrastructure
        address pythAdapter = 0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f;

        // Pyth feed IDs
        bytes32 feedSPY = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5;
        bytes32 feedQQQ = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d;

        console.log("=== Deploying Canonical xLever Vaults ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy canonical SPY vault with pre-deployed modules
        console.log("\nDeploying wSPYx Vault...");
        address[5] memory spyModules = _deployModules(deployer);
        Vault spyVault = new Vault(usdc, wSPYx, deployer, deployer, pythAdapter, feedSPY, spyModules);
        _transferModuleOwnership(spyModules, address(spyVault));
        spyVault.initializeModules();
        console.log("wSPYx Vault:", address(spyVault));
        console.log("  Oracle:", address(spyVault.oracle()));
        console.log("  FeeEngine:", address(spyVault.feeEngine()));
        console.log("  JuniorTranche:", address(spyVault.juniorTranche()));
        console.log("  RiskModule:", address(spyVault.riskModule()));

        // Deploy canonical QQQ vault with pre-deployed modules
        console.log("\nDeploying wQQQx Vault...");
        address[5] memory qqqModules = _deployModules(deployer);
        Vault qqqVault = new Vault(usdc, wQQQx, deployer, deployer, pythAdapter, feedQQQ, qqqModules);
        _transferModuleOwnership(qqqModules, address(qqqVault));
        qqqVault.initializeModules();
        console.log("wQQQx Vault:", address(qqqVault));
        console.log("  Oracle:", address(qqqVault.oracle()));
        console.log("  FeeEngine:", address(qqqVault.feeEngine()));
        console.log("  JuniorTranche:", address(qqqVault.juniorTranche()));
        console.log("  RiskModule:", address(qqqVault.riskModule()));

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("\nUpdate frontend config:");
        console.log("wSPYx: '", address(spyVault), "',");
        console.log("wQQQx: '", address(qqqVault), "'");
    }

    function _transferModuleOwnership(address[5] memory modules, address vaultAddr) internal {
        TWAPOracle(modules[0]).setVault(vaultAddr);
        PositionModule(modules[1]).setVault(vaultAddr);
        FeeEngine(modules[2]).setVault(vaultAddr);
        JuniorTranche(modules[3]).setVault(vaultAddr);
        RiskModule(modules[4]).setVault(vaultAddr);
    }

    function _deployModules(address deployer) internal returns (address[5] memory modules) {
        TWAPOracle oracle = new TWAPOracle(deployer, deployer);
        PositionModule posModule = new PositionModule(address(oracle), deployer);
        FeeEngine fee = new FeeEngine(address(oracle), deployer);
        JuniorTranche junior = new JuniorTranche(deployer);
        RiskModule risk = new RiskModule(deployer);

        modules[0] = address(oracle);
        modules[1] = address(posModule);
        modules[2] = address(fee);
        modules[3] = address(junior);
        modules[4] = address(risk);
    }
}
