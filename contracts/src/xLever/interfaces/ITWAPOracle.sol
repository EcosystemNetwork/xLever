// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

interface ITWAPOracle {
    event PriceUpdated(uint128 spotPrice, uint128 twap, uint16 spreadBps);
    event DivergenceAlert(uint256 divergenceBps, uint8 severity);

    function updatePrice(uint128 spotPrice) external;
    function getTWAP() external view returns (uint128 twap);
    function getSpotPrice() external view returns (uint128 spot);
    function getDynamicSpread() external view returns (uint16 spreadBps);
    function getDivergence() external view returns (uint256 divergenceBps);
    function isStale() external view returns (bool);
}
