/**
 * xLever Contract Adapter
 * viem-based interface for xLever Vault + ERC-20 interactions
 *
 * NOTE: Contract addresses below are hardcoded for testnet development.
 * In production, addresses MUST be loaded from environment variables or
 * a configuration service to support multi-environment deployments and
 * prevent accidental use of test addresses on mainnet.
 */
import { createPublicClient, createWalletClient, http, custom, parseUnits, formatUnits, encodeFunctionData, parseEther } from 'viem'
import { getPriceForFeed } from './pyth.js'
import { PYTH_FEEDS, ASSET_FEED_MAP } from './assets.js'
import { CONTRACT_ADDRESSES, VAULT_REGISTRY_CONFIG, CHAIN_VAULT_REGISTRIES, RPC_URLS, CHAIN_ID } from './config.js'

// ═══════════════════════════════════════════════════════════════
// CHAIN CONFIG
// ═══════════════════════════════════════════════════════════════

export const inkSepolia = {
  id: 763373,
  name: 'Ink Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URLS[763373]] },
  },
  blockExplorers: {
    default: { name: 'Ink Explorer', url: 'https://explorer-sepolia.inkonchain.com' },
  },
}

export const ethSepolia = {
  id: 11155111,
  name: 'Ethereum Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URLS[11155111]] },
  },
  blockExplorers: {
    default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' },
  },
}

// ═══════════════════════════════════════════════════════════════
// MULTI-CHAIN VAULT REGISTRIES
// ═══════════════════════════════════════════════════════════════

export const CHAIN_CONFIGS = {
  // Ink Sepolia (763373) — primary chain
  763373: {
    chain: inkSepolia,
    vaults: null, // populated below from VAULT_REGISTRY (default)
  },
  // Ethereum Sepolia (11155111) — cloned vault registry from Ink Sepolia
  11155111: {
    chain: ethSepolia,
    vaults: CHAIN_VAULT_REGISTRIES[11155111] || {},
  },
}

let activeChainId = 763373 // default to Ink Sepolia

/**
 * Switch the active chain and re-create viem clients for the new chain.
 * Also re-resolves the vault address for the current active asset on the new chain.
 *
 * @param {number} chainId — EVM chain ID (e.g., 763373 for Ink Sepolia, 11155111 for Eth Sepolia)
 * @throws {Error} If the chainId is not in CHAIN_CONFIGS
 */
export function switchChain(chainId) {
  const config = CHAIN_CONFIGS[chainId]
  if (!config) throw new Error(`Unsupported chain: ${chainId}`)
  activeChainId = chainId
  // Re-create clients for new chain
  publicClient = createPublicClient({ chain: config.chain, transport: http() })
  if (window.ethereum) {
    walletClient = createWalletClient({ chain: config.chain, transport: custom(window.ethereum) })
  }
  // Re-resolve vault for active asset
  setActiveAsset(activeAsset)
}

/** @returns {number} The currently active EVM chain ID */
export function getActiveChainId() { return activeChainId }

/** @returns {Object} The CHAIN_CONFIGS entry for the active chain (includes chain def and vault map) */
export function getActiveChainConfig() { return CHAIN_CONFIGS[activeChainId] }

// ═══════════════════════════════════════════════════════════════
// CONTRACT ADDRESSES (filled after deployment)
// ═══════════════════════════════════════════════════════════════

export const ADDRESSES = {
  ...CONTRACT_ADDRESSES,
  vault: CONTRACT_ADDRESSES.qqqVault || '0xDEC80165b7F26e0EEA3c4fCF9a2B8E3D25a4f792',  // Active vault (switches with asset)
}

// ═══════════════════════════════════════════════════════════════
// VAULT REGISTRY — sourced from config.js (env-overridable)
// To override in production, inject window.__XLEVER_CONFIG__.vaultRegistry
// ═══════════════════════════════════════════════════════════════

export const VAULT_REGISTRY = VAULT_REGISTRY_CONFIG

// Backfill: Ink Sepolia uses VAULT_REGISTRY as its vault map
CHAIN_CONFIGS[763373].vaults = CHAIN_VAULT_REGISTRIES[763373] || VAULT_REGISTRY

/**
 * Look up the deployed vault address for a given asset symbol on the active chain.
 * Falls back to the default VAULT_REGISTRY if the active chain has no vault map.
 *
 * @param {string} symbol — Bare ticker symbol (e.g., 'QQQ', 'SPY')
 * @returns {string|null} Vault contract address, or null if no vault is deployed for this asset
 */
export function getVaultForAsset(symbol) {
  const config = CHAIN_CONFIGS[activeChainId]
  const vaults = config?.vaults || VAULT_REGISTRY
  return vaults[symbol] || null
}

/**
 * Check whether a vault has been deployed for the given asset on the active chain.
 *
 * @param {string} symbol — Bare ticker symbol (e.g., 'QQQ')
 * @returns {boolean} True if a vault address exists for this symbol
 */
export function isVaultDeployed(symbol) {
  return !!getVaultForAsset(symbol)
}

/**
 * Override a contract address at runtime. Used for dynamic configuration
 * when deploying new contracts or switching environments.
 *
 * @param {string} key — Address key in the ADDRESSES object (e.g., 'vault', 'usdc')
 * @param {string} address — New Ethereum address (0x-prefixed, checksummed)
 */
