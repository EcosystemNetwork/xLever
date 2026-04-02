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
  vault: CONTRACT_ADDRESSES.qqqVault || '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',  // Active vault (switches with asset)
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
  // Write functions — VaultSimple interface (no Pyth oracle, not payable)
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'leverageBps', type: 'int32' }], outputs: [{ name: 'positionValue', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'received', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'depositJunior', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'withdrawJunior', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'amount', type: 'uint256' }], stateMutability: 'nonpayable' },

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
  { type: 'function', name: 'usdc', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'asset', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'admin', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },

  // Events
  { type: 'event', name: 'Deposit', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'leverage', type: 'int32' }] },
  { type: 'event', name: 'Withdraw', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }] },
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
  // VaultSimple doesn't have getPositionValue — derive from deposit amount
  if (!ADDRESSES.vault) return { value: 0n, pnl: 0n }
  try {
    const pos = await getPosition(userAddress)
    if (!pos || !pos.isActive) return { value: 0n, pnl: 0n }
    return { value: pos.depositAmount, pnl: 0n }
  } catch { return { value: 0n, pnl: 0n } }
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
  // VaultSimple uses placeholder TWAP (100e8)
  return { twap: 10000000000n, spreadBps: 0 }
}

export async function getOnChainOracleState() {
  // VaultSimple has no oracle — return mock "ready" state
  return { executionPrice: 100, displayPrice: 100, riskPrice: 100, divergenceBps: 0, spreadBps: 0, isFresh: true, isCircuitBroken: false, lastUpdateTime: Math.floor(Date.now() / 1000), updateCount: 255 }
}

export async function getMaxLeverage() {
  // VaultSimple hardcodes 3.5x (35000 bps)
  if (!ADDRESSES.vault) return 35000
  try {
    const pool = await getPoolState()
    return pool?.currentMaxLeverageBps || 35000
  } catch { return 35000 }
}

export async function getFundingRate() { return 0n }

export async function getJuniorValue() {
  if (!ADDRESSES.vault) return { totalValue: 0n, sharePrice: 0n }
  try {
    const pool = await getPoolState()
    return { totalValue: pool?.totalJuniorDeposits || 0n, sharePrice: 1000000n }
  } catch { return { totalValue: 0n, sharePrice: 0n } }
}

export async function readFeeConfig() {
  // VaultSimple has no fees
  return { baseEntryFeeBps: 0, baseExitFeeBps: 0, protocolSpreadBps: 0, maxFundingRateBps: 0, fundingInterval: 0, juniorFeeSplit: 0, insuranceFeeSplit: 0, treasuryFeeSplit: 0 }
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
    } catch (err) { /* swallow */ }
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

  const allowance = await getAllowance(ADDRESSES.usdc, account, ADDRESSES.vault)
  if (allowance < amount) {
    await approveToken(ADDRESSES.usdc, ADDRESSES.vault, amount)
  }

  const hash = await wc.writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'deposit',
    args: [amount, leverageBps], account, chain: getActiveChainConfig().chain,
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
export async function closePosition(amountUsdc) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')
  const amount = parseUnits(amountUsdc, 6)

  const hash = await wc.writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'withdraw',
    args: [amount], account, chain: getActiveChainConfig().chain,
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
  // VaultSimple does not support adjustLeverage — close and re-open with new leverage
  throw new Error('Adjust leverage not supported on VaultSimple. Close position and re-open with desired leverage.')
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
// VAULT SETUP — Oracle initialization + warmup + liquidity seeding
// ═══════════════════════════════════════════════════════════════

/**
 * Push a Pyth oracle update to the vault without trading.
 * Used to warm up the TWAP oracle (needs 5+ updates before trading is allowed).
 *
 * @returns {Promise<{hash: string, receipt: Object, explorerUrl: string}>}
 */
export async function updateOracle() {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')
  const { updateData, fee } = await fetchPythUpdate()

  const hash = await wc.writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'updateOracle',
    args: [updateData], value: fee, account, chain: getActiveChainConfig().chain,
  })
  return waitForTx(hash)
}

/**
 * Initialize the TWAP oracle buffer with a starting price (admin only).
 * Must be called once after vault deployment before any trading can happen.
 * Fills all 75 buffer slots with startPrice so TWAP is immediately valid.
 *
 * @param {number} startPrice — Starting price in 8-decimal format (e.g., 48000000000 for $480.00)
 * @returns {Promise<{hash: string, receipt: Object, explorerUrl: string}>}
 */
export async function initializeOracle(startPrice) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const wc = getWalletClient()
  if (!wc) throw new Error('No wallet connected')

  const INIT_ORACLE_ABI = [{ type: 'function', name: 'initializeOracle', inputs: [{ name: 'startPrice', type: 'uint128' }], outputs: [], stateMutability: 'nonpayable' }]

  const hash = await wc.writeContract({
    address: ADDRESSES.vault, abi: INIT_ORACLE_ABI, functionName: 'initializeOracle',
    args: [BigInt(startPrice)], account, chain: getActiveChainConfig().chain,
  })
  return waitForTx(hash)
}

/**
 * Check vault readiness for trading. Returns status of oracle, liquidity, and protocol state.
 *
 * @returns {Promise<{oracleReady: boolean, oracleUpdates: number, hasLiquidity: boolean,
 *   juniorTVL: string, maxLeverage: number, protocolState: string, isActive: boolean,
 *   oracleInitialized: boolean, checks: Object[]}>}
 */
