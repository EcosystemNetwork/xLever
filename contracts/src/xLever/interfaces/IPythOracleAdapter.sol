// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Interface for the Pyth oracle adapter — defines how the vault interacts with Pyth's pull-oracle
interface IPythOracleAdapter {
    // Emitted after a successful price update — provides feed ID, price, confidence, and timestamp
    event PriceUpdated(bytes32 indexed feedId, int64 price, uint64 conf, uint64 publishTime);
    // Emitted when a new price feed is registered — used for off-chain discovery of supported assets
    event FeedRegistered(bytes32 indexed feedId, string symbol);

    /// @notice Update Pyth price feeds and return the price for the given feed
    /// @param feedId Pyth price feed ID
    /// @param priceUpdateData Encoded price update from Hermes
    /// @return price Scaled price (8 decimals)
    /// @return publishTime Unix timestamp of the price
    // Atomic update+read pattern: pays Pyth fee, pushes data, reads back fresh price in one call
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
    // Read-only path for when a recent update already happened (saves gas by skipping update)
    function readPrice(bytes32 feedId, uint256 maxAgeSec)
        external
        view
        returns (int64 price, uint64 conf, uint64 publishTime);

    /// @notice Get the Pyth update fee for given price data
    // Allows callers to query the required ETH fee before sending a transaction
    function getUpdateFee(bytes[] calldata priceUpdateData) external view returns (uint256 fee);

    /// @notice Register a new price feed
    // Admin function to whitelist new Pyth feeds for new tokenized assets
    function registerFeed(bytes32 feedId, string calldata symbol) external;

    /// @notice Check if a feed's price is stale
    // Used by risk module to detect when prices are too old for safe trading
    function isStale(bytes32 feedId, uint256 maxAgeSec) external view returns (bool);
}