export function setAddress(key, address) {
  ADDRESSES[key] = address
}

// ═══════════════════════════════════════════════════════════════
// ABIs
// ═══════════════════════════════════════════════════════════════

export const ERC20_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
]

export const VAULT_ABI = [
  // Write functions (Pyth pull-oracle: all accept priceUpdateData + msg.value for fee)
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'leverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'positionValue', type: 'uint256' }], stateMutability: 'payable' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'minReceived', type: 'uint256' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'received', type: 'uint256' }], stateMutability: 'payable' },
  { type: 'function', name: 'adjustLeverage', inputs: [{ name: 'newLeverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'depositJunior', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'withdrawJunior', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'amount', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'updateOracle', inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }], outputs: [], stateMutability: 'payable' },

  // Read functions
  { type: 'function', name: 'getPosition', inputs: [{ name: 'user', type: 'address' }], outputs: [{
    name: '', type: 'tuple', components: [
      { name: 'depositAmount', type: 'uint128' },
      { name: 'leverageBps', type: 'int32' },
      { name: 'entryTWAP', type: 'uint128' },
      { name: 'lastFeeTimestamp', type: 'uint64' },
      { name: 'settledFees', type: 'uint128' },
      { name: 'leverageLockExpiry', type: 'uint32' },
      { name: 'isActive', type: 'bool' },
    ]
  }], stateMutability: 'view' },
  { type: 'function', name: 'getPositionValue', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: 'value', type: 'uint256' }, { name: 'pnl', type: 'int256' }], stateMutability: 'view' },
  { type: 'function', name: 'getPoolState', inputs: [], outputs: [{
    name: '', type: 'tuple', components: [
      { name: 'totalSeniorDeposits', type: 'uint128' },
      { name: 'totalJuniorDeposits', type: 'uint128' },
      { name: 'insuranceFund', type: 'uint128' },
      { name: 'netExposure', type: 'int256' },
      { name: 'grossLongExposure', type: 'uint128' },
      { name: 'grossShortExposure', type: 'uint128' },
      { name: 'lastRebalanceTime', type: 'uint64' },
      { name: 'currentMaxLeverageBps', type: 'uint32' },
      { name: 'fundingRateBps', type: 'int64' },
      { name: 'protocolState', type: 'uint8' },
    ]
  }], stateMutability: 'view' },
  { type: 'function', name: 'getCurrentTWAP', inputs: [], outputs: [{ name: 'twap', type: 'uint128' }, { name: 'spreadBps', type: 'uint16' }], stateMutability: 'view' },
  { type: 'function', name: 'getMaxLeverage', inputs: [], outputs: [{ name: 'maxLeverageBps', type: 'int32' }], stateMutability: 'view' },
  { type: 'function', name: 'getFundingRate', inputs: [], outputs: [{ name: 'rateBps', type: 'int256' }], stateMutability: 'view' },
  { type: 'function', name: 'getCarryRate', inputs: [], outputs: [{ name: 'annualBps', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getFeeConfig', inputs: [], outputs: [{
    name: '', type: 'tuple', components: [
      { name: 'baseEntryFeeBps', type: 'uint16' },
      { name: 'baseExitFeeBps', type: 'uint16' },
      { name: 'protocolSpreadBps', type: 'uint16' },
      { name: 'maxFundingRateBps', type: 'uint16' },
      { name: 'fundingInterval', type: 'uint32' },
      { name: 'juniorFeeSplit', type: 'uint16' },
      { name: 'insuranceFeeSplit', type: 'uint16' },
      { name: 'treasuryFeeSplit', type: 'uint16' },
    ]
  }], stateMutability: 'view' },
  { type: 'function', name: 'getJuniorValue', inputs: [], outputs: [{ name: 'totalValue', type: 'uint256' }, { name: 'sharePrice', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getOracleState', inputs: [], outputs: [{
    name: '', type: 'tuple', components: [
      { name: 'executionPrice', type: 'uint128' },
      { name: 'displayPrice', type: 'uint128' },
      { name: 'riskPrice', type: 'uint128' },
      { name: 'divergenceBps', type: 'uint256' },
      { name: 'spreadBps', type: 'uint16' },
      { name: 'isFresh', type: 'bool' },
      { name: 'isCircuitBroken', type: 'bool' },
      { name: 'lastUpdateTime', type: 'uint64' },
      { name: 'updateCount', type: 'uint8' },
    ]
  }], stateMutability: 'view' },

  { type: 'function', name: 'getRiskState', inputs: [], outputs: [{ name: 'protocolState', type: 'uint8' }, { name: 'healthScore', type: 'uint256' }, { name: 'juniorRatioBps', type: 'uint256' }, { name: 'currentMaxLeverageBps', type: 'uint32' }, { name: 'oracleStale', type: 'bool' }, { name: 'circuitBroken', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'juniorTranche', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },

  // Events
  { type: 'event', name: 'Deposit', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'leverage', type: 'int32' }, { name: 'isSenior', type: 'bool' }] },
  { type: 'event', name: 'Withdraw', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'pnl', type: 'uint256' }] },
  { type: 'event', name: 'LeverageAdjusted', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'oldLeverage', type: 'int32' }, { name: 'newLeverage', type: 'int32' }] },
  { type: 'event', name: 'OracleUpdate', inputs: [{ name: 'executionPrice', type: 'uint128' }, { name: 'displayPrice', type: 'uint128' }, { name: 'divergenceBps', type: 'uint256' }, { name: 'isFresh', type: 'bool' }, { name: 'isCircuitBroken', type: 'bool' }] },
]

