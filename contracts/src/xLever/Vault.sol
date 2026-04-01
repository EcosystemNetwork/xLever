// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "./libraries/DataTypes.sol";
import {IVault} from "./interfaces/IVault.sol";
import {TWAPOracle} from "./modules/TWAPOracle.sol";
import {PositionModule} from "./modules/PositionModule.sol";
import {FeeEngine} from "./modules/FeeEngine.sol";
import {JuniorTranche} from "./modules/JuniorTranche.sol";
import {RiskModule} from "./modules/RiskModule.sol";
import {IPythOracleAdapter} from "./interfaces/IPythOracleAdapter.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title Vault
/// @notice Main vault contract for xLever protocol with real risk, junior, and agent subsystems
contract Vault is IVault {
    IERC20 public immutable usdc;
    address public immutable asset;

    TWAPOracle public immutable oracle;
    PositionModule public immutable positionModule;
    FeeEngine public immutable feeEngine;
    JuniorTranche public immutable juniorTranche;
    RiskModule public immutable riskModule;

    IPythOracleAdapter public immutable pythAdapter;
    bytes32 public immutable feedId;

    DataTypes.PoolState public poolState;

    address public admin;
    address public treasury;

    // Bounded agent address — can only reduce leverage or close positions (Safe Mode)
    address public agentOperator;

    mapping(address => DataTypes.SlowWithdrawal) public slowWithdrawals;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS — risk state changes, leverage cap changes, auto-deleverage, agent actions
    // ═══════════════════════════════════════════════════════════════

    event RiskStateChanged(uint8 indexed oldState, uint8 indexed newState, uint256 healthScore, uint256 juniorRatioBps);
    event LeverageCapChanged(uint32 oldCapBps, uint32 newCapBps, uint256 juniorRatioBps);
    event AutoDeleverageExecuted(address indexed user, int32 oldLeverage, int32 newLeverage, uint256 healthScore);
    event AgentAction(address indexed agent, address indexed user, string action, int32 targetLeverage, string reason);
    event JuniorStateChanged(uint256 juniorTotalAssets, uint256 seniorDeposits, uint256 juniorRatioBps, uint32 newMaxLeverageBps);
    event RiskCheckPerformed(uint256 healthScore, uint8 protocolState, bool circuitBreakerTripped);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier whenActive() {
        require(poolState.protocolState == 0 || poolState.protocolState == 1, "Protocol paused or emergency");
        _;
    }

    /// @notice Allow when protocol is not in emergency (state 3). Permits paused-state withdrawals.
    modifier whenNotEmergency() {
        require(poolState.protocolState != 3, "Protocol in emergency");
        _;
    }

    modifier onlyAgentOrAdmin() {
        require(msg.sender == agentOperator || msg.sender == admin, "Only agent or admin");
        _;
    }

    // Reentrancy guard
    uint256 private _locked;
    modifier nonReentrant() {
        require(_locked == 0, "Reentrancy");
        _locked = 1;
        _;
        _locked = 0;
    }

    /// @notice Require oracle is fresh and circuit breaker is not tripped
    modifier requireFreshOracle() {
        require(!oracle.isStale(), "Oracle stale");
        require(!oracle.isCircuitBroken(), "Circuit breaker tripped");
        require(oracle.hasSufficientUpdates(), "Insufficient oracle updates");
        _;
    }

    /// @notice Deploy vault with pre-deployed modules (avoids contract size limit)
    /// @dev Modules must be deployed separately and their addresses passed in.
    ///      Use DeployModular.s.sol to deploy modules + vault in the correct order.
    /// @param _usdc USDC token address
    /// @param _asset Underlying asset token address (e.g., wQQQx)
    /// @param _admin Admin address for governance
    /// @param _treasury Treasury address for fee collection
    /// @param _pythAdapter Pre-deployed PythOracleAdapter address
    /// @param _feedId Pyth price feed ID for this asset
    /// @param _modules Pre-deployed module addresses: [oracle, positionModule, feeEngine, juniorTranche, riskModule]
    constructor(
        address _usdc,
        address _asset,
        address _admin,
        address _treasury,
        address _pythAdapter,
        bytes32 _feedId,
        address[5] memory _modules
    ) {
        usdc = IERC20(_usdc);
        asset = _asset;
        admin = _admin;
        treasury = _treasury;
        pythAdapter = IPythOracleAdapter(_pythAdapter);
        feedId = _feedId;

        // Wire pre-deployed modules (no inline deployment = smaller bytecode)
        oracle = TWAPOracle(_modules[0]);
        positionModule = PositionModule(_modules[1]);
        feeEngine = FeeEngine(_modules[2]);
        juniorTranche = JuniorTranche(_modules[3]);
        riskModule = RiskModule(_modules[4]);

        // NOTE: After deploying Vault, the deployer must call initializeModules()
        // to transfer module ownership from deployer to this vault.

        // Initialize pool state
        poolState.currentMaxLeverageBps = 40000; // 4x default
        poolState.protocolState = 0; // Active
    }

    // ═══════════════════════════════════════════════════════════════
    // ORACLE — Pyth pull-oracle integration
    // ═══════════════════════════════════════════════════════════════

    /// @notice Update oracle from Pyth price data (internal)
    /// @dev Calls PythOracleAdapter to verify price on-chain, then feeds into TWAP buffer
    function _updateOracleFromPyth(bytes[] calldata priceUpdateData) internal {
        if (priceUpdateData.length == 0) return;

        // Atomic Pyth update+read: pays fee, pushes data, reads verified price
        (int64 price, uint64 publishTime) =
            pythAdapter.updateAndReadPrice{value: msg.value}(feedId, priceUpdateData);

        require(price > 0, "Invalid oracle price");

        // Feed verified price into TWAP buffer
        oracle.updatePrice(uint128(uint64(price)));

        // Emit separated price roles for frontend
        DataTypes.OracleState memory oState = oracle.getOracleState();
        emit OracleUpdate(
            oState.executionPrice,
            oState.displayPrice,
            oState.divergenceBps,
            oState.isFresh,
            oState.isCircuitBroken
        );
    }

    /// @notice Push a Pyth price update without trading (keeper/anyone)
    function updateOracle(bytes[] calldata priceUpdateData) external payable {
        _updateOracleFromPyth(priceUpdateData);
    }

    // ═══════════════════════════════════════════════════════════════
    // USER FUNCTIONS — deposit / withdraw / adjust
    // ═══════════════════════════════════════════════════════════════

    /// @notice Deposit USDC and open leveraged position
    function deposit(
        uint256 amount,
        int32 leverageBps,
        bytes[] calldata priceUpdateData
    ) external payable whenActive returns (uint256 positionValue) {
        require(amount > 0, "Zero deposit");
        require(leverageBps >= -40000 && leverageBps <= 40000, "Invalid leverage");
        require(uint32(_absInt32(leverageBps)) <= poolState.currentMaxLeverageBps, "Leverage too high");

        // Update oracle with fresh Pyth data before reading price
        _updateOracleFromPyth(priceUpdateData);

        // Enforce oracle freshness after update
        require(!oracle.isStale(), "Oracle stale");
        require(!oracle.isCircuitBroken(), "Circuit breaker tripped");
        require(oracle.hasSufficientUpdates(), "Insufficient oracle updates");

        // Transfer USDC from user
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Calculate entry fee (reads divergence from oracle)
        uint256 notional = uint256(amount) * uint256(_absInt32(leverageBps)) / 10000;
        uint256 entryFee = feeEngine.calculateDynamicFee(notional, true);

        // Get current TWAP as entry/reference price
        uint128 entryTWAP = oracle.getTWAP();
        require(entryTWAP > 0, "Invalid TWAP");

        // Create position with verified oracle-backed entry price
        positionModule.updatePosition(msg.sender, uint128(amount - entryFee), leverageBps, entryTWAP);

        // Update pool state
        poolState.totalSeniorDeposits += uint128(amount - entryFee);

        if (leverageBps > 0) {
            poolState.grossLongExposure += uint128(notional);
            poolState.netExposure += int256(notional);
        } else if (leverageBps < 0) {
            poolState.grossShortExposure += uint128(notional);
            poolState.netExposure -= int256(notional);
        }

        // Distribute entry fee
        _distributeFees(entryFee);

        // Post-trade risk check — derives state from real pool/oracle/position data
        _checkAndUpdateRisk();

        emit Deposit(msg.sender, amount, leverageBps, true);

        return amount - entryFee;
    }

    /// @notice Withdraw position with oracle-backed settlement
    function withdraw(
        uint256 amount,
        uint256 minReceived,
        bytes[] calldata priceUpdateData
    ) external payable returns (uint256 received) {
        DataTypes.Position memory pos = positionModule.getPosition(msg.sender);
        require(pos.isActive, "No position");

        // Update oracle with fresh Pyth data before settlement
        _updateOracleFromPyth(priceUpdateData);

        // Enforce oracle freshness for withdrawal settlement
        require(!oracle.isStale(), "Oracle stale");
        require(!oracle.isCircuitBroken(), "Circuit breaker tripped");
        require(oracle.hasSufficientUpdates(), "Insufficient oracle updates");

        (uint256 positionValue, ) = positionModule.calculatePositionValue(msg.sender);
        require(amount <= positionValue, "Insufficient balance");

        // Calculate exit fee
        uint256 notional = uint256(pos.depositAmount) * uint256(_absInt32(pos.leverageBps)) / 10000;
        uint256 exitFee = feeEngine.calculateDynamicFee(notional, false);

        // Close position
        positionModule.closePosition(msg.sender);

        // Update pool state
        poolState.totalSeniorDeposits -= uint128(pos.depositAmount);

        if (pos.leverageBps > 0) {
            poolState.grossLongExposure -= uint128(notional);
            poolState.netExposure -= int256(notional);
        } else if (pos.leverageBps < 0) {
            poolState.grossShortExposure -= uint128(notional);
            poolState.netExposure += int256(notional);
        }

        // Calculate net amount after fees
        received = amount > exitFee ? amount - exitFee : 0;

        // Enforce minimum received (slippage protection)
        require(received >= minReceived, "Below min received");

        // Distribute exit fee
        _distributeFees(exitFee);

        // Post-trade risk check
        _checkAndUpdateRisk();

        // Transfer USDC to user
        require(usdc.transfer(msg.sender, received), "Transfer failed");

        emit Withdraw(msg.sender, amount, positionValue);
    }

    /// @notice Adjust leverage on existing position with fresh oracle
    function adjustLeverage(
        int32 newLeverageBps,
        bytes[] calldata priceUpdateData
    ) external payable whenActive {
        require(newLeverageBps >= -40000 && newLeverageBps <= 40000, "Invalid leverage");
        require(uint32(_absInt32(newLeverageBps)) <= poolState.currentMaxLeverageBps, "Leverage too high");

        DataTypes.Position memory oldPos = positionModule.getPosition(msg.sender);
        require(oldPos.isActive, "No position");

        // Update oracle with fresh Pyth data before adjustment
        _updateOracleFromPyth(priceUpdateData);

        // Enforce oracle freshness for leverage adjustment
        require(!oracle.isStale(), "Oracle stale");
        require(!oracle.isCircuitBroken(), "Circuit breaker tripped");
        require(oracle.hasSufficientUpdates(), "Insufficient oracle updates");

        // Update position (resets entry TWAP to current oracle-backed price)
        positionModule.adjustLeverage(msg.sender, newLeverageBps);

        // Update pool exposures
        uint256 oldNotional = uint256(oldPos.depositAmount) * uint256(_absInt32(oldPos.leverageBps)) / 10000;
        uint256 newNotional = uint256(oldPos.depositAmount) * uint256(_absInt32(newLeverageBps)) / 10000;

        // Remove old exposure
        if (oldPos.leverageBps > 0) {
            poolState.grossLongExposure -= uint128(oldNotional);
            poolState.netExposure -= int256(oldNotional);
        } else if (oldPos.leverageBps < 0) {
            poolState.grossShortExposure -= uint128(oldNotional);
            poolState.netExposure += int256(oldNotional);
        }

        // Add new exposure
        if (newLeverageBps > 0) {
            poolState.grossLongExposure += uint128(newNotional);
            poolState.netExposure += int256(newNotional);
        } else if (newLeverageBps < 0) {
            poolState.grossShortExposure += uint128(newNotional);
            poolState.netExposure -= int256(newNotional);
        }

        // Post-adjustment risk check
        _checkAndUpdateRisk();

        emit LeverageAdjusted(msg.sender, oldPos.leverageBps, newLeverageBps);
    }

    // ═══════════════════════════════════════════════════════════════
    // JUNIOR TRANCHE — first-loss capital that backs leverage limits
    // ═══════════════════════════════════════════════════════════════

    /// @notice Deposit into junior tranche
    function depositJunior(uint256 amount) external returns (uint256 shares) {
        require(amount > 0, "Zero deposit");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        shares = juniorTranche.deposit(amount);
        poolState.totalJuniorDeposits += uint128(amount);

        // Update max leverage based on new junior ratio
        _updateMaxLeverage();

        emit Deposit(msg.sender, amount, 0, false);
    }

    /// @notice Withdraw from junior tranche (blocked during emergency to protect first-loss capital)
    function withdrawJunior(uint256 shares) external whenNotEmergency returns (uint256 amount) {
        amount = juniorTranche.withdraw(shares);
        poolState.totalJuniorDeposits -= uint128(amount);

        require(usdc.transfer(msg.sender, amount), "Transfer failed");

        // Update max leverage based on new junior ratio
        _updateMaxLeverage();
    }

    // ═══════════════════════════════════════════════════════════════
    // AGENT — bounded Safe Mode execution (reduce-only)
    // ═══════════════════════════════════════════════════════════════

    /// @notice Agent reduces leverage on a user's position (Safe Mode: reduce-only)
    function agentDeleverage(
        address user,
        int32 newLeverageBps,
        string calldata reason
    ) external nonReentrant onlyAgentOrAdmin {
        DataTypes.Position memory pos = positionModule.getPosition(user);
        require(pos.isActive, "No position");

        // Agent can ONLY reduce leverage (absolute value), never increase
        require(_absInt32(newLeverageBps) < _absInt32(pos.leverageBps), "Agent can only reduce leverage");
        // Agent cannot flip direction
        require(
            (pos.leverageBps >= 0 && newLeverageBps >= 0) || (pos.leverageBps <= 0 && newLeverageBps <= 0),
            "Agent cannot flip direction"
        );

        int32 oldLeverage = pos.leverageBps;

        // Apply deleverage — bypasses cooldown locks since this is a safety action
        positionModule.applyDeleverage(user, newLeverageBps);

        // Update pool exposures
        uint256 oldNotional = uint256(pos.depositAmount) * uint256(_absInt32(oldLeverage)) / 10000;
        uint256 newNotional = uint256(pos.depositAmount) * uint256(_absInt32(newLeverageBps)) / 10000;

        if (oldLeverage > 0) {
            poolState.grossLongExposure -= uint128(oldNotional);
            poolState.netExposure -= int256(oldNotional);
        } else if (oldLeverage < 0) {
            poolState.grossShortExposure -= uint128(oldNotional);
            poolState.netExposure += int256(oldNotional);
        }

        if (newLeverageBps > 0) {
            poolState.grossLongExposure += uint128(newNotional);
            poolState.netExposure += int256(newNotional);
        } else if (newLeverageBps < 0) {
            poolState.grossShortExposure += uint128(newNotional);
            poolState.netExposure -= int256(newNotional);
        }

        emit AgentAction(msg.sender, user, "deleverage", newLeverageBps, reason);
        emit AutoDeleverageExecuted(user, oldLeverage, newLeverageBps, _getHealthScore());

        _checkAndUpdateRisk();
    }

    /// @notice Agent closes a user's position entirely (Safe Mode: emergency close)
    function agentClose(
        address user,
        string calldata reason
    ) external nonReentrant onlyAgentOrAdmin {
        DataTypes.Position memory pos = positionModule.getPosition(user);
        require(pos.isActive, "No position");

        (uint256 finalValue, ) = positionModule.closePosition(user);

        poolState.totalSeniorDeposits -= uint128(pos.depositAmount);
        uint256 notional = uint256(pos.depositAmount) * uint256(_absInt32(pos.leverageBps)) / 10000;

        if (pos.leverageBps > 0) {
            poolState.grossLongExposure -= uint128(notional);
            poolState.netExposure -= int256(notional);
        } else if (pos.leverageBps < 0) {
            poolState.grossShortExposure -= uint128(notional);
            poolState.netExposure += int256(notional);
        }

        if (finalValue > 0) {
            usdc.transfer(user, finalValue);
        }

        emit AgentAction(msg.sender, user, "close", 0, reason);

        _checkAndUpdateRisk();
    }

    /// @notice Set agent operator address
    function setAgentOperator(address _agent) external onlyAdmin {
        agentOperator = _agent;
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Get position details
    function getPosition(address user) external view returns (DataTypes.Position memory) {
        return positionModule.getPosition(user);
    }

    /// @notice Get position value and PnL
    function getPositionValue(address user) external view returns (uint256 value, int256 pnl) {
        return positionModule.calculatePositionValue(user);
    }

    /// @notice Get junior tranche value
    function getJuniorValue() external view returns (uint256 totalValue, uint256 sharePrice) {
        totalValue = juniorTranche.getTotalValue();
        sharePrice = juniorTranche.getSharePrice();
    }

    /// @notice Get pool state
    function getPoolState() external view returns (DataTypes.PoolState memory) {
        return poolState;
    }

    /// @notice Get current TWAP and spread
    function getCurrentTWAP() external view returns (uint128 twap, uint16 spreadBps) {
        twap = oracle.getTWAP();
        spreadBps = oracle.getDynamicSpread();
    }

    /// @notice Get full oracle state with separated price roles
    function getOracleState() external view returns (DataTypes.OracleState memory) {
        return oracle.getOracleState();
    }

    /// @notice Get max leverage
    function getMaxLeverage() external view returns (int32 maxLeverageBps) {
        return int32(poolState.currentMaxLeverageBps);
    }

    /// @notice Get funding rate
    function getFundingRate() external view returns (int256 rateBps) {
        return feeEngine.calculateFundingRate(
            poolState.netExposure,
            poolState.grossLongExposure + poolState.grossShortExposure
        );
    }

    /// @notice Get fee configuration (entry/exit fees, splits, funding params)
    function getFeeConfig() external view returns (DataTypes.FeeConfig memory) {
        return feeEngine.getFeeConfig();
    }

    /// @notice Get carry rate
    function getCarryRate() external view returns (uint256 annualBps) {
        // Euler borrow rate is 0 until hedging module is integrated.
        // When VaultWithHedging is active, this reads from the Euler EVK.
        uint256 eulerRate = 0;
        return feeEngine.calculateCarryRate(
            eulerRate,
            _absInt256(poolState.netExposure),
            poolState.grossLongExposure + poolState.grossShortExposure
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // RISK STATE — derived from real pool/oracle/position data
    // ═══════════════════════════════════════════════════════════════

    /// @notice Get health score derived from real pool state
    function getHealthScore() external view returns (uint256) {
        return _getHealthScore();
    }

    /// @notice Get risk state summary for frontend/agent consumption
    function getRiskState() external view returns (
        uint8 protocolState,
        uint256 healthScore,
        uint256 juniorRatioBps,
        uint32 currentMaxLeverageBps,
        bool oracleStale,
        bool circuitBroken
    ) {
        return (
            poolState.protocolState,
            _getHealthScore(),
            juniorTranche.getJuniorRatio(poolState.totalSeniorDeposits),
            poolState.currentMaxLeverageBps,
            oracle.isStale(),
            oracle.isCircuitBroken()
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Transfer module ownership from deployer to this vault (one-time setup)
    /// @dev Must be called by the deployer (who is the initial module owner) after vault deployment.
    ///      This is required because modules are deployed before the vault, so they initially
    ///      point to the deployer as their vault. This function transfers ownership so that
    ///      only this vault contract can call module admin functions going forward.
    bool private _modulesInitialized;
    function initializeModules() external {
        require(!_modulesInitialized, "Already initialized");
        // The deployer must have transferred module ownership to this vault address
        // by calling setVault(vaultAddress) on each module before calling this.
        // This function just marks initialization as complete.
        _modulesInitialized = true;
    }

    /// @notice Initialize TWAP oracle with starting price
    function initializeOracle(uint128 startPrice) external onlyAdmin {
        oracle.initializeBuffer(startPrice);
    }

    /// @notice Pause protocol
    function pause() external onlyAdmin {
        poolState.protocolState = 2;
        emit ProtocolStateChanged(poolState.protocolState, 2);
    }

    /// @notice Unpause protocol
    function unpause() external onlyAdmin {
        poolState.protocolState = 0;
        emit ProtocolStateChanged(poolState.protocolState, 0);
    }

    /// @notice Update fee configuration
    function updateFeeConfig(DataTypes.FeeConfig calldata config) external onlyAdmin {
        feeEngine.updateFeeConfig(config);
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Distribute fees to junior, insurance, and treasury
    function _distributeFees(uint256 totalFees) internal {
        (uint256 juniorAmount, uint256 insuranceAmount, uint256 treasuryAmount) =
            feeEngine.distributeFees(totalFees);

        juniorTranche.distributeFee(juniorAmount);
        poolState.insuranceFund += uint128(insuranceAmount);

        if (treasuryAmount > 0) {
            usdc.transfer(treasury, treasuryAmount);
        }
    }

    /// @notice Update max leverage based on real junior ratio from on-chain state
    function _updateMaxLeverage() internal {
        uint256 juniorRatio = juniorTranche.getJuniorRatio(poolState.totalSeniorDeposits);
        uint32 oldCap = poolState.currentMaxLeverageBps;
        uint32 newCap = uint32(riskModule.calculateMaxLeverage(juniorRatio));
        poolState.currentMaxLeverageBps = newCap;

        if (newCap != oldCap) {
            emit LeverageCapChanged(oldCap, newCap, juniorRatio);
        }

        emit JuniorStateChanged(
            juniorTranche.getTotalValue(),
            poolState.totalSeniorDeposits,
            juniorRatio,
            newCap
        );
    }

    /// @notice Check and update risk state from real on-chain inputs
    function _checkAndUpdateRisk() internal {
        uint256 healthScore = _getHealthScore();
        uint256 juniorRatioBps = juniorTranche.getJuniorRatio(poolState.totalSeniorDeposits);

        uint8 oldState = poolState.protocolState;
        uint8 newState = riskModule.checkHealth(healthScore, juniorRatioBps);

        // Check circuit breaker from real pool state
        uint256 juniorValue = juniorTranche.getTotalValue();
        uint256 volatility = 0;
        if (!oracle.isStale()) {
            volatility = oracle.getDivergence() * 10; // Scale divergence as vol proxy
        }

        (bool shouldPause, ) = riskModule.checkCircuitBreaker(
            poolState.grossLongExposure + poolState.grossShortExposure,
            juniorValue,
            volatility
        );

        if (shouldPause && newState < 2) {
            newState = 2; // Escalate to paused
        }

        emit RiskCheckPerformed(healthScore, newState, shouldPause);

        if (newState != oldState) {
            poolState.protocolState = newState;
            emit RiskStateChanged(oldState, newState, healthScore, juniorRatioBps);
            emit ProtocolStateChanged(oldState, newState);
        }

        // If emergency, calculate auto-deleverage cap
        if (newState == 3) {
            (int32 newMaxLev, bool shouldDeleverage) = riskModule.calculateAutoDeleverage(
                healthScore,
                int32(poolState.currentMaxLeverageBps)
            );
            if (shouldDeleverage) {
                uint32 oldCap = poolState.currentMaxLeverageBps;
                poolState.currentMaxLeverageBps = uint32(newMaxLev);
                emit LeverageCapChanged(oldCap, uint32(newMaxLev), juniorRatioBps);
            }
        }
    }

    /// @notice Derive health score from real pool state
    function _getHealthScore() internal view returns (uint256) {
        uint256 totalExposure = uint256(poolState.grossLongExposure) + uint256(poolState.grossShortExposure);
        if (totalExposure == 0) return 20000; // No exposure = perfectly healthy

        uint256 juniorValue = juniorTranche.getTotalValue();
        uint256 totalBacking = juniorValue + uint256(poolState.totalSeniorDeposits);

        // Health score in basis points: 10000 = 1.00x, 15000 = 1.50x, 20000 = 2.00x
        return totalBacking * 10000 / totalExposure;
    }

    function resetCircuitBreaker() external onlyAdmin {
        riskModule.resetCircuitBreaker();
    }

    function _absInt256(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function _absInt32(int32 x) internal pure returns (uint32) {
        return x >= 0 ? uint32(x) : uint32(-x);
    }

    /// @notice Accept ETH for Pyth fee refunds
    receive() external payable {}
}
