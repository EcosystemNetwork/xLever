// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

/// @title IEVC
/// @notice Minimal interface for Ethereum Vault Connector
interface IEVC {
    struct BatchItem {
        address targetContract;
        address onBehalfOfAccount;
        uint256 value;
        bytes data;
    }
    
    function batch(BatchItem[] calldata items) external payable;
    function enableCollateral(address account, address vault) external payable;
    function enableController(address account, address vault) external payable;
    function disableCollateral(address account, address vault) external payable;
    function disableController(address account, address vault) external payable;
}
