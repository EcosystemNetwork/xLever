// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

library DataTypes {
    /// @notice User position with fixed-entry leverage
    struct Position {
        uint128 depositAmount;        // USDC deposited (6 decimals)
        int32 leverageBps;            // -40000 to +40000 (basis points, -4x to +4x)
        uint128 entryTWAP;            // TWAP at position open/adjust (8 decimals)
        uint64 lastFeeTimestamp;      // Last fee settlement time
        uint128 settledFees;          // Fees already deducted
        uint32 leverageLockExpiry;    // Earliest time to increase leverage (unix)
        bool isActive;                // Position exists
    }

    /// @notice Pool-wide state
    struct PoolState {
        uint128 totalSeniorDeposits;    // Total senior USDC
        uint128 totalJuniorDeposits;    // Total junior USDC
        uint128 insuranceFund;          // Protocol backstop reserve
        int256 netExposure;             // Net long/short in asset terms
        uint128 grossLongExposure;      // Total long notional
        uint128 grossShortExposure;     // Total short notional
        uint64 lastRebalanceTime;       // Last hedging sync
        uint32 currentMaxLeverageBps;   // Dynamic cap based on junior ratio
        int64 fundingRateBps;           // Current funding rate (signed)
        uint8 protocolState;            // 0=active, 1=stressed, 2=paused, 3=emergency
    }

    /// @notice Euler V2 position state
    struct EulerPosition {
        address collateralVault;        // EVK vault holding collateral
        address debtVault;              // EVK vault from which we borrow
        uint256 subAccountId;           // EVC sub-account (0-255) for isolation
        uint128 collateralShares;       // Shares in collateral vault
        uint128 debtAmount;             // Borrowed amount
        uint256 healthScore;            // Euler health score (>1e18 = safe)
        bool isActive;                  // Position open
    }

    /// @notice TWAP buffer with dynamic spread
    struct TWAPBuffer {
        uint128[75] prices;             // 15 min of 12-sec samples
        uint8 currentIndex;             // Circular buffer pointer
        uint128 runningSum;             // For O(1) average calculation
        uint64 lastUpdateTime;          // Staleness check
        uint128 lastSpotPrice;          // Latest spot for divergence check
        uint16 dynamicSpreadBps;        // Current spread based on divergence
    }

    /// @notice Circuit breaker state
    struct CircuitBreaker {
        uint256 dailyVolume;            // Rolling 24h notional volume
        uint256 dailyVolumeLimit;       // Max notional per day
        uint256 lastJuniorValue;        // Junior NAV 24h ago
        uint256 maxDrawdownBps;         // Max daily junior drawdown
        uint256 volatility24h;          // Realized volatility
        uint256 volatilityThresholdBps; // Pause if exceeded
        uint64 lastVolumeReset;         // Daily reset timestamp
        uint8 state;                    // 0=normal, 1=warning, 2=triggered
    }

    /// @notice Slow withdrawal queue entry
    struct SlowWithdrawal {
        address user;
        uint256 totalAmount;        // Total notional to unwind
        uint256 executedAmount;     // Amount unwound so far
        uint256 chunksRemaining;    // Number of execution chunks left
        uint64 nextExecutionTime;   // Earliest time for next chunk
        uint64 chunkInterval;       // Seconds between chunks (default: 15 min)
    }

    /// @notice Fee configuration
    struct FeeConfig {
        uint16 baseEntryFeeBps;         // Base entry fee (e.g., 8 bps = 0.08%)
        uint16 baseExitFeeBps;          // Base exit fee (e.g., 4 bps = 0.04%)
        uint16 protocolSpreadBps;       // Protocol spread on carry (e.g., 10 bps)
        uint16 maxFundingRateBps;       // Max funding rate per period (e.g., 5 bps)
        uint32 fundingInterval;         // Funding settlement interval (e.g., 8 hours)
        uint16 juniorFeeSplit;          // Junior tranche fee share (e.g., 7000 = 70%)
        uint16 insuranceFeeSplit;       // Insurance fund fee share (e.g., 2000 = 20%)
        uint16 treasuryFeeSplit;        // Treasury fee share (e.g., 1000 = 10%)
    }
}
