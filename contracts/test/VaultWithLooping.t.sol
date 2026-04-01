// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import {VaultWithLooping} from "../src/xLever/VaultWithLooping.sol";
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
        require(asset.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        balances[receiver] += amount;
        return amount;
    }
    
    function withdraw(uint256 amount, address receiver, address owner) external returns (uint256) {
        require(balances[owner] >= amount, "Insufficient vault balance");
        balances[owner] -= amount;
        require(asset.transfer(receiver, amount), "Transfer failed");
        return amount;
    }
    
    function borrow(uint256 amount, address receiver) external returns (uint256) {
        debts[msg.sender] += amount;
        require(asset.transfer(receiver, amount), "Transfer failed");
        return amount;
    }
    
    function repay(uint256 amount, address receiver) external returns (uint256) {
        uint256 actualAmount = amount;
        if (actualAmount > debts[receiver]) {
            actualAmount = debts[receiver];
        }
        require(asset.transferFrom(msg.sender, address(this), actualAmount), "Transfer failed");
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
    function enableCollateral(address, address) external payable {}
    function enableController(address, address) external payable {}
}

contract VaultWithLoopingTest is Test {
    VaultWithLooping public vault;
    MockERC20 public usdc;
    MockERC20 public asset;
    MockEVault public usdcVault;
    MockEVault public assetVault;
    MockEVC public evc;
    
    address public admin = address(this);
    address public user = address(0x1);
    
    event LoopExecuted(address indexed user, uint256 iteration, uint256 deposited, uint256 borrowed);
    event PositionOpened(address indexed user, uint256 totalCollateral, uint256 totalDebt, int32 leverage);
    event Deposit(address indexed user, uint256 amount, int32 leverage, uint256 finalPosition);
    
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
        usdc.mint(address(usdcVault), 100_000_000e6); // 100M USDC
        asset.mint(address(assetVault), 100_000_000e18); // 100M asset tokens
        
        // Deploy VaultWithLooping
        vault = new VaultWithLooping(
            address(usdc),
            address(asset),
            address(evc),
            address(usdcVault),
            address(assetVault),
            admin
        );
        
        // Setup user with tokens
        usdc.mint(user, 100_000e6);
        asset.mint(user, 1000e18);
    }
    
    function testLoopingLong2x() public {
        uint256 depositAmount = 1000e6; // 1000 USDC
        int32 leverage = 20000; // 2x
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        uint256 finalPosition = vault.deposit(depositAmount, leverage);
        vm.stopPrank();
        
        // Should achieve ~2x position
        assertGt(finalPosition, depositAmount);
        assertApproxEqRel(finalPosition, depositAmount * 2, 0.1e18); // Within 10%
        
        // Check position stored correctly
        DataTypes.Position memory pos = vault.getPosition(user);
        assertEq(pos.depositAmount, depositAmount);
        assertEq(pos.leverageBps, leverage);
        assertTrue(pos.isActive);
        
        // Check Euler position exists
        DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
        assertTrue(eulerPos.isActive);
        assertGt(eulerPos.collateralShares, 0);
        assertGt(eulerPos.debtAmount, 0);
        
        // Verify debt is roughly (finalPosition - depositAmount)
        assertApproxEqRel(eulerPos.debtAmount, depositAmount, 0.2e18); // Within 20%
    }
    
    function testLoopingLong3x() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 30000; // 3x
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        uint256 finalPosition = vault.deposit(depositAmount, leverage);
        vm.stopPrank();
        
        // Should achieve ~3x position
        assertGt(finalPosition, depositAmount * 2);
        assertApproxEqRel(finalPosition, depositAmount * 3, 0.1e18);
        
        DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
        assertTrue(eulerPos.isActive);
        
        // Debt should be roughly 2x initial deposit for 3x leverage
        assertApproxEqRel(eulerPos.debtAmount, depositAmount * 2, 0.2e18);
    }
    
    function testLoopingLong4x() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 40000; // 4x (max)
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        uint256 finalPosition = vault.deposit(depositAmount, leverage);
        vm.stopPrank();
        
        // Should achieve close to 4x position (limited by LTV)
        assertGt(finalPosition, depositAmount * 3);
        
        DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
        assertTrue(eulerPos.isActive);
        assertGt(eulerPos.debtAmount, depositAmount * 2);
    }
    
    function testLoopingEventsEmitted() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 30000;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        // Expect multiple LoopExecuted events
        vm.expectEmit(true, false, false, false);
        emit LoopExecuted(user, 0, 0, 0); // We just check user is indexed
        
        // Expect PositionOpened event
        vm.expectEmit(true, false, false, false);
        emit PositionOpened(user, 0, 0, leverage);
        
        vault.deposit(depositAmount, leverage);
        vm.stopPrank();
    }
    
    function testLoopingNoLeverage() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 0;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        uint256 finalPosition = vault.deposit(depositAmount, leverage);
        vm.stopPrank();
        
        // No leverage = no looping
        assertEq(finalPosition, depositAmount);
        
        DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
        assertFalse(eulerPos.isActive); // No Euler position for 0 leverage
    }
    
    function testUnwindPosition() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 30000;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount, leverage);
        
        uint256 balanceBefore = usdc.balanceOf(user);
        
        // Withdraw (unwind loop)
        uint256 received = vault.withdraw(0);
        vm.stopPrank();
        
        // Should receive funds back
        assertGt(received, 0);
        assertEq(usdc.balanceOf(user), balanceBefore + received);
        
        // Position should be closed
        DataTypes.Position memory pos = vault.getPosition(user);
        assertFalse(pos.isActive);
        
        // Euler position should be closed
        DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
        assertFalse(eulerPos.isActive);
    }
    
    function testPartialWithdraw() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 20000;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount, leverage);
        
        // Withdraw half
        uint256 received = vault.withdraw(depositAmount / 2);
        vm.stopPrank();
        
        assertGt(received, 0);
        
        // Position should still be active
        DataTypes.Position memory pos = vault.getPosition(user);
        assertTrue(pos.isActive);
        assertEq(pos.depositAmount, depositAmount / 2);
    }
    
    function testHealthFactor() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 30000;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount, leverage);
        vm.stopPrank();
        
        (uint256 collateral, uint256 debt, uint256 healthFactor) = vault.getPositionHealth(user);
        
        assertGt(collateral, 0);
        assertGt(debt, 0);
        assertGt(healthFactor, 10000); // Health factor > 1.0 (100%)
        
        // With 74% LTV, health factor should be ~1.35 (135%)
        assertGt(healthFactor, 12000); // > 1.2
    }
    
    function testRevertInvalidLeverage() public {
        uint256 depositAmount = 1000e6;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        vm.expectRevert("Invalid leverage");
        vault.deposit(depositAmount, 50000); // 5x too high
        
        vm.expectRevert("Invalid leverage");
        vault.deposit(depositAmount, -50000); // -5x too high
        
        vm.stopPrank();
    }
    
    function testRevertZeroDeposit() public {
        vm.startPrank(user);
        
        vm.expectRevert("Zero deposit");
        vault.deposit(0, 10000);
        
        vm.stopPrank();
    }
    
    function testRevertWithdrawNoPosition() public {
        vm.startPrank(user);
        
        vm.expectRevert("No position");
        vault.withdraw(100e6);
        
        vm.stopPrank();
    }
    
    function testPoolStateUpdatesLong() public {
        uint256 depositAmount = 1000e6;
        int32 leverage = 30000;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount, leverage);
        vm.stopPrank();
        
        DataTypes.PoolState memory poolState = vault.getPoolState();
        assertEq(poolState.totalSeniorDeposits, depositAmount);
        assertGt(poolState.grossLongExposure, 0);
        assertGt(poolState.netExposure, 0);
        assertEq(poolState.grossShortExposure, 0);
    }
    
    // NOTE: Short position test skipped - requires DEX integration for asset->USDC swaps
    // The looping contract is deployed and ready for long positions
    // Short positions will be tested on testnet with actual DEX integration
    
    function testMultipleUsers() public {
        address user2 = address(0x2);
        usdc.mint(user2, 10_000e6);
        
        // User 1 deposits
        vm.startPrank(user);
        usdc.approve(address(vault), 1000e6);
        vault.deposit(1000e6, 20000);
        vm.stopPrank();
        
        // User 2 deposits
        vm.startPrank(user2);
        usdc.approve(address(vault), 2000e6);
        vault.deposit(2000e6, 30000);
        vm.stopPrank();
        
        // Both positions should be active
        assertTrue(vault.getPosition(user).isActive);
        assertTrue(vault.getPosition(user2).isActive);
        
        // Pool state should reflect both
        DataTypes.PoolState memory poolState = vault.getPoolState();
        assertEq(poolState.totalSeniorDeposits, 3000e6);
    }
    
    function testJuniorDeposit() public {
        uint256 depositAmount = 5000e6;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        uint256 shares = vault.depositJunior(depositAmount);
        vm.stopPrank();
        
        assertGt(shares, 0);
        
        DataTypes.PoolState memory poolState = vault.getPoolState();
        assertEq(poolState.totalJuniorDeposits, depositAmount);
    }
    
    function testJuniorWithdraw() public {
        uint256 depositAmount = 5000e6;
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        uint256 shares = vault.depositJunior(depositAmount);
        
        uint256 balanceBefore = usdc.balanceOf(user);
        uint256 amount = vault.withdrawJunior(shares);
        vm.stopPrank();
        
        assertEq(amount, shares);
        assertEq(usdc.balanceOf(user), balanceBefore + amount);
    }
    
    function testPauseUnpause() public {
        vault.pause();
        
        DataTypes.PoolState memory poolState = vault.getPoolState();
        assertEq(poolState.protocolState, 2);
        
        vm.startPrank(user);
        usdc.approve(address(vault), 1000e6);
        
        vm.expectRevert("Protocol paused");
        vault.deposit(1000e6, 10000);
        
        vm.stopPrank();
        
        vault.unpause();
        poolState = vault.getPoolState();
        assertEq(poolState.protocolState, 0);
    }
    
    function testFuzzLoopingLong(uint256 depositAmount, uint32 leverage) public {
        // Bound inputs to valid ranges
        depositAmount = bound(depositAmount, 100e6, 10_000e6); // 100 to 10k USDC
        leverage = uint32(bound(leverage, 10000, 40000)); // 1x to 4x (long only)
        
        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        
        uint256 finalPosition = vault.deposit(depositAmount, int32(leverage));
        vm.stopPrank();
        
        // Basic sanity checks
        assertGt(finalPosition, 0);
        
        DataTypes.Position memory pos = vault.getPosition(user);
        assertTrue(pos.isActive);
        assertEq(pos.depositAmount, depositAmount);
        assertEq(pos.leverageBps, int32(leverage));
        
        // For leverage >= 1x, should have debt
        if (leverage > 10000) {
            DataTypes.EulerPosition memory eulerPos = vault.getEulerPosition(user);
            assertTrue(eulerPos.isActive);
            assertGt(eulerPos.debtAmount, 0);
        }
        
        // Final position should be roughly depositAmount * (leverage / 10000)
        uint256 expectedPosition = (depositAmount * leverage) / 10000;
        assertApproxEqRel(finalPosition, expectedPosition, 0.15e18); // Within 15%
    }
}
