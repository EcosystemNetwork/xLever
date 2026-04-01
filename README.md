# xLever - Leveraged Tokenized Asset Protocol

Continuous leverage from -4× to +4× on tokenized assets without liquidation risk, powered by Euler Vault Kit.

## Project Structure

```
xLeverContracts/
├── contracts/          # Euler Vault Kit smart contracts
│   ├── src/           # Core EVK contracts
│   ├── script/        # Deployment scripts
│   ├── test/          # Tests
│   ├── DEPLOYMENT.md  # Detailed deployment guide
│   └── QUICKSTART.md  # Quick start guide
├── frontend/          # Web interface
├── server/            # Backend server
├── protocol.md        # Protocol specification
├── hackPlan.md        # Development plan
└── .env.example       # Environment template
```

## Quick Start

See [`contracts/QUICKSTART.md`](contracts/QUICKSTART.md) for deployment instructions.

## Documentation

- **[Protocol Specification](protocol.md)** - Complete protocol design
- **[Deployment Guide](contracts/DEPLOYMENT.md)** - Step-by-step deployment
- **[Hackathon Plan](hackPlan.md)** - Team assignments and milestones

## Key Features

- **Continuous Leverage**: -4× to +4× range on tokenized assets
- **No Liquidations**: Risk socialized through Junior tranche
- **Euler V2 Integration**: Modular vault architecture with EVC
- **AI Agent Trading**: Automated position management
- **Pyth Oracles**: 15-minute TWAP pricing

## Network

- **Testnet**: Ink Sepolia
- **Chain ID**: 763373
- **RPC**: https://rpc-gel-sepolia.inkonchain.com

## Deployed Contracts (Ink Sepolia)

