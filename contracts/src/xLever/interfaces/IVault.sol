// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "../libraries/DataTypes.sol";

interface IVault {
    // Events
    event Deposit(address indexed user, uint256 amount, int32 leverage, bool isSenior);
    event Withdraw(address indexed user, uint256 amount, uint256 pnl);
    event LeverageAdjusted(address indexed user, int32 oldLeverage, int32 newLeverage);
    event FeeCollected(address indexed user, uint256 amount, uint8 feeType);
    event FundingSettled(int256 rateBps, uint256 timestamp);
    event SlowWithdrawalQueued(address indexed user, uint256 amount, uint256 chunks);
    event ProtocolStateChanged(uint8 oldState, uint8 newState);

    // User functions
    function deposit(uint256 amount, int32 leverageBps) external returns (uint256 positionValue);
    function withdraw(uint256 amount) external returns (uint256 received);
    function adjustLeverage(int32 newLeverageBps) external;
    function getPosition(address user) external view returns (DataTypes.Position memory);
    function getPositionValue(address user) external view returns (uint256 value, int256 pnl);

    // Junior tranche functions
    function depositJunior(uint256 amount) external returns (uint256 shares);
    function withdrawJunior(uint256 shares) external returns (uint256 amount);
    function getJuniorValue() external view returns (uint256 totalValue, uint256 sharePrice);

    // View functions
    function getPoolState() external view returns (DataTypes.PoolState memory);
    function getCurrentTWAP() external view returns (uint128 twap, uint16 spreadBps);
    function getMaxLeverage() external view returns (int32 maxLeverageBps);
    function getFundingRate() external view returns (int256 rateBps);
    function getCarryRate() external view returns (uint256 annualBps);

    // Admin functions
    function pause() external;
    function unpause() external;
    function updateFeeConfig(DataTypes.FeeConfig calldata config) external;
}
