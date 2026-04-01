// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import shared structs so Position type is consistent across all contracts
import {DataTypes} from "../libraries/DataTypes.sol";
// Import TWAP oracle interface to read prices for PnL calculation and entry price recording
import {ITWAPOracle} from "../interfaces/ITWAPOracle.sol";

/// @title PositionModule
/// @notice Manages user positions with fixed-entry leverage tracking
// Separated from Vault for modularity — Vault delegates all position CRUD here
contract PositionModule {
    // Storage for all user positions — maps user address to their position state
    mapping(address => DataTypes.Position) public positions;

    // TWAP oracle reference — needed to read current price for PnL calculations
    ITWAPOracle public immutable oracle;
    // Vault address — used for access control (only vault can modify positions)
    address public immutable vault;

    // 1-hour cooldown after increasing leverage — prevents gaming by rapid leverage flips
    uint256 constant LEVERAGE_INCREASE_DELAY = 1 hours;
    // 4-hour cooldown after flipping direction (long to short or vice versa) — prevents arbitrage attacks
    uint256 constant LEVERAGE_FLIP_DELAY = 4 hours;

    // Emitted when a new position is opened — captures entry parameters for off-chain tracking
    event PositionOpened(address indexed user, uint256 deposit, int32 leverage, uint128 entryTWAP);
    // Emitted when a position is fully closed — captures final value and PnL
    event PositionClosed(address indexed user, uint256 finalValue, int256 pnl);
    // Emitted when leverage is adjusted — captures old and new values for audit trail
    event PositionAdjusted(address indexed user, int32 oldLeverage, int32 newLeverage);

    // Only the parent vault can call position-mutating functions — prevents unauthorized changes
    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        // Continue executing the function body after the check passes
        _;
    }

    // Wire up oracle and vault references on deployment
    constructor(address _oracle, address _vault) {
        // Store oracle for reading TWAP prices during PnL calculations
        oracle = ITWAPOracle(_oracle);
        // Store vault address for the onlyVault access control modifier
        vault = _vault;
    }

    /// @notice Open or update a position
    // Called by Vault.deposit() — creates a new position or updates an existing one
    function updatePosition(
        address user,         // The user whose position to create/update
        uint128 depositAmount,// Net USDC after entry fees
        int32 leverageBps,    // Signed leverage (-4x to +4x in bps)
        uint128 entryTWAP     // Current TWAP locked as entry price
    ) external onlyVault {
        // Get storage pointer for efficient reads and writes
        DataTypes.Position storage pos = positions[user];

        // Branch on whether this is a new or existing position
        if (!pos.isActive) {
            // New position — initialize all fields from scratch
            // Record the net deposit (after fees) as the position's principal
            pos.depositAmount = depositAmount;
            // Record the chosen leverage multiplier
            pos.leverageBps = leverageBps;
            // Lock in the current TWAP as the entry price for future PnL calculation
            pos.entryTWAP = entryTWAP;
            // Start the fee accrual clock at current time
            pos.lastFeeTimestamp = uint64(block.timestamp);
            // No fees settled yet on a fresh position
            pos.settledFees = 0;
            // No leverage lock on initial open — user can adjust immediately
            pos.leverageLockExpiry = 0;
            // Mark the position slot as occupied
            pos.isActive = true;

            // Emit event for off-chain indexing of new positions
            emit PositionOpened(user, depositAmount, leverageBps, entryTWAP);
        } else {
            // Existing position — overwrite deposit, leverage, and entry price
            // Update deposit amount (e.g., after adding to position)
            pos.depositAmount = depositAmount;
            // Update leverage (may change direction or magnitude)
            pos.leverageBps = leverageBps;
            // Reset entry TWAP since position parameters changed
            pos.entryTWAP = entryTWAP;
        }
    }

    /// @notice Close a position
    // Called by Vault.withdraw() — calculates final PnL and deletes position state
    function closePosition(address user) external onlyVault returns (uint256 finalValue, int256 pnl) {
        // Get storage pointer to validate and then delete
        DataTypes.Position storage pos = positions[user];
        // Ensure position exists before attempting to close
        require(pos.isActive, "No position");

        // Calculate final value and PnL at current TWAP before deleting
        (finalValue, pnl) = calculatePositionValue(user);

        // Emit closure event with final accounting for off-chain records
        emit PositionClosed(user, finalValue, pnl);

        // Delete all position state to free storage and gas refund
        delete positions[user];
    }

    /// @notice Adjust leverage with lock checks
    // Called by Vault.adjustLeverage() — applies cooldown rules before changing leverage
    function adjustLeverage(address user, int32 newLeverageBps) external onlyVault {
        // Get storage pointer for reading current state and writing updates
        DataTypes.Position storage pos = positions[user];
        // Ensure position exists before attempting to adjust
        require(pos.isActive, "No position");

        // Cache old leverage for comparison and event emission
        int32 oldLeverage = pos.leverageBps;

        // Check leverage increase lock — prevents rapid leverage pumping for manipulation
        if (_abs(newLeverageBps) > _abs(oldLeverage)) {
            // Increasing absolute leverage requires the cooldown to have expired
            require(block.timestamp >= pos.leverageLockExpiry, "Leverage locked");
            // Set a new 1-hour cooldown to prevent another increase too soon
            pos.leverageLockExpiry = uint32(block.timestamp + LEVERAGE_INCREASE_DELAY);
        }

        // Check direction flip lock — prevents rapid long/short flipping for arbitrage
        if ((oldLeverage > 0 && newLeverageBps < 0) || (oldLeverage < 0 && newLeverageBps > 0)) {
            // Flipping direction requires the cooldown to have expired
            require(block.timestamp >= pos.leverageLockExpiry, "Flip locked");
            // Set a longer 4-hour cooldown since direction flips have larger market impact
            pos.leverageLockExpiry = uint32(block.timestamp + LEVERAGE_FLIP_DELAY);
        }

        // Update the leverage multiplier to the new value
        pos.leverageBps = newLeverageBps;
        // Reset entry TWAP to current price — PnL now calculated from this new baseline
        pos.entryTWAP = oracle.getTWAP();

        // Emit event for off-chain tracking of leverage changes
        emit PositionAdjusted(user, oldLeverage, newLeverageBps);
    }

    /// @notice Calculate position value with PnL
    /// @dev Value = Deposit * (1 + Leverage * PriceChange%) - Fees
    // Core PnL formula — this is how xLever delivers synthetic leveraged exposure
    function calculatePositionValue(address user) public view returns (uint256 value, int256 pnl) {
        // Get storage pointer for reading position parameters
        DataTypes.Position storage pos = positions[user];
        // Return zero for inactive positions — no value to calculate
        if (!pos.isActive) return (0, 0);

        // Read current TWAP for comparison against entry price
        uint128 currentTWAP = oracle.getTWAP();

        // Calculate price change as a percentage in basis points since entry
        int256 priceChangeBps;
        if (currentTWAP > pos.entryTWAP) {
            // Price went up — positive change benefits longs
            priceChangeBps = int256(uint256(currentTWAP - pos.entryTWAP) * 10000 / pos.entryTWAP);
        } else {
            // Price went down — negative change benefits shorts
            priceChangeBps = -int256(uint256(pos.entryTWAP - currentTWAP) * 10000 / pos.entryTWAP);
        }

        // PnL = Deposit * Leverage * PriceChange%
        // Signed leverage means shorts automatically profit when price drops
        pnl = int256(uint256(pos.depositAmount)) * pos.leverageBps * priceChangeBps / (10000 * 10000);

        // Gross value = original deposit + unrealized PnL
        int256 grossValue = int256(uint256(pos.depositAmount)) + pnl;
        // Net value = gross value minus any fees already settled against this position
        int256 netValue = grossValue - int256(uint256(pos.settledFees));

        // Clamp to zero — xLever positions cannot go negative (no liquidation, just zero out)
        value = netValue > 0 ? uint256(netValue) : 0;
    }

    /// @notice Settle accumulated fees
    // Called periodically by vault to deduct carry and funding fees from position value
    function settleFees(address user, uint128 feeAmount) external onlyVault {
        // Get storage pointer for the position to deduct fees from
        DataTypes.Position storage pos = positions[user];
        // Ensure position exists — can't settle fees on a closed position
        require(pos.isActive, "No position");

        // Accumulate settled fees — these reduce position value in calculatePositionValue
        pos.settledFees += feeAmount;
        // Update fee timestamp so next accrual period starts from now
        pos.lastFeeTimestamp = uint64(block.timestamp);
    }

    /// @notice Get position details
    // View function — returns full position struct for UI and other contracts
    function getPosition(address user) external view returns (DataTypes.Position memory) {
        // Read from storage and return as memory copy
        return positions[user];
    }

    /// @notice Apply auto-deleverage to a position
    // Called by risk module when health score drops — forcibly reduces leverage to protect the pool
    function applyDeleverage(address user, int32 newLeverageBps) external onlyVault {
        // Get storage pointer for the position being deleveraged
        DataTypes.Position storage pos = positions[user];
        // Ensure position exists — can't deleverage a closed position
        require(pos.isActive, "No position");

        // Cache old leverage before overwriting so the event contains the correct transition
        int32 oldLeverage = pos.leverageBps;

        // Force the new (lower) leverage — bypasses cooldown checks since this is an emergency
        pos.leverageBps = newLeverageBps;
        // Reset entry TWAP so PnL is calculated from the deleverage point forward
        pos.entryTWAP = oracle.getTWAP();

        // Emit adjustment event — same event as voluntary adjustment for consistent indexing
        emit PositionAdjusted(user, oldLeverage, newLeverageBps);
    }

    // Utility: absolute value of int32 — needed to compare leverage magnitudes regardless of direction
    function _abs(int32 x) internal pure returns (int32) {
        // Return positive value for both positive and negative inputs
        return x >= 0 ? x : -x;
    }
}
