// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

/// @title JuniorTranche
/// @notice First-loss capital pool that absorbs losses before senior users
// Junior depositors earn fee revenue but bear losses first — this is the risk/reward tradeoff
// that enables xLever to offer "no liquidation" to senior leveraged users
contract JuniorTranche {
    // Total shares outstanding — denominator for share price calculation
    uint256 public totalShares;
    // Total USDC assets held — numerator for share price; changes with fees earned and losses absorbed
    uint256 public totalAssets;

    // Per-user share balances — tracks each LP's proportional ownership of the junior pool
    mapping(address => uint256) public shares;

    // Vault address — only the vault can call deposit/withdraw/loss/fee functions
    address public vault;

    // Emitted on junior deposit — tracks assets deposited and shares issued
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    // Emitted on junior withdrawal — tracks shares burned and assets returned
    event Withdraw(address indexed user, uint256 shares, uint256 assets);
    // Emitted when junior pool absorbs a loss — reduces totalAssets (and thus share price)
    event LossAbsorbed(uint256 lossAmount, uint256 newTotalAssets);
    // Emitted when fee revenue is distributed to the junior pool — increases share price
    event FeeDistributed(uint256 feeAmount);

    // Only the parent vault can call state-changing functions — prevents unauthorized manipulation
    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        // Continue executing the function body after the check passes
        _;
    }

    /// @notice Transfer vault ownership (one-time, called during modular deployment)
    function setVault(address _newVault) external {
        require(msg.sender == vault, "Only vault");
        require(_newVault != address(0), "Zero address");
        vault = _newVault;
    }

    // Initialize with vault reference for access control
    constructor(address _vault) {
        // Store vault address — all deposits and withdrawals are routed through the vault
        vault = _vault;
    }

    /// @notice Deposit USDC into junior tranche
    /// @param depositor The actual user depositing (passed by vault)
    /// @param assets Amount of USDC to deposit
    /// @return sharesIssued Number of shares minted
    // Mints proportional shares based on current share price (totalAssets / totalShares)
    function deposit(address depositor, uint256 assets) external onlyVault returns (uint256 sharesIssued) {
        // Reject zero deposits to prevent minting zero shares
        require(assets > 0, "Zero deposit");

        // Determine how many shares to mint based on whether this is the first deposit
        if (totalShares == 0) {
            // First deposit: 1 USDC = 1 share — establishes the initial share price
            sharesIssued = assets;
        } else {
            // Subsequent deposits: mint shares proportional to existing share price
            // shares = assets * totalShares / totalAssets — maintains constant share price
            sharesIssued = assets * totalShares / totalAssets;
        }

        // Credit shares to the actual depositor, not the vault
        shares[depositor] += sharesIssued;
        // Increase total shares outstanding
        totalShares += sharesIssued;
        // Increase total assets under management
        totalAssets += assets;

        // Emit event for off-chain tracking of junior deposits
        emit Deposit(depositor, assets, sharesIssued);
    }

    /// @notice Withdraw USDC from junior tranche
    /// @param withdrawer The actual user withdrawing (passed by vault)
    /// @param sharesToBurn Number of shares to redeem
    /// @return assetsReturned Amount of USDC returned
    // Burns shares and returns proportional USDC — may be less than deposited if losses were absorbed
    function withdraw(address withdrawer, uint256 sharesToBurn) external onlyVault returns (uint256 assetsReturned) {
        // Reject zero withdrawals
        require(sharesToBurn > 0, "Zero withdrawal");
        // Ensure the user has enough shares to burn
        require(shares[withdrawer] >= sharesToBurn, "Insufficient shares");

        // Calculate USDC to return: shares * (totalAssets / totalShares) = proportional value
        assetsReturned = sharesToBurn * totalAssets / totalShares;

        // Deduct shares from the user's balance
        shares[withdrawer] -= sharesToBurn;
        // Reduce total shares outstanding
        totalShares -= sharesToBurn;
        // Reduce total assets (the USDC leaves the pool)
        totalAssets -= assetsReturned;

        // Emit event for off-chain tracking of junior withdrawals
        emit Withdraw(withdrawer, sharesToBurn, assetsReturned);
    }

    /// @notice Absorb losses from senior tranche
    /// @param lossAmount Amount of loss to absorb
    // Called when leveraged positions lose money — junior pool takes the hit first
    function absorbLoss(uint256 lossAmount) external onlyVault {
        // Ensure loss doesn't exceed available junior capital — remaining loss would need insurance
        require(lossAmount <= totalAssets, "Loss exceeds junior capital");

        // Reduce total assets — this lowers the share price for all junior LPs proportionally
        totalAssets -= lossAmount;

        // Emit event for transparency — junior LPs can see losses absorbed
        emit LossAbsorbed(lossAmount, totalAssets);
    }

    /// @notice Distribute fee revenue to junior LPs
    /// @param feeAmount Fee amount to add to junior pool
    // Called by vault after collecting entry/exit/carry fees — increases share price
    function distributeFee(uint256 feeAmount) external onlyVault {
        // Increase total assets — this raises the share price for all junior LPs proportionally
        totalAssets += feeAmount;

        // Emit event for transparency — junior LPs can see fee revenue earned
        emit FeeDistributed(feeAmount);
    }

    /// @notice Get current share price
    /// @return price Share price in USDC (6 decimals)
    // Share price reflects accumulated fees (up) and absorbed losses (down)
    function getSharePrice() external view returns (uint256 price) {
        // Return 1 USDC per share when pool is empty — defines initial price for first depositor
        if (totalShares == 0) return 1e6; // 1 USDC per share initially
        // price = totalAssets * 1e6 / totalShares — scaled to 6 decimal USDC precision
        return totalAssets * 1e6 / totalShares;
    }

    /// @notice Get junior tranche value
    /// @return value Total value in USDC
    // Returns the total USDC backing all junior shares — used for pool-level reporting
    function getTotalValue() external view returns (uint256 value) {
        return totalAssets;
    }

    /// @notice Get user's share balance
    // View function — returns raw share count for a specific address
    function getShares(address user) external view returns (uint256) {
        return shares[user];
    }

    /// @notice Get user's asset value
    // View function — converts shares to USDC value at current share price
    function getUserValue(address user) external view returns (uint256) {
        // Return zero if pool has no shares to avoid division by zero
        if (totalShares == 0) return 0;
        // value = user's shares * totalAssets / totalShares — proportional ownership
        return shares[user] * totalAssets / totalShares;
    }

    /// @notice Calculate junior ratio (junior / total pool)
    /// @param totalSeniorDeposits Total senior deposits
    /// @return ratioBps Junior ratio in basis points
    // This ratio determines the dynamic leverage cap — more junior = higher allowed leverage
    function getJuniorRatio(uint256 totalSeniorDeposits) external view returns (uint256 ratioBps) {
        // Total pool = junior assets + senior deposits
        uint256 totalPool = totalAssets + totalSeniorDeposits;
        // Return 0 if pool is empty to avoid division by zero
        if (totalPool == 0) return 0;
        // Ratio = junior / total * 10000 — expressed in basis points (e.g., 4000 = 40%)
        return totalAssets * 10000 / totalPool;
    }
}
