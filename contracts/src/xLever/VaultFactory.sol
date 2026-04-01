// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {Vault} from "./Vault.sol";
import {TWAPOracle} from "./modules/TWAPOracle.sol";
import {PositionModule} from "./modules/PositionModule.sol";
import {FeeEngine} from "./modules/FeeEngine.sol";
import {JuniorTranche} from "./modules/JuniorTranche.sol";
import {RiskModule} from "./modules/RiskModule.sol";

/// @title VaultFactory
/// @notice Factory for deploying xLever vaults per asset with pre-deployed modules
contract VaultFactory {
    address public immutable usdc;
    address public admin;
    address public treasury;
    address public pythAdapter;

    mapping(address => address) public vaults; // asset => vault
    mapping(address => bytes32) public feedIds; // asset => Pyth feed ID
    address[] public allVaults;

    event VaultCreated(address indexed asset, address vault, uint256 index);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor(address _usdc, address _admin, address _treasury, address _pythAdapter) {
        require(_usdc != address(0), "Invalid USDC");
        require(_admin != address(0), "Invalid admin");
        require(_treasury != address(0), "Invalid treasury");
        require(_pythAdapter != address(0), "Invalid Pyth adapter");

        usdc = _usdc;
        admin = _admin;
        treasury = _treasury;
        pythAdapter = _pythAdapter;
    }

    /// @notice Create a new vault for an asset with pre-deployed modules
    function createVault(address asset, bytes32 feedId) external onlyAdmin returns (address vault) {
        require(asset != address(0), "Invalid asset");
        require(vaults[asset] == address(0), "Vault exists");
        require(feedId != bytes32(0), "Invalid feed ID");

        // Deploy modules with factory as initial owner
        address[5] memory modules = _deployModules();

        // Deploy vault with pre-deployed modules
        Vault v = new Vault(usdc, asset, admin, treasury, pythAdapter, feedId, modules);

        // Transfer module ownership from factory to the new vault
        TWAPOracle(modules[0]).setVault(address(v));
        PositionModule(modules[1]).setVault(address(v));
        FeeEngine(modules[2]).setVault(address(v));
        JuniorTranche(modules[3]).setVault(address(v));
        RiskModule(modules[4]).setVault(address(v));

        v.initializeModules();

        vault = address(v);
        feedIds[asset] = feedId;
        vaults[asset] = vault;
        allVaults.push(vault);

        emit VaultCreated(asset, vault, allVaults.length - 1);
    }

    function _deployModules() internal returns (address[5] memory modules) {
        TWAPOracle oracle = new TWAPOracle(address(this), address(this));
        PositionModule posModule = new PositionModule(address(oracle), address(this));
        FeeEngine fee = new FeeEngine(address(oracle), address(this));
        JuniorTranche junior = new JuniorTranche(address(this));
        RiskModule risk = new RiskModule(address(this));

        modules[0] = address(oracle);
        modules[1] = address(posModule);
        modules[2] = address(fee);
        modules[3] = address(junior);
        modules[4] = address(risk);
    }

    function getVault(address asset) external view returns (address) {
        return vaults[asset];
    }

    function getAllVaults() external view returns (address[] memory) {
        return allVaults;
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        require(newTreasury != address(0), "Invalid treasury");
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }
}
