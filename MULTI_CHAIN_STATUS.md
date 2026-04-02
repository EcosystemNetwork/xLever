# xLever Multi-Chain Deployment Status

**Updated:** 2026-03-31 by Eric

## Live Deployments (Testnet)

### Ink Sepolia (Chain 763373) — 33/33 vaults deployed
All 33 asset vaults are live and wired into the frontend. This is our primary chain.

### Ethereum Sepolia (Chain 11155111) — 33/33 vaults deployed
Full mirror deployment. Frontend supports chain switching via `switchChain(11155111)`.

**Vault addresses for both EVM chains are in:**
- `frontend/contracts.js` → `VAULT_REGISTRY` (Ink) + `CHAIN_CONFIGS[11155111].vaults` (Eth Sepolia)
- `deployment.json` → `smart_contracts.addresses.vaults`

## Ready to Deploy

### Solana (Devnet)
- Full Anchor program at `solana/`
- 12 Rust source files, mirrors the EVM vault logic exactly
- Pyth oracle integration, -3.5x to +3.5x leverage, matching fee model
- **To deploy:**
  ```bash
  cd solana && anchor build && anchor deploy --provider.cluster devnet
  ```
- Needs a Solana keypair with devnet SOL for deployment

### TON (Testnet)
- Tact smart contracts at `ton/`
- 9 files: vault, factory, messages, TS wrappers, deploy scripts
- All 33 Pyth feed IDs baked into the deploy script
- **To deploy:**
  ```bash
  cd ton && npm install && npx tact --config tact.config.json
  npx ts-node scripts/deployFactory.ts
  npx ts-node scripts/deployAllVaults.ts
  ```
- Needs `DEPLOYER_MNEMONIC` and `TON_ENDPOINT` in `.env`

## Mainnet

**Mads has final say on all mainnet deployments.** The deployer wallet (`0x116C28e6DCABCa363f83217C712d79DCE168d90e`) has 0 ETH on mainnet. Same Foundry script works — just swap the RPC URL.

## Frontend Multi-Chain Support

The contract adapter (`frontend/contracts.js`) now supports:
- `switchChain(chainId)` — switches RPC, clients, and vault registry
- `getVaultForAsset(symbol)` — resolves per active chain
- `isVaultDeployed(symbol)` — checks current chain
- `CHAIN_CONFIGS` — extensible registry for adding new chains

When Solana and TON are deployed, their vault addresses need to be integrated into the frontend with chain-specific adapters (non-EVM chains use different wallet/tx patterns).

## Quick Reference — All 33 Assets

QQQ, SPY, VUG, VGK, VXUS, SGOV, SMH, XLE, XOP, ITA, AAPL, NVDA, TSLA, DELL, SMCI, ANET, VRT, SNDK, KLAC, LRCX, AMAT, TER, CEG, GEV, SMR, ETN, PWR, APLD, SLV, PPLT, PALL, STRK, BTGO
