// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import shared structs so return types and parameters are ABI-compatible across contracts
import {DataTypes} from "../libraries/DataTypes.sol";

// Main vault interface — defines the complete public API for xLever vaults
interface IVault {
    // Events
    // Emitted on both senior and junior deposits — isSenior flag distinguishes the two
    event Deposit(address indexed user, uint256 amount, int32 leverage, bool isSenior);
    // Emitted on withdrawal — includes PnL for off-chain profit tracking
    event Withdraw(address indexed user, uint256 amount, uint256 pnl);
    // Emitted when a user changes their leverage multiplier on an existing position
    event LeverageAdjusted(address indexed user, int32 oldLeverage, int32 newLeverage);
    // Emitted when fees are collected — feeType distinguishes entry/exit/carry/funding
    event FeeCollected(address indexed user, uint256 amount, uint8 feeType);
    // Emitted when periodic funding is settled between longs and shorts
    event FundingSettled(int256 rateBps, uint256 timestamp);
    // Emitted when a large withdrawal enters the slow-withdrawal queue for chunked execution
    event SlowWithdrawalQueued(address indexed user, uint256 amount, uint256 chunks);
    // Emitted when the protocol transitions between active/stressed/paused/emergency states
    event ProtocolStateChanged(uint8 oldState, uint8 newState);

    // User functions — all write paths accept Pyth priceUpdateData to ensure fresh prices
    // Open a leveraged position by depositing USDC — returns net position value after fees
    function deposit(uint256 amount, int32 leverageBps, bytes[] calldata priceUpdateData) external payable returns (uint256 positionValue);
    // Close position and withdraw USDC — returns net amount received after exit fees
    function withdraw(uint256 amount, uint256 minReceived, bytes[] calldata priceUpdateData) external payable returns (uint256 received);
    // Change leverage on an existing position without depositing or withdrawing
    function adjustLeverage(int32 newLeverageBps, bytes[] calldata priceUpdateData) external payable;
    // Read a user's full position struct — used by UI and other contracts
    function getPosition(address user) external view returns (DataTypes.Position memory);
    // Read a user's current position value and unrealized PnL
    function getPositionValue(address user) external view returns (uint256 value, int256 pnl);

    // Junior tranche functions — for first-loss capital providers
    // Deposit USDC into junior tranche and receive proportional shares
    function depositJunior(uint256 amount) external returns (uint256 shares);
    // Redeem junior shares for proportional USDC (may be less if losses were absorbed)
    function withdrawJunior(uint256 shares) external returns (uint256 amount);
    // Read junior tranche total value and per-share price
    function getJuniorValue() external view returns (uint256 totalValue, uint256 sharePrice);

    // Oracle — allows keepers to push price updates without a trade
    function updateOracle(bytes[] calldata priceUpdateData) external payable;

    // View functions — for UI, dashboards, and off-chain monitoring
    // Read full pool state including deposits, exposures, and protocol status
    function getPoolState() external view returns (DataTypes.PoolState memory);
    // Read current TWAP price and dynamic spread
    function getCurrentTWAP() external view returns (uint128 twap, uint16 spreadBps);
    // Read current dynamic leverage cap based on junior ratio
    function getMaxLeverage() external view returns (int32 maxLeverageBps);
    // Read current funding rate reflecting long/short imbalance
    function getFundingRate() external view returns (int256 rateBps);
    // Read annualized carry rate passed through from Euler borrowing costs
    function getCarryRate() external view returns (uint256 annualBps);

    // Admin functions — restricted to vault admin
    // Emergency pause — stops deposits and leverage adjustments
    function pause() external;
    // Resume normal operations after emergency resolution
    function unpause() external;
    // Update fee parameters without redeploying the vault
    function updateFeeConfig(DataTypes.FeeConfig calldata config) external;
}
