// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import {EulerHedgingModule} from "../src/xLever/modules/EulerHedgingModule.sol";
import {IEVault} from "../src/EVault/IEVault.sol";
import {IEVC} from "../src/xLever/interfaces/IEVC.sol";

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

contract EulerHedgingTest is Test {
    EulerHedgingModule public hedging;
    MockERC20 public usdc;
    MockERC20 public asset;
    
    address public user = address(2);
    
    // Mock addresses for testing
    address public mockEVC = address(3);
    address public mockUsdcVault = address(4);
    address public mockAssetVault = address(5);
    
    function setUp() public {
        usdc = new MockERC20();
        asset = new MockERC20();
        
        hedging = new EulerHedgingModule(
            mockEVC,
            mockUsdcVault,
            mockAssetVault,
            address(usdc),
            address(asset)
        );
        
        // Mint tokens to user
        usdc.mint(user, 100_000e6);
        asset.mint(user, 100e18);
    }
    
    function testConstructor() public {
        assertEq(address(hedging.evc()), mockEVC);
        assertEq(address(hedging.usdcVault()), mockUsdcVault);
        assertEq(address(hedging.assetVault()), mockAssetVault);
        assertEq(address(hedging.usdc()), address(usdc));
        assertEq(address(hedging.asset()), address(asset));
        assertEq(hedging.owner(), address(this));
    }
    
    function testOpenLongPositionRevertsInvalidLeverage() public {
        vm.startPrank(user);
        asset.approve(address(hedging), 10e18);
        
        // Too low
        vm.expectRevert("Invalid leverage");
        hedging.openLongPosition(10e18, 5000);
        
        // Too high
        vm.expectRevert("Invalid leverage");
        hedging.openLongPosition(10e18, 50000);
        
        vm.stopPrank();
    }
    
    function testOpenShortPositionRevertsInvalidLeverage() public {
        vm.startPrank(user);
        usdc.approve(address(hedging), 10_000e6);
        
        // Too low
        vm.expectRevert("Invalid leverage");
        hedging.openShortPosition(10_000e6, 5000);
        
        // Too high
        vm.expectRevert("Invalid leverage");
        hedging.openShortPosition(10_000e6, 50000);
        
        vm.stopPrank();
    }
    
    function testEmergencyWithdrawOnlyOwner() public {
        usdc.mint(address(hedging), 1000e6);
        
        vm.prank(user);
        vm.expectRevert("Only owner");
        hedging.emergencyWithdraw(address(usdc), 1000e6);
        
        // Owner can withdraw
        uint256 balanceBefore = usdc.balanceOf(address(this));
        hedging.emergencyWithdraw(address(usdc), 1000e6);
        assertEq(usdc.balanceOf(address(this)) - balanceBefore, 1000e6);
    }
    
    function testLeverageCalculation() public {
        uint256 initialCollateral = 1000e6;
        uint256 targetLeverage = 30000; // 3x
        
        uint256 totalPosition = (initialCollateral * targetLeverage) / 10000;
        uint256 debtNeeded = totalPosition - initialCollateral;
        
        assertEq(totalPosition, 3000e6, "Total position should be 3x");
        assertEq(debtNeeded, 2000e6, "Debt should be 2x initial");
    }
}