### xLever Protocol - LIVE & FULLY FUNCTIONAL ✅
- **wSPYx Vault**: [`0x6bbb5fe4f82b14bd29fd8d7b9cc1f45a6e19c3dd`](https://explorer-sepolia.inkonchain.com/address/0x6bbb5fe4f82b14bd29fd8d7b9cc1f45a6e19c3dd)
- **wQQQx Vault**: [`0xd76378af8494eafa6251d13dcbcaa4f39e70b90b`](https://explorer-sepolia.inkonchain.com/address/0xd76378af8494eafa6251d13dcbcaa4f39e70b90b)

**Status:** ✅ **FULLY FUNCTIONAL WITH JUNIOR TRANCHE** - Full vault contracts with junior liquidity provider support deployed and integrated!

**Features:**
- ✅ Open positions with USDC deposit and leverage selection (-4x to +4x)
- ✅ Close positions and withdraw USDC
- ✅ Asset selection (SPY/QQQ)
- ✅ Real-time position tracking
- ✅ Balance updates
- ✅ **Junior tranche deposits and withdrawals**
- ✅ **First-loss capital pool for LPs**
- ✅ **Fee distribution to junior LPs**
- ✅ Fully integrated frontend UI with chart visualization

**How to Use:**
1. Connect MetaMask wallet to Ink Sepolia network
2. Get testnet USDC from faucet
3. Select asset (SPY or QQQ) and leverage
4. Enter USDC amount and open position
5. View your active positions
6. Close positions to withdraw USDC + P&L

### Tokens
- **USDC**: [`0x6b57475467cd854d36Be7FB614caDa5207838943`](https://explorer-sepolia.inkonchain.com/address/0x6b57475467cd854d36Be7FB614caDa5207838943)
- **wSPYx (Wrapped SP500)**: [`0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e`](https://explorer-sepolia.inkonchain.com/address/0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e)
- **wQQQx (Wrapped Nasdaq)**: [`0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9`](https://explorer-sepolia.inkonchain.com/address/0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9)

### Euler Vaults (75% Borrow LTV / 87% Liquidation LTV)
- **USDC EVault**: [`0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53`](https://explorer-sepolia.inkonchain.com/address/0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53)
- **wSPYx EVault**: [`0x6d064558d58645439A64cE1e88989Dfba88AA052`](https://explorer-sepolia.inkonchain.com/address/0x6d064558d58645439A64cE1e88989Dfba88AA052)
- **wQQQx EVault**: [`0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9`](https://explorer-sepolia.inkonchain.com/address/0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9)

**LTV Configuration:**
- Borrow LTV: 75% (max 3x safe leverage, 4x theoretical)
- Liquidation LTV: 87% (12% volatility buffer before liquidation)
- Collateral pairs: USDC ↔ wSPYx, USDC ↔ wQQQx

### Euler Vault Kit Infrastructure
- **EVC**: [`0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c`](https://explorer-sepolia.inkonchain.com/address/0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c)
- **ProtocolConfig**: [`0x15bb9ba8236de055090a262f45a7e213f6040320`](https://explorer-sepolia.inkonchain.com/address/0x15bb9ba8236de055090a262f45a7e213f6040320)
- **SequenceRegistry**: [`0xb694120ecdc69fbbee3ae21831d7b76ab8a9169b`](https://explorer-sepolia.inkonchain.com/address/0xb694120ecdc69fbbee3ae21831d7b76ab8a9169b)

### EVault System
- **EVault Implementation**: [`0xd821a7d919e007b6b39925f672f1219db4865fba`](https://explorer-sepolia.inkonchain.com/address/0xd821a7d919e007b6b39925f672f1219db4865fba)
- **GenericFactory**: [`0xba1240b966e20e16ca32bbfc189528787794f2a9`](https://explorer-sepolia.inkonchain.com/address/0xba1240b966e20e16ca32bbfc189528787794f2a9)
- **IRM Linear Kink**: [`0xe91a4b01632a7d281fb3eb0e83ad9d5f0305d48f`](https://explorer-sepolia.inkonchain.com/address/0xe91a4b01632a7d281fb3eb0e83ad9d5f0305d48f)

### EVault Modules
- **Initialize**: [`0x6abaeb70c9ba9ea497ff5e20d08bd20ca1e02139`](https://explorer-sepolia.inkonchain.com/address/0x6abaeb70c9ba9ea497ff5e20d08bd20ca1e02139)
- **Token**: [`0xb6251797386a8c5a2a4a8783f430ef2ed5c63bef`](https://explorer-sepolia.inkonchain.com/address/0xb6251797386a8c5a2a4a8783f430ef2ed5c63bef)
- **Vault**: [`0xce92e887d225d06c21a16d845d88e980d536fa2b`](https://explorer-sepolia.inkonchain.com/address/0xce92e887d225d06c21a16d845d88e980d536fa2b)
- **Borrowing**: [`0xd6ee29f9ae035adb0f2741228ed55f0fc6dbb6c2`](https://explorer-sepolia.inkonchain.com/address/0xd6ee29f9ae035adb0f2741228ed55f0fc6dbb6c2)
- **Liquidation**: [`0xd1f77f73ca47a726875d884cc45eff289f6176e3`](https://explorer-sepolia.inkonchain.com/address/0xd1f77f73ca47a726875d884cc45eff289f6176e3)
- **RiskManager**: [`0x8e3ef1e28262e351eb066374df1bed36cc704dda`](https://explorer-sepolia.inkonchain.com/address/0x8e3ef1e28262e351eb066374df1bed36cc704dda)
- **BalanceForwarder**: [`0x4a7c22878c8c25354dd926bd89722a3aadafcb66`](https://explorer-sepolia.inkonchain.com/address/0x4a7c22878c8c25354dd926bd89722a3aadafcb66)
- **Governance**: [`0x75b85bbc8779b9cde77cc9dd0335c27410455a53`](https://explorer-sepolia.inkonchain.com/address/0x75b85bbc8779b9cde77cc9dd0335c27410455a53)

## Getting Started

### Using the Live App

1. **Setup Wallet**
   - Install MetaMask
   - Add Ink Sepolia network (Chain ID: 763373)
   - RPC: `https://lb.drpc.org/ogrpc?network=ink-sepolia&dkey=AmNgmLfXikwWhpaarzWUjEmU59gkRdwR8ImsKlzbRHZc`

2. **Get Testnet Tokens**
   - Get testnet ETH for gas
   - Get testnet USDC: `0x6b57475467cd854d36Be7FB614caDa5207838943`

3. **Run Frontend**
   ```bash
   cd frontend
   python3 -m http.server 8080
   # Open http://localhost:8080 in browser
   ```

4. **Open a Position**
   - Connect wallet
   - Select asset (SPY or QQQ)
   - Choose leverage with slider
   - Enter USDC amount
   - Click "Open Position"
   - Approve transactions in MetaMask

### Development

1. **Deploy New Contracts**
   ```bash
   cd contracts
   forge script script/DeploySimple.s.sol:DeploySimple --rpc-url <RPC> --broadcast --private-key <KEY>
   ```

2. **Run Tests**
   ```bash
   cd contracts
   forge test
   ```

## Team

- **Mads**: Euler Vault Kit integration & deployment
- **Eric & Maroua**: AI agent for automated trading

## License

See individual component licenses.
