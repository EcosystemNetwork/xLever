// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

import {DataTypes} from "../libraries/DataTypes.sol";

// Interface for the TWAP oracle — defines how other modules read smoothed prices and spreads
interface ITWAPOracle {
    // Emitted on each price update — provides spot, TWAP, and spread for off-chain monitoring
    event PriceUpdated(uint128 spotPrice, uint128 twap, uint16 spreadBps);
    // Emitted when spot-TWAP divergence exceeds 1% — alerts keepers and risk systems
    event DivergenceAlert(uint256 divergenceBps, uint8 severity);
    // Emitted with full oracle state on every update — consumed by frontends for health display
    event OracleStateUpdated(
        uint128 executionPrice,
        uint128 displayPrice,
        uint128 riskPrice,
        uint256 divergenceBps,
        bool isCircuitBroken,
        uint64 timestamp
    );
    // Emitted when circuit breaker trips or resets — signals trading halt/resume
    event CircuitBreakerTriggered(uint256 divergenceBps, bool tripped);

    // Push a new spot price into the TWAP buffer — called by vault after Pyth update
    function updatePrice(uint128 spotPrice) external;
    // Read the 15-minute time-weighted average price — used as display price in UI
    function getTWAP() external view returns (uint128 twap);
    // Read the latest raw spot price — used as execution reference price
    function getSpotPrice() external view returns (uint128 spot);
    // Read the current dynamic spread — widens when spot diverges from TWAP to protect against manipulation
    function getDynamicSpread() external view returns (uint16 spreadBps);
    // Read spot-TWAP divergence in basis points — used by fee engine for fee scaling
    function getDivergence() external view returns (uint256 divergenceBps);
    // Check if the oracle has not been updated within the staleness threshold
    function isStale() external view returns (bool);
    // Check if oracle has received enough updates for reliable TWAP pricing
    function hasSufficientUpdates() external view returns (bool);
    // Check if the circuit breaker has tripped due to excessive spot-TWAP divergence
    function isCircuitBroken() external view returns (bool);
    // Get full oracle state with separated price roles
    function getOracleState() external view returns (DataTypes.OracleState memory);
    // Transfer updater role to a new address
    function setUpdater(address _newUpdater) external;
}