export const PYTH_ADAPTER_ABI = [
  { type: 'function', name: 'getUpdateFee', inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'fee', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'readPrice', inputs: [{ name: 'feedId', type: 'bytes32' }, { name: 'maxAgeSec', type: 'uint256' }], outputs: [{ name: 'price', type: 'int64' }, { name: 'conf', type: 'uint64' }, { name: 'publishTime', type: 'uint64' }], stateMutability: 'view' },
  { type: 'function', name: 'isStale', inputs: [{ name: 'feedId', type: 'bytes32' }, { name: 'maxAgeSec', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
]

export const JUNIOR_TRANCHE_ABI = [
  { type: 'function', name: 'getShares', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getUserValue', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getSharePrice', inputs: [], outputs: [{ name: 'price', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getTotalValue', inputs: [], outputs: [{ name: 'value', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalShares', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
]

// Re-export so existing consumers keep working
export { ASSET_FEED_MAP }

let activeAsset = 'QQQ'

/**
 * Set the active asset for all vault operations. Updates ADDRESSES.vault
 * to point to the correct vault contract for the selected symbol.
 *
 * @param {string} symbol — Bare ticker symbol (e.g., 'QQQ', 'SPY')
 */
export function setActiveAsset(symbol) {
  activeAsset = symbol
  // Switch vault address to match the selected asset
  const vaultAddr = getVaultForAsset(symbol)
  if (vaultAddr) {
    ADDRESSES.vault = vaultAddr
  } else {
    // No vault deployed — null out so write functions throw early
    ADDRESSES.vault = null
  }
}

/** @returns {string} The currently active asset symbol (e.g., 'QQQ') */
export function getActiveAsset() {
  return activeAsset
}

/**
 * Get the Pyth feed ID for the currently active asset.
 * Falls back to QQQ/USD if the active asset has no registered feed.
 *
 * @returns {string} Hex-encoded Pyth feed ID (0x-prefixed)
 */
export function getActiveFeedId() {
  return ASSET_FEED_MAP[activeAsset] || PYTH_FEEDS['QQQ/USD']
}

// ═══════════════════════════════════════════════════════════════
// CLIENT SETUP
// ═══════════════════════════════════════════════════════════════

let publicClient = null
let walletClient = null

/**
 * Get or create the viem public client for read-only RPC calls.
 * Lazily initializes on first call using the active chain's RPC URL.
 *
 * @returns {import('viem').PublicClient} viem public client instance
 */
export function getPublicClient() {
  if (!publicClient) {
    const config = CHAIN_CONFIGS[activeChainId]
    publicClient = createPublicClient({ chain: config?.chain || inkSepolia, transport: http() })
  }
  return publicClient
}

/**
 * Get or create the viem wallet client for write transactions.
 * Requires window.ethereum (MetaMask/injected provider). Returns null if unavailable.
 *
 * @returns {import('viem').WalletClient|null} viem wallet client, or null if no provider
 */
export function getWalletClient() {
  if (!walletClient && window.ethereum) {
    const config = CHAIN_CONFIGS[activeChainId]
    walletClient = createWalletClient({ chain: config?.chain || inkSepolia, transport: custom(window.ethereum) })
  }
  return walletClient
}

/**
 * Get the first connected wallet address from the wallet client.
 *
 * @returns {Promise<string>} Checksummed Ethereum address
 * @throws {Error} If no wallet is connected or no account is found
 */
async function getAccount() {
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')
  const [account] = await wc.getAddresses()
  if (!account) throw new Error('No account found')
  return account
}

// ═══════════════════════════════════════════════════════════════
// ERC-20 READS
// ═══════════════════════════════════════════════════════════════

/**
 * Read the ERC-20 token balance for a user, returning both raw and formatted values.
 *
 * @param {string} tokenAddress — ERC-20 token contract address
 * @param {string} userAddress — Wallet address to query
 * @returns {Promise<{raw: bigint, formatted: string, decimals: number}>} Balance data
 */
export async function getBalance(tokenAddress, userAddress) {
  try {
    const pc = getPublicClient()
    const balance = await pc.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [userAddress] })
    const decimals = await pc.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' })
    return { raw: balance, formatted: formatUnits(balance, decimals), decimals }
  } catch (err) {
    console.error('getBalance failed:', err.message)
    return { raw: 0n, formatted: '0', decimals: 18 }
  }
}

/**
 * Read the ERC-20 allowance granted by an owner to a spender.
 *
 * @param {string} tokenAddress — ERC-20 token contract address
 * @param {string} ownerAddress — Token holder's address
 * @param {string} spenderAddress — Address authorized to spend tokens (typically the vault)
 * @returns {Promise<bigint>} Remaining allowance in token base units
 */
export async function getAllowance(tokenAddress, ownerAddress, spenderAddress) {
  return getPublicClient().readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'allowance', args: [ownerAddress, spenderAddress] })
}

// ═══════════════════════════════════════════════════════════════
// ERC-20 WRITES
// ═══════════════════════════════════════════════════════════════

/**
 * Approve a spender (typically the vault) to transfer tokens on behalf of the user.
 * Uses max uint256 (infinite approval) to avoid repeated approval popups.
 *
 * @param {string} tokenAddress — ERC-20 token to approve
 * @param {string} spenderAddress — Address receiving the approval (typically vault)
 * @param {string} _amount — Unused (infinite approval is always granted)
 * @returns {Promise<{hash: string, receipt: Object, explorerUrl: string}>} Transaction result
 */
export async function approveToken(tokenAddress, spenderAddress, _amount) {
  const account = await getAccount()
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')
  // Infinite approval avoids repeated approve popups on subsequent deposits
  const maxUint256 = 2n ** 256n - 1n
  const hash = await wc.writeContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: 'approve',
    args: [spenderAddress, maxUint256], account, chain: getActiveChainConfig().chain,
  })
  return waitForTx(hash)
}

