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

### Core Infrastructure
- **EVC**: `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c`
- **ProtocolConfig**: `0x15bb9ba8236de055090a262f45a7e213f6040320`
- **SequenceRegistry**: `0xb694120ecdc69fbbee3ae21831d7b76ab8a9169b`

### EVault System
- **EVault Implementation**: `0xd821a7d919e007b6b39925f672f1219db4865fba`
- **GenericFactory**: `0xba1240b966e20e16ca32bbfc189528787794f2a9`
- **IRM Linear Kink**: `0xe91a4b01632a7d281fb3eb0e83ad9d5f0305d48f`

### EVault Modules
- **Initialize**: `0x6abaeb70c9ba9ea497ff5e20d08bd20ca1e02139`
- **Token**: `0xb6251797386a8c5a2a4a8783f430ef2ed5c63bef`
- **Vault**: `0xce92e887d225d06c21a16d845d88e980d536fa2b`
- **Borrowing**: `0xd6ee29f9ae035adb0f2741228ed55f0fc6dbb6c2`
- **Liquidation**: `0xd1f77f73ca47a726875d884cc45eff289f6176e3`
- **RiskManager**: `0x8e3ef1e28262e351eb066374df1bed36cc704dda`
- **BalanceForwarder**: `0x4a7c22878c8c25354dd926bd89722a3aadafcb66`
- **Governance**: `0x75b85bbc8779b9cde77cc9dd0335c27410455a53`

## Getting Started

1. **Deploy Contracts**
   ```bash
   cd contracts
   # Follow QUICKSTART.md
   ```

2. **Run Frontend**
   ```bash
   cd frontend
   # Open index.html in browser
   ```

3. **Start Backend**
   ```bash
   cd server
   python server.py
   ```

## Team

- **Mads**: Euler Vault Kit integration & deployment
- **Eric & Maroua**: AI agent for automated trading

## License

See individual component licenses.
