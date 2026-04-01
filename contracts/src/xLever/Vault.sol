// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {DataTypes} from "./libraries/DataTypes.sol";
import {IVault} from "./interfaces/IVault.sol";
import {TWAPOracle} from "./modules/TWAPOracle.sol";
import {PythOracleAdapter} from "./modules/PythOracleAdapter.sol";
import {PositionModule} from "./modules/PositionModule.sol";
import {FeeEngine} from "./modules/FeeEngine.sol";
import {JuniorTranche} from "./modules/JuniorTranche.sol";
import {RiskModule} from "./modules/RiskModule.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title Vault
/// @notice Main vault contract for xLever protocol
/// @dev Uses Pyth pull-oracle: callers supply priceUpdateData with each action.
///      The vault pays the Pyth update fee from msg.value, updates the feed,
///      reads the fresh price, then updates the internal TWAP buffer.
contract Vault is IVault {
    IERC20 public immutable usdc;
    address public immutable asset; // xQQQ or other tokenized asset

    TWAPOracle public immutable oracle;
    PythOracleAdapter public immutable pythAdapter;
    bytes32 public feedId; // Pyth feed ID for this vault's asset (e.g. QQQ/USD)
    PositionModule public immutable positionModule;
    FeeEngine public immutable feeEngine;
    JuniorTranche public immutable juniorTranche;
    RiskModule public immutable riskModule;

    DataTypes.PoolState public poolState;

    address public admin;
    address public treasury;

    mapping(address => DataTypes.SlowWithdrawal) public slowWithdrawals;

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
        address _admin,
        address _treasury,
        address _pythAdapter,
        bytes32 _feedId
    ) {
        usdc = IERC20(_usdc);
        asset = _asset;
        admin = _admin;
        treasury = _treasury;
        pythAdapter = PythOracleAdapter(payable(_pythAdapter));
        feedId = _feedId;

        // Deploy modules
        oracle = new TWAPOracle(address(this), address(this));
        positionModule = new PositionModule(address(oracle), address(this));
        feeEngine = new FeeEngine(address(oracle), address(this));
        juniorTranche = new JuniorTranche(address(this));
        riskModule = new RiskModule(address(this));

        // Initialize pool state
        poolState.currentMaxLeverageBps = 40000; // 4x default
        poolState.protocolState = 0; // Active
    }
    
    /// @notice Deposit USDC and open leveraged position
    /// @param amount USDC amount (6 decimals)
    /// @param leverageBps Leverage in basis points (-40000 to +40000)
    /// @param priceUpdateData Pyth Hermes price update bytes — pass msg.value for the update fee
    function deposit(uint256 amount, int32 leverageBps, bytes[] calldata priceUpdateData) external payable whenActive returns (uint256 positionValue) {
        require(amount > 0, "Zero deposit");
        require(leverageBps >= -40000 && leverageBps <= 40000, "Invalid leverage");
        require(uint32(_absInt32(leverageBps)) <= poolState.currentMaxLeverageBps, "Leverage too high");

        // Pull-oracle: update Pyth → read price → feed TWAP buffer
        _updateOracleFromPyth(priceUpdateData);

        // Transfer USDC from user
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // Calculate entry fee
        uint256 notional = uint256(amount) * uint256(_absInt32(leverageBps)) / 10000;
        uint256 entryFee = feeEngine.calculateDynamicFee(notional, true);

        // Get current TWAP
        uint128 entryTWAP = oracle.getTWAP();

        // Create position
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

        emit Deposit(msg.sender, amount, leverageBps, true);

        return amount - entryFee;
    }
    
    /// @notice Withdraw position
    /// @param amount Amount to withdraw (6 decimals)
    /// @param priceUpdateData Pyth Hermes price update bytes
    function withdraw(uint256 amount, bytes[] calldata priceUpdateData) external payable returns (uint256 received) {
        _updateOracleFromPyth(priceUpdateData);
        DataTypes.Position memory pos = positionModule.getPosition(msg.sender);
        require(pos.isActive, "No position");
        
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
        
        // Distribute exit fee
        _distributeFees(exitFee);
        
        // Transfer USDC to user
        require(usdc.transfer(msg.sender, received), "Transfer failed");
        
        emit Withdraw(msg.sender, amount, positionValue);
    }
    
    /// @notice Adjust leverage on existing position
    /// @param newLeverageBps New leverage in basis points
    /// @param priceUpdateData Pyth Hermes price update bytes
    function adjustLeverage(int32 newLeverageBps, bytes[] calldata priceUpdateData) external payable whenActive {
        _updateOracleFromPyth(priceUpdateData);
        require(newLeverageBps >= -40000 && newLeverageBps <= 40000, "Invalid leverage");
        require(uint32(_absInt32(newLeverageBps)) <= poolState.currentMaxLeverageBps, "Leverage too high");
        
        DataTypes.Position memory oldPos = positionModule.getPosition(msg.sender);
        require(oldPos.isActive, "No position");
        
        // Update position
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
        
        emit LeverageAdjusted(msg.sender, oldPos.leverageBps, newLeverageBps);
    }
    
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
    
    /// @notice Withdraw from junior tranche
    function withdrawJunior(uint256 shares) external returns (uint256 amount) {
        amount = juniorTranche.withdraw(shares);
        poolState.totalJuniorDeposits -= uint128(amount);
        
        require(usdc.transfer(msg.sender, amount), "Transfer failed");
        
        // Update max leverage based on new junior ratio
        _updateMaxLeverage();
    }
    
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
    
    /// @notice Get carry rate
    function getCarryRate() external view returns (uint256 annualBps) {
        // TODO: Get actual Euler borrow rate
        uint256 eulerRate = 350; // 3.5% placeholder
        return feeEngine.calculateCarryRate(
            eulerRate,
            _absInt256(poolState.netExposure),
            poolState.grossLongExposure + poolState.grossShortExposure
        );
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
    
    /// @notice Update oracle from Pyth price data (can be called standalone by keeper)
    /// @param priceUpdateData Pyth Hermes price update bytes
    function updateOracle(bytes[] calldata priceUpdateData) external payable {
        _updateOracleFromPyth(priceUpdateData);
    }

    /// @dev Internal: pay Pyth fee, update feeds, read price, push to TWAP buffer
    function _updateOracleFromPyth(bytes[] calldata priceUpdateData) internal {
        if (priceUpdateData.length == 0) return; // allow empty for view-only calls

        uint256 fee = pythAdapter.getUpdateFee(priceUpdateData);
        require(msg.value >= fee, "Insufficient Pyth fee");

        (int64 pythPrice, ) = pythAdapter.updateAndReadPrice{value: fee}(feedId, priceUpdateData);
        require(pythPrice > 0, "Negative/zero price");

        // Pyth prices are int64 with variable expo; adapter normalises to 8-decimal.
        // Push into TWAP buffer so the rest of the vault logic is unchanged.
        oracle.updatePrice(uint128(uint64(pythPrice)));

        // Refund excess ETH to caller
        if (msg.value > fee) {
            (bool ok, ) = msg.sender.call{value: msg.value - fee}("");
            require(ok, "Refund failed");
        }
    }
    
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
    
    /// @notice Update max leverage based on junior ratio
    function _updateMaxLeverage() internal {
        uint256 juniorRatio = juniorTranche.getJuniorRatio(poolState.totalSeniorDeposits);
        poolState.currentMaxLeverageBps = uint32(riskModule.calculateMaxLeverage(juniorRatio));
    }
    
    function _absInt256(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
    
    function _absInt32(int32 x) internal pure returns (uint32) {
        return x >= 0 ? uint32(x) : uint32(-x);
    }
}
