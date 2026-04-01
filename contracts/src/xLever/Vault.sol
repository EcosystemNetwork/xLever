// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing and allow derivative works
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow checks on arithmetic

// Import shared structs so Vault, modules, and callers share a single ABI-compatible type set
import {DataTypes} from "./libraries/DataTypes.sol";
// Import vault interface to enforce the public API contract and emit its events
import {IVault} from "./interfaces/IVault.sol";
// Import TWAP oracle module — vault feeds it prices and reads smoothed TWAPs for PnL
import {TWAPOracle} from "./modules/TWAPOracle.sol";
// Import Pyth adapter — vault delegates pull-oracle updates to it
import {PythOracleAdapter} from "./modules/PythOracleAdapter.sol";
// Import position module — vault delegates all position CRUD to it
import {PositionModule} from "./modules/PositionModule.sol";
// Import fee engine — vault delegates fee calculation and distribution logic
import {FeeEngine} from "./modules/FeeEngine.sol";
// Import junior tranche — vault delegates first-loss capital pool management
import {JuniorTranche} from "./modules/JuniorTranche.sol";
// Import risk module — vault delegates health checks and leverage cap calculations
import {RiskModule} from "./modules/RiskModule.sol";

// Minimal ERC-20 interface — only the methods Vault actually calls, to avoid importing full OpenZeppelin
interface IERC20 {
    // transferFrom needed to pull USDC from depositors into the vault
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    // transfer needed to send USDC back to users on withdrawal and to treasury for fees
    function transfer(address to, uint256 amount) external returns (bool);
    // balanceOf needed if we ever need to check vault's own USDC holdings
    function balanceOf(address account) external view returns (uint256);
}

