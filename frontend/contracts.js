/**
 * xLever Contract Adapter
 * viem-based interface for xLever Vault + ERC-20 interactions
 */
import { createPublicClient, createWalletClient, http, custom, parseUnits, formatUnits, encodeFunctionData } from 'viem'

// ═══════════════════════════════════════════════════════════════
// CHAIN CONFIG
// ═══════════════════════════════════════════════════════════════

export const inkSepolia = {
  id: 763373,
  name: 'Ink Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-gel-sepolia.inkonchain.com'] },
  },
  blockExplorers: {
    default: { name: 'Ink Explorer', url: 'https://explorer-sepolia.inkonchain.com' },
  },
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT ADDRESSES (filled after deployment)
// ═══════════════════════════════════════════════════════════════

export const ADDRESSES = {
  evc: '0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c',
  vault: null,           // xLever Vault — set after deploy via setAddress()
  usdc: '0x6b57475467cd854d36Be7FB614caDa5207838943',       // USDC on Ink Sepolia
  wSPYx: '0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e',     // Wrapped SP500 xStock
  wQQQx: '0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9',     // Wrapped Nasdaq xStock
  spyVault: null,        // wSPYx Vault — set after deploy
  qqqVault: null,        // wQQQx Vault — set after deploy
  // Euler V2 core (Ethereum mainnet, for reference)
  euler: {
    evc: '0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383',
    eVaultFactory: '0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e',
    protocolConfig: '0x4cD6BF1D183264c02Be7748Cb5cd3A47d013351b',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  // xStocks ERC-20 on Ethereum mainnet
  xstocks: {
    QQQx: '0xa753a7395cae905cd615da0b82a53e0560f250af',
    SPYx: '0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48',
  },
}

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
  // --- Write functions ---
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'leverageBps', type: 'int32' }], outputs: [{ name: 'positionValue', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'received', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'adjustLeverage', inputs: [{ name: 'newLeverageBps', type: 'int32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'depositJunior', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'withdrawJunior', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'amount', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'updatePrice', inputs: [{ name: 'spotPrice', type: 'uint128' }], outputs: [], stateMutability: 'nonpayable' },

  // --- Read functions ---
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
  { type: 'function', name: 'getJuniorValue', inputs: [], outputs: [{ name: 'totalValue', type: 'uint256' }, { name: 'sharePrice', type: 'uint256' }], stateMutability: 'view' },

  // --- Events ---
  { type: 'event', name: 'Deposit', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'leverage', type: 'int32' }, { name: 'isSenior', type: 'bool' }] },
  { type: 'event', name: 'Withdraw', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'pnl', type: 'uint256' }] },
  { type: 'event', name: 'LeverageAdjusted', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'oldLeverage', type: 'int32' }, { name: 'newLeverage', type: 'int32' }] },
]

// ═══════════════════════════════════════════════════════════════
// CLIENT SETUP
// ═══════════════════════════════════════════════════════════════

let publicClient = null
let walletClient = null

export function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: inkSepolia,
      transport: http(),
    })
  }
  return publicClient
}

export function getWalletClient() {
  if (!walletClient && window.ethereum) {
    walletClient = createWalletClient({
      chain: inkSepolia,
      transport: custom(window.ethereum),
    })
  }
  return walletClient
}

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

export async function getBalance(tokenAddress, userAddress) {
  const pc = getPublicClient()
  const balance = await pc.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [userAddress],
  })
  const decimals = await pc.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
  })
  return { raw: balance, formatted: formatUnits(balance, decimals), decimals }
}

export async function getAllowance(tokenAddress, ownerAddress, spenderAddress) {
  return getPublicClient().readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddress, spenderAddress],
  })
}

// ═══════════════════════════════════════════════════════════════
// ERC-20 WRITES
// ═══════════════════════════════════════════════════════════════

export async function approveToken(tokenAddress, spenderAddress, amount) {
  const account = await getAccount()
  const hash = await getWalletClient().writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spenderAddress, amount],
    account,
    chain: inkSepolia,
  })
  return waitForTx(hash)
}

// ═══════════════════════════════════════════════════════════════
// VAULT READS
// ═══════════════════════════════════════════════════════════════

export async function getPosition(userAddress) {
  if (!ADDRESSES.vault) return null
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getPosition',
    args: [userAddress],
  })
}

export async function getPositionValue(userAddress) {
  if (!ADDRESSES.vault) return { value: 0n, pnl: 0n }
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getPositionValue',
    args: [userAddress],
  })
}

