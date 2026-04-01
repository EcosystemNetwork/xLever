# Multi-Chain Lending & Borrowing

Agentic lending automation across 4 chains with protocol-specific adapters.

---

## Architecture

```
Nav Chain Switcher (click network badge)
       |
       v
LendingAdapterRegistry (singleton)
       |
       ├── EulerV2Adapter  → Ink Sepolia (chainId 763373)
       ├── EulerV2Adapter  → Ethereum Mainnet (chainId 1)
       ├── KaminoAdapter   → Solana (solana:mainnet)
       └── EvaaAdapter     → TON (ton:mainnet)
              |
              v
LendingAgent (chain-agnostic tick loop)
       |
       ├── Yield Mode      → auto-supply idle capital, rebalance for best APY
       ├── Leverage Mode   → supply collateral, borrow, manage health factor
       ├── Hedge Mode      → offset xLever position risk via lending
       └── Monitor Mode    → read-only alerts, cross-chain health checks
```

---

## Supported Protocols

| Chain | Protocol | Markets | Status |
|-------|----------|---------|--------|
| Ink Sepolia | Euler V2 EVK | USDC, wQQQx, wSPYx, WETH | Live (on-chain reads) |
| Ethereum | Euler V2 EVK | USDC, WETH, wstETH, USDT | Deployed on Sepolia (33 vaults mirrored) |
| Solana | Kamino Finance | USDC, SOL, USDT, JitoSOL | Adapter live (SDK integration needed) |
| TON | EVAA Protocol | TON, USDT, USDC, stTON | Adapter live (TL-B encoding needed) |

---

## Frontend Files

| File | Purpose |
|------|---------|
| `lending-adapters.js` | Adapter interface, Euler/Kamino/EVAA implementations, registry |
| `lending-agent.js` | Chain-agnostic lending automation (4 policy modes) |
| `nav.js` | Chain switcher syncs registry + hot-swaps agent |
| `09-lending-borrowing.html` | Cross-chain lending UI — markets, positions, yield comparison |

---

## Backend Routes

All routes accept `?chain=ink-sepolia|ethereum|solana|ton` to filter by chain.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/lending/markets` | GET | Market data (APY, TVL, utilization) per chain |
| `/api/lending/markets/{symbol}` | GET | Single market lookup |
| `/api/lending/positions/{wallet}` | GET | User positions, aggregated or per-chain |
| `/api/lending/rates/history/{symbol}` | GET | Historical rate data |
| `/api/lending/overview` | GET | Cross-chain TVL, best rates, protocol breakdown |
| `/api/lending/chains` | GET | Supported chains with status |

---

## Adapter Interface (ILendingAdapter)

Every chain adapter implements:

```javascript
class ILendingAdapter {
  get protocolName()           // "Euler V2", "Kamino Finance", "EVAA Protocol"
  isReady()                    // SDK loaded, wallet available
  async getAddress()           // Connected wallet address
  async getMarkets()           // All markets: APY, utilization, TVL
  async getPositions(address)  // User supplies, borrows, health factor
  async getIdleBalance(address)// Undeployed stablecoin balance
  async supply(asset, amount)  // Deposit into lending pool
  async withdraw(asset, amount)// Withdraw from lending pool
  async borrow(asset, amount)  // Borrow against collateral
  async repay(asset, amount)   // Repay borrowed asset
  explorerUrl(hash)            // Block explorer link
}
```

### Adding a New Chain

1. Create a new class extending `ILendingAdapter`
2. Implement all methods for your protocol's SDK
3. Register in `LendingAdapterRegistry.init()`
4. Add chain to `CHAIN_CONFIG` and `CHAIN_NAMES` in nav.js
5. Add market data to backend `lending.py`

---

## Cross-Chain Features

### Yield Comparison
The agent's Yield mode compares APY across all chains and logs cross-chain opportunities when another chain offers significantly better rates (configurable threshold, default 3%).

### Aggregated Positions
`GET /api/lending/positions/{wallet}` without `?chain=` returns positions across all 4 chains with an aggregated summary.

### Market Overview
`GET /api/lending/overview` returns total TVL, best supply/borrow rates, and per-chain breakdowns.

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@solana/web3.js` | ^1.98.4 | Solana RPC, transaction building, wallet signing |
| `@ton/ton` | ^15.3.0 | TON client, contract interaction |
| `@ton/core` | ^0.59.1 | Cell/BOC serialization for TON messages |
| `@ton/crypto` | ^3.3.0 | TON cryptographic primitives |
| `viem` | ^2.47.6 | EVM contract reads/writes (Euler V2) |

---

## Known Limitations

1. **Backend market data is static** — APY/TVL values are hardcoded, not fetched from APIs
2. **Kamino instructions are simplified** — need official Kamino SDK for proper account key layout
3. **EVAA payloads use estimated op codes** — need real TL-B schema from EVAA docs
4. **Ethereum mainnet vaults not deployed** — script ready, needs execution
5. **Position data is placeholder** — backend returns empty positions until on-chain indexing is built
