// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

interface IPythOracleAdapter {
    event PriceUpdated(bytes32 indexed feedId, int64 price, uint64 conf, uint64 publishTime);
    event FeedRegistered(bytes32 indexed feedId, string symbol);

    /// @notice Update Pyth price feeds and return the price for the given feed
    /// @param feedId Pyth price feed ID
    /// @param priceUpdateData Encoded price update from Hermes
    /// @return price Scaled price (8 decimals)
    /// @return publishTime Unix timestamp of the price
    function updateAndReadPrice(bytes32 feedId, bytes[] calldata priceUpdateData)
        external
        payable
        returns (int64 price, uint64 publishTime);

    /// @notice Read a cached price (no update), reverts if too old
    /// @param feedId Pyth price feed ID
    /// @param maxAgeSec Maximum acceptable age in seconds
    /// @return price Scaled price (8 decimals)
    /// @return conf Confidence interval
    /// @return publishTime Unix timestamp of the price
    function readPrice(bytes32 feedId, uint256 maxAgeSec)
        external
        view
        returns (int64 price, uint64 conf, uint64 publishTime);

    /// @notice Get the Pyth update fee for given price data
    function getUpdateFee(bytes[] calldata priceUpdateData) external view returns (uint256 fee);

    /// @notice Register a new price feed
    function registerFeed(bytes32 feedId, string calldata symbol) external;

    /// @notice Check if a feed's price is stale
    function isStale(bytes32 feedId, uint256 maxAgeSec) external view returns (bool);
}