// ═══════════════════════════════════════════════════════════════
// VAULT READS
// ═══════════════════════════════════════════════════════════════

/**
 * Read a user's leveraged position from the active vault contract.
 *
 * @param {string} userAddress — Wallet address to query
 * @returns {Promise<Object|null>} Raw position tuple (depositAmount, leverageBps, entryTWAP, etc.), or null if no vault
 */
export async function getPosition(userAddress) {
  if (!ADDRESSES.vault) return null
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getPosition', args: [userAddress] })
}

/**
 * Read the current USD value and unrealized P&L for a user's position.
 *
 * @param {string} userAddress — Wallet address to query
 * @returns {Promise<{value: bigint, pnl: bigint}>} Position value and P&L in USDC base units (6 decimals)
 */
export async function getPositionValue(userAddress) {
  if (!ADDRESSES.vault) return { value: 0n, pnl: 0n }
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getPositionValue', args: [userAddress] })
}

/**
 * Read the vault's pool-level state (TVL, exposure, utilization, protocol state).
 * Not user-specific — returns aggregate vault metrics.
 *
 * @returns {Promise<Object|null>} Raw pool state tuple, or null if no vault
 */
export async function getPoolState() {
  if (!ADDRESSES.vault) return null
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getPoolState' })
}

/**
 * Read the current time-weighted average price (TWAP) and spread from the vault.
 *
 * @returns {Promise<{twap: bigint, spreadBps: number}>} TWAP in 8-decimal fixed-point, spread in basis points
 */
export async function getTWAP() {
  if (!ADDRESSES.vault) return { twap: 0n, spreadBps: 0 }
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getCurrentTWAP' })
}

/**
 * Read full on-chain oracle state with separated price roles.
 * Returns: { executionPrice, displayPrice, riskPrice, divergenceBps, spreadBps,
 *            isFresh, isCircuitBroken, lastUpdateTime, updateCount }
 */
export async function getOnChainOracleState() {
  if (!ADDRESSES.vault) return null
  try {
    const raw = await getPublicClient().readContract({
      address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getOracleState',
    })
    return {
      executionPrice: Number(raw.executionPrice) / 1e8,
      displayPrice: Number(raw.displayPrice) / 1e8,
      riskPrice: Number(raw.riskPrice) / 1e8,
      divergenceBps: Number(raw.divergenceBps),
      spreadBps: Number(raw.spreadBps),
      isFresh: raw.isFresh,
      isCircuitBroken: raw.isCircuitBroken,
      lastUpdateTime: Number(raw.lastUpdateTime),
      updateCount: Number(raw.updateCount),
    }
  } catch {
    return null
  }
}

/**
 * Read the current maximum allowed leverage from the vault.
 * Returns raw basis points (e.g., 40000 = 4.0x).
 *
 * @returns {Promise<number>} Max leverage in basis points (divide by 10000 for multiplier)
 */
export async function getMaxLeverage() {
  if (!ADDRESSES.vault) return 40000
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getMaxLeverage' })
}

/**
 * Read the current funding rate from the vault.
 *
 * @returns {Promise<bigint>} Funding rate in basis points (positive = longs pay, negative = shorts pay)
 */
export async function getFundingRate() {
  if (!ADDRESSES.vault) return 0n
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getFundingRate' })
}

/**
 * Read the junior tranche's total value and share price from the vault.
 *
 * @returns {Promise<{totalValue: bigint, sharePrice: bigint}>} Values in USDC base units (6 decimals)
 */
export async function getJuniorValue() {
  if (!ADDRESSES.vault) return { totalValue: 0n, sharePrice: 0n }
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getJuniorValue' })
}

/**
 * Read the fee configuration from the vault's FeeEngine contract.
 * Returns entry/exit fee rates, fee splits, and funding parameters.
 *
 * @returns {Promise<Object>} Fee config with fields in basis points
 */
export async function readFeeConfig() {
  if (!ADDRESSES.vault) return null
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getFeeConfig' })
}

// ═══════════════════════════════════════════════════════════════
// VAULT WRITES
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch Pyth price update + compute the ETH fee to send with the tx.
 * @returns {{ updateData: string[], fee: bigint }}
 */
