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

/// @title VaultWithHedging
/// @notice xLever vault with integrated Euler V2 hedging for actual position execution
/// @dev This contract accepts USDC/stock deposits and executes leveraged positions through Euler vaults
contract VaultWithHedging {
    IERC20 public immutable usdc;
    IERC20 public immutable asset;
    
    IEVC public immutable evc;
    IEVault public immutable usdcVault;
    IEVault public immutable assetVault;
    
    address public admin;
    
    DataTypes.PoolState public poolState;
    mapping(address => DataTypes.Position) public positions;
    mapping(address => DataTypes.EulerPosition) public eulerPositions;
    
    event Deposit(address indexed user, uint256 amount, int32 leverage, uint256 positionValue);
    event Withdraw(address indexed user, uint256 amount, uint256 received);
    event PositionOpened(address indexed user, uint256 collateral, uint256 debt, int32 leverage);
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
    
    /// @notice Deposit USDC and open leveraged position
    /// @param amount Amount of USDC to deposit
    /// @param leverageBps Leverage in basis points (positive = long, negative = short)
    /// @return positionValue The value of the opened position
    function depositUSDC(uint256 amount, int32 leverageBps) external whenActive returns (uint256 positionValue) {
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
        
        // Execute leveraged position through Euler
        if (leverageBps > 0) {
            // Long position: deposit USDC as collateral, borrow more USDC, buy asset
            positionValue = _openLongPosition(msg.sender, amount, leverageBps);
        } else if (leverageBps < 0) {
            // Short position: deposit USDC as collateral, borrow asset, sell for USDC
            positionValue = _openShortPosition(msg.sender, amount, leverageBps);
        } else {
            // No leverage: just hold USDC
            positionValue = amount;
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
        
        emit Deposit(msg.sender, amount, leverageBps, positionValue);
        
        return positionValue;
    }
    
    /// @notice Deposit stock/asset and open leveraged position
    /// @param amount Amount of asset to deposit
    /// @param leverageBps Leverage in basis points (positive = long, negative = short)
    /// @return positionValue The value of the opened position
    function depositAsset(uint256 amount, int32 leverageBps) external whenActive returns (uint256 positionValue) {
        require(amount > 0, "Zero deposit");
        require(leverageBps >= 10000 && leverageBps <= 40000, "Invalid leverage for asset deposit");
        
        // Transfer asset from user
        require(asset.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Store position data
        DataTypes.Position storage pos = positions[msg.sender];
        pos.depositAmount = uint128(amount); // Store in asset terms
        pos.leverageBps = leverageBps;
        pos.entryTWAP = 100e8; // Placeholder
        pos.lastFeeTimestamp = uint64(block.timestamp);
        pos.isActive = true;
        
        // Execute leveraged long position (asset as collateral)
        positionValue = _openLongPositionWithAsset(msg.sender, amount, leverageBps);
        
        // Update pool state
        uint256 notional = uint256(amount) * uint256(_absInt32(leverageBps)) / 10000;
        poolState.grossLongExposure += uint128(notional);
        poolState.netExposure += int256(notional);
        
        emit Deposit(msg.sender, amount, leverageBps, positionValue);
        
        return positionValue;
    }
    
    /// @notice Withdraw position and close Euler position
    /// @param amount Amount to withdraw (0 = close entire position)
    /// @return received Amount of USDC received
    function withdraw(uint256 amount) external returns (uint256 received) {
        DataTypes.Position storage pos = positions[msg.sender];
        require(pos.isActive, "No position");
        
        if (amount == 0) {
            amount = pos.depositAmount;
        }
        
        require(amount <= pos.depositAmount, "Insufficient balance");
        
        // Close Euler position
        received = _closePosition(msg.sender);
        
        // Update position
        if (amount >= pos.depositAmount) {
            // Full withdrawal
            pos.isActive = false;
            pos.depositAmount = 0;
        } else {
            // Partial withdrawal
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
    
    /// @notice Open long position through Euler (borrow USDC, buy asset)
    function _openLongPosition(address user, uint256 collateral, int32 leverageBps) internal returns (uint256) {
        // Calculate position size
        uint256 targetLeverage = uint256(uint32(leverageBps));
        uint256 totalPosition = (collateral * targetLeverage) / 10000;
        uint256 debtNeeded = totalPosition - collateral;
        
        // Approve USDC vault
        usdc.approve(address(usdcVault), collateral);
        
        // Enable collateral and controller
        evc.enableCollateral(address(this), address(usdcVault));
        evc.enableController(address(this), address(usdcVault));
        
        // Deposit USDC as collateral
        usdcVault.deposit(collateral, address(this));
        
        if (debtNeeded > 0) {
            // Borrow additional USDC
            usdcVault.borrow(debtNeeded, address(this));
            
            // In real implementation: swap borrowed USDC for asset
            // For now, just hold the borrowed USDC (simulating asset purchase)
            // The borrowed USDC stays in the vault contract
        }
        
        // Store Euler position
        DataTypes.EulerPosition storage eulerPos = eulerPositions[user];
        eulerPos.collateralVault = address(usdcVault);
        eulerPos.debtVault = address(usdcVault);
        eulerPos.collateralShares = uint128(usdcVault.balanceOf(address(this)));
        eulerPos.debtAmount = uint128(debtNeeded);
        eulerPos.isActive = true;
        
        emit PositionOpened(user, collateral, debtNeeded, leverageBps);
        
        return totalPosition;
    }
    
    /// @notice Open short position through Euler (borrow asset, sell for USDC)
    function _openShortPosition(address user, uint256 collateral, int32 leverageBps) internal returns (uint256) {
        // Calculate position size
        uint256 targetLeverage = uint256(uint32(-leverageBps));
        uint256 totalPosition = (collateral * targetLeverage) / 10000;
        uint256 assetDebtNeeded = totalPosition - collateral;
        
        // Approve USDC vault
        usdc.approve(address(usdcVault), collateral);
        
        // Enable collateral and controller
        evc.enableCollateral(address(this), address(usdcVault));
        evc.enableController(address(this), address(assetVault));
        
        // Deposit USDC as collateral
        usdcVault.deposit(collateral, address(this));
        
        if (assetDebtNeeded > 0) {
            // Borrow asset
            assetVault.borrow(assetDebtNeeded, address(this));
            
            // In real implementation: swap borrowed asset for USDC
            // For now, just hold the borrowed asset (simulating sale)
            // The borrowed asset stays in the vault contract
        }
        
        // Store Euler position
        DataTypes.EulerPosition storage eulerPos = eulerPositions[user];
        eulerPos.collateralVault = address(usdcVault);
        eulerPos.debtVault = address(assetVault);
        eulerPos.collateralShares = uint128(usdcVault.balanceOf(address(this)));
        eulerPos.debtAmount = uint128(assetDebtNeeded);
        eulerPos.isActive = true;
        
        emit PositionOpened(user, collateral, assetDebtNeeded, leverageBps);
        
        return totalPosition;
    }
    
    /// @notice Open long position with asset as collateral
    function _openLongPositionWithAsset(address user, uint256 collateral, int32 leverageBps) internal returns (uint256) {
        // Calculate position size
        uint256 targetLeverage = uint256(uint32(leverageBps));
        uint256 totalPosition = (collateral * targetLeverage) / 10000;
        uint256 assetDebtNeeded = totalPosition - collateral;
        
        // Convert asset debt to USDC equivalent (assuming 1:1 price, adjust decimals)
        // Asset is 18 decimals, USDC is 6 decimals
        // In real implementation, would use oracle price
        uint256 usdcDebtNeeded = assetDebtNeeded / 1e12; // Convert 18 decimals to 6 decimals
        
        // Approve asset vault
        asset.approve(address(assetVault), collateral);
        
        // Enable collateral and controller
        evc.enableCollateral(address(this), address(assetVault));
        evc.enableController(address(this), address(usdcVault));
        
        // Deposit asset as collateral
        assetVault.deposit(collateral, address(this));
        
        if (usdcDebtNeeded > 0) {
            // Borrow USDC
            usdcVault.borrow(usdcDebtNeeded, address(this));
            
            // In real implementation: swap borrowed USDC for more asset
            // For now, just hold the borrowed USDC (simulating asset purchase)
            // The borrowed USDC stays in the vault contract
        }
        
        // Store Euler position
        DataTypes.EulerPosition storage eulerPos = eulerPositions[user];
        eulerPos.collateralVault = address(assetVault);
        eulerPos.debtVault = address(usdcVault);
        eulerPos.collateralShares = uint128(assetVault.balanceOf(address(this)));
        eulerPos.debtAmount = uint128(usdcDebtNeeded);
        eulerPos.isActive = true;
        
        emit PositionOpened(user, collateral, usdcDebtNeeded, leverageBps);
        
        return totalPosition;
    }
    
    /// @notice Close Euler position and return funds
    function _closePosition(address user) internal returns (uint256 received) {
        DataTypes.EulerPosition storage eulerPos = eulerPositions[user];
        require(eulerPos.isActive, "No Euler position");
        
        IEVault collVault = IEVault(eulerPos.collateralVault);
        IEVault debtVault = IEVault(eulerPos.debtVault);
        
        // Get current debt
        uint256 currentDebt = debtVault.debtOf(address(this));
        
        if (currentDebt > 0) {
            // Withdraw collateral to repay debt
            uint256 collateralBalance = collVault.balanceOf(address(this));
            
            if (collateralBalance > 0) {
                // Withdraw from collateral vault
                collVault.withdraw(collateralBalance, address(this), address(this));
                
                // Approve debt vault for repayment
                if (eulerPos.collateralVault == address(usdcVault)) {
                    usdc.approve(address(debtVault), currentDebt);
                } else {
                    asset.approve(address(debtVault), currentDebt);
                }
                
                // Repay debt
                debtVault.repay(currentDebt, address(this));
            }
        }
        
        // Withdraw remaining collateral
        uint256 remainingCollateral = collVault.balanceOf(address(this));
        if (remainingCollateral > 0) {
            collVault.withdraw(remainingCollateral, address(this), address(this));
        }
        
        // Calculate received amount (in USDC terms)
        received = usdc.balanceOf(address(this));
        
        // Mark position as closed
        eulerPos.isActive = false;
        
        emit PositionClosed(user, remainingCollateral, currentDebt);
        
        return received;
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
