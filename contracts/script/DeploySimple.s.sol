// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {Vault} from "../src/xLever/Vault.sol";
import {TWAPOracle} from "../src/xLever/modules/TWAPOracle.sol";
import {PositionModule} from "../src/xLever/modules/PositionModule.sol";
import {FeeEngine} from "../src/xLever/modules/FeeEngine.sol";
import {JuniorTranche} from "../src/xLever/modules/JuniorTranche.sol";
import {RiskModule} from "../src/xLever/modules/RiskModule.sol";

/// @title DeploySimple
/// @notice Deploys the canonical modular Vault with pre-deployed modules.
///         Modules are deployed separately to keep Vault bytecode under the EVM size limit.
contract DeploySimple is Script {
    function run() external {
        // Token addresses on Ink Sepolia
        address usdc  = 0xFabab97dCE620294D2B0b0e46C68964e326300Ac;
        address wSPYx = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;
        address wQQQx = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;

        // Shared Pyth infrastructure on Ink Sepolia
        address pythAdapter = 0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f;

        // Pyth feed IDs
        bytes32 feedSPY = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5;
        bytes32 feedQQQ = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d;

        console.log("=== Deploying Canonical Vault (modular, pre-deployed modules) ===");
        console.log("Deployer:", msg.sender);

        vm.startBroadcast();

        // --- Deploy SPY vault with its own module set ---
        address[5] memory spyModules = _deployModules(msg.sender);
        Vault spyVault = new Vault(usdc, wSPYx, msg.sender, msg.sender, pythAdapter, feedSPY, spyModules);
        _transferModuleOwnership(spyModules, address(spyVault));
        spyVault.initializeModules();
        console.log("\nwSPYx Vault:", address(spyVault));
        console.log("  Oracle:", spyModules[0]);
        console.log("  PositionModule:", spyModules[1]);
        console.log("  FeeEngine:", spyModules[2]);
        console.log("  JuniorTranche:", spyModules[3]);
        console.log("  RiskModule:", spyModules[4]);

        // --- Deploy QQQ vault with its own module set ---
        address[5] memory qqqModules = _deployModules(msg.sender);
        Vault qqqVault = new Vault(usdc, wQQQx, msg.sender, msg.sender, pythAdapter, feedQQQ, qqqModules);
        _transferModuleOwnership(qqqModules, address(qqqVault));
        qqqVault.initializeModules();
        console.log("\nwQQQx Vault:", address(qqqVault));
        console.log("  Oracle:", qqqModules[0]);
        console.log("  PositionModule:", qqqModules[1]);
        console.log("  FeeEngine:", qqqModules[2]);
        console.log("  JuniorTranche:", qqqModules[3]);
        console.log("  RiskModule:", qqqModules[4]);

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("SPY_VAULT=", address(spyVault));
        console.log("QQQ_VAULT=", address(qqqVault));
    }

    /// @dev Transfer module ownership from deployer to the vault contract.
    ///      Called by deployer EOA, so msg.sender matches the modules' initial vault address.
    function _transferModuleOwnership(address[5] memory modules, address vaultAddr) internal {
        TWAPOracle(modules[0]).setVault(vaultAddr);
        PositionModule(modules[1]).setVault(vaultAddr);
        FeeEngine(modules[2]).setVault(vaultAddr);
        JuniorTranche(modules[3]).setVault(vaultAddr);
        RiskModule(modules[4]).setVault(vaultAddr);
    }

    /// @dev Deploy all 5 xLever modules for a single vault.
    ///      Modules are initially owned by the deployer. The Vault constructor
    ///      calls setVault() on each module to transfer ownership to itself.
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
