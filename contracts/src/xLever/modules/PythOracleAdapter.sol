// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {IPythOracleAdapter} from "../interfaces/IPythOracleAdapter.sol";

/// @title Pyth Oracle Interface (subset used by the adapter)
interface IPyth {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount);
    function updatePriceFeeds(bytes[] calldata updateData) external payable;
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (Price memory price);
    function getPriceUnsafe(bytes32 id) external view returns (Price memory price);
}

/// @title PythOracleAdapter
/// @notice Pull-oracle adapter for Pyth Network on Ink Sepolia.
///         Stores feed registry, wraps updatePriceFeeds + read into atomic calls,
///         and normalises prices to 8-decimal uint128 for vault consumption.
contract PythOracleAdapter is IPythOracleAdapter {

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    IPyth public immutable pyth;
    address public admin;
    address public vault;

    /// @notice Max price age for atomic reads after update (default: 24h for equity feeds)
    uint256 public maxPriceAge = 86400;

    /// @notice Registered feed IDs → human-readable symbol (for UI/logging)
    mapping(bytes32 => string) public feedSymbols;
    /// @notice Track which feeds are registered
    mapping(bytes32 => bool) public feedRegistered;

    // ═══════════════════════════════════════════════════════════
    // KNOWN PYTH FEED IDS (Stable Mainnet / Sepolia)
    // ═══════════════════════════════════════════════════════════

    // Equity feeds — these are the Pyth price feed IDs for US equities
    bytes32 public constant FEED_QQQ_USD  = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d; // Equity.US.QQQ/USD
    bytes32 public constant FEED_SPY_USD  = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5; // Equity.US.SPY/USD
    bytes32 public constant FEED_AAPL_USD = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688; // Equity.US.AAPL/USD
    bytes32 public constant FEED_NVDA_USD = 0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593; // Equity.US.NVDA/USD
    bytes32 public constant FEED_TSLA_USD = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1; // Equity.US.TSLA/USD

    // Crypto feeds (useful for ETH gas, collateral pricing)
    bytes32 public constant FEED_ETH_USD  = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace; // ETH/USD

    // ═══════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyVaultOrAdmin() {
        require(msg.sender == vault || msg.sender == admin, "Not authorized");
        _;
    }

    // ═══════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════

    /// @param _pyth Pyth contract on Ink Sepolia: 0x2880aB155794e7179c9eE2e38200202908C17B43
    /// @param _admin Admin address for feed management
    constructor(address _pyth, address _admin) {
        pyth = IPyth(_pyth);
        admin = _admin;

        // Pre-register core feeds
        _registerFeed(FEED_QQQ_USD,  "QQQ/USD");
        _registerFeed(FEED_SPY_USD,  "SPY/USD");
        _registerFeed(FEED_AAPL_USD, "AAPL/USD");
        _registerFeed(FEED_NVDA_USD, "NVDA/USD");
        _registerFeed(FEED_TSLA_USD, "TSLA/USD");
        _registerFeed(FEED_ETH_USD,  "ETH/USD");
    }

    // ═══════════════════════════════════════════════════════════
    // CORE: UPDATE + READ (atomic pull-oracle pattern)
    // ═══════════════════════════════════════════════════════════

    /// @inheritdoc IPythOracleAdapter
    function updateAndReadPrice(bytes32 feedId, bytes[] calldata priceUpdateData)
        external
        payable
        onlyVaultOrAdmin
        returns (int64 price, uint64 publishTime)
    {
        require(feedRegistered[feedId], "Feed not registered");

        // Pay update fee and push data to Pyth
        uint256 fee = pyth.getUpdateFee(priceUpdateData);
        require(msg.value >= fee, "Insufficient fee");
        pyth.updatePriceFeeds{value: fee}(priceUpdateData);

        // Read the freshly updated price — use maxPriceAge (default 24h for equity feeds
        // that only publish during US market hours)
        IPyth.Price memory p = pyth.getPriceNoOlderThan(feedId, maxPriceAge);
        price = p.price;
        publishTime = uint64(p.publishTime);

        emit PriceUpdated(feedId, price, p.conf, publishTime);

        // Refund excess ETH
        if (msg.value > fee) {
            (bool ok, ) = msg.sender.call{value: msg.value - fee}("");
            require(ok, "Refund failed");
        }
    }

    /// @inheritdoc IPythOracleAdapter
    function readPrice(bytes32 feedId, uint256 maxAgeSec)
        external
        view
        returns (int64 price, uint64 conf, uint64 publishTime)
    {
        require(feedRegistered[feedId], "Feed not registered");
        IPyth.Price memory p = pyth.getPriceNoOlderThan(feedId, maxAgeSec);
        price = p.price;
        conf = p.conf;
        publishTime = uint64(p.publishTime);
    }

    /// @inheritdoc IPythOracleAdapter
    function getUpdateFee(bytes[] calldata priceUpdateData) external view returns (uint256 fee) {
        return pyth.getUpdateFee(priceUpdateData);
    }

    // ═══════════════════════════════════════════════════════════
    // STALENESS CHECK
    // ═══════════════════════════════════════════════════════════

    /// @inheritdoc IPythOracleAdapter
    function isStale(bytes32 feedId, uint256 maxAgeSec) external view returns (bool) {
        try pyth.getPriceNoOlderThan(feedId, maxAgeSec) returns (IPyth.Price memory) {
            return false;
        } catch {
            return true;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FEED MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /// @inheritdoc IPythOracleAdapter
    function registerFeed(bytes32 feedId, string calldata symbol) external onlyAdmin {
        _registerFeed(feedId, symbol);
    }

    function _registerFeed(bytes32 feedId, string memory symbol) internal {
        feedSymbols[feedId] = symbol;
        feedRegistered[feedId] = true;
        emit FeedRegistered(feedId, symbol);
    }

    /// @notice Set vault address (called once after vault deployment)
    function setVault(address _vault) external onlyAdmin {
        vault = _vault;
    }

    /// @notice Set max acceptable price age (seconds). Default 86400 (24h) for equity feeds.
    function setMaxPriceAge(uint256 _maxAge) external onlyAdmin {
        maxPriceAge = _maxAge;
    }

    /// @notice Transfer admin
    function transferAdmin(address newAdmin) external onlyAdmin {
        admin = newAdmin;
    }

    receive() external payable {}
}