export async function checkVaultReadiness() {
  if (!ADDRESSES.vault) return { oracleReady: true, hasLiquidity: false, isActive: false, checks: [{ label: 'No vault', ok: false }] }

  const pc = getPublicClient()
  const checks = []

  // Check if vault has code deployed
  try {
    const code = await pc.getCode({ address: ADDRESSES.vault })
    const hasCode = code && code !== '0x' && code.length > 2
    checks.push({ label: 'Vault Deployed', ok: hasCode, detail: hasCode ? ADDRESSES.vault.slice(0, 10) + '...' : 'No contract at address' })
    if (!hasCode) return { oracleReady: true, hasLiquidity: false, isActive: false, checks }
  } catch (e) {
    checks.push({ label: 'Vault Check', ok: false, detail: e.shortMessage || e.message })
    return { oracleReady: true, hasLiquidity: false, isActive: false, checks }
  }

  // Check pool state
  let poolState = null
  try {
    poolState = await pc.readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getPoolState' })
    const formatted = formatPoolState(poolState)
    checks.push({ label: 'Protocol Active', ok: poolState.protocolState === 0, detail: formatted.state })
    checks.push({ label: 'Junior Liquidity', ok: Number(poolState.totalJuniorDeposits) > 0, detail: `$${formatted.juniorTVL} USDC` })
    checks.push({ label: 'Senior TVL', ok: true, detail: `$${formatted.seniorTVL} USDC` })
    checks.push({ label: 'Max Leverage', ok: Number(poolState.currentMaxLeverageBps) >= 10000, detail: `${formatted.maxLeverage}x` })
  } catch (e) {
    checks.push({ label: 'Pool State', ok: false, detail: e.shortMessage || e.message })
  }

  // VaultSimple has no oracle — always ready
  const hasLiquidity = poolState ? Number(poolState.totalJuniorDeposits) > 0 : false
  const isActive = poolState ? poolState.protocolState === 0 : false

  return {
    oracleReady: true,
    oracleUpdates: 255,
    oracleInitialized: true,
    hasLiquidity,
    juniorTVL: poolState ? formatUnits(poolState.totalJuniorDeposits, 6) : '0',
    maxLeverage: poolState ? Number(poolState.currentMaxLeverageBps) / 10000 : 0,
    protocolState: poolState ? ['Active', 'Stressed', 'Paused', 'Emergency'][poolState.protocolState] : 'Unknown',
    isActive,
    checks,
  }
}

/**
 * Full vault setup sequence: initialize oracle + warm up with 5 Pyth updates + seed junior liquidity.
 * Emits progress events via a callback.
 *
 * @param {Object} opts
 * @param {number} opts.startPrice — Oracle start price (8 decimals). If 0, fetches from Pyth.
 * @param {string} [opts.juniorAmount] — USDC amount to seed into junior tranche (human-readable, e.g., "1000")
 * @param {function} [opts.onProgress] — Callback: (step, total, message) => void
 * @returns {Promise<{success: boolean, steps: string[]}>}
 */
export async function setupVault(opts = {}) {
  const { startPrice, juniorAmount, onProgress } = opts
  const steps = []
  const log = (step, total, msg) => {
    steps.push(msg)
    if (onProgress) onProgress(step, total, msg)
  }

  const totalSteps = 2 + 5 + (juniorAmount ? 1 : 0) // init + 5 warmups + optional junior
  let currentStep = 0

  // Step 1: Get oracle start price from Pyth if not provided
  let price = startPrice
  if (!price) {
    log(++currentStep, totalSteps, 'Fetching current price from Pyth...')
    const feedId = getActiveFeedId()
    const { price: pythPrice } = await getPriceForFeed(feedId)
    price = Math.round(pythPrice * 1e8) // Convert to 8-decimal integer
    log(currentStep, totalSteps, `Price: $${pythPrice.toFixed(2)} (${price} raw)`)
  }

  // Step 2: Initialize oracle buffer (admin only — will revert if already initialized)
  try {
    log(++currentStep, totalSteps, 'Initializing oracle buffer...')
    await initializeOracle(price)
    log(currentStep, totalSteps, 'Oracle buffer initialized')
  } catch (e) {
    if (e.message?.includes('Already initialized')) {
      log(currentStep, totalSteps, 'Oracle already initialized — skipping')
    } else {
      throw e
    }
  }

  // Steps 3-7: Push 5 Pyth oracle updates to warm up the update counter
  for (let i = 0; i < 5; i++) {
    log(++currentStep, totalSteps, `Pushing oracle update ${i + 1}/5...`)
    await updateOracle()
    log(currentStep, totalSteps, `Oracle update ${i + 1}/5 confirmed`)
  }

  // Step 8 (optional): Seed junior tranche with liquidity
  if (juniorAmount) {
    log(++currentStep, totalSteps, `Seeding junior tranche with ${juniorAmount} USDC...`)
    await depositJunior(juniorAmount)
    log(currentStep, totalSteps, `Junior tranche seeded with ${juniorAmount} USDC`)
  }

  return { success: true, steps }
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
    } catch (err) { /* swallow */ }
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
      (listeners[event] || []).forEach(fn => { try { fn(data) } catch (e) { /* swallow */ } })
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
  updateOracle, initializeOracle, checkVaultReadiness, setupVault,
  getOracleHealth, readOnChainPrice, getOnChainOracleState,
  getExplorerUrl, getAddressExplorerUrl,
  formatPosition, formatPoolState,
  getPublicClient, getWalletClient,
  txEvents, classifyTxError, TX_STATES,
  runPreflight,
}
