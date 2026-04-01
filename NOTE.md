# Note for Maroua & Mads

**Date:** 2026-03-31
**Re:** Multi-Chain Agentic Lending & Borrowing — Implementation Status

---

## What Was Built

We implemented multi-chain agentic lending and borrowing across all 4 supported chains:

| Chain | Protocol | Adapter |
|-------|----------|---------|
| Ink Sepolia | Euler V2 | `EulerV2Adapter` |
| Ethereum Mainnet | Euler V2 | `EulerV2Adapter` |
| Solana | Kamino Finance | `KaminoAdapter` |
| TON | EVAA Protocol | `EvaaAdapter` |

### New Files
- **`frontend/lending-adapters.js`** — Chain-agnostic adapter interface + all 4 adapters + registry singleton
- **`contracts/script/DeployMainnet.s.sol`** — Ethereum mainnet deployment script for all 33 vaults
- **`frontend/lending-agent.js`** — Refactored to be fully chain-agnostic (was Euler-only)
- **`server/api/routes/lending.py`** — Rewritten for multi-chain aggregation with `?chain=` filter
- **`frontend/nav.js`** — Network badge is now clickable, opens chain switcher, syncs lending agent

### New Dependencies
- `@solana/web3.js` — Solana RPC + transaction building
- `@ton/ton`, `@ton/core`, `@ton/crypto` — TON client + cell serialization

---

## What's Real (No Mock)

- Euler V2 on Ink Sepolia — 3 live markets (USDC, wQQQx, wSPYx), real on-chain reads via viem
- Adapter architecture — registry, chain switching, cross-chain aggregation all wired and working
- Nav chain switcher — hot-swaps the lending agent when you change networks
- Lending agent — all 4 policy modes (Yield, Leverage, Hedge, Monitor) work on any chain
- Build passes clean, dependencies installed
- Kamino program ID + reserve addresses are real mainnet
- EVAA master contract address is real mainnet

## What's Still Mocked / Needs Work

### Backend Market Data (Priority: HIGH)
- All APY/TVL/utilization numbers in `server/api/routes/lending.py` are **hardcoded Python dicts**
- `KAMINO_API` and `EVAA_API` constants are defined but **never called**
- No actual RPC calls or external API fetches happen
- **Fix:** Wire up real API calls to Kamino REST API, EVAA API, and Euler V2 on-chain reads

### Kamino Transaction Instructions (Priority: HIGH)
- The Solana adapter constructs deposit/withdraw/borrow/repay instructions with **simplified opcodes**
- Real Kamino Lending uses a more complex instruction layout with ~10+ account keys per instruction
- Current code has 3 keys per instruction — will fail on mainnet
- **Fix:** Integrate the official Kamino Lending SDK (`@kamino-finance/klend-sdk`) for proper instruction building

### EVAA Transaction Payloads (Priority: HIGH)
- The TON adapter builds BOC cell payloads with **guessed op codes** (0x01-0x04)
- Real EVAA uses specific TL-B message schemas that don't match this format
- The fallback hex encoding is not a valid BOC
- **Fix:** Use EVAA's official SDK or reference their TL-B schema docs for correct message construction

### Euler V2 Ethereum Mainnet (Priority: MEDIUM)
- All vault addresses for Ethereum mainnet are set to `null` in `lending-adapters.js`
- Deployment script exists (`DeployMainnet.s.sol`) but hasn't been executed
- **Fix:** Run the deployment script, then update vault addresses in the adapter config

### Euler V2 ABI (Priority: LOW)
- The eVault ABI in `lending-adapters.js` is simplified — missing some functions like `interestAccrual()`
- Basic supply/withdraw/borrow/repay will work, but full rate reads need the complete ABI
- **Fix:** Pull the full eVault ABI from Euler V2 docs

---

## Action Items

### Mads (Contracts / EVM)
1. Review and run `contracts/script/DeployMainnet.s.sol` when ready for mainnet
2. Update `frontend/lending-adapters.js` `EULER_ADDRESSES[ethereum]` with deployed vault addresses
3. Verify the eVault ABI in `lending-adapters.js` matches real Euler V2 eVault interface

### Maroua (Frontend / Agent / Demo)
1. The lending page (`09-lending-borrowing.html`) now loads `lending-adapters.js` — verify chain switching works in the demo flow
2. The lending agent logs now show which protocol/chain it's operating on — good for demo visibility
3. Cross-chain yield comparison shows up in Yield mode logs — highlight this in the demo

### Both / Next Sprint
1. Replace hardcoded backend market data with real API calls (biggest gap)
2. Integrate Kamino SDK for real Solana transactions
3. Integrate EVAA SDK for real TON transactions
4. End-to-end test: supply USDC on Ink Sepolia, switch to Solana, verify positions show on both

---

## Architecture Summary

```
User clicks chain in nav
       |
       v
AppKit Network Selector (4 chains)
       |
       v
nav.js subscribeCaipNetworkChange
       |
       ├── Updates badge text
       ├── Sets registry.activeChain
       └── Hot-swaps lending agent
              |
              v
LendingAgent.tick()
       |
       v
registry.active() → ILendingAdapter
       |
       ├── EulerV2Adapter (Ink Sepolia / Ethereum)
       ├── KaminoAdapter (Solana)
       └── EvaaAdapter (TON)
              |
              v
adapter.getMarkets() / supply() / borrow() / etc.
       |
       v
Chain-specific RPC / SDK calls
```

The adapter pattern means adding a new chain is just writing one new class that implements `ILendingAdapter`. Everything else (agent logic, UI, backend routing) works automatically.
