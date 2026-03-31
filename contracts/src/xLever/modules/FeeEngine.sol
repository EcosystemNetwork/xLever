// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "../libraries/DataTypes.sol";
import {ITWAPOracle} from "../interfaces/ITWAPOracle.sol";

/// @title FeeEngine
/// @notice Dynamic fee calculation with divergence-adjusted entry/exit fees
contract FeeEngine {
    ITWAPOracle public immutable oracle;
    DataTypes.FeeConfig public feeConfig;
    
    address public vault;
    uint64 public lastFundingTime;
    
    uint256 constant MAX_DIVERGENCE_BPS = 300; // 3% max divergence
    
    event FeeConfigUpdated(DataTypes.FeeConfig config);
    event FundingRateCalculated(int256 rateBps, uint256 timestamp);
    
    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }
    
    constructor(address _oracle, address _vault) {
        oracle = ITWAPOracle(_oracle);
        vault = _vault;
        
        // Default fee config
        feeConfig = DataTypes.FeeConfig({
            baseEntryFeeBps: 8,         // 0.08%
            baseExitFeeBps: 4,          // 0.04%
            protocolSpreadBps: 10,      // 0.10%
            maxFundingRateBps: 5,       // 0.05% per period
            fundingInterval: 8 hours,
            juniorFeeSplit: 7000,       // 70%
            insuranceFeeSplit: 2000,    // 20%
            treasuryFeeSplit: 1000      // 10%
        });
        
        lastFundingTime = uint64(block.timestamp);
    }
    
    /// @notice Calculate dynamic entry/exit fee based on TWAP divergence
    /// @param notionalDelta Notional amount being traded
    /// @param isIncrease True for entry, false for exit
    /// @return feeAmount Fee in USDC (6 decimals)
    function calculateDynamicFee(
        uint256 notionalDelta,
        bool isIncrease
    ) external view returns (uint256 feeAmount) {
        uint256 baseBps = isIncrease ? feeConfig.baseEntryFeeBps : feeConfig.baseExitFeeBps;
        
        // Get spot-TWAP divergence
        uint256 divergenceBps = oracle.getDivergence();
        
        // Reject if divergence too high
        require(divergenceBps <= MAX_DIVERGENCE_BPS, "Divergence too high");
        
        // Fee multiplier: 1 + (divergence * 0.5)
        // At 0% divergence: 1.0x
        // At 1% divergence: 1.5x
        // At 2% divergence: 2.0x
        uint256 multiplier = 10000 + (divergenceBps * 50);
        
        feeAmount = notionalDelta * baseBps * multiplier / (10000 * 10000);
    }
    
    /// @notice Calculate continuous carry fee based on Euler borrow rate
    /// @param eulerBorrowRate Annual borrow rate from Euler (bps)
    /// @param netExposure Net long/short exposure
    /// @param grossExposure Total gross exposure
    /// @return annualRateBps Annual carry rate in bps
    function calculateCarryRate(
        uint256 eulerBorrowRate,
        uint256 netExposure,
        uint256 grossExposure
    ) external view returns (uint256 annualRateBps) {
        if (grossExposure == 0) return feeConfig.protocolSpreadBps;
        
        // Netting ratio: how much of gross exposure is actually hedged
        uint256 nettingRatio = netExposure * 10000 / grossExposure;
        
        // Passthrough = Euler rate × netting ratio
        uint256 passthrough = eulerBorrowRate * nettingRatio / 10000;
        
        return passthrough + feeConfig.protocolSpreadBps;
    }
    
    /// @notice Calculate per-second fee accrual
    function calculateAccruedFee(
        uint256 depositAmount,
        uint256 annualRateBps,
        uint256 secondsElapsed
    ) external pure returns (uint256 feeAmount) {
        // Fee = Deposit × Rate × Time / (365.25 days)
        return depositAmount * annualRateBps * secondsElapsed / (10000 * 365.25 days);
    }
    
    /// @notice Calculate funding rate based on pool imbalance
    /// @param netExposure Net long/short (signed)
    /// @param grossExposure Total gross exposure
    /// @return rateBps Funding rate in bps (positive = longs pay shorts)
    function calculateFundingRate(
        int256 netExposure,
        uint256 grossExposure
    ) external view returns (int256 rateBps) {
        if (grossExposure == 0) return 0;
        
        // Raw rate = (net / gross) × max rate
        int256 rawRate = netExposure * int256(uint256(feeConfig.maxFundingRateBps)) / int256(grossExposure);
        
        // Clamp to max funding rate
        int256 maxRate = int256(uint256(feeConfig.maxFundingRateBps));
        if (rawRate > maxRate) return maxRate;
        if (rawRate < -maxRate) return -maxRate;
        
        return rawRate;
    }
    
    /// @notice Check if funding settlement is due
    function isFundingDue() external view returns (bool) {
        return block.timestamp >= lastFundingTime + feeConfig.fundingInterval;
    }
    
    /// @notice Mark funding as settled
    function settleFunding() external onlyVault {
        lastFundingTime = uint64(block.timestamp);
    }
    
    /// @notice Update fee configuration
    function updateFeeConfig(DataTypes.FeeConfig calldata newConfig) external onlyVault {
        require(
            newConfig.juniorFeeSplit + newConfig.insuranceFeeSplit + newConfig.treasuryFeeSplit == 10000,
            "Invalid fee split"
        );
        
        feeConfig = newConfig;
        emit FeeConfigUpdated(newConfig);
    }
    
    /// @notice Distribute collected fees
    function distributeFees(uint256 totalFees) external view returns (
        uint256 juniorAmount,
        uint256 insuranceAmount,
        uint256 treasuryAmount
    ) {
        juniorAmount = totalFees * feeConfig.juniorFeeSplit / 10000;
        insuranceAmount = totalFees * feeConfig.insuranceFeeSplit / 10000;
        treasuryAmount = totalFees * feeConfig.treasuryFeeSplit / 10000;
    }
}
