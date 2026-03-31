# xLever Protocol Contracts

Leveraged tokenized asset protocol with fixed-entry leverage and no liquidations.

## Architecture

```
VaultFactory
    └── Vault (per asset, e.g., xQQQ)
        ├── TWAPOracle (15-min TWAP with dynamic spread)
        ├── PositionModule (fixed-entry leverage tracking)
        ├── FeeEngine (dynamic fees + funding rate)
        ├── JuniorTranche (first-loss capital)
        └── RiskModule (health monitoring + auto-deleverage)
```

## Contracts

### Core
- **VaultFactory**: Deploys and manages vaults per asset
- **Vault**: Main user interface for deposits, withdrawals, and leverage adjustments

### Modules
- **TWAPOracle**: 15-minute TWAP with dynamic spread pricing based on spot-TWAP divergence
- **PositionModule**: Tracks user positions with fixed-entry leverage (not daily rebalanced)
- **FeeEngine**: Calculates dynamic entry/exit fees, carry fees, and funding rates
- **JuniorTranche**: First-loss capital pool that absorbs losses before senior users
- **RiskModule**: Health monitoring, auto-deleverage, and circuit breakers

## Key Features

### Fixed-Entry Leverage
Unlike TQQQ/SPXL which rebalance daily, xLever uses **fixed-entry leverage**:
- Your PnL = Deposit × Leverage × (Price Change from Entry)
- No volatility decay in choppy markets
- No daily rebalancing

### Two-Tranche System
- **Senior (Users)**: Leveraged positions with no liquidation risk
- **Junior (LPs)**: First-loss capital earning fee revenue

### Dynamic Fees
Entry/exit fees scale with spot-TWAP divergence:
- 0% divergence: 0.08% entry fee
- 1% divergence: 0.12% entry fee
- 2% divergence: 0.16% entry fee
- >3% divergence: Rejected

### Risk Management
- Dynamic leverage caps based on junior ratio
- Auto-deleverage cascade at health thresholds
- Circuit breakers for volume, drawdown, and volatility

## Deployment

```bash
# Set environment variables
export USDC_ADDRESS=<usdc-address>
export XQQQ_ADDRESS=<xqqq-address>

# Deploy xLever protocol
forge script script/DeployXLever.s.sol --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY --legacy
```

## Usage

### For Senior Users (Leverage Traders)

```solidity
// Deposit $10K at 3x long
vault.deposit(10_000e6, 30000); // 30000 bps = 3x

// Adjust to 2x
vault.adjustLeverage(20000);

// Withdraw
vault.withdraw(amount);
```

### For Junior LPs (First-Loss Capital)

```solidity
// Deposit into junior tranche
vault.depositJunior(100_000e6);

// Withdraw
vault.withdrawJunior(shares);
```

## Integration with Euler Vault Kit

The xLever protocol is designed to use Euler V2 for hedging:
- Net long exposure → Loop USDC → xQQQ on Euler
- Net short exposure → Loop xQQQ → USDC on Euler
- EVC batch operations for atomic leverage construction

**Note**: The EulerHedgingModule is not yet implemented. Current contracts handle position tracking and fee management. Euler integration coming next.

## Next Steps

1. Deploy mock USDC and xQQQ tokens for testing
2. Implement EulerHedgingModule for actual hedging via EVC
3. Add Pyth oracle integration for price feeds
4. Test full deposit → hedge → withdraw flow
5. Deploy to Ink Sepolia testnet

## Security Considerations

⚠️ **These contracts are experimental and unaudited**
- Do not use with real funds
- Intended for hackathon/testing purposes only
- Euler integration requires careful testing
- Circuit breakers and risk limits need tuning

## License

GPL-2.0-or-later
