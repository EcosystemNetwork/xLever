// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import shared structs so FeeConfig type is consistent across the codebase
import {DataTypes} from "../libraries/DataTypes.sol";
// Import TWAP oracle interface to read divergence for fee scaling
import {ITWAPOracle} from "../interfaces/ITWAPOracle.sol";

/// @title FeeEngine
/// @notice Dynamic fee calculation with divergence-adjusted entry/exit fees
// Implements xLever's fee model: 0.5% + 0.5% * |leverage - 1| annually, plus dynamic adjustments
contract FeeEngine {
    // TWAP oracle reference — needed to read spot-TWAP divergence for fee multiplier
    ITWAPOracle public immutable oracle;
    // Fee configuration parameters — tunable by admin via vault
    DataTypes.FeeConfig public feeConfig;

    // Vault address — used for access control on config updates and funding settlement
    address public vault;
    // Timestamp of last funding settlement — used to enforce 8-hour funding intervals
    uint64 public lastFundingTime;

    // Maximum acceptable spot-TWAP divergence — reject trades above 3% to prevent manipulation
    uint256 constant MAX_DIVERGENCE_BPS = 300; // 3% max divergence

    // Emitted when fee configuration is updated — for governance and transparency
    event FeeConfigUpdated(DataTypes.FeeConfig config);
    // Emitted when funding rate is calculated — for off-chain tracking and accounting
    event FundingRateCalculated(int256 rateBps, uint256 timestamp);

    // Only the parent vault can update config and settle funding
    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        // Continue executing the function body after the check passes
        _;
    }

    // Initialize fee engine with oracle reference and default fee parameters
    constructor(address _oracle, address _vault) {
        // Store oracle for reading divergence during fee calculation
        oracle = ITWAPOracle(_oracle);
        // Store vault for access control
        vault = _vault;

        // Set default fee configuration — conservative parameters for launch
        feeConfig = DataTypes.FeeConfig({
            // 0.08% base entry fee — low enough to not deter deposits
            baseEntryFeeBps: 8,         // 0.08%
            // 0.04% base exit fee — lower than entry to avoid penalizing exits
            baseExitFeeBps: 4,          // 0.04%
            // 0.10% protocol spread on carry — added to Euler borrow rate passthrough
            protocolSpreadBps: 10,      // 0.10%
            // 0.05% max funding rate per 8-hour period — caps imbalance cost
            maxFundingRateBps: 5,       // 0.05% per period
            // 8-hour funding interval — standard perp exchange convention
            fundingInterval: 8 hours,
            // 70% of fees go to junior tranche — rewards first-loss capital providers
            juniorFeeSplit: 7000,       // 70%
            // 20% of fees go to insurance fund — builds protocol backstop
            insuranceFeeSplit: 2000,    // 20%
            // 10% of fees go to treasury — funds protocol operations
            treasuryFeeSplit: 1000      // 10%
        });

        // Start the funding clock from deployment time
        lastFundingTime = uint64(block.timestamp);
    }

    /// @notice Calculate dynamic entry/exit fee based on TWAP divergence
    /// @param notionalDelta Notional amount being traded
    /// @param isIncrease True for entry, false for exit
    /// @return feeAmount Fee in USDC (6 decimals)
    // Dynamic fees widen during high divergence to protect the pool from manipulation
    function calculateDynamicFee(
        uint256 notionalDelta,
        bool isIncrease
    ) external view returns (uint256 feeAmount) {
        // Select base fee rate depending on whether this is an entry or exit
        uint256 baseBps = isIncrease ? feeConfig.baseEntryFeeBps : feeConfig.baseExitFeeBps;

        // Read current spot-TWAP divergence from oracle
        uint256 divergenceBps = oracle.getDivergence();

        // Block trades when divergence is too high — prevents manipulation during volatile periods
        require(divergenceBps <= MAX_DIVERGENCE_BPS, "Divergence too high");

        // Fee multiplier scales linearly with divergence — higher divergence = higher fee
        // At 0% divergence: 1.0x multiplier (just the base fee)
        // At 1% divergence: 1.5x multiplier
        // At 2% divergence: 2.0x multiplier
        uint256 multiplier = 10000 + (divergenceBps * 50);

        // Final fee = notional * base rate * multiplier, normalized by two layers of basis points
        feeAmount = notionalDelta * baseBps * multiplier / (10000 * 10000);
    }

    /// @notice Calculate continuous carry fee based on Euler borrow rate
    /// @param eulerBorrowRate Annual borrow rate from Euler (bps)
    /// @param netExposure Net long/short exposure
    /// @param grossExposure Total gross exposure
    /// @return annualRateBps Annual carry rate in bps
    // Carry fee = Euler passthrough (scaled by netting ratio) + protocol spread
    function calculateCarryRate(
        uint256 eulerBorrowRate,
        uint256 netExposure,
        uint256 grossExposure
    ) external view returns (uint256 annualRateBps) {
        // If no exposure exists, only charge the protocol spread
        if (grossExposure == 0) return feeConfig.protocolSpreadBps;

        // Netting ratio: net / gross — measures how much of the pool is actually hedged on Euler
        // Low netting = longs and shorts offset each other; high netting = unbalanced pool
        uint256 nettingRatio = netExposure * 10000 / grossExposure;

        // Euler cost passthrough: only charge for the portion that actually borrows on Euler
        uint256 passthrough = eulerBorrowRate * nettingRatio / 10000;

        // Total carry = Euler passthrough + protocol spread (xLever's margin)
        return passthrough + feeConfig.protocolSpreadBps;
    }

    /// @notice Calculate per-second fee accrual
    // Used to compute how much carry fee a position owes for a given time period
    function calculateAccruedFee(
        uint256 depositAmount,   // Position's USDC principal
        uint256 annualRateBps,   // Annual carry rate from calculateCarryRate
        uint256 secondsElapsed   // Time since last fee settlement
    ) external pure returns (uint256 feeAmount) {
        // Pro-rata accrual: deposit * rate * time / (10000 bps * seconds in a year)
        return depositAmount * annualRateBps * secondsElapsed / (10000 * 365.25 days);
    }

    /// @notice Calculate funding rate based on pool imbalance
    /// @param netExposure Net long/short (signed)
    /// @param grossExposure Total gross exposure
    /// @return rateBps Funding rate in bps (positive = longs pay shorts)
    // Funding rate incentivizes balance: the dominant side pays the minority side
    function calculateFundingRate(
        int256 netExposure,
        uint256 grossExposure
    ) external view returns (int256 rateBps) {
        // No funding needed when there's no exposure to rebalance
        if (grossExposure == 0) return 0;

        // Raw rate = (net / gross) * max rate — linear scaling with imbalance
        int256 rawRate = netExposure * int256(uint256(feeConfig.maxFundingRateBps)) / int256(grossExposure);

        // Clamp to max funding rate in both directions to prevent extreme costs
        int256 maxRate = int256(uint256(feeConfig.maxFundingRateBps));
        // Cap positive rate (longs paying shorts)
        if (rawRate > maxRate) return maxRate;
        // Cap negative rate (shorts paying longs)
        if (rawRate < -maxRate) return -maxRate;

        // Return the unclamped rate if within bounds
        return rawRate;
    }

    /// @notice Check if funding settlement is due
    // Returns true every 8 hours — vault or keeper calls this to trigger periodic funding
    function isFundingDue() external view returns (bool) {
        // Compare elapsed time since last settlement against the configured interval
        return block.timestamp >= lastFundingTime + feeConfig.fundingInterval;
    }

    /// @notice Mark funding as settled
    // Called by vault after distributing funding payments to reset the clock
    function settleFunding() external onlyVault {
        // Record current time as last settlement — next settlement due in fundingInterval seconds
        lastFundingTime = uint64(block.timestamp);
    }

    /// @notice Update fee configuration
    // Called by vault (admin-gated) to tune fee parameters without redeploying
    function updateFeeConfig(DataTypes.FeeConfig calldata newConfig) external onlyVault {
        // Validate that fee splits sum to exactly 100% — prevents over- or under-distribution
        require(
            newConfig.juniorFeeSplit + newConfig.insuranceFeeSplit + newConfig.treasuryFeeSplit == 10000,
            "Invalid fee split"
        );

        // Replace the entire fee config struct
        feeConfig = newConfig;
        // Emit event for transparency and off-chain config tracking
        emit FeeConfigUpdated(newConfig);
    }

    /// @notice Distribute collected fees
    // Pure calculation — splits total fees according to configured ratios
    function distributeFees(uint256 totalFees) external view returns (
        uint256 juniorAmount,    // Portion for junior tranche (first-loss capital reward)
        uint256 insuranceAmount, // Portion for insurance fund (protocol backstop)
        uint256 treasuryAmount   // Portion for treasury (protocol operations)
    ) {
        // Junior share — typically 70%, rewards first-loss capital providers for bearing risk
        juniorAmount = totalFees * feeConfig.juniorFeeSplit / 10000;
        // Insurance share — typically 20%, builds a backstop reserve for extreme events
        insuranceAmount = totalFees * feeConfig.insuranceFeeSplit / 10000;
        // Treasury share — typically 10%, funds protocol development and operations
        treasuryAmount = totalFees * feeConfig.treasuryFeeSplit / 10000;
    }
}