async function fetchPythUpdate() {
  const feedId = getActiveFeedId()
  let updateData
  try {
    const result = await getPriceForFeed(feedId)
    updateData = result.updateData
  } catch (err) {
    console.error('Pyth price fetch failed:', err.message)
    throw new Error('Failed to fetch oracle price update. Please try again.')
  }

  let fee = parseUnits('0.001', 18) // safe default
  if (ADDRESSES.pythAdapter) {
    try {
      fee = await getPublicClient().readContract({
        address: ADDRESSES.pythAdapter, abi: PYTH_ADAPTER_ABI,
        functionName: 'getUpdateFee', args: [updateData],
      })
      fee = fee + (fee / 10n) // 10% buffer
    } catch { /* fallback to default */ }
  }
  return { updateData, fee }
}

/**
 * Open a new leveraged position in the active vault.
 * Automatically fetches Pyth oracle update, checks USDC allowance, and approves if needed.
 *
 * @param {string} amountUsdc — Deposit amount in USDC (human-readable, e.g., "100")
 * @param {number} leverage — Leverage multiplier (e.g., 2.0 for 2x long, -1.5 for 1.5x short)
 * @returns {Promise<{hash: string, receipt: Object, explorerUrl: string}>} Transaction result
 * @throws {Error} If vault not deployed, USDC not set, or wallet not connected
 */
export async function openPosition(amountUsdc, leverage) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  if (!ADDRESSES.usdc) throw new Error('USDC address not set')

  const account = await getAccount()
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')
  const amount = parseUnits(amountUsdc, 6)
  const leverageBps = Math.round(leverage * 10000)
  const { updateData, fee } = await fetchPythUpdate()

  const allowance = await getAllowance(ADDRESSES.usdc, account, ADDRESSES.vault)
  if (allowance < amount) {
    await approveToken(ADDRESSES.usdc, ADDRESSES.vault, amount)
  }

  const hash = await wc.writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'deposit',
    args: [amount, leverageBps, updateData], value: fee, account, chain: getActiveChainConfig().chain,
  })
  return waitForTx(hash)
}

/**
 * Close (withdraw from) a leveraged position in the active vault.
 * Fetches a Pyth oracle update and applies slippage tolerance.
 *
 * @param {string} amountUsdc — Amount to withdraw in USDC (human-readable)
 * @param {number} [slippageBps=50] — Maximum slippage tolerance in basis points (default 0.5%)
 * @returns {Promise<{hash: string, receipt: Object, explorerUrl: string}>} Transaction result
 * @throws {Error} If vault not deployed or wallet not connected
 */
export async function closePosition(amountUsdc, slippageBps = 50) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')
  const amount = parseUnits(amountUsdc, 6)
  // minReceived = amount * (1 - slippage%), default 0.5% slippage tolerance
  const minReceived = amount - (amount * BigInt(slippageBps) / 10000n)
  const { updateData, fee } = await fetchPythUpdate()

  const hash = await wc.writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'withdraw',
    args: [amount, minReceived, updateData], value: fee, account, chain: getActiveChainConfig().chain,
  })
  return waitForTx(hash)
}

/**
 * Adjust leverage on an existing position without depositing or withdrawing.
 * Fetches a Pyth oracle update for accurate price execution.
 *
 * @param {number} newLeverage — Target leverage multiplier (e.g., 3.0 for 3x)
 * @returns {Promise<{hash: string, receipt: Object, explorerUrl: string}>} Transaction result
 * @throws {Error} If vault not deployed or wallet not connected
 */
export async function adjustLeverage(newLeverage) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')
  const leverageBps = Math.round(newLeverage * 10000)
  const { updateData, fee } = await fetchPythUpdate()

  const hash = await wc.writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'adjustLeverage',
    args: [leverageBps, updateData], value: fee, account, chain: getActiveChainConfig().chain,
  })
  return waitForTx(hash)
}

/**
 * Deposit USDC into the junior (first-loss) tranche of the active vault.
 * Junior depositors earn yield from protocol fees in exchange for absorbing losses first.
 *
 * @param {string} amountUsdc — Deposit amount in USDC (human-readable, e.g., "500")
 * @returns {Promise<{hash: string, receipt: Object, explorerUrl: string}>} Transaction result
 * @throws {Error} If vault not deployed, USDC not set, or wallet not connected
 */
export async function depositJunior(amountUsdc) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  if (!ADDRESSES.usdc) throw new Error('USDC address not set')
  const account = await getAccount()
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')
  const amount = parseUnits(amountUsdc, 6)

  const allowance = await getAllowance(ADDRESSES.usdc, account, ADDRESSES.vault)
  if (allowance < amount) {
    await approveToken(ADDRESSES.usdc, ADDRESSES.vault, amount)
  }

  const hash = await wc.writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'depositJunior',
    args: [amount], account, chain: getActiveChainConfig().chain,
  })
  return waitForTx(hash)
}

/**
 * Withdraw from the junior tranche by redeeming shares.
 *
 * @param {string} shares — Number of junior shares to redeem (human-readable)
 * @returns {Promise<{hash: string, receipt: Object, explorerUrl: string}>} Transaction result
 * @throws {Error} If vault not deployed or wallet not connected
 */
