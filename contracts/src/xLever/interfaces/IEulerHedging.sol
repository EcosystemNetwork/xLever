// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "../libraries/DataTypes.sol";

interface IEulerHedging {
    event HedgeExecuted(int256 netExposure, uint256 collateralAdded, uint256 debtChanged);
    event LoopExecuted(bool isLong, uint256 iterations, uint256 finalLeverage);
    event PositionUnwound(uint256 collateralRemoved, uint256 debtRepaid);

    function hedge(int256 targetNetExposure) external returns (uint256 healthScore);
    function rebalance() external returns (uint256 newHealthScore);
    function getEulerPosition() external view returns (DataTypes.EulerPosition memory);
    function getHealthScore() external view returns (uint256 score);
    function unwindPosition(uint256 amount) external returns (uint256 received);
}
