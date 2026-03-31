# Euler Vault Kit Deployment Guide - Ink Sepolia

This guide walks through deploying the Euler Vault Kit on Ink Sepolia for the xLever protocol.

## Prerequisites

1. **Foundry installed**
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

2. **Funded wallet on Ink Sepolia**
   - Get testnet ETH from Ink Sepolia faucet
   - Ensure sufficient balance for deployment

3. **Environment setup**
   - Copy `.env.example` to `.env`
   - Fill in your `PRIVATE_KEY`

## Network Information

- **Network Name**: Ink Sepolia
- **RPC URL**: `https://rpc-gel-sepolia.inkonchain.com`
- **Chain ID**: `763373`
- **Explorer**: TBD

## Deployment Steps

### Step 1: Deploy EVC (Ethereum Vault Connector)

The EVC is a critical dependency. You have two options:

**Option A: Use existing EVC deployment**
```bash
# If EVC is already deployed on Ink Sepolia, add to .env:
EVC_ADDRESS=0x...
```

**Option B: Deploy EVC yourself**
```bash
# Clone EVC repository
cd ..
git clone https://github.com/euler-xyz/ethereum-vault-connector.git
cd ethereum-vault-connector

# Install dependencies
forge install

# Deploy EVC
forge script script/DeployEVC.s.sol --rpc-url $RPC_URL --broadcast --verify

# Copy the deployed EVC address to your .env file
```

### Step 2: Deploy Euler Vault Kit Core

```bash
cd /home/remsee/xLeverContracts/contracts

# Ensure dependencies are installed
forge install

# Run deployment script
forge script script/DeployEulerVaultKit.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  -vvvv

# This will deploy:
# - ProtocolConfig
# - SequenceRegistry
# - EVault Implementation
# - EVault Factory
# - IRM Linear Kink
```

After deployment, addresses will be saved to `deployments/ink-sepolia.json`.

### Step 3: Update .env with Deployed Addresses

Copy the deployed addresses from the console output or `deployments/ink-sepolia.json` to your `.env` file:

```bash
PROTOCOL_CONFIG_ADDRESS=0x...
SEQUENCE_REGISTRY_ADDRESS=0x...
EVAULT_IMPLEMENTATION_ADDRESS=0x...
EVAULT_FACTORY_ADDRESS=0x...
IRM_ADDRESS=0x...
```

### Step 4: Create Vaults for xLever Protocol

The xLever protocol requires two vaults:
1. **Senior Vault** - For leverage traders
2. **Junior Vault** - For liquidity providers

```bash
# Set asset address in .env (e.g., USDC)
ASSET_ADDRESS=0x...  # USDC or base asset
EVAULT_FACTORY_ADDRESS=0x...  # From step 2

# Create vault
forge script script/CreateVault.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  -vvvv
```

Repeat for both Senior and Junior vaults with different configurations.

### Step 5: Configure Vaults

After creating vaults, configure them for the xLever protocol:

```solidity
// Senior Vault Configuration
- Higher interest rates (to attract deposits)
- Lower LTV ratios (more conservative)
- Collateral: xQQQ tokens

// Junior Vault Configuration  
- Lower interest rates
- Higher risk tolerance
- Absorbs losses from Senior vault
```

### Step 6: Set Up Oracles

Configure Pyth oracles for price feeds:

```bash
# Deploy or configure oracle adapter
# Set oracle addresses in vault configuration
vault.setOracle(collateralAsset, oracleAddress);
```

### Step 7: Configure Collateral

Set LTV (Loan-to-Value) ratios for collateral assets:

```bash
# Example: Set xQQQ as collateral with 80% LTV
vault.setLTV(xQQQAddress, 0.8e4, 0.8e4, 0);
```

## Verification

After deployment, verify contracts on block explorer:

```bash
forge verify-contract \
  --chain-id 763373 \
  --compiler-version v0.8.19 \
  <CONTRACT_ADDRESS> \
  <CONTRACT_NAME> \
  --watch
```

## Testing

Test vault operations:

```bash
# Run tests
forge test -vvv

# Test specific functionality
forge test --match-test testDeposit -vvv
forge test --match-test testBorrow -vvv
```

## Integration with xLever Protocol

Once vaults are deployed and configured:

1. **Update frontend** with vault addresses
2. **Configure AI agent** with contract ABIs and addresses
3. **Set up monitoring** for vault health
4. **Test leverage operations** on testnet

## Key Contract Addresses (to be filled)

```
EVC: 
ProtocolConfig: 
SequenceRegistry: 
EVault Implementation: 
EVault Factory: 
IRM Linear Kink: 
Senior Vault: 
Junior Vault: 
```

## Troubleshooting

### Issue: EVC not deployed
**Solution**: Deploy EVC first or use existing deployment

### Issue: Insufficient gas
**Solution**: Increase gas limit in foundry.toml or use `--gas-limit` flag

### Issue: Verification fails
**Solution**: Ensure correct compiler version and constructor arguments

## Security Considerations

- [ ] Audit smart contracts before mainnet deployment
- [ ] Test all vault operations thoroughly
- [ ] Set appropriate caps and limits
- [ ] Configure emergency pause mechanisms
- [ ] Monitor vault health continuously

## Next Steps

1. Deploy to testnet and verify all functionality
2. Integrate with xLever frontend
3. Connect AI agent to deployed contracts
4. Run end-to-end tests
5. Prepare for mainnet deployment

## Resources

- [Euler Vault Kit Docs](https://docs.euler.finance/euler-vault-kit-white-paper/)
- [EVC Documentation](https://docs.euler.finance/ethereum-vault-connector/)
- [Foundry Book](https://book.getfoundry.sh/)
- [xLever Protocol Docs](../protocol.md)
