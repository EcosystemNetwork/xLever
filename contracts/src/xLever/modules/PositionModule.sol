// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "../libraries/DataTypes.sol";
import {ITWAPOracle} from "../interfaces/ITWAPOracle.sol";

/// @title PositionModule
/// @notice Manages user positions with fixed-entry leverage tracking
contract PositionModule {
    mapping(address => DataTypes.Position) public positions;
    
    ITWAPOracle public immutable oracle;
    address public immutable vault;
    
    uint256 constant LEVERAGE_INCREASE_DELAY = 1 hours;
    uint256 constant LEVERAGE_FLIP_DELAY = 4 hours;
    
    event PositionOpened(address indexed user, uint256 deposit, int32 leverage, uint128 entryTWAP);
    event PositionClosed(address indexed user, uint256 finalValue, int256 pnl);
    event PositionAdjusted(address indexed user, int32 oldLeverage, int32 newLeverage);
    
    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }
    
    constructor(address _oracle, address _vault) {
        oracle = ITWAPOracle(_oracle);
        vault = _vault;
    }
    
    /// @notice Open or update a position
    function updatePosition(
        address user,
        uint128 depositAmount,
        int32 leverageBps,
        uint128 entryTWAP
    ) external onlyVault {
        DataTypes.Position storage pos = positions[user];
        
        if (!pos.isActive) {
            // New position
            pos.depositAmount = depositAmount;
            pos.leverageBps = leverageBps;
            pos.entryTWAP = entryTWAP;
            pos.lastFeeTimestamp = uint64(block.timestamp);
            pos.settledFees = 0;
            pos.leverageLockExpiry = 0;
            pos.isActive = true;
            
            emit PositionOpened(user, depositAmount, leverageBps, entryTWAP);
        } else {
            // Update existing position
            pos.depositAmount = depositAmount;
            pos.leverageBps = leverageBps;
            pos.entryTWAP = entryTWAP;
        }
    }
    
    /// @notice Close a position
    function closePosition(address user) external onlyVault returns (uint256 finalValue, int256 pnl) {
        DataTypes.Position storage pos = positions[user];
        require(pos.isActive, "No position");
        
        (finalValue, pnl) = calculatePositionValue(user);
        
        emit PositionClosed(user, finalValue, pnl);
        
        delete positions[user];
    }
    
    /// @notice Adjust leverage with lock checks
    function adjustLeverage(address user, int32 newLeverageBps) external onlyVault {
        DataTypes.Position storage pos = positions[user];
        require(pos.isActive, "No position");
        
        int32 oldLeverage = pos.leverageBps;
        
        // Check leverage increase lock
        if (_abs(newLeverageBps) > _abs(oldLeverage)) {
            require(block.timestamp >= pos.leverageLockExpiry, "Leverage locked");
            pos.leverageLockExpiry = uint32(block.timestamp + LEVERAGE_INCREASE_DELAY);
        }
        
        // Check flip lock (long to short or vice versa)
        if ((oldLeverage > 0 && newLeverageBps < 0) || (oldLeverage < 0 && newLeverageBps > 0)) {
            require(block.timestamp >= pos.leverageLockExpiry, "Flip locked");
            pos.leverageLockExpiry = uint32(block.timestamp + LEVERAGE_FLIP_DELAY);
        }
        
        // Update leverage and reset entry TWAP
        pos.leverageBps = newLeverageBps;
        pos.entryTWAP = oracle.getTWAP();
        
        emit PositionAdjusted(user, oldLeverage, newLeverageBps);
    }
    
    /// @notice Calculate position value with PnL
    /// @dev Value = Deposit × (1 + Leverage × PriceChange%) - Fees
    function calculatePositionValue(address user) public view returns (uint256 value, int256 pnl) {
        DataTypes.Position storage pos = positions[user];
        if (!pos.isActive) return (0, 0);
        
        uint128 currentTWAP = oracle.getTWAP();
        
        // If entryTWAP is zero (shouldn't happen with fixed contract), return deposit amount
        if (pos.entryTWAP == 0) {
            return (uint256(pos.depositAmount), 0);
        }
        
        // Calculate price change percentage (in basis points)
        int256 priceChangeBps;
        if (currentTWAP > pos.entryTWAP) {
            priceChangeBps = int256(uint256(currentTWAP - pos.entryTWAP) * 10000 / pos.entryTWAP);
        } else {
            priceChangeBps = -int256(uint256(pos.entryTWAP - currentTWAP) * 10000 / pos.entryTWAP);
        }
        
        // PnL = Deposit × Leverage × PriceChange%
        // Note: leverageBps is signed, so shorts automatically get negative PnL on price increases
        pnl = int256(uint256(pos.depositAmount)) * pos.leverageBps * priceChangeBps / (10000 * 10000);
        
        // Value = Deposit + PnL - Fees
        int256 grossValue = int256(uint256(pos.depositAmount)) + pnl;
        int256 netValue = grossValue - int256(uint256(pos.settledFees));
        
        // Clamp to zero (can't go negative)
        value = netValue > 0 ? uint256(netValue) : 0;
    }
    
    /// @notice Settle accumulated fees
    function settleFees(address user, uint128 feeAmount) external onlyVault {
        DataTypes.Position storage pos = positions[user];
        require(pos.isActive, "No position");
        
        pos.settledFees += feeAmount;
        pos.lastFeeTimestamp = uint64(block.timestamp);
    }
    
    /// @notice Get position details
    function getPosition(address user) external view returns (DataTypes.Position memory) {
        return positions[user];
    }
    
    /// @notice Apply auto-deleverage to a position
    function applyDeleverage(address user, int32 newLeverageBps) external onlyVault {
        DataTypes.Position storage pos = positions[user];
        require(pos.isActive, "No position");
        
        pos.leverageBps = newLeverageBps;
        pos.entryTWAP = oracle.getTWAP();
        
        emit PositionAdjusted(user, pos.leverageBps, newLeverageBps);
    }
    
    function _abs(int32 x) internal pure returns (int32) {
        return x >= 0 ? x : -x;
    }
}
