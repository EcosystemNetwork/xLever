// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {PythOracleAdapter} from "../src/xLever/modules/PythOracleAdapter.sol";
import {Vault} from "../src/xLever/Vault.sol";
import {TWAPOracle} from "../src/xLever/modules/TWAPOracle.sol";
import {PositionModule} from "../src/xLever/modules/PositionModule.sol";
import {FeeEngine} from "../src/xLever/modules/FeeEngine.sol";
import {JuniorTranche} from "../src/xLever/modules/JuniorTranche.sol";
import {RiskModule} from "../src/xLever/modules/RiskModule.sol";

/// @title DeployPythAndVault
/// @notice Deploys PythOracleAdapter + QQQ Vault + SPY Vault to Ink Sepolia
contract DeployPythAndVault is Script {

    address constant PYTH      = 0x2880aB155794e7179c9eE2e38200202908C17B43;
    address constant USDC      = 0x6b57475467cd854d36Be7FB614caDa5207838943;
    address constant WQQQ      = 0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9;
    address constant WSPY      = 0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e;

    bytes32 constant FEED_QQQ = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d;
    bytes32 constant FEED_SPY = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5;

    function run() external {
        uint256 deployerPK = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPK);

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPK);

        PythOracleAdapter adapter = new PythOracleAdapter(PYTH, deployer);
        console.log("PythOracleAdapter:", address(adapter));

        // Deploy QQQ vault with pre-deployed modules
        address[5] memory qqqModules = _deployModules(deployer);
        Vault qqqVault = new Vault(USDC, WQQQ, deployer, deployer, address(adapter), FEED_QQQ, qqqModules);
        _transferModuleOwnership(qqqModules, address(qqqVault));
        qqqVault.initializeModules();
        console.log("QQQ Vault:", address(qqqVault));

        // Deploy SPY vault with pre-deployed modules
        address[5] memory spyModules = _deployModules(deployer);
        Vault spyVault = new Vault(USDC, WSPY, deployer, deployer, address(adapter), FEED_SPY, spyModules);
        _transferModuleOwnership(spyModules, address(spyVault));
        spyVault.initializeModules();
        console.log("SPY Vault:", address(spyVault));

        adapter.setVault(address(qqqVault));

        // Initialize TWAP buffers with starting prices (8 decimals)
        uint128 QQQ_START_PRICE = 48000000000; // $480.00
        uint128 SPY_START_PRICE = 53000000000; // $530.00
        qqqVault.initializeOracle(QQQ_START_PRICE);
        spyVault.initializeOracle(SPY_START_PRICE);

        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("PythOracleAdapter:", address(adapter));
        console.log("QQQ Vault:        ", address(qqqVault));
        console.log("SPY Vault:        ", address(spyVault));
        console.log("");
        console.log("TWAP buffers initialized:");
        console.log("  QQQ start price: $480.00");
        console.log("  SPY start price: $530.00");
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
