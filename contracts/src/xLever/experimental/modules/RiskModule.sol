// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import shared structs so CircuitBreaker type is consistent across the codebase
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title RiskModule
/// @notice Health monitoring and auto-deleverage system
// Core safety mechanism — replaces traditional liquidation with automatic leverage reduction
contract RiskModule {
    // Vault address — used for access control (only vault can call state-changing functions)
    address public vault;

    // Circuit breaker state — tracks volume, drawdown, and volatility for emergency pausing
    DataTypes.CircuitBreaker public circuitBreaker;

    // Health score threshold that triggers emergency auto-deleverage — pool is critically undercollateralized
    uint256 constant HEALTH_CRITICAL = 11000;  // 1.10 - trigger ADL
    // Health score threshold that triggers warning state — pool is at risk
    uint256 constant HEALTH_WARNING = 12000;   // 1.20 - warning state
    // Health score above which the pool is considered safe — no intervention needed
    uint256 constant HEALTH_SAFE = 15000;      // 1.50 - safe state

    // Emitted on each health check — provides score and resulting state for monitoring
    event HealthCheck(uint256 healthScore, uint8 state);
    // Emitted when auto-deleverage cascade is triggered — signals forced leverage reduction
    event AutoDeleverageTriggered(uint256 oldHealth, uint256 targetHealth);
    // Emitted when circuit breaker trips — includes reason code for diagnosis
    event CircuitBreakerTriggered(uint8 reason, uint256 value);
    // Emitted on protocol state transitions — for governance monitoring
    event ProtocolStateChanged(uint8 oldState, uint8 newState);
    // Emitted when daily volume is updated — for off-chain volume tracking
    event VolumeUpdated(uint256 volumeDelta, uint256 newDailyVolume);
    // Emitted when circuit breaker is manually reset — for governance audit trail
    event CircuitBreakerReset(uint64 timestamp);

    // Only the parent vault can call risk-state-changing functions
    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        // Continue executing the function body after the check passes
        _;
    }

    // Initialize risk module with vault reference and default circuit breaker parameters
    constructor(address _vault) {
        // Store vault address for access control
        vault = _vault;

        // Initialize circuit breaker with conservative default limits
        circuitBreaker = DataTypes.CircuitBreaker({
            // Start with zero daily volume — accumulates as trades occur
            dailyVolume: 0,
            // $10M daily volume limit — prevents excessive trading in stressed conditions
            dailyVolumeLimit: 10_000_000e6,  // $10M daily limit
            // No prior junior value — will be set on first circuit breaker check
            lastJuniorValue: 0,
            // 20% max daily junior drawdown — trips breaker if first-loss capital erodes too fast
            maxDrawdownBps: 2000,            // 20% max daily drawdown
            // Start with zero volatility — will be updated by keepers
            volatility24h: 0,
            // 50% volatility threshold — trips breaker in extreme market conditions
            volatilityThresholdBps: 5000,    // 50% volatility threshold
            // Start the daily volume window from deployment time
            lastVolumeReset: uint64(block.timestamp),
            // Start in normal state
            state: 0
        });
    }

    /// @notice Check pool health and determine state
    /// @param healthScore Current Euler health score (1e18 = 100%)
    /// @param juniorRatioBps Junior tranche ratio
    /// @return protocolState 0=active, 1=stressed, 2=paused, 3=emergency
    // Called by vault after trades to determine if risk state needs to change
    function checkHealth(
        uint256 healthScore,
        uint256 juniorRatioBps
    ) external onlyVault returns (uint8 protocolState) {
        // Most critical check first: health below 1.10 OR junior ratio below 10%
        if (healthScore < HEALTH_CRITICAL || juniorRatioBps < 1000) {
            // Emergency state — auto-deleverage cascade should be triggered immediately
            protocolState = 3; // Emergency
        // Second tier: health below 1.20 OR junior ratio below 20%
        } else if (healthScore < HEALTH_WARNING || juniorRatioBps < 2000) {
            // Paused — stop new deposits and leverage increases until conditions improve
            protocolState = 2; // Paused
        // Third tier: health below 1.50 OR junior ratio below 30%
        } else if (healthScore < HEALTH_SAFE || juniorRatioBps < 3000) {
            // Stressed — allow trading but with reduced leverage caps
            protocolState = 1; // Stressed
        } else {
            // All metrics are healthy — normal operations
            protocolState = 0; // Active
        }

        // Emit health check result for off-chain monitoring and alerting
        emit HealthCheck(healthScore, protocolState);

        // Return the computed state so vault can update poolState.protocolState
        return protocolState;
    }

    /// @notice Calculate auto-deleverage cascade
    /// @param currentHealth Current health score
    /// @param currentMaxLeverage Current max leverage
    /// @return newMaxLeverage Reduced leverage cap
    /// @return shouldDeleverage Whether to trigger ADL
    // Pure function — vault calls this to decide if forced deleveraging is needed
    // NOTE: This function does not factor in individual position PnL when determining
    // deleverage targets. In production, positions with the largest unrealized losses
    // should be deleveraged first to maximize risk reduction per unit of disruption.
    // This is a known limitation — the current implementation uses a blanket leverage
    // cap reduction that affects all positions equally regardless of PnL.
    function calculateAutoDeleverage(
        uint256 currentHealth,
        int32 currentMaxLeverage
    ) external view returns (int32 newMaxLeverage, bool shouldDeleverage) {
        // If health is above safe threshold, no deleveraging needed
        if (currentHealth >= HEALTH_SAFE) {
            // Return current leverage unchanged and no deleverage flag
            return (currentMaxLeverage, false);
        }

        // Critical health: aggressively reduce to 1.5x to rapidly lower risk
        if (currentHealth < HEALTH_CRITICAL) {
            // 1.5x max — drastic reduction to prevent insolvency
            return (15000, true);
        // Warning health: moderately reduce to 2x
        } else if (currentHealth < HEALTH_WARNING) {
            // 2x max — significant reduction but less disruptive than critical
            return (20000, true);
        } else {
            // Stressed health: mildly reduce to 3x
            // 3x max — slight reduction as an early warning measure
            return (30000, true);
        }
    }

    /// @notice Check circuit breaker conditions
    /// @param dailyVolume Current 24h volume
    /// @param juniorValue Current junior value
    /// @param volatility Current volatility
    /// @return shouldPause Whether to trigger circuit breaker
    /// @return reason Reason code (1=volume, 2=drawdown, 3=volatility)
    // Called by vault to check if trading should be halted due to abnormal conditions
    function checkCircuitBreaker(
        uint256 dailyVolume,
        uint256 juniorValue,
        uint256 volatility
    ) external returns (bool shouldPause, uint8 reason) {
        // Get storage pointer for efficient multi-field reads and writes
        DataTypes.CircuitBreaker storage cb = circuitBreaker;

        // Reset daily counters if 24 hours have passed since last reset
        if (block.timestamp >= cb.lastVolumeReset + 1 days) {
            // Reset volume counter for the new 24-hour window
            cb.dailyVolume = 0;
            // Start new 24-hour window from current time
            cb.lastVolumeReset = uint64(block.timestamp);
            // Snapshot current junior value as baseline for drawdown calculation
            cb.lastJuniorValue = juniorValue;
        }

        // Check 1: Daily volume limit — prevents excessive trading that could destabilize the pool
        if (dailyVolume > cb.dailyVolumeLimit) {
            // Trip the breaker — set state to triggered
            cb.state = 2;
            // Emit event with reason code 1 (volume) for diagnosis
            emit CircuitBreakerTriggered(1, dailyVolume);
            // Signal vault to pause trading
            return (true, 1);
        }

        // Check 2: Junior tranche drawdown — first-loss buffer is eroding too fast
        if (cb.lastJuniorValue > 0 && juniorValue < cb.lastJuniorValue) {
            // Calculate how much junior NAV has dropped as a percentage of yesterday's value
            uint256 drawdownBps = (cb.lastJuniorValue - juniorValue) * 10000 / cb.lastJuniorValue;
            // Trip if drawdown exceeds threshold (default 20%)
            if (drawdownBps > cb.maxDrawdownBps) {
                // Trip the breaker — junior capital is being consumed too quickly
                cb.state = 2;
                // Emit event with reason code 2 (drawdown) for diagnosis
                emit CircuitBreakerTriggered(2, drawdownBps);
                // Signal vault to pause trading
                return (true, 2);
            }
        }

        // Check 3: Volatility — market conditions are too extreme for safe leveraged trading
        if (volatility > cb.volatilityThresholdBps) {
            // Trip the breaker — high volatility makes PnL unpredictable
            cb.state = 2;
            // Emit event with reason code 3 (volatility) for diagnosis
            emit CircuitBreakerTriggered(3, volatility);
            // Signal vault to pause trading
            return (true, 3);
        }

        // All checks passed — no pause needed
        return (false, 0);
    }

    /// @notice Update daily volume
    // Called by vault after each trade to accumulate daily volume for circuit breaker checks
    function updateVolume(uint256 volumeDelta) external onlyVault {
        // Add this trade's notional to the running daily total
        circuitBreaker.dailyVolume += volumeDelta;
        // Emit event for off-chain volume monitoring and alerting
        emit VolumeUpdated(volumeDelta, circuitBreaker.dailyVolume);
    }

    /// @notice Calculate dynamic max leverage based on junior ratio
    /// @param juniorRatioBps Junior ratio in basis points
    /// @return maxLeverageBps Maximum allowed leverage
    // Pure function — maps junior ratio tiers to leverage caps (more junior = higher leverage allowed)
    function calculateMaxLeverage(uint256 juniorRatioBps) external pure returns (int32 maxLeverageBps) {
        // 40%+ junior ratio: full 4x leverage allowed — strong first-loss buffer
        if (juniorRatioBps >= 4000) return 40000;      // 40% = 4x
        // 30-40% junior ratio: 3x max — moderate buffer
        if (juniorRatioBps >= 3000) return 30000;      // 30% = 3x
        // 20-30% junior ratio: 2x max — thin buffer, restrict leverage
        if (juniorRatioBps >= 2000) return 20000;      // 20% = 2x
        // Below 20%: 1.5x max — minimal buffer, heavy restriction
        return 15000;                                  // <20% = 1.5x
    }

    /// @notice Reset circuit breaker (admin only)
    // Called by vault (admin-gated) after manual review to resume trading after a trip
    function resetCircuitBreaker() external onlyVault {
        // Reset state to normal — allows trading to resume
        circuitBreaker.state = 0;
        // Reset daily volume counter so the breaker doesn't immediately re-trip
        circuitBreaker.dailyVolume = 0;
        // Emit event for governance audit trail of manual resets
        emit CircuitBreakerReset(uint64(block.timestamp));
    }

    /// @notice Update circuit breaker limits
    // Called by vault (admin-gated) to tune risk parameters without redeploying
    function updateCircuitBreakerLimits(
        uint256 volumeLimit,          // New daily volume limit
        uint256 maxDrawdownBps,       // New max junior drawdown threshold
        uint256 volatilityThresholdBps // New volatility threshold
    ) external onlyVault {
        // Update volume limit — may be raised for more liquid markets
        circuitBreaker.dailyVolumeLimit = volumeLimit;
        // Update drawdown threshold — may be loosened for mature pools with deep junior tranches
        circuitBreaker.maxDrawdownBps = maxDrawdownBps;
        // Update volatility threshold — may be adjusted for different asset classes
        circuitBreaker.volatilityThresholdBps = volatilityThresholdBps;
    }
}
