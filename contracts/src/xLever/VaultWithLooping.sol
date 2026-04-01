// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "./libraries/DataTypes.sol";
import {IEVault} from "../EVault/IEVault.sol";
import {IEVC} from "./interfaces/IEVC.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title VaultWithLooping
/// @notice xLever vault with actual recursive looping for true leverage using Euler V2 EVC
/// @dev Implements deposit -> borrow -> deposit -> borrow... loop to achieve target leverage
contract VaultWithLooping {
    IERC20 public immutable usdc;
    IERC20 public immutable asset;
    
    IEVC public immutable evc;
    IEVault public immutable usdcVault;
    IEVault public immutable assetVault;
    
    address public admin;
    
    DataTypes.PoolState public poolState;
    mapping(address => DataTypes.Position) public positions;
    mapping(address => DataTypes.EulerPosition) public eulerPositions;
    
    uint256 public constant MAX_LOOP_ITERATIONS = 10;
    uint256 public constant BORROW_LTV_BPS = 7500; // 75% LTV from README
    uint256 public constant SAFETY_MARGIN_BPS = 100; // 1% safety margin
    
    event Deposit(address indexed user, uint256 amount, int32 leverage, uint256 finalPosition);
    event Withdraw(address indexed user, uint256 amount, uint256 received);
    event LoopExecuted(address indexed user, uint256 iteration, uint256 deposited, uint256 borrowed);
    event PositionOpened(address indexed user, uint256 totalCollateral, uint256 totalDebt, int32 leverage);
    event PositionClosed(address indexed user, uint256 withdrawn, uint256 repaid);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    modifier whenActive() {
        require(poolState.protocolState == 0, "Protocol paused");
        _;
    }
    
    constructor(
        address _usdc,
        address _asset,
        address _evc,
        address _usdcVault,
        address _assetVault,
        address _admin
    ) {
        usdc = IERC20(_usdc);
        asset = IERC20(_asset);
        evc = IEVC(_evc);
        usdcVault = IEVault(_usdcVault);
        assetVault = IEVault(_assetVault);
        admin = _admin;
        
        poolState.currentMaxLeverageBps = 40000; // 4x default
        poolState.protocolState = 0; // Active
    }
    
    /// @notice Deposit USDC and open leveraged position with actual looping
    /// @param amount Amount of USDC to deposit
    /// @param leverageBps Leverage in basis points (positive = long, negative = short)
    /// @return finalPosition The final leveraged position size
    function deposit(uint256 amount, int32 leverageBps) external whenActive returns (uint256 finalPosition) {
        require(amount > 0, "Zero deposit");
        require(leverageBps >= -40000 && leverageBps <= 40000, "Invalid leverage");
        require(uint32(_absInt32(leverageBps)) <= poolState.currentMaxLeverageBps, "Leverage too high");
        
        // Transfer USDC from user
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Store position data
        DataTypes.Position storage pos = positions[msg.sender];
        pos.depositAmount = uint128(amount);
        pos.leverageBps = leverageBps;
        pos.entryTWAP = 100e8; // Placeholder - should get from oracle
        pos.lastFeeTimestamp = uint64(block.timestamp);
        pos.isActive = true;
        
        // Execute leveraged position with actual looping
        if (leverageBps > 0) {
            // Long position: loop deposit USDC -> borrow USDC -> deposit USDC...
            finalPosition = _executeLoopLong(msg.sender, amount, leverageBps);
        } else if (leverageBps < 0) {
            // Short position: deposit USDC -> borrow asset -> sell -> deposit USDC...
            finalPosition = _executeLoopShort(msg.sender, amount, leverageBps);
        } else {
            // No leverage: just hold USDC
            finalPosition = amount;
        }
        
        // Update pool state
        poolState.totalSeniorDeposits += uint128(amount);
        
        uint256 notional = uint256(amount) * uint256(_absInt32(leverageBps)) / 10000;
        if (leverageBps > 0) {
            poolState.grossLongExposure += uint128(notional);
            poolState.netExposure += int256(notional);
        } else if (leverageBps < 0) {
            poolState.grossShortExposure += uint128(notional);
            poolState.netExposure -= int256(notional);
        }
        
        emit Deposit(msg.sender, amount, leverageBps, finalPosition);
        
        return finalPosition;
    }
    
    /// @notice Execute looping for long position (USDC collateral, borrow USDC)
    /// @dev Recursively: deposit USDC -> borrow USDC -> deposit USDC -> borrow USDC...
    function _executeLoopLong(address user, uint256 initialAmount, int32 leverageBps) internal returns (uint256) {
        // Calculate target leverage multiplier
        uint256 targetLeverage = uint256(uint32(leverageBps)); // e.g., 30000 = 3x
        uint256 targetPosition = (initialAmount * targetLeverage) / 10000;
        
        // Approve USDC vault for initial deposit
        usdc.approve(address(usdcVault), type(uint256).max);
        
        // Enable collateral and controller for EVC batch operations
        evc.enableCollateral(address(this), address(usdcVault));
        evc.enableController(address(this), address(usdcVault));
        
        uint256 totalCollateral = 0;
        uint256 totalDebt = 0;
        uint256 currentAmount = initialAmount;
        
        // Loop: deposit -> borrow -> deposit -> borrow...
        for (uint256 i = 0; i < MAX_LOOP_ITERATIONS; i++) {
            if (currentAmount < 1000) break; // Stop if amount too small (< 0.001 USDC)
            
            // Deposit current amount as collateral
            usdcVault.deposit(currentAmount, address(this));
            totalCollateral += currentAmount;
            
            // Check if we've reached target leverage
            if (totalCollateral >= targetPosition) break;
            
            // Calculate how much more we need
            uint256 remaining = targetPosition - totalCollateral;
            
            // Calculate max we can borrow (75% LTV with safety margin)
            uint256 maxBorrow = (currentAmount * (BORROW_LTV_BPS - SAFETY_MARGIN_BPS)) / 10000;
            
            // Borrow the minimum of what we need and what we can safely borrow
            uint256 borrowAmount = remaining < maxBorrow ? remaining : maxBorrow;
            
            if (borrowAmount < 1000) break; // Stop if borrow amount too small
            
            // Borrow USDC
            usdcVault.borrow(borrowAmount, address(this));
            totalDebt += borrowAmount;
            
            emit LoopExecuted(user, i, currentAmount, borrowAmount);
            
            // Next iteration will deposit the borrowed amount
            currentAmount = borrowAmount;
        }
        
        // Store Euler position
        DataTypes.EulerPosition storage eulerPos = eulerPositions[user];
        eulerPos.collateralVault = address(usdcVault);
        eulerPos.debtVault = address(usdcVault);
        eulerPos.collateralShares = uint128(usdcVault.balanceOf(address(this)));
        eulerPos.debtAmount = uint128(totalDebt);
        eulerPos.isActive = true;
        
        emit PositionOpened(user, totalCollateral, totalDebt, leverageBps);
        
        return totalCollateral;
    }
    
    /// @notice Execute looping for short position (USDC collateral, borrow asset)
    /// @dev Recursively: deposit USDC -> borrow asset -> sell for USDC -> deposit USDC...
    function _executeLoopShort(address user, uint256 initialAmount, int32 leverageBps) internal returns (uint256) {
        // Calculate target leverage multiplier
        uint256 targetLeverage = uint256(uint32(-leverageBps)); // e.g., -30000 = 3x short
        uint256 targetPosition = (initialAmount * targetLeverage) / 10000;
        
        // Approve vaults
        usdc.approve(address(usdcVault), type(uint256).max);
        asset.approve(address(assetVault), type(uint256).max);
        
        // Enable collateral and controller
        evc.enableCollateral(address(this), address(usdcVault));
        evc.enableController(address(this), address(assetVault));
        
        uint256 totalCollateral = 0;
        uint256 totalAssetDebt = 0;
        uint256 currentUSDC = initialAmount;
        
        // Loop: deposit USDC -> borrow asset -> (simulate sell) -> deposit USDC...
        for (uint256 i = 0; i < MAX_LOOP_ITERATIONS; i++) {
            if (currentUSDC < 1000) break;
            
            // Deposit USDC as collateral
            usdcVault.deposit(currentUSDC, address(this));
            totalCollateral += currentUSDC;
            
            // Check if we've reached target
            if (totalCollateral >= targetPosition) break;
            
            uint256 remaining = targetPosition - totalCollateral;
            
            // Calculate max asset we can borrow based on USDC collateral
            // Assuming 1:1 price for simplicity (should use oracle in production)
            uint256 maxBorrowAsset = (currentUSDC * (BORROW_LTV_BPS - SAFETY_MARGIN_BPS)) / 10000;
            
            // Convert to asset amount (asset is 18 decimals, USDC is 6 decimals)
            maxBorrowAsset = maxBorrowAsset * 1e12;
            
            uint256 borrowAmount = remaining < (maxBorrowAsset / 1e12) ? (remaining * 1e12) : maxBorrowAsset;
            
            if (borrowAmount < 1000 * 1e12) break;
            
            // Borrow asset
            assetVault.borrow(borrowAmount, address(this));
            totalAssetDebt += borrowAmount;
            
            // In production: swap asset for USDC here
            // For now, simulate by using equivalent USDC value
            uint256 usdcFromSale = borrowAmount / 1e12;
            
            emit LoopExecuted(user, i, currentUSDC, borrowAmount);
            
            currentUSDC = usdcFromSale;
        }
        
        // Store Euler position
        DataTypes.EulerPosition storage eulerPos = eulerPositions[user];
        eulerPos.collateralVault = address(usdcVault);
        eulerPos.debtVault = address(assetVault);
        eulerPos.collateralShares = uint128(usdcVault.balanceOf(address(this)));
        eulerPos.debtAmount = uint128(totalAssetDebt);
        eulerPos.isActive = true;
        
        emit PositionOpened(user, totalCollateral, totalAssetDebt, leverageBps);
        
        return totalCollateral;
    }
    
    /// @notice Withdraw position and unwind the loop
    /// @param amount Amount to withdraw (0 = close entire position)
    /// @return received Amount of USDC received
    function withdraw(uint256 amount) external returns (uint256 received) {
        DataTypes.Position storage pos = positions[msg.sender];
        require(pos.isActive, "No position");
        
        if (amount == 0) {
            amount = pos.depositAmount;
        }
        
        require(amount <= pos.depositAmount, "Insufficient balance");
        
        // Unwind the looped position
        received = _unwindPosition(msg.sender);
        
        // Update position
        if (amount >= pos.depositAmount) {
            pos.isActive = false;
            pos.depositAmount = 0;
        } else {
            pos.depositAmount -= uint128(amount);
        }
        
        // Update pool state
        poolState.totalSeniorDeposits -= uint128(amount);
        
        uint256 notional = uint256(amount) * uint256(_absInt32(pos.leverageBps)) / 10000;
        if (pos.leverageBps > 0) {
            poolState.grossLongExposure -= uint128(notional);
            poolState.netExposure -= int256(notional);
        } else if (pos.leverageBps < 0) {
            poolState.grossShortExposure -= uint128(notional);
            poolState.netExposure += int256(notional);
        }
        
        // Transfer USDC to user
        require(usdc.transfer(msg.sender, received), "Transfer failed");
        
        emit Withdraw(msg.sender, amount, received);
        
        return received;
    }
    
    /// @notice Unwind looped position by repaying debt and withdrawing collateral
    function _unwindPosition(address user) internal returns (uint256 received) {
        DataTypes.EulerPosition storage eulerPos = eulerPositions[user];
        require(eulerPos.isActive, "No Euler position");
        
        IEVault collVault = IEVault(eulerPos.collateralVault);
        IEVault debtVault = IEVault(eulerPos.debtVault);
        
        uint256 currentDebt = debtVault.debtOf(address(this));
        
        // Unwind loop: withdraw collateral -> repay debt -> withdraw more -> repay...
        while (currentDebt > 1000) {
            uint256 collateralBalance = collVault.balanceOf(address(this));
            
            // Calculate how much we can withdraw while maintaining health
            // We need to keep enough collateral to cover remaining debt
            uint256 maxWithdraw = collateralBalance - ((currentDebt * 10000) / BORROW_LTV_BPS);
            
            if (maxWithdraw < 1000) {
                // Can't withdraw more safely, need to repay first
                // In production, would need flash loan or external liquidity
                break;
            }
            
            // Withdraw collateral
            collVault.withdraw(maxWithdraw, address(this), address(this));
            
            // Use withdrawn funds to repay debt
            uint256 repayAmount = maxWithdraw < currentDebt ? maxWithdraw : currentDebt;
            
            if (eulerPos.collateralVault == address(usdcVault)) {
                usdc.approve(address(debtVault), repayAmount);
            } else {
                asset.approve(address(debtVault), repayAmount);
            }
            
            debtVault.repay(repayAmount, address(this));
            
            currentDebt = debtVault.debtOf(address(this));
        }
        
        // Repay any remaining dust debt
        if (currentDebt > 0) {
            uint256 collateralBalance = collVault.balanceOf(address(this));
            if (collateralBalance > 0) {
                collVault.withdraw(collateralBalance, address(this), address(this));
                
                if (eulerPos.collateralVault == address(usdcVault)) {
                    usdc.approve(address(debtVault), currentDebt);
                } else {
                    asset.approve(address(debtVault), currentDebt);
                }
                
                debtVault.repay(currentDebt, address(this));
            }
        }
        
        // Withdraw all remaining collateral
        uint256 remainingCollateral = collVault.balanceOf(address(this));
        if (remainingCollateral > 0) {
            collVault.withdraw(remainingCollateral, address(this), address(this));
        }
        
        // Calculate received amount
        received = usdc.balanceOf(address(this));
        
        // Mark position as closed
        eulerPos.isActive = false;
        
        emit PositionClosed(user, remainingCollateral, eulerPos.debtAmount);
        
        return received;
    }
    
    /// @notice Deposit into junior tranche
    function depositJunior(uint256 amount) external returns (uint256 shares) {
        require(amount > 0, "Zero deposit");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        poolState.totalJuniorDeposits += uint128(amount);
        
        emit Deposit(msg.sender, amount, 0, amount);
        return amount;
    }
    
    /// @notice Withdraw from junior tranche
    function withdrawJunior(uint256 shares) external returns (uint256 amount) {
        amount = shares;
        poolState.totalJuniorDeposits -= uint128(amount);
        
        require(usdc.transfer(msg.sender, amount), "Transfer failed");
        return amount;
    }
    
    /// @notice Get position details
    function getPosition(address user) external view returns (DataTypes.Position memory) {
        return positions[user];
    }
    
    /// @notice Get Euler position details
    function getEulerPosition(address user) external view returns (DataTypes.EulerPosition memory) {
        return eulerPositions[user];
    }
    
    /// @notice Get pool state
    function getPoolState() external view returns (DataTypes.PoolState memory) {
        return poolState;
    }
    
    /// @notice Get position health from Euler
    function getPositionHealth(address user) external view returns (uint256 collateral, uint256 debt, uint256 healthFactor) {
        DataTypes.EulerPosition memory eulerPos = eulerPositions[user];
        if (!eulerPos.isActive) {
            return (0, 0, 0);
        }
        
        IEVault collVault = IEVault(eulerPos.collateralVault);
        IEVault debtVault = IEVault(eulerPos.debtVault);
        
        collateral = collVault.balanceOf(address(this));
        debt = debtVault.debtOf(address(this));
        
        if (debt > 0) {
            healthFactor = (collateral * 10000) / debt;
        } else {
            healthFactor = type(uint256).max;
        }
    }
    
    /// @notice Pause protocol
    function pause() external onlyAdmin {
        poolState.protocolState = 2;
    }
    
    /// @notice Unpause protocol
    function unpause() external onlyAdmin {
        poolState.protocolState = 0;
    }
    
    /// @notice Emergency withdraw (admin only)
    function emergencyWithdraw(address token, uint256 amount) external onlyAdmin {
        IERC20(token).transfer(admin, amount);
    }
    
    function _absInt32(int32 x) internal pure returns (uint32) {
        return x >= 0 ? uint32(x) : uint32(-x);
    }
}
