// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import {VaultWithHedging} from "../src/xLever/VaultWithHedging.sol";
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol";

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

contract MockEVault {
    MockERC20 public asset;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public debts;
    
    constructor(address _asset) {
        asset = MockERC20(_asset);
    }
    
    function deposit(uint256 amount, address receiver) external returns (uint256) {
        require(asset.balanceOf(msg.sender) >= amount, "Insufficient sender balance");
        require(asset.allowance(msg.sender, address(this)) >= amount, "Insufficient allowance");
        asset.transferFrom(msg.sender, address(this), amount);
        balances[receiver] += amount;
        return amount;
    }
    
    function withdraw(uint256 amount, address receiver, address owner) external returns (uint256) {
        require(balances[owner] >= amount, "Insufficient vault balance");
        require(asset.balanceOf(address(this)) >= amount, "Insufficient vault liquidity");
        balances[owner] -= amount;
        asset.transfer(receiver, amount);
        return amount;
    }
    
    function borrow(uint256 amount, address receiver) external returns (uint256) {
        require(asset.balanceOf(address(this)) >= amount, "Insufficient vault liquidity for borrow");
        debts[msg.sender] += amount;
        asset.transfer(receiver, amount);
        return amount;
    }
    
    function repay(uint256 amount, address receiver) external returns (uint256) {
        uint256 actualAmount = amount;
        if (actualAmount > debts[receiver]) {
            actualAmount = debts[receiver];
        }
        require(asset.balanceOf(msg.sender) >= actualAmount, "Insufficient repay balance");
        require(asset.allowance(msg.sender, address(this)) >= actualAmount, "Insufficient repay allowance");
        asset.transferFrom(msg.sender, address(this), actualAmount);
        debts[receiver] -= actualAmount;
        return actualAmount;
    }
    
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }
    
    function debtOf(address account) external view returns (uint256) {
        return debts[account];
    }
}

contract MockEVC {
    function enableCollateral(address account, address vault) external payable {}
    function enableController(address account, address vault) external payable {}
    function disableCollateral(address account, address vault) external payable {}
    function disableController(address account, address vault) external payable {}
    function batch(BatchItem[] calldata items) external payable {}
    
    struct BatchItem {
        address targetContract;
        address onBehalfOfAccount;
        uint256 value;
        bytes data;
    }
}

