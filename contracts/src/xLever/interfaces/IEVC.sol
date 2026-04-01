// SPDX-License-Identifier: GPL-2.0-or-later
// Use GPL-2.0+ to match Euler V2 EVK licensing
pragma solidity ^0.8.0;
// Require Solidity 0.8+ for built-in overflow/underflow safety

/// @title IEVC
/// @notice Minimal interface for Ethereum Vault Connector
// EVC is Euler's cross-vault orchestration layer — enables atomic multi-vault operations
interface IEVC {
    // Represents a single operation in an EVC batch — allows atomic multi-step transactions
    struct BatchItem {
        // The vault or contract to call in this batch step
        address targetContract;
        // The account (sub-account) on whose behalf the operation executes
        address onBehalfOfAccount;
        // ETH value to forward with this call (for payable operations)
        uint256 value;
        // ABI-encoded function call data for the target contract
        bytes data;
    }

    // Execute multiple vault operations atomically — key to leverage looping (deposit+borrow in one tx)
    function batch(BatchItem[] calldata items) external payable;
    // Register a vault as collateral for an account — required before borrowing against its deposits
    function enableCollateral(address account, address vault) external payable;
    // Register a vault as a controller (lender) for an account — required before borrowing from it
    function enableController(address account, address vault) external payable;
    // Remove a vault from an account's collateral set — used when closing positions
    function disableCollateral(address account, address vault) external payable;
    // Remove a vault as controller — used when fully repaying debt to clean up account state
    function disableController(address account, address vault) external payable;
}
