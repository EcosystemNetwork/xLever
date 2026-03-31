// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {Vault} from "./Vault.sol";

/// @title VaultFactory
/// @notice Factory for deploying xLever vaults per asset
contract VaultFactory {
    address public immutable usdc;
    address public admin;
    address public treasury;
    
    mapping(address => address) public vaults; // asset => vault
    address[] public allVaults;
    
    event VaultCreated(address indexed asset, address vault, uint256 index);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor(address _usdc, address _admin, address _treasury) {
        require(_usdc != address(0), "Invalid USDC");
        require(_admin != address(0), "Invalid admin");
        require(_treasury != address(0), "Invalid treasury");
        
        usdc = _usdc;
        admin = _admin;
        treasury = _treasury;
    }
    
    /// @notice Create a new vault for an asset
    /// @param asset Address of the tokenized asset (e.g., xQQQ)
    /// @return vault Address of the deployed vault
    function createVault(address asset) external onlyAdmin returns (address vault) {
        require(asset != address(0), "Invalid asset");
        require(vaults[asset] == address(0), "Vault exists");
        
        // Deploy new vault
        vault = address(new Vault(usdc, asset, admin, treasury));
        
        // Register vault
        vaults[asset] = vault;
        allVaults.push(vault);
        
        emit VaultCreated(asset, vault, allVaults.length - 1);
    }
    
    /// @notice Get vault for an asset
    function getVault(address asset) external view returns (address) {
        return vaults[asset];
    }
    
    /// @notice Get all vaults
    function getAllVaults() external view returns (address[] memory) {
        return allVaults;
    }
    
    /// @notice Get number of vaults
    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
    
    /// @notice Change admin
    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }
    
    /// @notice Change treasury
    function setTreasury(address newTreasury) external onlyAdmin {
        require(newTreasury != address(0), "Invalid treasury");
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }
}