contract VaultWithHedgingTest is Test {
    VaultWithHedging public vault;
    MockERC20 public usdc;
    MockERC20 public asset;
    MockEVault public usdcVault;
    MockEVault public assetVault;
    MockEVC public evc;
    
    address public admin = address(this);
    address public user = address(0x1);
    
    function setUp() public {
        // Deploy mock tokens
        usdc = new MockERC20("USDC", "USDC", 6);
        asset = new MockERC20("wSPYx", "wSPYx", 18);
        
        // Deploy mock EVC
        evc = new MockEVC();
        
        // Deploy mock Euler vaults
        usdcVault = new MockEVault(address(usdc));
        assetVault = new MockEVault(address(asset));
        
        // Mint liquidity to vaults for borrowing
        usdc.mint(address(usdcVault), 10_000_000e6); // 10M USDC
        asset.mint(address(assetVault), 10_000_000e18); // 10M asset tokens
        
        // Deploy VaultWithHedging
        vault = new VaultWithHedging(
            address(usdc),
            address(asset),
            address(evc),
            address(usdcVault),
            address(assetVault),
            admin
        );
        
        // Setup user with tokens
        usdc.mint(user, 10_000e6);
        asset.mint(user, 100e18);
    }
    
    function testDepositUSDCNoLeverage() public {
        uint256 depositAmount = 1000e6;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        uint256 positionValue = vault.depositUSDC(depositAmount, 0);
        vm.stopPrank();
        
        assertEq(positionValue, depositAmount);
        
        DataTypes.Position memory pos = vault.getPosition(user);
        assertEq(pos.depositAmount, depositAmount);
        assertEq(pos.leverageBps, 0);
        assertTrue(pos.isActive);
    }
    
    function testDepositUSDCWithLongLeverage() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 20000; // 2x
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        uint256 positionValue = vault.depositUSDC(depositAmount, leverage);
        vm.stopPrank();
        
        assertGt(positionValue, depositAmount);
        
        DataTypes.Position memory pos = vault.getPosition(user);
        assertEq(pos.depositAmount, depositAmount);
        assertEq(pos.leverageBps, leverage);
        assertTrue(pos.isActive);
        
        DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
        assertTrue(eulerPos.isActive);
        assertGt(eulerPos.debtAmount, 0);
    }
    
    function testDepositUSDCWithShortLeverage() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = -20000; // 2x short
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        uint256 positionValue = vault.depositUSDC(depositAmount, leverage);
        vm.stopPrank();
        
        assertGt(positionValue, depositAmount);
        
        DataTypes.Position memory pos = vault.getPosition(user);
        assertEq(pos.depositAmount, depositAmount);
        assertEq(pos.leverageBps, leverage);
        assertTrue(pos.isActive);
        
        DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
        assertTrue(eulerPos.isActive);
    }
    
    function testDepositAssetWithLeverage() public {
        uint256 depositAmount = 1e18; // 1 asset token
        int32 leverage = 20000; // 2x
        
        vm.startPrank(user);
        asset.approve(address(vault), depositAmount);
        
        uint256 positionValue = vault.depositAsset(depositAmount, leverage);
        vm.stopPrank();
        
        assertGt(positionValue, depositAmount);
        
        DataTypes.Position memory pos = vault.getPosition(user);
        assertEq(pos.depositAmount, depositAmount);
        assertEq(pos.leverageBps, leverage);
        assertTrue(pos.isActive);
        
        DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
        assertTrue(eulerPos.isActive);
        assertEq(eulerPos.collateralVault, address(assetVault));
    }
    
    function testWithdrawPosition() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 20000;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.depositUSDC(depositAmount, leverage);
        
        uint256 received = vault.withdraw(0);
        vm.stopPrank();
        
        assertGt(received, 0);
        
        DataTypes.Position memory pos = vault.getPosition(user);
        assertFalse(pos.isActive);
    }
    
    function testRevertInvalidLeverage() public {
        uint256 depositAmount = 1000e6;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        vm.expectRevert("Invalid leverage");
        vault.depositUSDC(depositAmount, 50000); // 5x too high
        
        vm.expectRevert("Invalid leverage");
        vault.depositUSDC(depositAmount, -50000); // -5x too high
        
        vm.stopPrank();
    }
    
    function testRevertZeroDeposit() public {
        vm.startPrank(user);
        
        vm.expectRevert("Zero deposit");
        vault.depositUSDC(0, 10000);
        
        vm.stopPrank();
    }
    
    function testPoolStateUpdates() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 20000;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.depositUSDC(depositAmount, leverage);
        vm.stopPrank();
        
        DataTypes.PoolState memory poolState = vault.getPoolState();
        assertEq(poolState.totalSeniorDeposits, depositAmount);
        assertGt(poolState.grossLongExposure, 0);
        assertGt(poolState.netExposure, 0);
    }
    
    function testPauseUnpause() public {
        vault.pause();
        
        DataTypes.PoolState memory poolState = vault.getPoolState();
        assertEq(poolState.protocolState, 2);
        
        vm.startPrank(user);
        usdc.approve(address(vault), 1000e6);
        
        vm.expectRevert("Protocol paused");
        vault.depositUSDC(1000e6, 10000);
        
        vm.stopPrank();
        
        vault.unpause();
        poolState = vault.getPoolState();
        assertEq(poolState.protocolState, 0);
    }
    
    function testGetPositionHealth() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 20000;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.depositUSDC(depositAmount, leverage);
        vm.stopPrank();
        
        (uint256 collateral, uint256 debt, uint256 healthFactor) = vault.getPositionHealth(user);
        
        if (debt > 0) {
            assertGt(collateral, 0);
            assertGt(healthFactor, 0);
        }
    }
}
