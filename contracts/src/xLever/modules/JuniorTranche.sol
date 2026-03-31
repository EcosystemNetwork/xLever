// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

/// @title JuniorTranche
/// @notice First-loss capital pool that absorbs losses before senior users
contract JuniorTranche {
    uint256 public totalShares;
    uint256 public totalAssets;
    
    mapping(address => uint256) public shares;
    
    address public immutable vault;
    
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 shares, uint256 assets);
    event LossAbsorbed(uint256 lossAmount, uint256 newTotalAssets);
    event FeeDistributed(uint256 feeAmount);
    
    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }
    
    constructor(address _vault) {
        vault = _vault;
    }
    
    /// @notice Deposit USDC into junior tranche
    /// @param assets Amount of USDC to deposit
    /// @return sharesIssued Number of shares minted
    function deposit(uint256 assets) external onlyVault returns (uint256 sharesIssued) {
        require(assets > 0, "Zero deposit");
        
        if (totalShares == 0) {
            // First deposit: 1:1 ratio
            sharesIssued = assets;
        } else {
            // Subsequent deposits: proportional to current share price
            sharesIssued = assets * totalShares / totalAssets;
        }
        
        shares[msg.sender] += sharesIssued;
        totalShares += sharesIssued;
        totalAssets += assets;
        
        emit Deposit(msg.sender, assets, sharesIssued);
    }
    
    /// @notice Withdraw USDC from junior tranche
    /// @param sharesToBurn Number of shares to redeem
    /// @return assetsReturned Amount of USDC returned
    function withdraw(uint256 sharesToBurn) external onlyVault returns (uint256 assetsReturned) {
        require(sharesToBurn > 0, "Zero withdrawal");
        require(shares[msg.sender] >= sharesToBurn, "Insufficient shares");
        
        // Calculate proportional assets
        assetsReturned = sharesToBurn * totalAssets / totalShares;
        
        shares[msg.sender] -= sharesToBurn;
        totalShares -= sharesToBurn;
        totalAssets -= assetsReturned;
        
        emit Withdraw(msg.sender, sharesToBurn, assetsReturned);
    }
    
    /// @notice Absorb losses from senior tranche
    /// @param lossAmount Amount of loss to absorb
    function absorbLoss(uint256 lossAmount) external onlyVault {
        require(lossAmount <= totalAssets, "Loss exceeds junior capital");
        
        totalAssets -= lossAmount;
        
        emit LossAbsorbed(lossAmount, totalAssets);
    }
    
    /// @notice Distribute fee revenue to junior LPs
    /// @param feeAmount Fee amount to add to junior pool
    function distributeFee(uint256 feeAmount) external onlyVault {
        totalAssets += feeAmount;
        
        emit FeeDistributed(feeAmount);
    }
    
    /// @notice Get current share price
    /// @return price Share price in USDC (6 decimals)
    function getSharePrice() external view returns (uint256 price) {
        if (totalShares == 0) return 1e6; // 1 USDC per share initially
        return totalAssets * 1e6 / totalShares;
    }
    
    /// @notice Get junior tranche value
    /// @return value Total value in USDC
    function getTotalValue() external view returns (uint256 value) {
        return totalAssets;
    }
    
    /// @notice Get user's share balance
    function getShares(address user) external view returns (uint256) {
        return shares[user];
    }
    
    /// @notice Get user's asset value
    function getUserValue(address user) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return shares[user] * totalAssets / totalShares;
    }
    
    /// @notice Calculate junior ratio (junior / total pool)
    /// @param totalSeniorDeposits Total senior deposits
    /// @return ratioBps Junior ratio in basis points
    function getJuniorRatio(uint256 totalSeniorDeposits) external view returns (uint256 ratioBps) {
        uint256 totalPool = totalAssets + totalSeniorDeposits;
        if (totalPool == 0) return 0;
        return totalAssets * 10000 / totalPool;
    }
}