/// @title Vault
/// @notice Main vault contract for xLever protocol
/// @dev Uses Pyth pull-oracle: callers supply priceUpdateData with each action.
///      The vault pays the Pyth update fee from msg.value, updates the feed,
///      reads the fresh price, then updates the internal TWAP buffer.
// Inherit IVault so the compiler enforces we implement all required functions and events
contract Vault is IVault {
    // Immutable USDC token — all deposits, withdrawals, and fees are denominated in USDC
    IERC20 public immutable usdc;
    // Immutable tokenized asset address (e.g. xQQQ) — identifies which asset this vault tracks
    address public immutable asset; // xQQQ or other tokenized asset

    // TWAP oracle module — computes 15-min time-weighted average price for fair PnL settlement
    TWAPOracle public immutable oracle;
    // Pyth adapter module — handles pull-oracle updates from Pyth Network's Hermes service
    PythOracleAdapter public immutable pythAdapter;
    // Pyth feed ID for this vault's asset — uniquely identifies the price stream (e.g. QQQ/USD)
    bytes32 public feedId; // Pyth feed ID for this vault's asset (e.g. QQQ/USD)
    // Position module — tracks all user positions, leverage, and PnL calculations
    PositionModule public immutable positionModule;
    // Fee engine module — calculates dynamic entry/exit fees, carry, and funding rates
    FeeEngine public immutable feeEngine;
    // Junior tranche module — manages first-loss capital that buffers senior depositors
    JuniorTranche public immutable juniorTranche;
    // Risk module — monitors health, calculates leverage caps, and triggers auto-deleverage
    RiskModule public immutable riskModule;

    // Pool-wide accounting state — tracks deposits, exposures, and protocol status
    DataTypes.PoolState public poolState;

    // Admin address — has authority to pause/unpause and update fee configs
    address public admin;
    // Treasury address — receives protocol's share of fee revenue
    address public treasury;

    // Slow withdrawal queue — maps user to their pending chunked withdrawal (for large exits)
    mapping(address => DataTypes.SlowWithdrawal) public slowWithdrawals;

    // Restrict sensitive admin functions to the designated admin address
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        // Continue executing the function body after the check passes
        _;
    }

    // Prevent user actions when protocol is paused (state != 0) to protect during emergencies
    modifier whenActive() {
        require(poolState.protocolState == 0, "Protocol paused");
        // Continue executing the function body after the check passes
        _;
    }

    // Deploy vault with all its sub-modules and wire them together
    constructor(
        address _usdc,       // USDC stablecoin contract — the settlement currency
        address _asset,      // Tokenized asset address — what this vault provides leverage on
        address _admin,      // Initial admin — controls pause/unpause and config
        address _treasury,   // Treasury — receives protocol fee share
        address _pythAdapter,// Pre-deployed Pyth adapter — shared across vaults for gas efficiency
        bytes32 _feedId      // Pyth feed ID — identifies which price stream this vault consumes
    ) {
        // Store USDC reference as immutable to save gas on every deposit/withdraw call
        usdc = IERC20(_usdc);
        // Store asset address so the vault knows which tokenized asset it manages
        asset = _asset;
        // Store admin for access control on privileged operations
        admin = _admin;
        // Store treasury for fee distribution target
        treasury = _treasury;
        // Cast and store Pyth adapter — payable because it receives ETH for Pyth update fees
        pythAdapter = PythOracleAdapter(payable(_pythAdapter));
        // Store feed ID so the vault knows which Pyth price feed to query
        feedId = _feedId;

        // Deploy modules — each is a separate contract for modularity and upgradeability
        // Deploy TWAP oracle owned by this vault — vault is both updater and owner
        oracle = new TWAPOracle(address(this), address(this));
        // Deploy position module — needs oracle for PnL calcs and vault address for access control
        positionModule = new PositionModule(address(oracle), address(this));
        // Deploy fee engine — needs oracle for divergence-based fee scaling
        feeEngine = new FeeEngine(address(oracle), address(this));
        // Deploy junior tranche — needs vault address for access control
        juniorTranche = new JuniorTranche(address(this));
        // Deploy risk module — needs vault address for access control
        riskModule = new RiskModule(address(this));

        // Initialize pool state with default values
        // Set default max leverage to 4x (40000 bps) — will be adjusted based on junior ratio
        poolState.currentMaxLeverageBps = 40000; // 4x default
        // Set protocol to active state (0) so trading can begin immediately
        poolState.protocolState = 0; // Active
    }

    /// @notice Deposit USDC and open leveraged position
    /// @param amount USDC amount (6 decimals)
    /// @param leverageBps Leverage in basis points (-40000 to +40000)
    /// @param priceUpdateData Pyth Hermes price update bytes — pass msg.value for the update fee
    // payable because callers must send ETH to cover Pyth oracle update fees
    function deposit(uint256 amount, int32 leverageBps, bytes[] calldata priceUpdateData) external payable whenActive returns (uint256 positionValue) {
        // Reject zero deposits to prevent empty positions cluttering state
        require(amount > 0, "Zero deposit");
        // Enforce leverage bounds: -4x to +4x as per xLever's fixed-entry design
        require(leverageBps >= -40000 && leverageBps <= 40000, "Invalid leverage");
        // Enforce dynamic leverage cap — may be lower than 4x when junior tranche is thin
        require(uint32(_absInt32(leverageBps)) <= poolState.currentMaxLeverageBps, "Leverage too high");

        // Pull-oracle pattern: update Pyth price, read it, and push into TWAP buffer
        _updateOracleFromPyth(priceUpdateData);

        // Transfer USDC from user to vault — must have prior approval
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Calculate notional exposure = deposit * |leverage| for fee and exposure tracking
        uint256 notional = uint256(amount) * uint256(_absInt32(leverageBps)) / 10000;
        // Calculate entry fee based on notional size and current TWAP divergence
        uint256 entryFee = feeEngine.calculateDynamicFee(notional, true);

        // Read current TWAP to lock in the entry price for future PnL calculations
        uint128 entryTWAP = oracle.getTWAP();

        // Create or update user's position with net deposit (after fee) and entry TWAP
        positionModule.updatePosition(msg.sender, uint128(amount - entryFee), leverageBps, entryTWAP);

        // Track total senior deposits for junior ratio and risk calculations
        poolState.totalSeniorDeposits += uint128(amount - entryFee);

        // Update directional exposure tracking — needed for funding rate and hedging
        if (leverageBps > 0) {
            // Long position: increases gross long and positive net exposure
            poolState.grossLongExposure += uint128(notional);
            poolState.netExposure += int256(notional);
        } else if (leverageBps < 0) {
            // Short position: increases gross short and reduces net exposure
            poolState.grossShortExposure += uint128(notional);
            poolState.netExposure -= int256(notional);
        }

        // Split and distribute the entry fee to junior tranche, insurance, and treasury
        _distributeFees(entryFee);

        // Emit deposit event for indexers — isSenior=true distinguishes from junior deposits
        emit Deposit(msg.sender, amount, leverageBps, true);

        // Return the effective position value (deposit minus entry fee)
        return amount - entryFee;
    }

    /// @notice Withdraw position
    /// @param amount Amount to withdraw (6 decimals)
    /// @param priceUpdateData Pyth Hermes price update bytes
    // payable because callers must send ETH to cover Pyth oracle update fees
    function withdraw(uint256 amount, bytes[] calldata priceUpdateData) external payable returns (uint256 received) {
        // Update oracle before reading prices to ensure PnL is calculated on fresh data
        _updateOracleFromPyth(priceUpdateData);
        // Fetch user's position to validate and calculate withdrawal
        DataTypes.Position memory pos = positionModule.getPosition(msg.sender);
        // Ensure user actually has an open position to withdraw from
        require(pos.isActive, "No position");

        // Calculate current position value including PnL to enforce withdrawal cap
        (uint256 positionValue, ) = positionModule.calculatePositionValue(msg.sender);
        // Prevent withdrawing more than the position is worth
        require(amount <= positionValue, "Insufficient balance");

        // Calculate exit fee on the original notional to match entry fee symmetry
        uint256 notional = uint256(pos.depositAmount) * uint256(_absInt32(pos.leverageBps)) / 10000;
        // Get divergence-adjusted exit fee (lower base than entry to encourage liquidity)
        uint256 exitFee = feeEngine.calculateDynamicFee(notional, false);

        // Close user's position entirely — xLever uses full-close model, not partial
        positionModule.closePosition(msg.sender);

        // Reduce tracked senior deposits since position is fully closed
        poolState.totalSeniorDeposits -= uint128(pos.depositAmount);

        // Remove this position's exposure from pool totals for accurate hedging and funding
        if (pos.leverageBps > 0) {
            // Was long: reduce gross long and net exposure
            poolState.grossLongExposure -= uint128(notional);
            poolState.netExposure -= int256(notional);
        } else if (pos.leverageBps < 0) {
            // Was short: reduce gross short and increase net exposure (removing negative)
            poolState.grossShortExposure -= uint128(notional);
            poolState.netExposure += int256(notional);
        }

        // Protect against underflow if exit fee exceeds withdrawal amount (edge case)
        received = amount > exitFee ? amount - exitFee : 0;

        // Split and distribute exit fee to junior tranche, insurance, and treasury
        _distributeFees(exitFee);

        // Send net USDC to the user after deducting fees
        require(usdc.transfer(msg.sender, received), "Transfer failed");

        // Emit withdrawal event with original amount and position value for off-chain tracking
        emit Withdraw(msg.sender, amount, positionValue);
    }

    /// @notice Adjust leverage on existing position
    /// @param newLeverageBps New leverage in basis points
    /// @param priceUpdateData Pyth Hermes price update bytes
    // payable because callers must send ETH to cover Pyth oracle update fees
    function adjustLeverage(int32 newLeverageBps, bytes[] calldata priceUpdateData) external payable whenActive {
        // Update oracle first so leverage adjustment uses fresh pricing
        _updateOracleFromPyth(priceUpdateData);
        // Enforce leverage bounds on the new value
        require(newLeverageBps >= -40000 && newLeverageBps <= 40000, "Invalid leverage");
        // Enforce dynamic leverage cap based on current junior tranche ratio
        require(uint32(_absInt32(newLeverageBps)) <= poolState.currentMaxLeverageBps, "Leverage too high");

        // Fetch current position to validate and compute exposure deltas
        DataTypes.Position memory oldPos = positionModule.getPosition(msg.sender);
        // User must have an active position to adjust
        require(oldPos.isActive, "No position");

        // Delegate leverage adjustment to position module (handles lock checks and TWAP reset)
        positionModule.adjustLeverage(msg.sender, newLeverageBps);

        // Compute old and new notional to update pool exposure tracking
        uint256 oldNotional = uint256(oldPos.depositAmount) * uint256(_absInt32(oldPos.leverageBps)) / 10000;
        uint256 newNotional = uint256(oldPos.depositAmount) * uint256(_absInt32(newLeverageBps)) / 10000;

        // Remove old position's contribution to pool exposure before adding new
        if (oldPos.leverageBps > 0) {
            // Was long: subtract from gross long and net exposure
            poolState.grossLongExposure -= uint128(oldNotional);
            poolState.netExposure -= int256(oldNotional);
        } else if (oldPos.leverageBps < 0) {
            // Was short: subtract from gross short and add back to net exposure
            poolState.grossShortExposure -= uint128(oldNotional);
            poolState.netExposure += int256(oldNotional);
        }

        // Add new position's contribution to pool exposure
        if (newLeverageBps > 0) {
            // Now long: add to gross long and net exposure
            poolState.grossLongExposure += uint128(newNotional);
            poolState.netExposure += int256(newNotional);
        } else if (newLeverageBps < 0) {
            // Now short: add to gross short and reduce net exposure
            poolState.grossShortExposure += uint128(newNotional);
            poolState.netExposure -= int256(newNotional);
        }

        // Emit event for off-chain tracking and UI updates
        emit LeverageAdjusted(msg.sender, oldPos.leverageBps, newLeverageBps);
    }

    /// @notice Deposit into junior tranche
    // Junior tranche provides first-loss buffer; higher junior ratio enables higher max leverage
    function depositJunior(uint256 amount) external returns (uint256 shares) {
        // Reject zero deposits to prevent empty junior positions
        require(amount > 0, "Zero deposit");

        // Pull USDC from junior LP into the vault's custody
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Mint proportional shares via junior tranche module
        shares = juniorTranche.deposit(amount);
        // Track total junior deposits for ratio and risk calculations
        poolState.totalJuniorDeposits += uint128(amount);

        // Recalculate max leverage since junior ratio changed (more junior = higher cap)
        _updateMaxLeverage();

        // Emit deposit event — leverageBps=0 and isSenior=false marks this as a junior deposit
        emit Deposit(msg.sender, amount, 0, false);
    }

    /// @notice Withdraw from junior tranche
    // Junior LPs can redeem shares for proportional USDC (may be less if losses absorbed)
    function withdrawJunior(uint256 shares) external returns (uint256 amount) {
        // Burn shares and calculate proportional USDC to return
        amount = juniorTranche.withdraw(shares);
        // Reduce tracked junior deposits to keep ratio accurate
        poolState.totalJuniorDeposits -= uint128(amount);

        // Send redeemed USDC to the junior LP
        require(usdc.transfer(msg.sender, amount), "Transfer failed");

        // Recalculate max leverage since junior ratio changed (less junior = lower cap)
        _updateMaxLeverage();
    }

    /// @notice Get position details
    // View function — allows UI and other contracts to read position state without gas cost
    function getPosition(address user) external view returns (DataTypes.Position memory) {
        // Delegate to position module which owns position storage
        return positionModule.getPosition(user);
    }

    /// @notice Get position value and PnL
    // View function — calculates real-time value using current TWAP
    function getPositionValue(address user) external view returns (uint256 value, int256 pnl) {
        // Delegate to position module's PnL calculator
        return positionModule.calculatePositionValue(user);
    }

    /// @notice Get junior tranche value
    // View function — returns total NAV and per-share price for junior LPs
    function getJuniorValue() external view returns (uint256 totalValue, uint256 sharePrice) {
        // Read total assets held by junior tranche
        totalValue = juniorTranche.getTotalValue();
        // Read current share price (may differ from 1:1 if fees earned or losses absorbed)
        sharePrice = juniorTranche.getSharePrice();
    }

    /// @notice Get pool state
    // View function — returns full pool state struct for dashboard display
    function getPoolState() external view returns (DataTypes.PoolState memory) {
        return poolState;
    }

    /// @notice Get current TWAP and spread
    // View function — returns smoothed price and current dynamic spread for UI display
    function getCurrentTWAP() external view returns (uint128 twap, uint16 spreadBps) {
        // Read 15-minute time-weighted average price
        twap = oracle.getTWAP();
        // Read current dynamic spread based on spot-TWAP divergence
        spreadBps = oracle.getDynamicSpread();
    }

    /// @notice Get max leverage
    // View function — returns current dynamic leverage cap for UI validation
    function getMaxLeverage() external view returns (int32 maxLeverageBps) {
        // Cast from uint32 storage to int32 return type for consistency with leverageBps
        return int32(poolState.currentMaxLeverageBps);
    }

    /// @notice Get funding rate
    // View function — returns current funding rate reflecting pool imbalance (longs pay shorts or vice versa)
    function getFundingRate() external view returns (int256 rateBps) {
        // Funding rate depends on how skewed the pool is between longs and shorts
        return feeEngine.calculateFundingRate(
            poolState.netExposure,
            // Gross exposure = total of both sides, used as denominator for imbalance ratio
            poolState.grossLongExposure + poolState.grossShortExposure
        );
    }

    /// @notice Get carry rate
    // View function — returns annualized carry cost passed through from Euler borrowing
    function getCarryRate() external view returns (uint256 annualBps) {
        // Hackathon: hardcoded 3.5% annual borrow rate stands in for the Euler V2 IRM on-chain query.
        // Production deployment will call eulerVault.interestRate() here.
        uint256 eulerRate = 350; // 3.5% annual bps
        // Carry = Euler borrow rate * netting ratio + protocol spread
        return feeEngine.calculateCarryRate(
            eulerRate,
            // Absolute net exposure — determines how much borrowing the pool actually needs
            _absInt256(poolState.netExposure),
            // Gross exposure — used to calculate the netting efficiency
            poolState.grossLongExposure + poolState.grossShortExposure
        );
    }

    /// @notice Pause protocol
    // Emergency brake — stops all deposits, leverage adjustments; withdrawals still allowed
    function pause() external onlyAdmin {
        // Cache old state before overwriting so the event contains the correct transition
        uint8 oldState = poolState.protocolState;
        // Set state to 2 (paused) — checked by whenActive modifier
        poolState.protocolState = 2;
        // Emit state change event for monitoring and indexer consumption
        emit ProtocolStateChanged(oldState, 2);
    }

    /// @notice Unpause protocol
    // Restore normal operations after emergency conditions have been resolved
    function unpause() external onlyAdmin {
        // Cache old state before overwriting so the event contains the correct transition
        uint8 oldState = poolState.protocolState;
        // Set state back to 0 (active) — allows deposits and adjustments again
        poolState.protocolState = 0;
        // Emit state change event for monitoring and indexer consumption
        emit ProtocolStateChanged(oldState, 0);
    }

    /// @notice Update fee configuration
    // Allows admin to tune fee parameters without redeploying the vault
    function updateFeeConfig(DataTypes.FeeConfig calldata config) external onlyAdmin {
        // Delegate to fee engine which validates the config (e.g. splits sum to 100%)
        feeEngine.updateFeeConfig(config);
    }

    /// @notice Update oracle from Pyth price data (can be called standalone by keeper)
    /// @param priceUpdateData Pyth Hermes price update bytes
    // Public entry point so off-chain keepers can push fresh prices without a trade
    function updateOracle(bytes[] calldata priceUpdateData) external payable {
        // Delegate to internal helper that handles Pyth fee payment, price read, and TWAP push
        _updateOracleFromPyth(priceUpdateData);
    }

    /// @dev Internal: pay Pyth fee, update feeds, read price, push to TWAP buffer
    // Centralizes oracle update logic so deposit/withdraw/adjust all share the same path
    function _updateOracleFromPyth(bytes[] calldata priceUpdateData) internal {
        // Allow empty price data for view-only or keeper-already-updated scenarios
        if (priceUpdateData.length == 0) return; // allow empty for view-only calls

        // Query Pyth for the required update fee before sending ETH
        uint256 fee = pythAdapter.getUpdateFee(priceUpdateData);
        // Ensure caller sent enough ETH to cover the Pyth oracle fee
        require(msg.value >= fee, "Insufficient Pyth fee");

        // Atomically update Pyth feeds and read back the fresh price for our asset
        (int64 pythPrice, ) = pythAdapter.updateAndReadPrice{value: fee}(feedId, priceUpdateData);
        // Reject invalid prices — Pyth can return negative for some exotic feeds
        require(pythPrice > 0, "Negative/zero price");

        // Pyth prices are int64 with variable exponent; adapter normalises to 8-decimal.
        // Push the normalised price into the TWAP circular buffer for smoothing.
        oracle.updatePrice(uint128(uint64(pythPrice)));

        // Refund any excess ETH the caller sent beyond the required Pyth fee
        if (msg.value > fee) {
            // Use low-level call for ETH transfer to handle all receiver types
            (bool ok, ) = msg.sender.call{value: msg.value - fee}("");
            // Revert if refund fails to prevent ETH from being trapped in the contract
            require(ok, "Refund failed");
        }
    }

    /// @notice Distribute fees to junior, insurance, and treasury
    // Centralizes fee distribution so all fee-generating paths use consistent splits
    function _distributeFees(uint256 totalFees) internal {
        // Ask fee engine to split fees according to configured ratios (70/20/10 default)
        (uint256 juniorAmount, uint256 insuranceAmount, uint256 treasuryAmount) =
            feeEngine.distributeFees(totalFees);

        // Credit junior tranche — increases share price, rewarding first-loss capital providers
        juniorTranche.distributeFee(juniorAmount);
        // Accumulate insurance fund — protocol backstop for extreme scenarios
        poolState.insuranceFund += uint128(insuranceAmount);

        // Send treasury's share of fees to the treasury address
        if (treasuryAmount > 0) {
            // Only transfer if non-zero to save gas on zero-amount transfers
            usdc.transfer(treasury, treasuryAmount);
        }
    }

    /// @notice Update max leverage based on junior ratio
    // Called after junior deposits/withdrawals to dynamically adjust the leverage cap
    function _updateMaxLeverage() internal {
        // Calculate what percentage of the total pool the junior tranche represents
        uint256 juniorRatio = juniorTranche.getJuniorRatio(poolState.totalSeniorDeposits);
        // Map junior ratio to a leverage cap — more first-loss buffer enables higher leverage
        poolState.currentMaxLeverageBps = uint32(riskModule.calculateMaxLeverage(juniorRatio));
    }

    // Utility: absolute value of int256 — needed for net exposure calculations
    function _absInt256(int256 x) internal pure returns (uint256) {
        // Ternary handles both positive and negative cases without branching
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    // Utility: absolute value of int32 — needed for leverage magnitude calculations
    function _absInt32(int32 x) internal pure returns (uint32) {
        // Ternary handles both positive and negative cases without branching
        return x >= 0 ? uint32(x) : uint32(-x);
    }
}
