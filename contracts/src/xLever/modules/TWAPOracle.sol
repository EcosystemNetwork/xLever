// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "../libraries/DataTypes.sol";
import {ITWAPOracle} from "../interfaces/ITWAPOracle.sol";

/// @title TWAPOracle
/// @notice 15-minute TWAP oracle with dynamic spread pricing based on spot-TWAP divergence
contract TWAPOracle is ITWAPOracle {
    uint256 constant BUFFER_SIZE = 75; // 15 min / 12 sec = 75 samples
    uint256 constant SAMPLE_INTERVAL = 12 seconds;
    uint256 constant MAX_STALENESS = 5 minutes;
    uint256 constant DIVERGENCE_SCALE = 50; // Multiplier per 1% divergence

    DataTypes.TWAPBuffer public twapBuffer;
    address public updater;
    address public vault;

    modifier onlyUpdater() {
        require(msg.sender == updater || msg.sender == vault, "Not authorized");
        _;
    }

    constructor(address _updater, address _vault) {
        updater = _updater;
        vault = _vault;
        twapBuffer.lastUpdateTime = uint64(block.timestamp);
    }

    /// @notice Update TWAP with new spot price
    function updatePrice(uint128 spotPrice) external onlyUpdater {
        require(spotPrice > 0, "Invalid price");
        
        DataTypes.TWAPBuffer storage buffer = twapBuffer;
        
        // Update circular buffer
        uint8 oldIndex = buffer.currentIndex;
        uint128 oldPrice = buffer.prices[oldIndex];
        
        buffer.prices[oldIndex] = spotPrice;
        buffer.runningSum = buffer.runningSum - oldPrice + spotPrice;
        buffer.currentIndex = uint8((oldIndex + 1) % BUFFER_SIZE);
        buffer.lastUpdateTime = uint64(block.timestamp);
        buffer.lastSpotPrice = spotPrice;
        
        // Calculate dynamic spread based on divergence
        uint128 currentTWAP = buffer.runningSum / uint128(BUFFER_SIZE);
        uint256 divergenceBps = _calculateDivergence(spotPrice, currentTWAP);
        
        // Dynamic spread: base + (divergence * scale)
        // At 0% divergence: 0 bps
        // At 1% divergence: 50 bps
        // At 2% divergence: 100 bps
        buffer.dynamicSpreadBps = uint16(divergenceBps * DIVERGENCE_SCALE / 100);
        
        emit PriceUpdated(spotPrice, currentTWAP, buffer.dynamicSpreadBps);
        
        // Alert on high divergence
        if (divergenceBps >= 100) { // >= 1%
            uint8 severity = divergenceBps >= 300 ? 3 : divergenceBps >= 200 ? 2 : 1;
            emit DivergenceAlert(divergenceBps, severity);
        }
    }

    /// @notice Get current TWAP
    function getTWAP() external view returns (uint128 twap) {
        return twapBuffer.runningSum / uint128(BUFFER_SIZE);
    }

    /// @notice Get latest spot price
    function getSpotPrice() external view returns (uint128 spot) {
        return twapBuffer.lastSpotPrice;
    }

    /// @notice Get dynamic spread in basis points
    function getDynamicSpread() external view returns (uint16 spreadBps) {
        return twapBuffer.dynamicSpreadBps;
    }

    /// @notice Get spot-TWAP divergence in basis points
    function getDivergence() external view returns (uint256 divergenceBps) {
        uint128 twap = twapBuffer.runningSum / uint128(BUFFER_SIZE);
        return _calculateDivergence(twapBuffer.lastSpotPrice, twap);
    }

    /// @notice Check if oracle is stale
    function isStale() external view returns (bool) {
        return block.timestamp > twapBuffer.lastUpdateTime + MAX_STALENESS;
    }

    /// @notice Calculate divergence between spot and TWAP
    function _calculateDivergence(uint128 spot, uint128 twap) internal pure returns (uint256 divergenceBps) {
        if (twap == 0) return 0;
        
        uint256 diff = spot > twap ? spot - twap : twap - spot;
        return (diff * 10000) / twap;
    }

    /// @notice Initialize buffer with starting price
    function initializeBuffer(uint128 startPrice) external onlyUpdater {
        require(twapBuffer.runningSum == 0, "Already initialized");
        
        for (uint256 i = 0; i < BUFFER_SIZE; i++) {
            twapBuffer.prices[i] = startPrice;
        }
        twapBuffer.runningSum = startPrice * uint128(BUFFER_SIZE);
        twapBuffer.lastSpotPrice = startPrice;
        twapBuffer.lastUpdateTime = uint64(block.timestamp);
    }
}
