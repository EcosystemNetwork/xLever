# Testing the Looping Functionality

## 🎉 Deployed Looping Vaults

- **wSPYx Looping Vault**: `0x93c0323D7133E2e9D57133a629a35Df17797d890`
- **wQQQx Looping Vault**: `0x0C2c35ed457a4532794602a588eB0C086Ebd67DB`

## Quick Test Guide

### 1. Start the Frontend

```bash
cd frontend
python3 -m http.server 8080
```

Open http://localhost:8080 in your browser.

### 2. Connect Wallet

- Connect MetaMask to Ink Sepolia network
- Chain ID: 763373
- RPC: https://rpc-gel-sepolia.inkonchain.com

### 3. Get Test USDC

Make sure you have some testnet USDC at: `0x6b57475467cd854d36Be7FB614caDa5207838943`

### 4. Test Looping

**Open a 3x Long Position:**
1. Select SPY or QQQ
2. Set leverage slider to 3x (30000 bps)
3. Enter amount (e.g., 100 USDC)
4. Click "Open Position"
5. Approve USDC spending
6. Confirm transaction

**What Happens Behind the Scenes:**

The contract will execute a loop like this:
```
Iteration 1: Deposit $100 → Borrow $74 (74% LTV)
Iteration 2: Deposit $74 → Borrow $55
Iteration 3: Deposit $55 → Borrow $41
Iteration 4: Deposit $41 → Borrow $30
Iteration 5: Deposit $30 → Borrow $22
...continues until ~$300 total collateral reached
```

### 5. Check the Transaction

After the transaction confirms, check the explorer:

**Look for these events:**
- `LoopExecuted` - Shows each iteration (deposited amount, borrowed amount)
- `PositionOpened` - Shows final totals (totalCollateral, totalDebt, leverage)

**Example:**
```
LoopExecuted(user, iteration=0, deposited=100000000, borrowed=74000000)
LoopExecuted(user, iteration=1, deposited=74000000, borrowed=54760000)
LoopExecuted(user, iteration=2, deposited=54760000, borrowed=40522400)
...
PositionOpened(user, totalCollateral=~300000000, totalDebt=~200000000, leverage=30000)
```

### 6. Check Position Health

You can call these view functions on the vault:

```javascript
// Get your position
vault.getPosition(yourAddress)
// Returns: depositAmount, leverageBps, entryTWAP, etc.

// Get Euler position details
vault.getEulerPosition(yourAddress)
// Returns: collateralVault, debtVault, collateralShares, debtAmount

// Get position health
vault.getPositionHealth(yourAddress)
// Returns: collateral, debt, healthFactor
```

### 7. Close Position (Test Unwinding)

1. Click "Close Position" in the UI
2. Confirm transaction

**What Happens:**
The contract unwinds the loop in reverse:
```
While debt > 0:
  - Withdraw collateral (maintaining health)
  - Repay debt with withdrawn funds
  - Repeat
Final: Withdraw all remaining collateral
```

## Verification Checklist

- [ ] Transaction succeeds (no revert)
- [ ] Multiple `LoopExecuted` events emitted
- [ ] `PositionOpened` event shows correct totals
- [ ] Total collateral ≈ initial deposit × leverage
- [ ] Total debt ≈ initial deposit × (leverage - 1)
- [ ] Health factor > 1.0 (safe position)
- [ ] Can successfully close position
- [ ] Receive USDC back after closing

## Expected Results for 100 USDC @ 3x Leverage

| Metric | Expected Value |
|--------|---------------|
| Initial Deposit | 100 USDC |
| Target Position | 300 USDC |
| Total Collateral | ~300 USDC |
| Total Debt | ~200 USDC |
| Net Position | ~100 USDC |
| Loop Iterations | 5-7 iterations |
| Health Factor | ~1.5 (150%) |

## Troubleshooting

**Transaction Reverts:**
- Check USDC approval
- Ensure sufficient USDC balance
- Verify leverage is within limits (-4x to +4x)

**No Loop Events:**
- Check transaction logs on explorer
- Verify you're looking at the correct vault address

**Health Factor Too Low:**
- This shouldn't happen with 74% effective LTV
- Check Euler vault LTV configuration

## Advanced: Manual Contract Interaction

Using cast or ethers.js:

```bash
# Check position
cast call 0x93c0323D7133E2e9D57133a629a35Df17797d890 \
  "getPosition(address)" YOUR_ADDRESS \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com

# Check Euler position
cast call 0x93c0323D7133E2e9D57133a629a35Df17797d890 \
  "getEulerPosition(address)" YOUR_ADDRESS \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com

# Check health
cast call 0x93c0323D7133E2e9D57133a629a35Df17797d890 \
  "getPositionHealth(address)" YOUR_ADDRESS \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com
```

## Next Steps

Once basic looping is verified:
1. Test different leverage amounts (1.5x, 2x, 4x)
2. Test short positions (negative leverage)
3. Monitor gas costs for different iteration counts
4. Verify loop unwinding works correctly
5. Test edge cases (very small amounts, max leverage)

## Documentation

See `LOOPING_EXPLAINED.md` for detailed explanation of the looping mechanism.
