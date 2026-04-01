// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import shared structs so EulerPosition type is consistent across the codebase
import {DataTypes} from "../libraries/DataTypes.sol";

// Interface for the hedging module — defines how the vault interacts with Euler V2 for leverage
interface IEulerHedging {
    // Emitted when the hedge position is adjusted to match pool net exposure
    event HedgeExecuted(int256 netExposure, uint256 collateralAdded, uint256 debtChanged);
    // Emitted after a leverage loop completes — tracks iterations for gas monitoring
    event LoopExecuted(bool isLong, uint256 iterations, uint256 finalLeverage);
    // Emitted when a leveraged position is unwound — tracks collateral recovered and debt repaid
    event PositionUnwound(uint256 collateralRemoved, uint256 debtRepaid);

    // Adjust Euler position to hedge the pool's net exposure — called after deposits/withdrawals
    function hedge(int256 targetNetExposure) external returns (uint256 healthScore);
    // Re-balance existing Euler position to maintain target health — called by keepers
    function rebalance() external returns (uint256 newHealthScore);
    // Read current Euler position state — used by risk module for health monitoring
    function getEulerPosition() external view returns (DataTypes.EulerPosition memory);
    // Read Euler health score — used by risk module to trigger auto-deleverage if needed
    function getHealthScore() external view returns (uint256 score);
    // Partially unwind the Euler position — used during auto-deleverage cascade
    function unwindPosition(uint256 amount) external returns (uint256 received);
}
