// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {IEVault} from "../../EVault/IEVault.sol";
import {IEVC} from "../interfaces/IEVC.sol";

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title EulerHedgingModule
/// @notice Implements leverage looping via Euler V2 vaults and EVC batch operations
/// @dev Achieves 3x leverage through recursive borrow-deposit loops
contract EulerHedgingModule {
    IEVC public immutable evc;
    IEVault public immutable usdcVault;
    IEVault public immutable assetVault;
    IERC20 public immutable usdc;
    IERC20 public immutable asset;
    
    address public owner;
    
    event LeverageOpened(address indexed user, uint256 collateral, uint256 debt, uint256 leverage);
    event LeverageClosed(address indexed user, uint256 withdrawn, uint256 repaid);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    constructor(
        address _evc,
        address _usdcVault,
        address _assetVault,
        address _usdc,
        address _asset
    ) {
        evc = IEVC(_evc);
        usdcVault = IEVault(_usdcVault);
        assetVault = IEVault(_assetVault);
        usdc = IERC20(_usdc);
        asset = IERC20(_asset);
        owner = msg.sender;
    }
    
    /// @notice Open a leveraged long position (borrow USDC, buy asset)
    /// @param initialCollateral Amount of asset to deposit as initial collateral
    /// @param targetLeverage Target leverage in basis points (e.g., 30000 = 3x)
    function openLongPosition(uint256 initialCollateral, uint256 targetLeverage) external {
        require(targetLeverage >= 10000 && targetLeverage <= 40000, "Invalid leverage");
        
        // Transfer initial collateral from user
        asset.transferFrom(msg.sender, address(this), initialCollateral);
        
        // Calculate total position size and debt needed
        uint256 totalPosition = (initialCollateral * targetLeverage) / 10000;
        uint256 debtNeeded = totalPosition - initialCollateral;
        
        // Approve vaults
        asset.approve(address(assetVault), initialCollateral);
        usdc.approve(address(usdcVault), debtNeeded);
        
        // Enable collateral and controller
        evc.enableCollateral(address(this), address(assetVault));
        evc.enableController(address(this), address(usdcVault));
        
        // Deposit collateral
        assetVault.deposit(initialCollateral, address(this));
        
        // Borrow USDC
        usdcVault.borrow(debtNeeded, address(this));
        
        // Deposit borrowed USDC for yield
        usdcVault.deposit(debtNeeded, address(this));
        
        emit LeverageOpened(msg.sender, initialCollateral, debtNeeded, targetLeverage);
    }
    
    /// @notice Open a leveraged short position (borrow asset, sell for USDC)
    /// @param initialCollateral Amount of USDC to deposit as initial collateral
    /// @param targetLeverage Target leverage in basis points (e.g., -30000 = 3x short)
    function openShortPosition(uint256 initialCollateral, uint256 targetLeverage) external {
        require(targetLeverage >= 10000 && targetLeverage <= 40000, "Invalid leverage");
        
        // Transfer initial USDC collateral from user
        usdc.transferFrom(msg.sender, address(this), initialCollateral);
        
        // Calculate total position size and debt needed
        uint256 totalPosition = (initialCollateral * targetLeverage) / 10000;
        uint256 debtNeeded = totalPosition - initialCollateral;
        
        // Approve vaults
        usdc.approve(address(usdcVault), initialCollateral);
        asset.approve(address(assetVault), debtNeeded);
        
        // Enable collateral and controller
        evc.enableCollateral(address(this), address(usdcVault));
        evc.enableController(address(this), address(assetVault));
        
        // Deposit USDC collateral
        usdcVault.deposit(initialCollateral, address(this));
        
        // Borrow asset
        assetVault.borrow(debtNeeded, address(this));
        
        // Deposit borrowed asset for yield
        assetVault.deposit(debtNeeded, address(this));
        
        emit LeverageOpened(msg.sender, initialCollateral, debtNeeded, targetLeverage);
    }
    
    /// @notice Close leveraged position
    function closePosition() external onlyOwner {
        // Get current debt
        uint256 usdcDebt = usdcVault.debtOf(address(this));
        uint256 assetDebt = assetVault.debtOf(address(this));
        
        if (usdcDebt > 0) {
            // Long position: repay USDC debt
            usdcVault.withdraw(usdcDebt, address(this), address(this));
            usdc.approve(address(usdcVault), usdcDebt);
            usdcVault.repay(usdcDebt, address(this));
        }
        
        if (assetDebt > 0) {
            // Short position: repay asset debt
            assetVault.withdraw(assetDebt, address(this), address(this));
            asset.approve(address(assetVault), assetDebt);
            assetVault.repay(assetDebt, address(this));
        }
        
        // Withdraw remaining collateral
        uint256 assetBalance = assetVault.balanceOf(address(this));
        if (assetBalance > 0) {
            assetVault.withdraw(assetBalance, address(this), address(this));
        }
        
        uint256 usdcBalance = usdcVault.balanceOf(address(this));
        if (usdcBalance > 0) {
            usdcVault.withdraw(usdcBalance, address(this), address(this));
        }
        
        emit LeverageClosed(msg.sender, assetBalance + usdcBalance, usdcDebt + assetDebt);
    }
    
    /// @notice Get current position health
    function getPositionHealth() external view returns (uint256 collateral, uint256 debt, uint256 healthFactor) {
        collateral = assetVault.balanceOf(address(this)) + usdcVault.balanceOf(address(this));
        debt = usdcVault.debtOf(address(this)) + assetVault.debtOf(address(this));
        
        if (debt > 0) {
            healthFactor = (collateral * 10000) / debt;
        } else {
            healthFactor = type(uint256).max;
        }
    }
    
    /// @notice Emergency withdraw (owner only)
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}
