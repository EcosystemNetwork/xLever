// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import {VaultSimple} from "../src/xLever/VaultSimple.sol";
import {DataTypes} from "../src/xLever/libraries/DataTypes.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
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

contract VaultSimpleTest is Test {
    VaultSimple public vault;
    MockERC20 public usdc;
    MockERC20 public asset;
    
    address public admin = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    
    function setUp() public {
        usdc = new MockERC20();
        asset = new MockERC20();
        vault = new VaultSimple(address(usdc), address(asset), admin);
        
        // Mint USDC to users
        usdc.mint(user1, 100_000e6);
        usdc.mint(user2, 100_000e6);
    }
    
    function testDeposit() public {
        vm.startPrank(user1);
        
        uint256 depositAmount = 10_000e6;
        int32 leverage = 30000; // 3x long
        
        usdc.approve(address(vault), depositAmount);
        uint256 result = vault.deposit(depositAmount, leverage);
        
        assertEq(result, depositAmount, "Deposit should return deposited amount");
        
        DataTypes.Position memory pos = vault.getPosition(user1);
        assertEq(pos.depositAmount, depositAmount, "Position deposit amount incorrect");
        assertEq(pos.leverageBps, leverage, "Position leverage incorrect");
        assertTrue(pos.isActive, "Position should be active");
        
        vm.stopPrank();
    }
    
    function testDepositMultipleUsers() public {
        // User 1 deposits
        vm.startPrank(user1);
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(10_000e6, 30000);
        vm.stopPrank();
        
        // User 2 deposits
        vm.startPrank(user2);
        usdc.approve(address(vault), 20_000e6);
        vault.deposit(20_000e6, -20000); // 2x short
        vm.stopPrank();
        
        DataTypes.Position memory pos1 = vault.getPosition(user1);
        DataTypes.Position memory pos2 = vault.getPosition(user2);
        
        assertEq(pos1.depositAmount, 10_000e6, "User1 deposit incorrect");
        assertEq(pos2.depositAmount, 20_000e6, "User2 deposit incorrect");
        assertEq(pos1.leverageBps, 30000, "User1 leverage incorrect");
        assertEq(pos2.leverageBps, -20000, "User2 leverage incorrect");
        
        DataTypes.PoolState memory pool = vault.getPoolState();
        assertEq(pool.totalSeniorDeposits, 30_000e6, "Total deposits incorrect");
    }
    
    function testWithdraw() public {
        vm.startPrank(user1);
        
        // Deposit first
        uint256 depositAmount = 10_000e6;
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount, 30000);
        
        // Withdraw half
        uint256 withdrawAmount = 5_000e6;
        uint256 balanceBefore = usdc.balanceOf(user1);
        vault.withdraw(withdrawAmount);
        uint256 balanceAfter = usdc.balanceOf(user1);
        
        assertEq(balanceAfter - balanceBefore, withdrawAmount, "Withdraw amount incorrect");
        
        DataTypes.Position memory pos = vault.getPosition(user1);
        assertEq(pos.depositAmount, 5_000e6, "Remaining deposit incorrect");
        assertTrue(pos.isActive, "Position should still be active");
        
        vm.stopPrank();
    }
    
    function testWithdrawFull() public {
        vm.startPrank(user1);
        
        // Deposit
        uint256 depositAmount = 10_000e6;
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount, 30000);
        
        // Withdraw all
        vault.withdraw(depositAmount);
        
        DataTypes.Position memory pos = vault.getPosition(user1);
        assertEq(pos.depositAmount, 0, "Deposit should be zero");
        assertFalse(pos.isActive, "Position should be inactive");
        
        vm.stopPrank();
    }
    
    function testDepositZeroAmount() public {
        vm.startPrank(user1);
        usdc.approve(address(vault), 1000e6);
        
        vm.expectRevert("Zero deposit");
        vault.deposit(0, 30000);
        
        vm.stopPrank();
    }
    
    function testDepositInvalidLeverage() public {
        vm.startPrank(user1);
        usdc.approve(address(vault), 10_000e6);
        
        // Too high leverage
        vm.expectRevert("Invalid leverage");
        vault.deposit(10_000e6, 50000); // 5x
        
        // Too low leverage
        vm.expectRevert("Invalid leverage");
        vault.deposit(10_000e6, -50000); // -5x
        
        vm.stopPrank();
    }
    
    function testWithdrawNoPosition() public {
        vm.startPrank(user1);
        
        vm.expectRevert("No position");
        vault.withdraw(1000e6);
        
        vm.stopPrank();
    }
    
    function testWithdrawInsufficientBalance() public {
        vm.startPrank(user1);
        
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(10_000e6, 30000);
        
        vm.expectRevert("Insufficient balance");
        vault.withdraw(20_000e6);
        
        vm.stopPrank();
    }
    
    function testLeverageRange() public {
        vm.startPrank(user1);
        
        // Test max long leverage (4x)
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(10_000e6, 40000);
        DataTypes.Position memory pos = vault.getPosition(user1);
        assertEq(pos.leverageBps, 40000, "Max long leverage incorrect");
        vault.withdraw(10_000e6);
        
        // Test max short leverage (-4x)
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(10_000e6, -40000);
        pos = vault.getPosition(user1);
        assertEq(pos.leverageBps, -40000, "Max short leverage incorrect");
        vault.withdraw(10_000e6);
        
        // Test neutral (0x)
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(10_000e6, 0);
        pos = vault.getPosition(user1);
        assertEq(pos.leverageBps, 0, "Neutral leverage incorrect");
        
        vm.stopPrank();
    }
    
    function testPoolStateTracking() public {
        // Initial state
        DataTypes.PoolState memory pool = vault.getPoolState();
        assertEq(pool.totalSeniorDeposits, 0, "Initial deposits should be zero");
        assertEq(pool.currentMaxLeverageBps, 40000, "Max leverage should be 4x");
        assertEq(pool.protocolState, 0, "Protocol should be active");
        
        // After deposits
        vm.prank(user1);
        usdc.approve(address(vault), 10_000e6);
        vm.prank(user1);
        vault.deposit(10_000e6, 30000);
        
        vm.prank(user2);
        usdc.approve(address(vault), 20_000e6);
        vm.prank(user2);
        vault.deposit(20_000e6, -20000);
        
        pool = vault.getPoolState();
        assertEq(pool.totalSeniorDeposits, 30_000e6, "Total deposits incorrect");
    }
}
