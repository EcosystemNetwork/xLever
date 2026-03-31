// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title RiskModule
/// @notice Health monitoring and auto-deleverage system
contract RiskModule {
    address public vault;
    
    DataTypes.CircuitBreaker public circuitBreaker;
    
    // Health thresholds for auto-deleverage cascade
    uint256 constant HEALTH_CRITICAL = 11000;  // 1.10 - trigger ADL
    uint256 constant HEALTH_WARNING = 12000;   // 1.20 - warning state
    uint256 constant HEALTH_SAFE = 15000;      // 1.50 - safe state
    
    event HealthCheck(uint256 healthScore, uint8 state);
    event AutoDeleverageTriggered(uint256 oldHealth, uint256 targetHealth);
    event CircuitBreakerTriggered(uint8 reason, uint256 value);
    event ProtocolStateChanged(uint8 oldState, uint8 newState);
    
    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }
    
    constructor(address _vault) {
        vault = _vault;
        
        // Initialize circuit breaker
        circuitBreaker = DataTypes.CircuitBreaker({
            dailyVolume: 0,
            dailyVolumeLimit: 10_000_000e6,  // $10M daily limit
            lastJuniorValue: 0,
            maxDrawdownBps: 2000,            // 20% max daily drawdown
            volatility24h: 0,
            volatilityThresholdBps: 5000,    // 50% volatility threshold
            lastVolumeReset: uint64(block.timestamp),
            state: 0
        });
    }
    
    /// @notice Check pool health and determine state
    /// @param healthScore Current Euler health score (1e18 = 100%)
    /// @param juniorRatioBps Junior tranche ratio
    /// @return protocolState 0=active, 1=stressed, 2=paused, 3=emergency
    function checkHealth(
        uint256 healthScore,
        uint256 juniorRatioBps
    ) external onlyVault returns (uint8 protocolState) {
        // Determine state based on health and junior ratio
        if (healthScore < HEALTH_CRITICAL || juniorRatioBps < 1000) {
            // Critical: health < 1.10 or junior < 10%
            protocolState = 3; // Emergency
        } else if (healthScore < HEALTH_WARNING || juniorRatioBps < 2000) {
            // Warning: health < 1.20 or junior < 20%
            protocolState = 2; // Paused
        } else if (healthScore < HEALTH_SAFE || juniorRatioBps < 3000) {
            // Stressed: health < 1.50 or junior < 30%
            protocolState = 1; // Stressed
        } else {
            protocolState = 0; // Active
        }
        
        emit HealthCheck(healthScore, protocolState);
        
        return protocolState;
    }
    
    /// @notice Calculate auto-deleverage cascade
    /// @param currentHealth Current health score
    /// @param currentMaxLeverage Current max leverage
    /// @return newMaxLeverage Reduced leverage cap
    /// @return shouldDeleverage Whether to trigger ADL
    function calculateAutoDeleverage(
        uint256 currentHealth,
        int32 currentMaxLeverage
    ) external view returns (int32 newMaxLeverage, bool shouldDeleverage) {
        if (currentHealth >= HEALTH_SAFE) {
            return (currentMaxLeverage, false);
        }
        
        if (currentHealth < HEALTH_CRITICAL) {
            // Critical: reduce to 1.5x
            return (15000, true);
        } else if (currentHealth < HEALTH_WARNING) {
            // Warning: reduce to 2x
            return (20000, true);
        } else {
            // Stressed: reduce to 3x
            return (30000, true);
        }
    }
    
    /// @notice Check circuit breaker conditions
    /// @param dailyVolume Current 24h volume
    /// @param juniorValue Current junior value
    /// @param volatility Current volatility
    /// @return shouldPause Whether to trigger circuit breaker
    /// @return reason Reason code (1=volume, 2=drawdown, 3=volatility)
    function checkCircuitBreaker(
        uint256 dailyVolume,
        uint256 juniorValue,
        uint256 volatility
    ) external returns (bool shouldPause, uint8 reason) {
        DataTypes.CircuitBreaker storage cb = circuitBreaker;
        
        // Reset daily volume if needed
        if (block.timestamp >= cb.lastVolumeReset + 1 days) {
            cb.dailyVolume = 0;
            cb.lastVolumeReset = uint64(block.timestamp);
            cb.lastJuniorValue = juniorValue;
        }
        
        // Check volume limit
        if (dailyVolume > cb.dailyVolumeLimit) {
            cb.state = 2;
            emit CircuitBreakerTriggered(1, dailyVolume);
            return (true, 1);
        }
        
        // Check junior drawdown
        if (cb.lastJuniorValue > 0) {
            uint256 drawdownBps = (cb.lastJuniorValue - juniorValue) * 10000 / cb.lastJuniorValue;
            if (drawdownBps > cb.maxDrawdownBps) {
                cb.state = 2;
                emit CircuitBreakerTriggered(2, drawdownBps);
                return (true, 2);
            }
        }
        
        // Check volatility
        if (volatility > cb.volatilityThresholdBps) {
            cb.state = 2;
            emit CircuitBreakerTriggered(3, volatility);
            return (true, 3);
        }
        
        return (false, 0);
    }
    
    /// @notice Update daily volume
    function updateVolume(uint256 volumeDelta) external onlyVault {
        circuitBreaker.dailyVolume += volumeDelta;
    }
    
    /// @notice Calculate dynamic max leverage based on junior ratio
    /// @param juniorRatioBps Junior ratio in basis points
    /// @return maxLeverageBps Maximum allowed leverage
    function calculateMaxLeverage(uint256 juniorRatioBps) external pure returns (int32 maxLeverageBps) {
        if (juniorRatioBps >= 4000) return 40000;      // 40% = 4×
        if (juniorRatioBps >= 3000) return 30000;      // 30% = 3×
        if (juniorRatioBps >= 2000) return 20000;      // 20% = 2×
        return 15000;                                  // <20% = 1.5×
    }
    
    /// @notice Reset circuit breaker (admin only)
    function resetCircuitBreaker() external onlyVault {
        circuitBreaker.state = 0;
        circuitBreaker.dailyVolume = 0;
    }
    
    /// @notice Update circuit breaker limits
    function updateCircuitBreakerLimits(
        uint256 volumeLimit,
        uint256 maxDrawdownBps,
        uint256 volatilityThresholdBps
    ) external onlyVault {
        circuitBreaker.dailyVolumeLimit = volumeLimit;
        circuitBreaker.maxDrawdownBps = maxDrawdownBps;
        circuitBreaker.volatilityThresholdBps = volatilityThresholdBps;
    }
}
