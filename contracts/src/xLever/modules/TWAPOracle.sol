// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import shared structs so TWAPBuffer type is consistent across the codebase
import {DataTypes} from "../libraries/DataTypes.sol";
// Import oracle interface to implement its required functions
import {ITWAPOracle} from "../interfaces/ITWAPOracle.sol";

/// @title TWAPOracle
/// @notice 15-minute TWAP oracle with dynamic spread pricing based on spot-TWAP divergence
// TWAP smoothing prevents single-block price manipulation from affecting PnL settlement
contract TWAPOracle is ITWAPOracle {
    // 75 samples at 12-second intervals = 15 minutes of price history
    uint256 constant BUFFER_SIZE = 75; // 15 min / 12 sec = 75 samples
    // Expected time between price updates — aligned with Ethereum block time
    uint256 constant SAMPLE_INTERVAL = 12 seconds;
    // Oracle is considered stale after 5 minutes without an update — triggers safety checks
    uint256 constant MAX_STALENESS = 5 minutes;
    // Spread scaling factor — each 1% divergence adds 50 bps of spread (manipulation protection)
    uint256 constant DIVERGENCE_SCALE = 50; // Multiplier per 1% divergence

    // Circular buffer holding price samples, running sum, and derived metrics
    DataTypes.TWAPBuffer public twapBuffer;
    // Address authorized to push price updates (typically the vault or a keeper)
    address public updater;
    // Vault address — also authorized to push updates as part of deposit/withdraw flows
    address public vault;
    // Number of price updates received — used to enforce minimum updates before trading
    uint8 public updateCount;

    // Only the designated updater or vault can push new prices — prevents unauthorized manipulation
    modifier onlyUpdater() {
        require(msg.sender == updater || msg.sender == vault, "Not authorized");
        // Continue executing the function body after the check passes
        _;
    }

    // Initialize oracle with authorized update addresses and set initial timestamp
    constructor(address _updater, address _vault) {
        // Store the updater address (keeper or vault) for access control
        updater = _updater;
        // Store the vault address as an alternative authorized updater
        vault = _vault;
        // Set initial update time so staleness check doesn't immediately trigger
        twapBuffer.lastUpdateTime = uint64(block.timestamp);
    }

    /// @notice Update TWAP with new spot price
    // Called on every Pyth update — pushes the new price into the circular buffer and recalculates spread
    function updatePrice(uint128 spotPrice) external onlyUpdater {
        // Reject zero prices which would corrupt the running sum and TWAP calculation
        require(spotPrice > 0, "Invalid price");

        // Get storage pointer to the buffer for efficient multi-field updates
        DataTypes.TWAPBuffer storage buffer = twapBuffer;

        // Save current index and the price it holds — we're about to overwrite it
        uint8 oldIndex = buffer.currentIndex;
        // Cache the old price at this slot for running sum adjustment
        uint128 oldPrice = buffer.prices[oldIndex];

        // Write new price into the current slot, replacing the oldest sample
        buffer.prices[oldIndex] = spotPrice;
        // Update running sum: subtract the evicted price, add the new one — O(1) TWAP update
        buffer.runningSum = buffer.runningSum - oldPrice + spotPrice;
        // Advance the circular buffer pointer, wrapping around at BUFFER_SIZE
        buffer.currentIndex = uint8((oldIndex + 1) % BUFFER_SIZE);
        // Record update timestamp for staleness detection
        buffer.lastUpdateTime = uint64(block.timestamp);
        // Cache the latest spot price for divergence calculation
        buffer.lastSpotPrice = spotPrice;

        // Increment update count (cap at 255 to prevent uint8 overflow)
        if (updateCount < 255) {
            updateCount++;
        }

        // Compute current TWAP as simple average of all samples in the buffer
        uint128 currentTWAP = buffer.runningSum / uint128(BUFFER_SIZE);
        // Measure how far spot has diverged from the smoothed TWAP (in basis points)
        uint256 divergenceBps = _calculateDivergence(spotPrice, currentTWAP);

        // Dynamic spread widens proportionally to divergence — protects against manipulation
        // At 0% divergence: 0 bps spread (no penalty)
        // At 1% divergence: 50 bps spread
        // At 2% divergence: 100 bps spread
        buffer.dynamicSpreadBps = uint16(divergenceBps * DIVERGENCE_SCALE / 100);

        // Emit event for off-chain monitoring of price updates and spread changes
        emit PriceUpdated(spotPrice, currentTWAP, buffer.dynamicSpreadBps);

        // Alert when divergence is abnormally high — may indicate manipulation or extreme volatility
        if (divergenceBps >= 100) { // >= 1%
            // Severity tiers: 1 (1-2%), 2 (2-3%), 3 (3%+) — for escalating response
            uint8 severity = divergenceBps >= 300 ? 3 : divergenceBps >= 200 ? 2 : 1;
            // Emit alert event for risk monitoring systems and keepers
            emit DivergenceAlert(divergenceBps, severity);
        }
    }

    /// @notice Get current TWAP
    // Returns the 15-minute time-weighted average — used as the fair price for PnL settlement
    function getTWAP() external view returns (uint128 twap) {
        // Simple average of all samples: total sum divided by number of samples
        return twapBuffer.runningSum / uint128(BUFFER_SIZE);
    }

    /// @notice Get latest spot price
    // Returns the most recent price pushed — used for divergence display in UI
    function getSpotPrice() external view returns (uint128 spot) {
        // Return cached spot price from the last updatePrice call
        return twapBuffer.lastSpotPrice;
    }

    /// @notice Get dynamic spread in basis points
    // Returns the current spread — used by fee engine to scale entry/exit fees
    function getDynamicSpread() external view returns (uint16 spreadBps) {
        // Return pre-calculated spread from the last updatePrice call
        return twapBuffer.dynamicSpreadBps;
    }

    /// @notice Get spot-TWAP divergence in basis points
    // Returns the current divergence — used by fee engine and UI for risk display
    function getDivergence() external view returns (uint256 divergenceBps) {
        // Recompute TWAP from running sum for a fresh divergence reading
        uint128 twap = twapBuffer.runningSum / uint128(BUFFER_SIZE);
        // Calculate and return divergence between cached spot and fresh TWAP
        return _calculateDivergence(twapBuffer.lastSpotPrice, twap);
    }

    /// @notice Minimum number of price updates required before TWAP is considered reliable
    uint8 constant MIN_UPDATE_COUNT = 5;

    /// @notice Check if oracle has received enough updates for reliable TWAP
    // Returns true if at least MIN_UPDATE_COUNT prices have been pushed — prevents trading on sparse data
    function hasSufficientUpdates() external view returns (bool) {
        return updateCount >= MIN_UPDATE_COUNT;
    }

    /// @notice Check if oracle is stale
    // Returns true if no update has been received within MAX_STALENESS — signals potential issue
    function isStale() external view returns (bool) {
        // Compare current time against last update plus staleness threshold
        return block.timestamp > twapBuffer.lastUpdateTime + MAX_STALENESS;
    }

    /// @notice Calculate divergence between spot and TWAP
    // Internal helper — returns absolute percentage difference in basis points
    function _calculateDivergence(uint128 spot, uint128 twap) internal pure returns (uint256 divergenceBps) {
        // Avoid division by zero when TWAP hasn't been initialized yet
        if (twap == 0) return 0;

        // Absolute difference between spot and TWAP — direction doesn't matter for spread
        uint256 diff = spot > twap ? spot - twap : twap - spot;
        // Convert to basis points: (diff / twap) * 10000
        return (diff * 10000) / twap;
    }

    /// @notice Initialize buffer with starting price
    // Must be called once after deployment to fill all 75 slots with a valid starting price
    function initializeBuffer(uint128 startPrice) external onlyUpdater {
        // Prevent re-initialization which would corrupt existing TWAP history
        require(twapBuffer.runningSum == 0, "Already initialized");

        // Fill all buffer slots with the starting price so TWAP is immediately valid
        for (uint256 i = 0; i < BUFFER_SIZE; i++) {
            twapBuffer.prices[i] = startPrice;
        }
        // Set running sum to startPrice * 75 so TWAP = startPrice from the first read
        twapBuffer.runningSum = startPrice * uint128(BUFFER_SIZE);
        // Cache the starting price as the initial spot price
        twapBuffer.lastSpotPrice = startPrice;
        // Record initialization time so staleness check starts from now
        twapBuffer.lastUpdateTime = uint64(block.timestamp);
    }
}
