// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Library pattern — holds only struct definitions, deployed once and shared across all contracts
library DataTypes {
    /// @notice User position with fixed-entry leverage
    // Represents a single user's leveraged position in the vault
    struct Position {
        // The USDC principal the user deposited (after entry fees) — basis for PnL calculation
        uint128 depositAmount;        // USDC deposited (6 decimals)
        // Signed leverage in basis points — positive for long, negative for short (-4x to +4x)
        int32 leverageBps;            // -40000 to +40000 (basis points, -4x to +4x)
        // TWAP price at position open — locked at entry so PnL = deposit * leverage * (current/entry - 1)
        uint128 entryTWAP;            // TWAP at position open/adjust (8 decimals)
        // Timestamp of last fee settlement — used to calculate time-accrued carry and funding fees
        uint64 lastFeeTimestamp;      // Last fee settlement time
        // Cumulative fees already deducted from this position — subtracted from gross PnL
        uint128 settledFees;          // Fees already deducted
        // Cooldown timer preventing rapid leverage increases — anti-manipulation measure
        uint32 leverageLockExpiry;    // Earliest time to increase leverage (unix)
        // Whether this position slot is occupied — false means deleted/never opened
        bool isActive;                // Position exists
    }

    /// @notice Pool-wide state
    // Aggregated accounting for the entire vault — drives risk, hedging, and fee calculations
    struct PoolState {
        // Total USDC from leveraged (senior) depositors — numerator for senior share of pool
        uint128 totalSeniorDeposits;    // Total senior USDC
        // Total USDC from first-loss (junior) depositors — used to calculate junior ratio
        uint128 totalJuniorDeposits;    // Total junior USDC
        // Protocol backstop reserve — accumulated from fee splits, used in extreme loss scenarios
        uint128 insuranceFund;          // Protocol backstop reserve
        // Signed net directional exposure — determines how much Euler hedging is needed
        int256 netExposure;             // Net long/short in asset terms
        // Sum of all long notional — used with grossShort to calculate funding rate denominator
        uint128 grossLongExposure;      // Total long notional
        // Sum of all short notional — used with grossLong to calculate funding rate denominator
        uint128 grossShortExposure;     // Total short notional
        // Timestamp of last Euler hedge rebalance — used to detect stale hedges
        uint64 lastRebalanceTime;       // Last hedging sync
        // Dynamic leverage cap — lowered when junior ratio is thin to protect first-loss buffer
        uint32 currentMaxLeverageBps;   // Dynamic cap based on junior ratio
        // Current funding rate — positive means longs pay shorts, negative means shorts pay longs
        int64 fundingRateBps;           // Current funding rate (signed)
        // Protocol operating state — governs which operations are permitted
        uint8 protocolState;            // 0=active, 1=stressed, 2=paused, 3=emergency
    }

    /// @notice Euler V2 position state
    // Tracks the vault's leveraged position on Euler V2 used for hedging net exposure
    struct EulerPosition {
        // EVK vault where collateral is deposited — earns yield while backing borrows
        address collateralVault;        // EVK vault holding collateral
        // EVK vault from which we borrow — the borrowed asset is sold/bought for hedging
        address debtVault;              // EVK vault from which we borrow
        // EVC sub-account ID (0-255) — isolates this vault's Euler position from others
        uint256 subAccountId;           // EVC sub-account (0-255) for isolation
        // Shares held in the collateral vault — redeemable for underlying collateral
        uint128 collateralShares;       // Shares in collateral vault
        // Outstanding borrowed amount — must be repaid before collateral can be fully withdrawn
        uint128 debtAmount;             // Borrowed amount
        // Euler health score — ratio of collateral to debt; >1e18 means safe from liquidation
        uint256 healthScore;            // Euler health score (>1e18 = safe)
        // Whether an Euler position is currently open — false means no active hedge
        bool isActive;                  // Position open
    }

    /// @notice TWAP buffer with dynamic spread
    // Circular buffer that stores 15 minutes of price samples for time-weighted averaging
    struct TWAPBuffer {
        // Fixed-size array of 75 price samples — 15 min / 12 sec per block = 75 slots
        uint128[75] prices;             // 15 min of 12-sec samples
        // Current write index in the circular buffer — wraps around at 75
        uint8 currentIndex;             // Circular buffer pointer
        // Running sum of all prices in buffer — enables O(1) average: TWAP = sum / 75
        uint128 runningSum;             // For O(1) average calculation
        // Timestamp of most recent price update — used for staleness detection
        uint64 lastUpdateTime;          // Staleness check
        // Most recent spot price — used to calculate divergence from TWAP
        uint128 lastSpotPrice;          // Latest spot for divergence check
        // Current spread in basis points — widens when spot diverges from TWAP (manipulation protection)
        uint16 dynamicSpreadBps;        // Current spread based on divergence
    }

    /// @notice Circuit breaker state
    // Safety mechanism that pauses trading when abnormal conditions are detected
    struct CircuitBreaker {
        // Rolling 24-hour notional volume — tracked to detect unusual activity
        uint256 dailyVolume;            // Rolling 24h notional volume
        // Maximum allowed notional per day — breaker trips if exceeded
        uint256 dailyVolumeLimit;       // Max notional per day
        // Junior NAV snapshot from 24h ago — baseline for drawdown calculation
        uint256 lastJuniorValue;        // Junior NAV 24h ago
        // Maximum acceptable daily junior drawdown — breaker trips if exceeded
        uint256 maxDrawdownBps;         // Max daily junior drawdown
        // 24-hour realized volatility — tracked to detect extreme market conditions
        uint256 volatility24h;          // Realized volatility
        // Volatility threshold — breaker trips if realized vol exceeds this
        uint256 volatilityThresholdBps; // Pause if exceeded
        // Timestamp when daily volume counter was last reset to zero
        uint64 lastVolumeReset;         // Daily reset timestamp
        // Circuit breaker state — 0=normal, 1=warning (monitoring), 2=triggered (paused)
        uint8 state;                    // 0=normal, 1=warning, 2=triggered
    }

    /// @notice Slow withdrawal queue entry
    // Large withdrawals are chunked over time to avoid market impact and pool destabilization
    struct SlowWithdrawal {
        // The user requesting the withdrawal — needed to send funds to correct recipient
        address user;
        // Total notional to unwind from the Euler hedge — may require multiple transactions
        uint256 totalAmount;        // Total notional to unwind
        // Amount already unwound and sent — tracks progress through the queue
        uint256 executedAmount;     // Amount unwound so far
        // Remaining execution chunks — decremented after each partial execution
        uint256 chunksRemaining;    // Number of execution chunks left
        // Earliest timestamp for next chunk execution — enforces minimum spacing
        uint64 nextExecutionTime;   // Earliest time for next chunk
        // Seconds between chunks — default 15 min to spread market impact
        uint64 chunkInterval;       // Seconds between chunks (default: 15 min)
    }

    /// @notice Fee configuration
    // Tunable parameters for the fee model: 0.5% + 0.5% x |leverage - 1| annually
    struct FeeConfig {
        // Base entry fee applied to notional — charged on deposit to compensate junior tranche
        uint16 baseEntryFeeBps;         // Base entry fee (e.g., 8 bps = 0.08%)
        // Base exit fee applied to notional — lower than entry to avoid penalizing exits
        uint16 baseExitFeeBps;          // Base exit fee (e.g., 4 bps = 0.04%)
        // Protocol spread added on top of Euler borrow rate — protocol revenue from carry
        uint16 protocolSpreadBps;       // Protocol spread on carry (e.g., 10 bps)
        // Maximum funding rate per period — caps the imbalance penalty to prevent extreme costs
        uint16 maxFundingRateBps;       // Max funding rate per period (e.g., 5 bps)
        // Time between funding settlements — 8 hours matches perp exchange convention
        uint32 fundingInterval;         // Funding settlement interval (e.g., 8 hours)
        // Percentage of fees allocated to junior tranche — rewards first-loss capital providers
        uint16 juniorFeeSplit;          // Junior tranche fee share (e.g., 7000 = 70%)
        // Percentage of fees allocated to insurance fund — builds protocol backstop
        uint16 insuranceFeeSplit;       // Insurance fund fee share (e.g., 2000 = 20%)
        // Percentage of fees allocated to treasury — funds protocol operations
        uint16 treasuryFeeSplit;        // Treasury fee share (e.g., 1000 = 10%)
    }
}