export async function withdrawJunior(shares) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')
  const amount = parseUnits(shares, 6)

  const hash = await wc.writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'withdrawJunior',
    args: [amount], account, chain: getActiveChainConfig().chain,
  })
  return waitForTx(hash)
}

// ═══════════════════════════════════════════════════════════════
// ORACLE HEALTH
// ═══════════════════════════════════════════════════════════════

/**
 * Comprehensive oracle health check for the active asset's Pyth feed.
 * Combines off-chain Hermes data with on-chain staleness check from the Pyth adapter.
 *
 * @returns {Promise<{price: number, conf: number, age: number, publishTime: number,
 *   isStale: boolean, freshness: string, feedId: string, symbol: string,
 *   onChainStale: boolean|null, confPercent: string}>} Oracle health snapshot
 */
export async function getOracleHealth() {
  const feedId = getActiveFeedId()
  const { price, conf, publishTime, symbol } = await getPriceForFeed(feedId)
  const age = Math.floor(Date.now() / 1000) - publishTime
  const isStale = age > 300
  const freshness = age < 60 ? 'fresh' : age < 300 ? 'ok' : 'stale'

  let onChainStale = null
  if (ADDRESSES.pythAdapter) {
    try {
      onChainStale = await getPublicClient().readContract({
        address: ADDRESSES.pythAdapter, abi: PYTH_ADAPTER_ABI,
        functionName: 'isStale', args: [feedId, 300n],
      })
    } catch { /* adapter may not be reachable */ }
  }

  return {
    price, conf, age, publishTime, isStale, freshness, feedId, symbol, onChainStale,
    confPercent: price > 0 ? ((conf / price) * 100).toFixed(4) : '0',
  }
}

/**
 * Read a Pyth price directly from the on-chain Pyth adapter contract.
 * Unlike getOracleHealth() which uses the off-chain Hermes API, this reads
 * the price that the vault contract would actually use for execution.
 *
 * @param {string} [feedId] — Pyth feed ID (defaults to active asset's feed)
 * @param {number} [maxAgeSec=300] — Maximum acceptable staleness in seconds
 * @returns {Promise<{price: number, conf: number, publishTime: number}>} On-chain price data (8 decimal precision)
 * @throws {Error} If Pyth adapter is not deployed
 */
export async function readOnChainPrice(feedId, maxAgeSec = 300) {
  if (!ADDRESSES.pythAdapter) throw new Error('Pyth adapter not deployed')
  const result = await getPublicClient().readContract({
    address: ADDRESSES.pythAdapter, abi: PYTH_ADAPTER_ABI,
    functionName: 'readPrice', args: [feedId || getActiveFeedId(), BigInt(maxAgeSec)],
  })
  return { price: Number(result[0]) / 1e8, conf: Number(result[1]) / 1e8, publishTime: Number(result[2]) }
}

// ═══════════════════════════════════════════════════════════════
// TRANSACTION LIFECYCLE STATES
// ═══════════════════════════════════════════════════════════════

/**
 * Every transaction goes through these states in order:
 *   submitted → pending → confirmed | failed | rejected
 *
 * `submitted`  – hash returned by wallet, tx is in mempool
 * `pending`    – receipt polling in progress (with retry count)
 * `confirmed`  – receipt received, status === 'success'
 * `failed`     – receipt received but status === 'reverted', or RPC error after retries
 * `rejected`   – user rejected in wallet (never reaches chain)
 */
export const TX_STATES = Object.freeze({
  SUBMITTED: 'submitted',
  PENDING:   'pending',
  CONFIRMED: 'confirmed',
  FAILED:    'failed',
  REJECTED:  'rejected',
  SYNCED:    'synced',     // UI state refreshed from confirmed chain reads
})

// ═══════════════════════════════════════════════════════════════
// TRANSACTION EVENT SYSTEM
// ═══════════════════════════════════════════════════════════════

// Lightweight event emitter for transaction lifecycle.
// Consumers subscribe via txEvents.on('confirmed', fn) to reload
// balances/positions from confirmed chain state instead of polling.
const txEvents = (() => {
  const listeners = {}
  return {
    on(event, fn) {
      (listeners[event] ||= []).push(fn)
      return () => { listeners[event] = listeners[event].filter(f => f !== fn) }
    },
    emit(event, data) {
      (listeners[event] || []).forEach(fn => { try { fn(data) } catch (e) { console.error('[txEvents]', e) } })
    },
  }
})()

export { txEvents }

// ═══════════════════════════════════════════════════════════════
// ERROR CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

// Classifies raw errors into user-facing categories so the UI can
// show distinct states for each failure mode.
/**
 * Classify a raw transaction error into a user-facing category.
 * Parses error messages to distinguish wallet rejections, RPC failures,
 * on-chain reverts, and unknown errors so the UI can show appropriate feedback.
 *
 * @param {Error} err — Raw error from viem or wallet provider
 * @returns {{type: string, label: string, detail: string, icon: string, color: string}} Classified error with UI metadata
 */
