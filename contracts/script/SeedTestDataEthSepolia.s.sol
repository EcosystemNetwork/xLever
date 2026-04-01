// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IVaultSimple {
    function deposit(uint256 amount, int32 leverageBps) external returns (uint256);
    function withdraw(uint256 amount) external returns (uint256);
    function depositJunior(uint256 amount) external returns (uint256 shares);
    function getPosition(address user) external view returns (DataTypes.Position memory);
    function getPoolState() external view returns (DataTypes.PoolState memory);
}

/// @notice Seeds test data on Ethereum Sepolia vaults
contract SeedTestDataEthSepolia is Script {
    // USDC on Eth Sepolia (same address convention)
    address constant USDC = 0x6b57475467cd854d36Be7FB614caDa5207838943;

    // Eth Sepolia vault addresses from CHAIN_CONFIGS[11155111]
    address constant QQQ_VAULT  = 0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6;
    address constant SPY_VAULT  = 0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228;
    address constant AAPL_VAULT = 0x31026d0de55Eb7523EeADeBB58fec60876235f09;
    address constant NVDA_VAULT = 0xe212D68B4e18747b2bAb256090c1d09Ab9A5371a;
    address constant TSLA_VAULT = 0x5b493Fc8B66A6827f7A1658BFcFA01693534326e;
    address constant SMH_VAULT  = 0x30A37d04aFa2648FA4427b13c7ca380490F46BaD;
    address constant SLV_VAULT  = 0x46ce7cd72763B784977349686AEA72B84d3F86B6;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        uint256 usdcBal = IERC20(USDC).balanceOf(deployer);
        console.log("=== xLever Eth Sepolia Test Data Seeder ===");
        console.log("Deployer:", deployer);
        console.log("USDC balance:", usdcBal);
        require(usdcBal >= 100e6, "Need at least 100 USDC");

        vm.startBroadcast(pk);

        // Senior deposits
        _deposit(QQQ_VAULT, 20e6, 20000, "QQQ 2x long");
        _deposit(SPY_VAULT, 15e6, 30000, "SPY 3x long");
        _deposit(AAPL_VAULT, 10e6, 15000, "AAPL 1.5x long");
        _deposit(NVDA_VAULT, 15e6, 40000, "NVDA 4x long");
        _deposit(TSLA_VAULT, 10e6, -20000, "TSLA 2x short");
        _deposit(SMH_VAULT, 10e6, -30000, "SMH 3x short");
        _deposit(SLV_VAULT, 10e6, 20000, "SLV 2x long");

        // Junior LP deposits
        console.log("\n--- Junior LP Deposits ---");
        IERC20(USDC).approve(QQQ_VAULT, 10e6);
        IVaultSimple(QQQ_VAULT).depositJunior(10e6);
        console.log("  QQQ junior: 10 USDC");

        IERC20(USDC).approve(SPY_VAULT, 10e6);
        IVaultSimple(SPY_VAULT).depositJunior(10e6);
        console.log("  SPY junior: 10 USDC");

        // Partial withdrawal
        console.log("\n--- Partial Withdrawals ---");
        IVaultSimple(QQQ_VAULT).withdraw(5e6);
        console.log("  QQQ: withdrew 5 USDC");

        vm.stopBroadcast();
        console.log("\n=== Eth Sepolia Seeding Complete ===");
    }

    function _deposit(address vault, uint256 amount, int32 leverageBps, string memory label) internal {
        IERC20(USDC).approve(vault, amount);
        IVaultSimple(vault).deposit(amount, leverageBps);
        console.log(string.concat("  ", label, ": deposited"));
    }
}
