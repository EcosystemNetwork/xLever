// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "./libraries/DataTypes.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title VaultSimple
/// @notice Simplified vault for xLever protocol (under contract size limit)
contract VaultSimple {
    IERC20 public immutable usdc;
    address public immutable asset;
    address public admin;
    
    DataTypes.PoolState public poolState;
    mapping(address => DataTypes.Position) public positions;
    
    event Deposit(address indexed user, uint256 amount, int32 leverage);
    event Withdraw(address indexed user, uint256 amount);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor(address _usdc, address _asset, address _admin) {
        usdc = IERC20(_usdc);
        asset = _asset;
        admin = _admin;
        poolState.currentMaxLeverageBps = 40000;
        poolState.protocolState = 0;
    }
    
    /// @notice Deposit USDC (simplified - no fees, no hedging)
    function deposit(uint256 amount, int32 leverageBps) external returns (uint256) {
        require(amount > 0, "Zero deposit");
        require(leverageBps >= -40000 && leverageBps <= 40000, "Invalid leverage");
        
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        DataTypes.Position storage pos = positions[msg.sender];
        pos.depositAmount = uint128(amount);
        pos.leverageBps = leverageBps;
        pos.entryTWAP = 100e8; // Placeholder price
        pos.lastFeeTimestamp = uint64(block.timestamp);
        pos.isActive = true;
        
        poolState.totalSeniorDeposits += uint128(amount);
        
        emit Deposit(msg.sender, amount, leverageBps);
        return amount;
    }
    
    /// @notice Withdraw (simplified)
    function withdraw(uint256 amount) external returns (uint256) {
        DataTypes.Position storage pos = positions[msg.sender];
        require(pos.isActive, "No position");
        require(amount <= pos.depositAmount, "Insufficient balance");
        
        pos.depositAmount -= uint128(amount);
        if (pos.depositAmount == 0) {
            pos.isActive = false;
        }
        
        poolState.totalSeniorDeposits -= uint128(amount);
        
        require(usdc.transfer(msg.sender, amount), "Transfer failed");
        
        emit Withdraw(msg.sender, amount);
        return amount;
    }
    
    /// @notice Get position
    function getPosition(address user) external view returns (DataTypes.Position memory) {
        return positions[user];
    }
    
    /// @notice Get pool state
    function getPoolState() external view returns (DataTypes.PoolState memory) {
        return poolState;
    }
}