export function classifyTxError(err) {
  const msg = (err?.shortMessage || err?.message || '').toLowerCase()

  // Wallet rejected (user clicked "Reject" in MetaMask / WalletConnect)
  if (msg.includes('user rejected') || msg.includes('user denied') || msg.includes('rejected the request')) {
    return { type: 'wallet_rejected', label: 'Transaction Rejected', detail: 'You rejected the transaction in your wallet.', icon: 'block', color: '#ffd740' }
  }
  // RPC / network failure
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('econnreset') ||
      msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout') || err?.code === 'TIMEOUT') {
    return { type: 'rpc_failed', label: 'Network Error', detail: 'RPC request failed. Check your connection and try again.', icon: 'cloud_off', color: '#ff9100' }
  }
  // On-chain revert (receipt.status === 'reverted' or simulation revert)
  if (msg.includes('reverted') || msg.includes('execution reverted') || err?._txReverted) {
    return { type: 'tx_reverted', label: 'Transaction Reverted', detail: err?.shortMessage || 'The transaction was mined but reverted on-chain.', icon: 'cancel', color: '#ff5252' }
  }
  // Fallback: unknown error
  return { type: 'unknown', label: 'Transaction Failed', detail: err?.shortMessage || err?.message || 'Unknown error', icon: 'error', color: '#ff5252' }
}

// ═══════════════════════════════════════════════════════════════
// TX HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Wait for a transaction receipt with exponential backoff retry.
 * Emits lifecycle events: submitted → pending → confirmed | failed
 * Callers should emit 'synced' after refreshing UI from confirmed chain state.
 *
 * Retry strategy: up to 5 attempts with 2/4/8/16/32s backoff.
 * This survives transient RPC hiccups during a live demo.
 */
