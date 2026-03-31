# Quick Start - Deploy Euler Vault Kit on Ink Sepolia

## 1. Setup Environment

```bash
# Navigate to contracts directory
cd /home/remsee/xLeverContracts/contracts

# Copy environment template
cp ../.env.example ../.env

# Edit .env and add your private key
nano ../.env
```

Add your private key to `.env`:
```
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
```

## 2. Get Testnet Funds

Ensure your wallet has Ink Sepolia testnet ETH for deployment gas fees.

## 3. Deploy EVC (One-time, or use existing)

Check if EVC is already deployed on Ink Sepolia. If not:

```bash
# Clone EVC repository
cd /home/remsee/xLeverContracts
git clone https://github.com/euler-xyz/ethereum-vault-connector.git evc
cd evc

# Install and deploy
forge install
forge create src/EthereumVaultConnector.sol:EthereumVaultConnector \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com \
  --private-key $PRIVATE_KEY
```

Copy the deployed EVC address and add to `.env`:
```
EVC_ADDRESS=0x...
```

## 4. Deploy Euler Vault Kit

```bash
cd /home/remsee/xLeverContracts/contracts

# Load environment variables
source ../.env

# Deploy core contracts
forge script script/DeployEulerVaultKit.s.sol \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com \
  --broadcast \
  --private-key $PRIVATE_KEY \
  -vvvv
```

This deploys:
- ✅ ProtocolConfig
- ✅ SequenceRegistry  
- ✅ EVault Implementation
- ✅ EVault Factory
- ✅ IRM Linear Kink

Deployment addresses are saved to `deployments/ink-sepolia.json`.

## 5. Update .env with Deployed Addresses

After deployment, update your `.env` file with the contract addresses from the output:

```bash
# Copy addresses from console output or deployments/ink-sepolia.json
EVAULT_FACTORY_ADDRESS=0x...
IRM_ADDRESS=0x...
PROTOCOL_CONFIG_ADDRESS=0x...
```

## 6. Create Vaults

You need asset addresses (USDC, xQQQ) before creating vaults. 

Once you have them, update `.env`:
```
ASSET_ADDRESS=0x...  # USDC address
XQQQ_ADDRESS=0x...   # xQQQ address
```

Create a vault:
```bash
forge script script/CreateVault.s.sol \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com \
  --broadcast \
  --private-key $PRIVATE_KEY \
  -vvvv
```

## 7. Configure for xLever

After creating both Senior and Junior vaults, configure them:

```bash
# Update .env with vault addresses
SENIOR_VAULT_ADDRESS=0x...
JUNIOR_VAULT_ADDRESS=0x...
ORACLE_ADDRESS=0x...

# Run configuration script
forge script script/ConfigureVaultForXLever.s.sol \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com \
  --broadcast \
  --private-key $PRIVATE_KEY \
  -vvvv
```

## 8. Test Deployment

```bash
# Run tests
forge test -vvv

# Test against deployed contracts
forge test --fork-url https://rpc-gel-sepolia.inkonchain.com -vvv
```

## Deployed Contracts Checklist

- [ ] EVC deployed
- [ ] ProtocolConfig deployed
- [ ] SequenceRegistry deployed
- [ ] EVault Implementation deployed
- [ ] EVault Factory deployed
- [ ] IRM deployed
- [ ] Senior Vault created
- [ ] Junior Vault created
- [ ] Vaults configured for xLever
- [ ] Oracles set up
- [ ] Integration tested

## Next Steps

1. **Frontend Integration**: Update frontend with deployed contract addresses
2. **AI Agent Setup**: Configure agent with ABIs and addresses
3. **Oracle Configuration**: Set up Pyth price feeds
4. **Testing**: Run comprehensive tests on testnet
5. **Monitoring**: Set up vault health monitoring

## Troubleshooting

**Issue**: Transaction fails with "EVC_ADDRESS required"
- **Fix**: Deploy EVC first or add existing EVC address to `.env`

**Issue**: Out of gas
- **Fix**: Ensure wallet has sufficient testnet ETH

**Issue**: Contract verification fails
- **Fix**: Add Etherscan API key to `.env` (if explorer supports it)

## Support

- Euler Docs: https://docs.euler.finance/
- Foundry Book: https://book.getfoundry.sh/
- xLever Protocol: See `../protocol.md` and `../hackPlan.md`
