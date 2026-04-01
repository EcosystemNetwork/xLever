// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

// VaultSimple interface (no Pyth oracle args)
interface IVaultSimple {
    function deposit(uint256 amount, int32 leverageBps) external returns (uint256);
    function withdraw(uint256 amount) external returns (uint256);
    function depositJunior(uint256 amount) external returns (uint256 shares);
    function withdrawJunior(uint256 shares) external returns (uint256 amount);
    function getPosition(address user) external view returns (DataTypes.Position memory);
    function getPoolState() external view returns (DataTypes.PoolState memory);
}

contract SeedTestData is Script {
    // ── Ink Sepolia addresses ──
    address constant USDC = 0x6b57475467cd854d36Be7FB614caDa5207838943;

    // Vault addresses from VAULT_REGISTRY
    address constant QQQ_VAULT  = 0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6;
    address constant SPY_VAULT  = 0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228;
    address constant VUG_VAULT  = 0x09F7D7717a67783298d5Ca6C0fe036C39951D337;
    address constant AAPL_VAULT = 0x7D2C5FA48954F601faF30ed4A1611150E7CA72b8;
    address constant NVDA_VAULT = 0x31026d0de55Eb7523EeADeBB58fec60876235f09;
    address constant TSLA_VAULT = 0xe212D68B4e18747b2bAb256090c1d09Ab9A5371a;
    address constant SMH_VAULT  = 0x30A37d04aFa2648FA4427b13c7ca380490F46BaD;
    address constant CEG_VAULT  = 0xCFd3631169Ba659744A55904774B03346795e1F1;
    address constant SLV_VAULT  = 0x594332f239Fe809Ccf6B3Dd791Eb8252A3efA38c;
    address constant STRK_VAULT = 0x5fcAbBc1e9ab0bEca3d6cd9EF0257F2369230D12;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        uint256 usdcBal = IERC20(USDC).balanceOf(deployer);
        console.log("=== xLever Test Data Seeder ===");
        console.log("Deployer:", deployer);
        console.log("USDC balance:", usdcBal);
        require(usdcBal >= 200e6, "Need at least 200 USDC to seed data");

        vm.startBroadcast(pk);

        // ─────────────────────────────────────────────────────
        // ROUND 1: Senior deposits (various leverage & directions)
        // ─────────────────────────────────────────────────────

        // QQQ: 25 USDC, 2x long
        _deposit(QQQ_VAULT, 25e6, 20000, "QQQ 2x long");

        // SPY: 20 USDC, 3x long
        _deposit(SPY_VAULT, 20e6, 30000, "SPY 3x long");

        // AAPL: 15 USDC, 1.5x long
        _deposit(AAPL_VAULT, 15e6, 15000, "AAPL 1.5x long");

        // NVDA: 20 USDC, 4x long
        _deposit(NVDA_VAULT, 20e6, 40000, "NVDA 4x long");

        // TSLA: 10 USDC, 2x short
        _deposit(TSLA_VAULT, 10e6, -20000, "TSLA 2x short");

        // SMH: 15 USDC, 3x short
        _deposit(SMH_VAULT, 15e6, -30000, "SMH 3x short");

        // VUG: 10 USDC, 1x long (no leverage)
        _deposit(VUG_VAULT, 10e6, 10000, "VUG 1x long");

        // CEG: 10 USDC, 2.5x long
        _deposit(CEG_VAULT, 10e6, 25000, "CEG 2.5x long");

        // SLV: 10 USDC, 2x long (commodity)
        _deposit(SLV_VAULT, 10e6, 20000, "SLV 2x long");

        // STRK: 10 USDC, 3x long (crypto-adjacent)
        _deposit(STRK_VAULT, 10e6, 30000, "STRK 3x long");

        // ─────────────────────────────────────────────────────
        // ROUND 2: Junior LP deposits (first-loss capital)
        // ─────────────────────────────────────────────────────

        console.log("\n--- Junior LP Deposits ---");

        IERC20(USDC).approve(QQQ_VAULT, 15e6);
        IVaultSimple(QQQ_VAULT).depositJunior(15e6);
        console.log("  QQQ junior: 15 USDC");

        IERC20(USDC).approve(SPY_VAULT, 10e6);
        IVaultSimple(SPY_VAULT).depositJunior(10e6);
        console.log("  SPY junior: 10 USDC");

        IERC20(USDC).approve(NVDA_VAULT, 10e6);
        IVaultSimple(NVDA_VAULT).depositJunior(10e6);
        console.log("  NVDA junior: 10 USDC");

        // ─────────────────────────────────────────────────────
        // ROUND 3: Partial withdrawals (creates withdrawal events)
        // ─────────────────────────────────────────────────────

        console.log("\n--- Partial Withdrawals ---");

        // Withdraw 5 USDC from QQQ position
        IVaultSimple(QQQ_VAULT).withdraw(5e6);
        console.log("  QQQ: withdrew 5 USDC");

        // Withdraw 5 USDC from SPY position
        IVaultSimple(SPY_VAULT).withdraw(5e6);
        console.log("  SPY: withdrew 5 USDC");

        // ─────────────────────────────────────────────────────
        // ROUND 4: Log final pool states
        // ─────────────────────────────────────────────────────

        console.log("\n--- Final Pool States ---");
        _logPool(QQQ_VAULT, "QQQ");
        _logPool(SPY_VAULT, "SPY");
        _logPool(NVDA_VAULT, "NVDA");
        _logPool(TSLA_VAULT, "TSLA");

        vm.stopBroadcast();

        console.log("\n=== Seeding Complete ===");
        console.log("Total USDC used: ~200");
        console.log("Senior positions: 10");
        console.log("Junior deposits: 3");
        console.log("Withdrawals: 2");
    }

    function _deposit(address vault, uint256 amount, int32 leverageBps, string memory label) internal {
        IERC20(USDC).approve(vault, amount);
        IVaultSimple(vault).deposit(amount, leverageBps);
        console.log(string.concat("  ", label, ": deposited"));
    }

    function _logPool(address vault, string memory name) internal view {
        DataTypes.PoolState memory pool = IVaultSimple(vault).getPoolState();
        console.log(string.concat("  ", name, ":"));
        console.log("    Senior TVL:", pool.totalSeniorDeposits);
        console.log("    Junior TVL:", pool.totalJuniorDeposits);
        console.log("    Max Leverage:", pool.currentMaxLeverageBps);
    }
}
