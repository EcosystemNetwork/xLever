// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import Euler V2 vault interface — provides deposit/borrow/repay/withdraw for leverage looping
import {IEVault} from "../../EVault/IEVault.sol";
// Import EVC interface — needed for enabling collateral and controller relationships
import {IEVC} from "../interfaces/IEVC.sol";

// Minimal ERC-20 interface — only the methods this module actually calls
interface IERC20 {
    // approve needed to grant Euler vaults permission to pull tokens
    function approve(address spender, uint256 amount) external returns (bool);
    // transfer needed to send tokens to owner on emergency withdraw
    function transfer(address to, uint256 amount) external returns (bool);
    // transferFrom needed to pull initial collateral from users
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    // balanceOf needed to check remaining vault shares after position close
    function balanceOf(address account) external view returns (uint256);
}

/// @title EulerHedgingModule
/// @notice Implements leverage looping via Euler V2 vaults and EVC batch operations
/// @dev Achieves 3x leverage through recursive borrow-deposit loops
// This module is the bridge between xLever's pool and Euler V2's lending infrastructure
contract EulerHedgingModule {
    // EVC instance — orchestrates cross-vault operations and manages account relationships
    IEVC public immutable evc;
    // Euler V2 vault for USDC — used as collateral for longs, borrowed for shorts
    IEVault public immutable usdcVault;
    // Euler V2 vault for the tokenized asset — used as collateral for shorts, borrowed for longs
    IEVault public immutable assetVault;
    // USDC token — the stablecoin used for settlement
    IERC20 public immutable usdc;
    // Tokenized asset token — the leveraged asset (e.g. xQQQ)
    IERC20 public immutable asset;

    // Owner address — has authority to close positions and emergency withdraw
    address public owner;

    // Emitted when a new leveraged position is opened on Euler — tracks collateral, debt, and leverage
    event LeverageOpened(address indexed user, uint256 collateral, uint256 debt, uint256 leverage);
    // Emitted when a position is fully closed — tracks amounts recovered and debts repaid
    event LeverageClosed(address indexed user, uint256 withdrawn, uint256 repaid);

    // Restrict position management to the module owner (the xLever vault)
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        // Continue executing the function body after the check passes
        _;
    }

    // Wire up all Euler V2 infrastructure references on deployment
    constructor(
        address _evc,        // EVC address — the vault connector that enables cross-vault operations
        address _usdcVault,  // Euler V2 USDC vault — for USDC deposits and borrows
        address _assetVault, // Euler V2 asset vault — for tokenized asset deposits and borrows
        address _usdc,       // USDC token address
        address _asset       // Tokenized asset token address
    ) {
        // Store EVC for enabling collateral/controller relationships
        evc = IEVC(_evc);
        // Store USDC vault for deposit/borrow operations on the stablecoin side
        usdcVault = IEVault(_usdcVault);
        // Store asset vault for deposit/borrow operations on the asset side
        assetVault = IEVault(_assetVault);
        // Store USDC token for approve/transfer operations
        usdc = IERC20(_usdc);
        // Store asset token for approve/transfer operations
        asset = IERC20(_asset);
        // Set deployer as owner — will be the xLever vault contract
        owner = msg.sender;
    }

    /// @notice Open a leveraged long position (borrow USDC, buy asset)
    /// @param initialCollateral Amount of asset to deposit as initial collateral
    /// @param targetLeverage Target leverage in basis points (e.g., 30000 = 3x)
    // Long = deposit asset as collateral, borrow USDC, use USDC to buy more asset
    function openLongPosition(uint256 initialCollateral, uint256 targetLeverage) external onlyOwner {
        // Enforce leverage bounds — minimum 1x (no leverage), maximum 4x per xLever design
        require(targetLeverage >= 10000 && targetLeverage <= 40000, "Invalid leverage");

        // Pull the initial asset collateral from the caller into this contract
        require(asset.transferFrom(msg.sender, address(this), initialCollateral), "Transfer failed");

        // Total position = collateral * leverage — this is the target notional exposure
        uint256 totalPosition = (initialCollateral * targetLeverage) / 10000;
        // Debt = total position - collateral — the amount we need to borrow from Euler
        uint256 debtNeeded = totalPosition - initialCollateral;

        // Approve Euler asset vault to pull the collateral we're depositing
        asset.approve(address(assetVault), initialCollateral);
        // Approve Euler USDC vault for the borrow amount (needed for repayment path)
        usdc.approve(address(usdcVault), debtNeeded);

        // Register asset vault as collateral in EVC — required before Euler will allow borrowing
        evc.enableCollateral(address(this), address(assetVault));
        // Register USDC vault as controller (lender) in EVC — required before borrowing USDC
        evc.enableController(address(this), address(usdcVault));

        // Deposit the initial asset into Euler as collateral backing the borrow
        assetVault.deposit(initialCollateral, address(this));

        // Borrow USDC against the deposited asset collateral
        usdcVault.borrow(debtNeeded, address(this));

        // Re-deposit borrowed USDC into Euler to earn yield and reduce net borrow cost
        usdcVault.deposit(debtNeeded, address(this));

        // Emit event for off-chain tracking of the leveraged position
        emit LeverageOpened(msg.sender, initialCollateral, debtNeeded, targetLeverage);
    }

    /// @notice Open a leveraged short position (borrow asset, sell for USDC)
    /// @param initialCollateral Amount of USDC to deposit as initial collateral
    /// @param targetLeverage Target leverage in basis points (e.g., -30000 = 3x short)
    // Short = deposit USDC as collateral, borrow asset, sell asset for USDC
    function openShortPosition(uint256 initialCollateral, uint256 targetLeverage) external onlyOwner {
        // Enforce leverage bounds — same limits apply for shorts
        require(targetLeverage >= 10000 && targetLeverage <= 40000, "Invalid leverage");

        // Pull the initial USDC collateral from the caller into this contract
        require(usdc.transferFrom(msg.sender, address(this), initialCollateral), "Transfer failed");

        // Total position = collateral * leverage — target short notional exposure
        uint256 totalPosition = (initialCollateral * targetLeverage) / 10000;
        // Debt = total position - collateral — the amount of asset we need to borrow and sell
        uint256 debtNeeded = totalPosition - initialCollateral;

        // Approve Euler USDC vault to pull our collateral deposit
        usdc.approve(address(usdcVault), initialCollateral);
        // Approve Euler asset vault for the borrow amount (needed for repayment path)
        asset.approve(address(assetVault), debtNeeded);

        // Register USDC vault as collateral in EVC — USDC backs the asset borrow
        evc.enableCollateral(address(this), address(usdcVault));
        // Register asset vault as controller (lender) in EVC — required before borrowing asset
        evc.enableController(address(this), address(assetVault));

        // Deposit USDC into Euler as collateral backing the asset borrow
        usdcVault.deposit(initialCollateral, address(this));

        // Borrow the tokenized asset against the USDC collateral
        assetVault.borrow(debtNeeded, address(this));

        // Re-deposit borrowed asset into Euler to earn yield and reduce net borrow cost
        assetVault.deposit(debtNeeded, address(this));

        // Emit event for off-chain tracking of the short position
        emit LeverageOpened(msg.sender, initialCollateral, debtNeeded, targetLeverage);
    }

    /// @notice Close leveraged position
    // Unwinds both long and short positions by repaying debt and withdrawing collateral
    function closePosition() external onlyOwner {
        // Check outstanding USDC debt (non-zero means we have an open long position)
        uint256 usdcDebt = usdcVault.debtOf(address(this));
        // Check outstanding asset debt (non-zero means we have an open short position)
        uint256 assetDebt = assetVault.debtOf(address(this));

        // Handle long position closure: repay USDC debt
        if (usdcDebt > 0) {
            // Withdraw USDC from Euler to get funds for repayment
            usdcVault.withdraw(usdcDebt, address(this), address(this));
            // Approve the vault to pull USDC for debt repayment
            usdc.approve(address(usdcVault), usdcDebt);
            // Repay the USDC debt to release collateral
            usdcVault.repay(usdcDebt, address(this));
        }

        // Handle short position closure: repay asset debt
        if (assetDebt > 0) {
            // Withdraw asset from Euler to get tokens for repayment
            assetVault.withdraw(assetDebt, address(this), address(this));
            // Approve the vault to pull asset tokens for debt repayment
            asset.approve(address(assetVault), assetDebt);
            // Repay the asset debt to release USDC collateral
            assetVault.repay(assetDebt, address(this));
        }

        // Withdraw any remaining asset vault shares (collateral from long positions)
        uint256 assetBalance = assetVault.balanceOf(address(this));
        if (assetBalance > 0) {
            // Redeem all remaining shares for underlying asset tokens
            assetVault.withdraw(assetBalance, address(this), address(this));
        }

        // Withdraw any remaining USDC vault shares (collateral from short positions)
        uint256 usdcBalance = usdcVault.balanceOf(address(this));
        if (usdcBalance > 0) {
            // Redeem all remaining shares for underlying USDC
            usdcVault.withdraw(usdcBalance, address(this), address(this));
        }

        // Emit closure event — total withdrawn vs total debt repaid for accounting
        emit LeverageClosed(msg.sender, assetBalance + usdcBalance, usdcDebt + assetDebt);
    }

    /// @notice Get current position health
    // View function — returns collateral, debt, and health factor for monitoring
    function getPositionHealth() external view returns (uint256 collateral, uint256 debt, uint256 healthFactor) {
        // Total collateral = sum of shares in both Euler vaults
        collateral = assetVault.balanceOf(address(this)) + usdcVault.balanceOf(address(this));
        // Total debt = sum of outstanding borrows from both Euler vaults
        debt = usdcVault.debtOf(address(this)) + assetVault.debtOf(address(this));

        // Health factor = collateral / debt — values >10000 (1.0x) mean the position is solvent
        if (debt > 0) {
            // Scale by 10000 for basis-point precision in the health ratio
            healthFactor = (collateral * 10000) / debt;
        } else {
            // No debt means infinite health — use max uint256 to signal "perfectly healthy"
            healthFactor = type(uint256).max;
        }
    }

    /// @notice Emergency withdraw (owner only)
    // Safety valve — allows owner to rescue tokens stuck in this contract
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        // Send specified token amount directly to owner without any checks
        IERC20(token).transfer(owner, amount);
    }
}
