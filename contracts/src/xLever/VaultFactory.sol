// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

// Import Vault contract so the factory can deploy new instances via `new Vault(...)`
import {Vault} from "./Vault.sol";

/// @title VaultFactory
/// @notice Factory for deploying xLever vaults per asset
// Factory pattern ensures consistent vault deployment and maintains a registry of all vaults
contract VaultFactory {
    // Shared USDC address — all vaults use the same stablecoin for settlement
    address public immutable usdc;
    // Admin — has authority to create vaults and change factory settings
    address public admin;
    // Treasury — fee destination passed to each vault on creation
    address public treasury;
    // Shared Pyth adapter — all vaults share one adapter to avoid duplicate deployments
    address public pythAdapter;

    // Registry: maps each tokenized asset to its vault address (one vault per asset)
    mapping(address => address) public vaults; // asset => vault
    // Registry: maps each asset to its Pyth feed ID for cross-referencing
    mapping(address => bytes32) public feedIds; // asset => Pyth feed ID
    // Array of all deployed vaults for enumeration (used by getAllVaults)
    address[] public allVaults;

    // Emitted when a new vault is deployed — enables off-chain indexing of vault creation
    event VaultCreated(address indexed asset, address vault, uint256 index);
    // Emitted on admin change for governance tracking and security auditing
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    // Emitted on treasury change for governance tracking
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);

    // Restrict vault creation and settings changes to the admin
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        // Continue executing the function body after the check passes
        _;
    }

    // Initialize factory with shared infrastructure addresses
    constructor(address _usdc, address _admin, address _treasury, address _pythAdapter) {
        // Validate all addresses to prevent deploying a broken factory
        require(_usdc != address(0), "Invalid USDC");
        require(_admin != address(0), "Invalid admin");
        require(_treasury != address(0), "Invalid treasury");
        require(_pythAdapter != address(0), "Invalid Pyth adapter");

        // Store USDC as immutable — cannot change after deployment (all vaults share it)
        usdc = _usdc;
        // Store initial admin for access control
        admin = _admin;
        // Store treasury address — passed to each vault for fee distribution
        treasury = _treasury;
        // Store Pyth adapter — shared across all vaults to save deployment gas
        pythAdapter = _pythAdapter;
    }

    /// @notice Create a new vault for an asset
    /// @param asset Address of the tokenized asset (e.g., xQQQ)
    /// @param feedId Pyth price feed ID for this asset
    /// @return vault Address of the deployed vault
    // Each tokenized asset (xQQQ, xSPY, etc.) gets exactly one vault
    function createVault(address asset, bytes32 feedId) external onlyAdmin returns (address vault) {
        // Reject zero address to prevent deploying a vault for a non-existent asset
        require(asset != address(0), "Invalid asset");
        // Enforce one-vault-per-asset invariant to prevent fragmented liquidity
        require(vaults[asset] == address(0), "Vault exists");
        // Require a valid Pyth feed so the vault can get price data
        require(feedId != bytes32(0), "Invalid feed ID");

        // Deploy a new full Vault with all modules, wired to the shared Pyth adapter
        vault = address(new Vault(usdc, asset, admin, treasury, pythAdapter, feedId));
        // Store the feed ID mapping for off-chain tools to look up which feed each asset uses
        feedIds[asset] = feedId;

        // Register the vault in both lookup mappings for asset-to-vault resolution
        vaults[asset] = vault;
        // Add to the enumerable array so getAllVaults can return the full list
        allVaults.push(vault);

        // Emit creation event with index for off-chain ordering and discovery
        emit VaultCreated(asset, vault, allVaults.length - 1);
    }

    /// @notice Get vault for an asset
    // View function — primary lookup for finding which vault handles a given asset
    function getVault(address asset) external view returns (address) {
        // Return vault address (or zero if no vault exists for this asset)
        return vaults[asset];
    }

    /// @notice Get all vaults
    // View function — returns full array for UI enumeration of all supported assets
    function getAllVaults() external view returns (address[] memory) {
        // Return the entire array — suitable for small numbers of vaults
        return allVaults;
    }

    /// @notice Get number of vaults
    // View function — lightweight count without copying the full array
    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /// @notice Change admin
    // Governance function — allows admin rotation for security (e.g. multisig migration)
    function setAdmin(address newAdmin) external onlyAdmin {
        // Prevent setting admin to zero address which would permanently lock admin functions
        require(newAdmin != address(0), "Invalid admin");
        // Emit event before state change for accurate old/new tracking
        emit AdminChanged(admin, newAdmin);
        // Transfer admin authority to the new address
        admin = newAdmin;
    }

    /// @notice Change treasury
    // Allows redirecting protocol fee revenue to a new treasury address
    function setTreasury(address newTreasury) external onlyAdmin {
        // Prevent setting treasury to zero address which would burn future fee revenue
        require(newTreasury != address(0), "Invalid treasury");
        // Emit event before state change for accurate old/new tracking
        emit TreasuryChanged(treasury, newTreasury);
        // Update treasury — only affects future vault deployments (existing vaults keep old treasury)
        treasury = newTreasury;
    }
}