async function waitForTx(hash) {
  const explorerUrl = getExplorerUrl(hash)
  // submitted — hash is in the mempool
  txEvents.emit('submitted', { hash, explorerUrl, state: TX_STATES.SUBMITTED })

  const MAX_RETRIES = 5
  let receipt = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // pending — polling in progress
    txEvents.emit('pending', { hash, explorerUrl, state: TX_STATES.PENDING, attempt, maxRetries: MAX_RETRIES })

    try {
      receipt = await getPublicClient().waitForTransactionReceipt({
        hash,
        timeout: 30_000,        // 30s per attempt (viem default is 60s)
        pollingInterval: 2_000, // check every 2s
      })
      break // got a receipt
    } catch (pollErr) {
      console.warn(`[waitForTx] attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, pollErr.message)
      if (attempt === MAX_RETRIES) {
        // All retries exhausted — emit failed and throw
        const classified = classifyTxError(pollErr)
        txEvents.emit('failed', { hash, explorerUrl, state: TX_STATES.FAILED, error: classified })
        pollErr.shortMessage = pollErr.shortMessage || `Receipt polling failed after ${MAX_RETRIES + 1} attempts. Check the explorer for status.`
        throw pollErr
      }
      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)))
    }
  }

  // Check receipt status — 'reverted' means the tx was mined but failed on-chain
  if (receipt.status === 'reverted') {
    const err = new Error(`Transaction reverted (tx: ${hash})`)
    err._txReverted = true
    err.shortMessage = 'Transaction was mined but reverted on-chain.'
    txEvents.emit('failed', { hash, explorerUrl, receipt, state: TX_STATES.FAILED, error: classifyTxError(err) })
    throw err
  }

  // confirmed — receipt received, tx succeeded
  txEvents.emit('confirmed', { hash, explorerUrl, receipt, state: TX_STATES.CONFIRMED })
  return { hash, receipt, explorerUrl }
}

/**
 * Build a block explorer URL for a transaction hash on the active chain.
 *
 * @param {string} hash — Transaction hash (0x-prefixed)
 * @returns {string} Full explorer URL (e.g., "https://explorer-sepolia.inkonchain.com/tx/0x...")
 */
export function getExplorerUrl(hash) {
  const config = getActiveChainConfig()
  const explorer = config?.chain?.blockExplorers?.default?.url || inkSepolia.blockExplorers.default.url
  return `${explorer}/tx/${hash}`
}

/**
 * Build a block explorer URL for a contract or wallet address on the active chain.
 *
 * @param {string} address — Ethereum address (0x-prefixed)
 * @returns {string} Full explorer URL
 */
export function getAddressExplorerUrl(address) {
  const config = getActiveChainConfig()
  const explorer = config?.chain?.blockExplorers?.default?.url || inkSepolia.blockExplorers.default.url
  return `${explorer}/address/${address}`
}

// ═══════════════════════════════════════════════════════════════
// POSITION FORMATTING HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Format a raw on-chain position tuple into human-readable fields.
 * Converts basis points to multipliers, raw amounts to formatted strings.
 *
 * @param {Object} pos — Raw position from getPosition() (depositAmount, leverageBps, entryTWAP, etc.)
 * @returns {{deposit: string, leverage: number, leverageDisplay: string, isLong: boolean,
 *   isShort: boolean, entryPrice: string, fees: string, isActive: boolean}|null} Formatted position, or null if inactive
 */
export function formatPosition(pos) {
  if (!pos || !pos.isActive) return null
  const leverageFloat = Number(pos.leverageBps) / 10000
  return {
    deposit: formatUnits(pos.depositAmount, 6),
    leverage: leverageFloat,
    leverageDisplay: (leverageFloat > 0 ? '+' : '') + leverageFloat.toFixed(1) + 'x',
    isLong: leverageFloat > 0,
    isShort: leverageFloat < 0,
    entryPrice: formatUnits(pos.entryTWAP, 8),
    fees: formatUnits(pos.settledFees, 6),
    isActive: pos.isActive,
  }
}

/**
 * Format a raw on-chain pool state tuple into human-readable fields.
 * Converts raw BigInt amounts to formatted USD strings and computes derived ratios.
 *
 * @param {Object} pool — Raw pool state from getPoolState()
 * @returns {{seniorTVL: string, juniorTVL: string, insurance: string, netExposure: string,
 *   grossLong: string, grossShort: string, maxLeverage: number, state: string,
 *   juniorRatio: number}|null} Formatted pool state, or null if no pool data
 */
export function formatPoolState(pool) {
  if (!pool) return null
  return {
    seniorTVL: formatUnits(pool.totalSeniorDeposits, 6),
    juniorTVL: formatUnits(pool.totalJuniorDeposits, 6),
    insurance: formatUnits(pool.insuranceFund, 6),
    netExposure: formatUnits(pool.netExposure, 6),
    grossLong: formatUnits(pool.grossLongExposure, 6),
    grossShort: formatUnits(pool.grossShortExposure, 6),
    maxLeverage: Number(pool.currentMaxLeverageBps) / 10000,
    state: ['Active', 'Stressed', 'Paused', 'Emergency'][pool.protocolState] || 'Unknown',
    juniorRatio: Number(pool.totalJuniorDeposits) / (Number(pool.totalSeniorDeposits) + Number(pool.totalJuniorDeposits) || 1),
  }
}

// ═══════════════════════════════════════════════════════════════
// PRE-DEMO HEALTH CHECK (PREFLIGHT)
// ═══════════════════════════════════════════════════════════════

/**
 * Runs a comprehensive preflight check for demo readiness.
 * Returns an array of { key, label, ok, detail } items.
 */
export async function runPreflight() {
  const checks = []

  // 1. Wallet connected
  let account = null
  try {
    account = await getAccount()
    checks.push({ key: 'wallet', label: 'Wallet Connected', ok: true, detail: account.slice(0, 6) + '...' + account.slice(-4) })
  } catch {
    checks.push({ key: 'wallet', label: 'Wallet Connected', ok: false, detail: 'No wallet connected' })
  }

  // 2. Correct chain
  try {
    const chainId = await window.ethereum?.request({ method: 'eth_chainId' })
    const current = parseInt(chainId, 16)
    const expected = getActiveChainId()
    checks.push({ key: 'chain', label: 'Correct Chain', ok: current === expected, detail: current === expected ? getActiveChainConfig().chain.name : `Expected ${expected}, got ${current}` })
  } catch {
    checks.push({ key: 'chain', label: 'Correct Chain', ok: false, detail: 'Cannot read chain ID' })
  }

  // 3. USDC balance
  if (account) {
    try {
      const bal = await getBalance(ADDRESSES.usdc, account)
      const hasBalance = parseFloat(bal.formatted) > 0
      checks.push({ key: 'balance', label: 'USDC Balance', ok: hasBalance, detail: hasBalance ? `${parseFloat(bal.formatted).toFixed(2)} USDC` : '0 USDC' })
    } catch {
      checks.push({ key: 'balance', label: 'USDC Balance', ok: false, detail: 'Failed to read balance' })
    }
  } else {
    checks.push({ key: 'balance', label: 'USDC Balance', ok: false, detail: 'Connect wallet first' })
  }

  // 4. Vault address loaded
  const vaultAddr = ADDRESSES.vault
  checks.push({ key: 'vault', label: 'Vault Address Loaded', ok: !!vaultAddr, detail: vaultAddr ? vaultAddr.slice(0, 10) + '...' : 'No vault set' })

  // 5. RPC reachable
  try {
    const block = await getPublicClient().getBlockNumber()
    checks.push({ key: 'rpc', label: 'RPC Reachable', ok: true, detail: `Block #${block.toLocaleString()}` })
  } catch {
    checks.push({ key: 'rpc', label: 'RPC Reachable', ok: false, detail: 'RPC request failed' })
  }

  return checks
}

// Expose globally for non-module scripts
window.xLeverContracts = {
  ADDRESSES, setAddress, VAULT_REGISTRY, CHAIN_CONFIGS,
  ERC20_ABI, VAULT_ABI, JUNIOR_TRANCHE_ABI, PYTH_ADAPTER_ABI,
  ASSET_FEED_MAP, setActiveAsset, getActiveAsset, getActiveFeedId,
  getVaultForAsset, isVaultDeployed,
  switchChain, getActiveChainId, getActiveChainConfig,
  getBalance, getAllowance, approveToken,
  getPosition, getPositionValue, getPoolState, getTWAP, getMaxLeverage, getFundingRate, getJuniorValue,
  openPosition, closePosition, adjustLeverage, depositJunior, withdrawJunior,
  getOracleHealth, readOnChainPrice, getOnChainOracleState,
  getExplorerUrl, getAddressExplorerUrl,
  formatPosition, formatPoolState,
  getPublicClient, getWalletClient,
  txEvents, classifyTxError, TX_STATES,
  runPreflight,
}