export async function getPoolState() {
  if (!ADDRESSES.vault) return null
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getPoolState',
  })
}

export async function getTWAP() {
  if (!ADDRESSES.vault) return { twap: 0n, spreadBps: 0 }
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getCurrentTWAP',
  })
}

export async function getMaxLeverage() {
  if (!ADDRESSES.vault) return 40000
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getMaxLeverage',
  })
}

export async function getFundingRate() {
  if (!ADDRESSES.vault) return 0n
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getFundingRate',
  })
}

export async function getJuniorValue() {
  if (!ADDRESSES.vault) return { totalValue: 0n, sharePrice: 0n }
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getJuniorValue',
  })
}

// ═══════════════════════════════════════════════════════════════
// VAULT WRITES
// ═══════════════════════════════════════════════════════════════

/**
 * Open a leveraged position
 * @param {string} amountUsdc - Human-readable USDC amount (e.g., "1000")
 * @param {number} leverage - Leverage as float (e.g., 2.0 or -3.0)
 * @returns {Object} { hash, receipt }
 */
export async function openPosition(amountUsdc, leverage) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  if (!ADDRESSES.usdc) throw new Error('USDC address not set')

  const account = await getAccount()
  const amount = parseUnits(amountUsdc, 6) // USDC = 6 decimals
  const leverageBps = Math.round(leverage * 10000) // 2.0 -> 20000

  // Check and approve USDC if needed
  const allowance = await getAllowance(ADDRESSES.usdc, account, ADDRESSES.vault)
  if (allowance < amount) {
    await approveToken(ADDRESSES.usdc, ADDRESSES.vault, amount)
  }

  // Open position
  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'deposit',
    args: [amount, leverageBps],
    account,
    chain: inkSepolia,
  })
  return waitForTx(hash)
}

/**
 * Close position and withdraw
 * @param {string} amountUsdc - Amount to withdraw (human-readable)
 */
export async function closePosition(amountUsdc) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const amount = parseUnits(amountUsdc, 6)

  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'withdraw',
    args: [amount],
    account,
    chain: inkSepolia,
  })
  return waitForTx(hash)
}

/**
 * Adjust leverage on existing position
 * @param {number} newLeverage - New leverage as float
 */
export async function adjustLeverage(newLeverage) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const leverageBps = Math.round(newLeverage * 10000)

  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'adjustLeverage',
    args: [leverageBps],
    account,
    chain: inkSepolia,
  })
  return waitForTx(hash)
}

/**
 * Deposit into junior tranche (LP)
 * @param {string} amountUsdc - Amount in human-readable USDC
 */
export async function depositJunior(amountUsdc) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  if (!ADDRESSES.usdc) throw new Error('USDC address not set')
  const account = await getAccount()
  const amount = parseUnits(amountUsdc, 6)

  const allowance = await getAllowance(ADDRESSES.usdc, account, ADDRESSES.vault)
  if (allowance < amount) {
    await approveToken(ADDRESSES.usdc, ADDRESSES.vault, amount)
  }

  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'depositJunior',
    args: [amount],
    account,
    chain: inkSepolia,
  })
  return waitForTx(hash)
}

/**
 * Withdraw from junior tranche
 * @param {string} shares - Shares to withdraw
 */
export async function withdrawJunior(shares) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const amount = parseUnits(shares, 18)

  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'withdrawJunior',
    args: [amount],
    account,
    chain: inkSepolia,
  })
  return waitForTx(hash)
}

// ═══════════════════════════════════════════════════════════════
// TX HELPERS
// ═══════════════════════════════════════════════════════════════

async function waitForTx(hash) {
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash })
  return { hash, receipt }
}

export function getExplorerUrl(hash) {
  return `${inkSepolia.blockExplorers.default.url}/tx/${hash}`
}

export function getAddressExplorerUrl(address) {
  return `${inkSepolia.blockExplorers.default.url}/address/${address}`
}

// ═══════════════════════════════════════════════════════════════
// POSITION FORMATTING HELPERS
// ═══════════════════════════════════════════════════════════════

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

// Expose globally for non-module scripts
window.xLeverContracts = {
  ADDRESSES, setAddress,
  getBalance, getAllowance, approveToken,
  getPosition, getPositionValue, getPoolState, getTWAP, getMaxLeverage, getFundingRate, getJuniorValue,
  openPosition, closePosition, adjustLeverage, depositJunior, withdrawJunior,
  getExplorerUrl, getAddressExplorerUrl,
  formatPosition, formatPoolState,
  getPublicClient, getWalletClient,
}
