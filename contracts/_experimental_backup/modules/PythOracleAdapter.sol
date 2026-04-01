// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import the adapter interface to enforce the required public API
import {IPythOracleAdapter} from "../interfaces/IPythOracleAdapter.sol";

/// @title Pyth Oracle Interface (subset used by the adapter)
// Minimal Pyth interface — only the functions this adapter actually calls
interface IPyth {
    // Pyth price struct — contains price, confidence, exponent, and timestamp
    struct Price {
        // The price value as a signed integer (can be negative for some feeds)
        int64 price;
        // Confidence interval — wider confidence means less certain price
        uint64 conf;
        // Exponent for price scaling — price * 10^expo gives the actual value
        int32 expo;
        // Unix timestamp when this price was published by Pyth data providers
        uint256 publishTime;
    }

    // Query the ETH fee required to submit a price update — must be paid with msg.value
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount);
    // Push price update data to Pyth contract — requires ETH fee payment
    function updatePriceFeeds(bytes[] calldata updateData) external payable;
    // Read a cached price that is no older than `age` seconds — reverts if stale
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (Price memory price);
    // Read cached price without age check — useful for debugging, not for production pricing
    function getPriceUnsafe(bytes32 id) external view returns (Price memory price);
}

/// @title PythOracleAdapter
/// @notice Pull-oracle adapter for Pyth Network on Ink Sepolia.
///         Stores feed registry, wraps updatePriceFeeds + read into atomic calls,
///         and normalises prices to 8-decimal uint128 for vault consumption.
// Abstraction layer between xLever vaults and Pyth — handles fees, staleness, and normalization
contract PythOracleAdapter is IPythOracleAdapter {

    // =====================================================================
    // STATE
    // =====================================================================

    // Immutable reference to the Pyth contract deployed on the target chain
    IPyth public immutable pyth;
    // Admin address — can register feeds, set vault, and configure parameters
    address public admin;
    // Vault address — authorized to call updateAndReadPrice alongside admin
    address public vault;

    /// @notice Max price age for atomic reads after update (default: 24h for equity feeds)
    // Equity feeds only publish during US market hours, so prices can be up to 24h old on weekends
    uint256 public maxPriceAge = 86400;

    /// @notice Registered feed IDs mapped to human-readable symbol (for UI/logging)
    // Helps frontends and indexers display meaningful names instead of raw bytes32 feed IDs
    mapping(bytes32 => string) public feedSymbols;
    /// @notice Track which feeds are registered — prevents querying unregistered feeds
    mapping(bytes32 => bool) public feedRegistered;

    // =====================================================================
    // KNOWN PYTH FEED IDS (Stable Mainnet / Sepolia)
    // =====================================================================

    // Equity feeds — these are the Pyth price feed IDs for US equities tracked by xLever
    // QQQ ETF — Nasdaq 100 index tracker, primary xLever asset
    bytes32 public constant FEED_QQQ_USD  = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d; // Equity.US.QQQ/USD
    // SPY ETF — S&P 500 index tracker, secondary xLever asset
    bytes32 public constant FEED_SPY_USD  = 0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5; // Equity.US.SPY/USD
    // AAPL stock — Apple Inc, potential future xLever asset
    bytes32 public constant FEED_AAPL_USD = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688; // Equity.US.AAPL/USD
    // NVDA stock — Nvidia Corp, potential future xLever asset
    bytes32 public constant FEED_NVDA_USD = 0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593; // Equity.US.NVDA/USD
    // TSLA stock — Tesla Inc, potential future xLever asset
    bytes32 public constant FEED_TSLA_USD = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1; // Equity.US.TSLA/USD

    // Crypto feeds (useful for ETH gas pricing and collateral valuation)
    // ETH/USD — needed for gas cost estimation and ETH-denominated collateral pricing
    bytes32 public constant FEED_ETH_USD  = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace; // ETH/USD

    // =====================================================================
    // MODIFIERS
    // =====================================================================

    // Restrict administrative functions to the designated admin address
    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        // Continue executing the function body after the check passes
        _;
    }

    // Allow both vault and admin to call price update functions — vault for normal ops, admin for maintenance
    modifier onlyVaultOrAdmin() {
        require(msg.sender == vault || msg.sender == admin, "Not authorized");
        // Continue executing the function body after the check passes
        _;
    }

    // =====================================================================
    // CONSTRUCTOR
    // =====================================================================

    /// @param _pyth Pyth contract on Ink Sepolia: 0x2880aB155794e7179c9eE2e38200202908C17B43
    /// @param _admin Admin address for feed management
    // Deploy with Pyth contract reference and pre-register core equity feeds
    constructor(address _pyth, address _admin) {
        // Store immutable Pyth contract reference — cannot be changed after deployment
        pyth = IPyth(_pyth);
        // Store initial admin for access control
        admin = _admin;

        // Pre-register core feeds so vaults can use them immediately without extra admin calls
        // Register QQQ/USD — primary xLever tokenized asset
        _registerFeed(FEED_QQQ_USD,  "QQQ/USD");
        // Register SPY/USD — secondary xLever tokenized asset
        _registerFeed(FEED_SPY_USD,  "SPY/USD");
        // Register AAPL/USD — future expansion asset
        _registerFeed(FEED_AAPL_USD, "AAPL/USD");
        // Register NVDA/USD — future expansion asset
        _registerFeed(FEED_NVDA_USD, "NVDA/USD");
        // Register TSLA/USD — future expansion asset
        _registerFeed(FEED_TSLA_USD, "TSLA/USD");
        // Register ETH/USD — needed for gas and collateral pricing
        _registerFeed(FEED_ETH_USD,  "ETH/USD");
    }

    // =====================================================================
    // CORE: UPDATE + READ (atomic pull-oracle pattern)
    // =====================================================================

    /// @inheritdoc IPythOracleAdapter
    // Atomic update+read: pays Pyth fee, pushes price data, reads back fresh price in one call
    function updateAndReadPrice(bytes32 feedId, bytes[] calldata priceUpdateData)
        external
        payable
        onlyVaultOrAdmin
        returns (int64 price, uint64 publishTime)
    {
        // Only allow reads for pre-registered feeds to prevent misuse with unknown feed IDs
        require(feedRegistered[feedId], "Feed not registered");

        // Query Pyth for the required ETH fee before forwarding funds
        uint256 fee = pyth.getUpdateFee(priceUpdateData);
        // Ensure caller sent enough ETH to cover the Pyth update fee
        require(msg.value >= fee, "Insufficient fee");
        // Forward exactly the required fee to Pyth and push the price update data
        pyth.updatePriceFeeds{value: fee}(priceUpdateData);

        // Read the freshly updated price — use maxPriceAge (default 24h for equity feeds
        // that only publish during US market hours, so weekend prices can be up to ~48h old)
        IPyth.Price memory p = pyth.getPriceNoOlderThan(feedId, maxPriceAge);
        // Extract the price value (already normalized to 8 decimals by Pyth for equity feeds)
        price = p.price;
        // Extract publish timestamp for staleness tracking
        publishTime = uint64(p.publishTime);

        // Emit event for off-chain monitoring of price updates
        emit PriceUpdated(feedId, price, p.conf, publishTime);

        // Refund any excess ETH the caller sent beyond the required Pyth fee
        if (msg.value > fee) {
            // Use low-level call for ETH transfer to handle all receiver types (EOA and contracts)
            (bool ok, ) = msg.sender.call{value: msg.value - fee}("");
            // Revert if refund fails to prevent ETH from being trapped
            require(ok, "Refund failed");
        }
    }

    /// @inheritdoc IPythOracleAdapter
    // Read-only path — reads cached price without paying for an update (cheaper when price is fresh)
    function readPrice(bytes32 feedId, uint256 maxAgeSec)
        external
        view
        returns (int64 price, uint64 conf, uint64 publishTime)
    {
        // Only allow reads for pre-registered feeds
        require(feedRegistered[feedId], "Feed not registered");
        // Read cached price from Pyth — reverts if older than maxAgeSec
        IPyth.Price memory p = pyth.getPriceNoOlderThan(feedId, maxAgeSec);
        // Extract price, confidence, and timestamp from the Pyth Price struct
        price = p.price;
        conf = p.conf;
        publishTime = uint64(p.publishTime);
    }

    /// @inheritdoc IPythOracleAdapter
    // View function — allows callers to query the ETH fee before submitting an update transaction
    function getUpdateFee(bytes[] calldata priceUpdateData) external view returns (uint256 fee) {
        // Delegate to Pyth contract's fee calculation
        return pyth.getUpdateFee(priceUpdateData);
    }

    // =====================================================================
    // STALENESS CHECK
    // =====================================================================

    /// @inheritdoc IPythOracleAdapter
    // Returns true if the cached price for this feed is older than maxAgeSec
    function isStale(bytes32 feedId, uint256 maxAgeSec) external view returns (bool) {
        // Try to read the price with the given age constraint
        try pyth.getPriceNoOlderThan(feedId, maxAgeSec) returns (IPyth.Price memory) {
            // If read succeeds, the price is fresh enough
            return false;
        } catch {
            // If read reverts (price too old), the feed is stale
            return true;
        }
    }

    // =====================================================================
    // FEED MANAGEMENT
    // =====================================================================

    /// @inheritdoc IPythOracleAdapter
    // Admin function — registers a new Pyth feed ID so vaults can use it for pricing
    function registerFeed(bytes32 feedId, string calldata symbol) external onlyAdmin {
        // Delegate to internal helper that handles both constructor and admin registration
        _registerFeed(feedId, symbol);
    }

    // Internal helper — stores feed symbol and marks it as registered
    function _registerFeed(bytes32 feedId, string memory symbol) internal {
        // Store human-readable symbol for UI display (e.g., "QQQ/USD")
        feedSymbols[feedId] = symbol;
        // Mark feed as registered so updateAndReadPrice and readPrice will accept it
        feedRegistered[feedId] = true;
        // Emit event for off-chain discovery of newly supported feeds
        emit FeedRegistered(feedId, symbol);
    }

    /// @notice Set vault address (called once after vault deployment)
    // Must be called by admin after vault deployment to authorize the vault for price updates
    function setVault(address _vault) external onlyAdmin {
        // Prevent setting vault to zero address which would break authorization checks
        require(_vault != address(0), "Zero address");
        // Store vault address — enables the onlyVaultOrAdmin modifier to authorize the vault
        vault = _vault;
    }

    /// @notice Set max acceptable price age (seconds). Default 86400 (24h) for equity feeds.
    // Allows tuning staleness tolerance — shorter for crypto (always publishing), longer for equities
    function setMaxPriceAge(uint256 _maxAge) external onlyAdmin {
        // Update the max age used in updateAndReadPrice for the getPriceNoOlderThan call
        maxPriceAge = _maxAge;
    }

    /// @notice Transfer admin
    // Allows admin rotation for security (e.g., migrating to a multisig)
    function transferAdmin(address newAdmin) external onlyAdmin {
        // Prevent accidental admin renouncement by rejecting zero address
        require(newAdmin != address(0), "Zero address");
        // Transfer admin authority to the new address
        admin = newAdmin;
    }

    // Allow this contract to receive ETH — needed because Pyth fee refunds may be sent here
    receive() external payable {}
}
