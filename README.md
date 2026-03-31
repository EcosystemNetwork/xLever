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

### xLever Protocol
- **wSPYx Vault**: [`0x95822416e61Ad6b45Fc45c7540947b6eF080D5a1`](https://explorer-sepolia.inkonchain.com/address/0x95822416e61Ad6b45Fc45c7540947b6eF080D5a1)
- **wQQQx Vault**: [`0x1034259f355566fcE4571F792d239a99BBa1b9b4`](https://explorer-sepolia.inkonchain.com/address/0x1034259f355566fcE4571F792d239a99BBa1b9b4)

### Euler Hedging Modules (Leverage Looping)
- **wSPYx Hedging**: [`0xd0673BeB607CA2136b126d34ED0D3Ff7826c93EE`](https://explorer-sepolia.inkonchain.com/address/0xd0673BeB607CA2136b126d34ED0D3Ff7826c93EE)
- **wQQQx Hedging**: [`0x3Bc3c0D268455aD7eAe1432f57f3C24f42EdC7C8`](https://explorer-sepolia.inkonchain.com/address/0x3Bc3c0D268455aD7eAe1432f57f3C24f42EdC7C8)

**Status:** Contracts deployed and tested. Oracle price feeds required for full functionality.

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
