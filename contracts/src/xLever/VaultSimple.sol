// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import shared structs so positions and pool state are ABI-compatible with the full Vault
import {DataTypes} from "./libraries/DataTypes.sol";

// Minimal ERC-20 interface — only the transfer methods VaultSimple actually uses
interface IERC20 {
    // transferFrom needed to pull USDC from depositors into the vault
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    // transfer needed to send USDC back to users on withdrawal
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title VaultSimple
/// @notice Simplified vault for xLever protocol (under contract size limit)
// Lightweight version of Vault for fast deployment and testing — no fees, no hedging, no oracle
contract VaultSimple {
    // USDC token — settlement currency for all deposits and withdrawals
    IERC20 public immutable usdc;
    // Tokenized asset address — identifies which asset this vault tracks (e.g. xQQQ)
    address public immutable asset;
    // Admin address — has authority over privileged operations
    address public admin;

    // Pool-wide accounting state — same struct as full Vault for interface compatibility
    DataTypes.PoolState public poolState;
    // Direct position storage — simplified version doesn't use a separate PositionModule
    mapping(address => DataTypes.Position) public positions;

    // Events for off-chain indexing — simplified versions without senior/junior distinction
    event Deposit(address indexed user, uint256 amount, int32 leverage);
    event Withdraw(address indexed user, uint256 amount);

    // Restrict admin functions to the designated admin address
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        // Continue executing the function body after the check passes
        _;
    }

    // Deploy simple vault with minimal configuration — no modules needed
    constructor(address _usdc, address _asset, address _admin) {
        // Store USDC reference as immutable to save gas on repeated access
        usdc = IERC20(_usdc);
        // Store asset address so the vault knows which tokenized asset it manages
        asset = _asset;
        // Store admin for access control
        admin = _admin;
        // Set default max leverage to 3.5x (35000 bps) — matches deployed vault configuration
        poolState.currentMaxLeverageBps = 35000;
        // Set protocol to active state (0) so trading can begin immediately
        poolState.protocolState = 0;
    }

    /// @notice Deposit USDC (simplified - no fees, no hedging)
    // No payable — simplified vault doesn't need Pyth oracle updates
    function deposit(uint256 amount, int32 leverageBps) external returns (uint256) {
        // Reject zero deposits to prevent empty positions
        require(amount > 0, "Zero deposit");
        // Enforce leverage bounds: -3.5x to +3.5x matching the deployed vault configuration
        require(leverageBps >= -35000 && leverageBps <= 35000, "Invalid leverage");

        // Pull USDC from the user — must have prior approval
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Get storage pointer to user's position for efficient writes
        DataTypes.Position storage pos = positions[msg.sender];
        // Record deposit amount — no fee deduction in simplified version
        pos.depositAmount = uint128(amount);
        // Record chosen leverage for PnL calculation
        pos.leverageBps = leverageBps;
        // Use placeholder price since simplified vault has no oracle integration
        pos.entryTWAP = 100e8; // Placeholder price
        // Record timestamp for future fee settlement (not used in simplified version yet)
        pos.lastFeeTimestamp = uint64(block.timestamp);
        // Mark position as active so withdrawal checks pass
        pos.isActive = true;

        // Track total senior deposits for pool-level accounting
        poolState.totalSeniorDeposits += uint128(amount);

        // Emit event for off-chain indexers and UI
        emit Deposit(msg.sender, amount, leverageBps);
        // Return full deposit amount since no fees are charged
        return amount;
    }

    /// @notice Withdraw (simplified)
    // No oracle update needed — simplified vault uses deposit-amount-based withdrawal only
    function withdraw(uint256 amount) external returns (uint256) {
        // Get storage pointer to user's position for efficient reads and writes
        DataTypes.Position storage pos = positions[msg.sender];
        // Ensure user has an active position to withdraw from
        require(pos.isActive, "No position");
        // If amount is 0, withdraw all — convenience for full position closure
        uint256 withdrawAmount = amount == 0 ? pos.depositAmount : amount;
        // Prevent withdrawing more than deposited — no PnL in simplified version
        require(withdrawAmount <= pos.depositAmount, "Insufficient balance");

        // Reduce deposit by withdrawal amount — supports partial withdrawals
        pos.depositAmount -= uint128(withdrawAmount);
        // If fully withdrawn, mark position as inactive to free the slot
        if (pos.depositAmount == 0) {
            pos.isActive = false;
        }

        // Reduce tracked senior deposits to keep pool-level accounting accurate
        poolState.totalSeniorDeposits -= uint128(withdrawAmount);

        // Transfer USDC back to the user
        require(usdc.transfer(msg.sender, withdrawAmount), "Transfer failed");

        // Emit withdrawal event for off-chain tracking
        emit Withdraw(msg.sender, withdrawAmount);
        // Return amount withdrawn (same as requested since no fees)
        return withdrawAmount;
    }

    /// @notice Get position
    // View function — returns full position struct for UI display
    function getPosition(address user) external view returns (DataTypes.Position memory) {
        // Read from storage and return as memory — no access control needed for view
        return positions[user];
    }

    /// @notice Get pool state
    // View function — returns pool state struct for dashboard display
    function getPoolState() external view returns (DataTypes.PoolState memory) {
        // Return full pool state for interface compatibility with full Vault
        return poolState;
    }
}
