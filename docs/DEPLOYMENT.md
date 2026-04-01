# Deployment Guide

Environment setup, build process, deployment targets, and supported assets.

---

## Prerequisites

- **Node.js** 18+
- **Python** 3.10+
- **Foundry** (for smart contract compilation/deployment)
- **PostgreSQL** (for backend API)
- **Redis** (for caching layer)

---

## Local Development

### 1. Install Dependencies

```bash
npm install
cd server && pip install -r requirements.txt && cd ..
```

### 2. Environment Configuration

Copy `.env` and configure:

```env
# Reown (WalletConnect) Project ID — get one at https://cloud.reown.com
VITE_REOWN_PROJECT_ID=your_project_id

# Network RPC URL
RPC_URL=https://rpc-gel-sepolia.inkonchain.com

# Chain ID for Ink Sepolia
CHAIN_ID=763373

# Contract addresses (filled after deployment)
EVC_ADDRESS=0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c
QQQ_VAULT_ADDRESS=0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6
SPY_VAULT_ADDRESS=0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228
USDC_ADDRESS=0x6b57475467cd854d36Be7FB614caDa5207838943
XQQQ_ADDRESS=0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9
PYTH_CONTRACT_ADDRESS=0x2880aB155794e7179c9eE2e38200202908C17B43
PYTH_ADAPTER_ADDRESS=0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f
```

### 3. Start Services

```bash
# Start data proxy server (background)
cd server && python3 server.py &
cd ..

# Start frontend dev server
npm run dev
# -> http://localhost:3000 (auto-opens browser)
```

### 4. Optional: Start FastAPI Backend

```bash
cd server
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

Requires `DATABASE_URL`, `REDIS_URL`, and `CORS_ORIGINS` in `.env`.

---

## Production Build

### Frontend

```bash
npm run build
# -> output in dist/

# Preview locally
npm run preview
```

### Vite Build Configuration

| Setting | Value |
|---------|-------|
| Root | `frontend/` |
| Output | `dist/` |
| Entry points | 8 HTML pages (multi-page build) |
| Dev proxy | `/api/*` -> `http://localhost:8000` |
| Dev port | 3000 |

---

## Vercel Deployment

### Configuration

| Setting | Value |
|---------|-------|
| Build command | `npm run build` |
| Install command | `npm install` |
| Output directory | `dist/` |
| Framework preset | Vite |

### Rewrites

All routes rewrite to `index.html` for SPA routing.

### Cache Headers

Assets are cached for 1 year with `immutable` flag.

### Environment Variables (Vercel Dashboard)

| Variable | Type | Description |
|----------|------|-------------|
| `VITE_REOWN_PROJECT_ID` | Public | WalletConnect project ID (safe to expose) |

---

## Smart Contract Deployment

### Foundry Setup

```bash
cd contracts

# Install dependencies
forge install

# Compile
forge build

# Deploy to Ink Sepolia
forge script script/Deploy.s.sol --rpc-url https://rpc-gel-sepolia.inkonchain.com --broadcast
```

### Configuration (foundry.toml)

- Solidity compiler: ^0.8.0
- Test framework: Foundry
- Formal verification: Certora (audit-grade proofs)

### Deployment Order

1. **EVC** — Ethereum Vault Connector (or use existing deployment)
2. **PythOracleAdapter** — Wraps Pyth contract for TWAP pricing
3. **VaultFactory** — Deploys and registers vaults
4. **Vault (QQQ)** — Main vault for wQQQx leverage
5. **Vault (SPY)** — Vault for wSPYx leverage

After deployment, update `.env` with the new contract addresses.

---

## Supported Chains

| Chain | Chain ID | Status | Purpose |
|-------|----------|--------|---------|
| Ink Sepolia | 763373 | **Primary** | Testnet deployment, all contracts live |
| Ethereum | 1 | Reference | Euler V2 core contracts, xStocks ERC-20 |
| Solana | -- | Future | xStocks expansion |
| TON | -- | Future | xStocks expansion |

### RPC Endpoints

| Chain | URL |
|-------|-----|
| Ink Sepolia | `https://rpc-gel-sepolia.inkonchain.com` |
| Ethereum | Standard mainnet RPC |

### Block Explorer

| Chain | URL |
|-------|-----|
| Ink Sepolia | `https://explorer-sepolia.inkonchain.com` |

---

## Supported Assets

### With Pyth Oracle Feeds (Fully Supported)

These assets have active Pyth price feeds and can be used for vault creation and leveraged trading:

| Asset | Symbol | Pyth Feed | Vault |
|-------|--------|-----------|-------|
| Invesco QQQ Trust (Nasdaq-100) | QQQ/USD | Active | Deployed |
| SPDR S&P 500 ETF | SPY/USD | Active | Deployed |
| Apple Inc. | AAPL/USD | Active | Planned |
| NVIDIA Corp. | NVDA/USD | Active | Planned |
| Tesla Inc. | TSLA/USD | Active | Planned |
| Ethereum | ETH/USD | Active | Reference |

### Without Pyth Feeds (Cannot Support Yet)

The following 9 assets do **not** have Pyth price feeds. They are blocked from vault creation until Pyth registers corresponding feeds:

| Symbol | Description |
|--------|-------------|
| MOO | VanEck Agribusiness ETF |
| URA | Global X Uranium ETF |
| VCX | -- |
| LITE | Lumentum Holdings |
| USAR | -- |
| UUUU | Energy Fuels Inc. |
| COPX | Global X Copper Miners ETF |
| SLMT | -- |
| KRAQ | -- |

> **Note:** xLever requires a Pyth oracle feed for every supported asset. Without a reliable on-chain price source, the protocol cannot calculate TWAP, enforce dynamic spread pricing, or trigger auto-deleverage — all of which are critical safety mechanisms.

---

## Environment Variables Reference

### Frontend (VITE_ prefix, exposed to browser)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_REOWN_PROJECT_ID` | Yes | Reown/WalletConnect project ID |

### Smart Contracts

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Deploy only | Deployer wallet private key (never commit) |
| `RPC_URL` | Yes | Network RPC endpoint |
| `CHAIN_ID` | Yes | Target chain ID |
| `ETHERSCAN_API_KEY` | Optional | For contract verification |

### Contract Addresses

| Variable | Description |
|----------|-------------|
| `EVC_ADDRESS` | Ethereum Vault Connector |
| `QQQ_VAULT_ADDRESS` | QQQ leverage vault |
| `SPY_VAULT_ADDRESS` | SPY leverage vault |
| `USDC_ADDRESS` | USDC collateral token |
| `XQQQ_ADDRESS` | Wrapped QQQ xStock (wQQQx) |
| `PYTH_CONTRACT_ADDRESS` | Pyth oracle contract |
| `PYTH_ADAPTER_ADDRESS` | Pyth adapter + fee handler |

### Backend API

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `CORS_ORIGINS` | Allowed CORS origins |

---

## Security Notes

- **Never commit `PRIVATE_KEY`** to version control
- `VITE_REOWN_PROJECT_ID` is safe to expose (it's a public project identifier)
- Contract addresses are public by nature (on-chain)
- Pyth feed IDs are public constants
- Backend `.env` should contain `DATABASE_URL`, `REDIS_URL` — keep these private
