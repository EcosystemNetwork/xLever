/**
 * xLever Contract Adapter
 * viem-based interface for xLever Vault + ERC-20 interactions
 */
import { createPublicClient, createWalletClient, http, custom, parseUnits, formatUnits, encodeFunctionData, parseEther } from 'viem'
import { getPriceForFeed } from './pyth.js'
import { PYTH_FEEDS, ASSET_FEED_MAP } from './assets.js'

// ═══════════════════════════════════════════════════════════════
// CHAIN CONFIG
// ═══════════════════════════════════════════════════════════════

// Custom chain definition for Ink Sepolia since it's not in viem's built-in chain registry
export const inkSepolia = {
  // Ink Sepolia's unique chain ID used by wallets and viem to identify the network
  id: 763373,
  // Human-readable name shown in wallet prompts and UI
  name: 'Ink Sepolia',
  // ETH is the native gas token on Ink Sepolia (an L2 on Ethereum)
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  // RPC endpoint for reading chain state and submitting transactions
  rpcUrls: {
    default: { http: ['https://rpc-gel-sepolia.inkonchain.com'] },
  },
  // Block explorer for transaction verification links shown in the success modal
  blockExplorers: {
    default: { name: 'Ink Explorer', url: 'https://explorer-sepolia.inkonchain.com' },
  },
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT ADDRESSES (filled after deployment)
// ═══════════════════════════════════════════════════════════════

// Central address registry so all contract interactions reference a single source of truth
export const ADDRESSES = {
  // Euler V2 EVC (Ethereum Vault Connector) on Ink Sepolia -- coordinates vault interactions
  evc: '0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c',
  // QQQ Vault is the default active vault for leveraged Nasdaq exposure
  vault: '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',  // QQQ Vault (default)
  // USDC stablecoin on Ink Sepolia -- the collateral token for all positions
  usdc: '0x6b57475467cd854d36Be7FB614caDa5207838943',       // USDC on Ink Sepolia
  // Wrapped SP500 xStock token representing tokenized S&P 500 exposure
  wSPYx: '0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e',     // Wrapped SP500 xStock
  // Wrapped Nasdaq xStock token representing tokenized Nasdaq 100 exposure
  wQQQx: '0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9',     // Wrapped Nasdaq xStock
  // SPY Vault for leveraged S&P 500 positions (separate vault per underlying asset)
  spyVault: '0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228',
  // QQQ Vault for leveraged Nasdaq 100 positions (same as default vault above)
  qqqVault: '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
  // Pyth oracle contract on Ink Sepolia for on-chain price verification
  pyth: '0x2880aB155794e7179c9eE2e38200202908C17B43',       // Pyth on Ink Sepolia
  // Custom Pyth adapter that wraps Pyth for xLever-specific price reads and fee estimation
  pythAdapter: '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f',
  // Euler V2 core contracts on Ethereum mainnet, stored here for cross-chain reference
  euler: {
    // EVC on mainnet -- the hub contract that all Euler vaults connect through
    evc: '0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383',
    // Factory contract that deploys new Euler V2 vaults
    eVaultFactory: '0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e',
    // Protocol-level config (fee tiers, governors, etc.)
    protocolConfig: '0x4cD6BF1D183264c02Be7748Cb5cd3A47d013351b',
    // Uniswap Permit2 used by Euler for gas-efficient token approvals
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  // xStocks ERC-20 tokens on Ethereum mainnet (the underlying tokenized equities)
  xstocks: {
    // QQQx = tokenized Nasdaq 100 ETF on mainnet
    QQQx: '0xa753a7395cae905cd615da0b82a53e0560f250af',
    // SPYx = tokenized S&P 500 ETF on mainnet
    SPYx: '0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48',
  },
}

// Allows runtime overriding of any address (e.g., after deploying a new vault)
export function setAddress(key, address) {
  ADDRESSES[key] = address
}

// ═══════════════════════════════════════════════════════════════
// ABIs
// ═══════════════════════════════════════════════════════════════

// Minimal ERC-20 ABI -- only the functions xLever needs, not the full spec, to keep bundle size down
export const ERC20_ABI = [
  // approve: grants the vault permission to spend the user's USDC (required before deposit)
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  // allowance: checks how much the vault is already approved to spend (to skip redundant approvals)
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // balanceOf: reads the user's token balance for display and validation
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // decimals: needed to convert between raw uint256 values and human-readable amounts
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  // symbol: used to display the token ticker in the UI
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  // totalSupply: used for protocol analytics and TVL calculations
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
]

// xLever Vault ABI -- defines the leveraged position management interface
export const VAULT_ABI = [
  // --- Write functions (Pyth pull-oracle: all accept priceUpdateData + msg.value for fee) ---

  // deposit: opens a new leveraged position; takes USDC amount, leverage in basis points, and fresh Pyth price data
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'leverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'positionValue', type: 'uint256' }], stateMutability: 'payable' },
  // withdraw: closes a position and returns USDC to the user; requires Pyth price for fair-value calculation
  { type: 'function', name: 'withdraw', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'received', type: 'uint256' }], stateMutability: 'payable' },
  // adjustLeverage: changes leverage on an existing position without depositing or withdrawing
  { type: 'function', name: 'adjustLeverage', inputs: [{ name: 'newLeverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [], stateMutability: 'payable' },
  // depositJunior: adds liquidity to the junior tranche (LP side that absorbs risk and earns fees)
  { type: 'function', name: 'depositJunior', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
  // withdrawJunior: redeems junior tranche shares back to USDC
  { type: 'function', name: 'withdrawJunior', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'amount', type: 'uint256' }], stateMutability: 'nonpayable' },
  // updateOracle: standalone Pyth price update (used to refresh stale prices without trading)
  { type: 'function', name: 'updateOracle', inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }], outputs: [], stateMutability: 'payable' },

  // --- Read functions ---

  // getPosition: returns the full position struct for a user (deposit, leverage, entry price, fees, etc.)
  { type: 'function', name: 'getPosition', inputs: [{ name: 'user', type: 'address' }], outputs: [{
    name: '', type: 'tuple', components: [
      // depositAmount: the USDC collateral the user deposited (6 decimals)
      { name: 'depositAmount', type: 'uint128' },
      // leverageBps: leverage in basis points (e.g., 20000 = +2.0x, -30000 = -3.0x)
      { name: 'leverageBps', type: 'int32' },
      // entryTWAP: the time-weighted average price at position entry (8 decimals)
      { name: 'entryTWAP', type: 'uint128' },
      // lastFeeTimestamp: when fees were last accrued (for pro-rata fee calculation)
      { name: 'lastFeeTimestamp', type: 'uint64' },
      // settledFees: total fees already deducted from this position (6 decimals)
      { name: 'settledFees', type: 'uint128' },
      // leverageLockExpiry: timestamp until which leverage cannot be changed (anti-gaming)
      { name: 'leverageLockExpiry', type: 'uint32' },
      // isActive: whether this position is currently open
      { name: 'isActive', type: 'bool' },
    ]
  }], stateMutability: 'view' },
  // getPositionValue: returns current mark-to-market value and unrealized PnL
  { type: 'function', name: 'getPositionValue', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: 'value', type: 'uint256' }, { name: 'pnl', type: 'int256' }], stateMutability: 'view' },
  // getPoolState: returns aggregate vault state (TVL, exposure, funding rate, protocol health)
  { type: 'function', name: 'getPoolState', inputs: [], outputs: [{
    name: '', type: 'tuple', components: [
      // totalSeniorDeposits: total USDC from leveraged position holders (senior tranche)
      { name: 'totalSeniorDeposits', type: 'uint128' },
      // totalJuniorDeposits: total USDC from LP/risk-absorbers (junior tranche)
      { name: 'totalJuniorDeposits', type: 'uint128' },
      // insuranceFund: reserve fund that backstops extreme losses
      { name: 'insuranceFund', type: 'uint128' },
      // netExposure: net directional exposure (longs - shorts); drives funding rate
      { name: 'netExposure', type: 'int256' },
      // grossLongExposure: total notional of all long positions
      { name: 'grossLongExposure', type: 'uint128' },
      // grossShortExposure: total notional of all short positions
      { name: 'grossShortExposure', type: 'uint128' },
      // lastRebalanceTime: timestamp of last pool rebalance
      { name: 'lastRebalanceTime', type: 'uint64' },
      // currentMaxLeverageBps: dynamic max leverage that tightens under stress
      { name: 'currentMaxLeverageBps', type: 'uint32' },
      // fundingRateBps: current funding rate in bps (positive = longs pay shorts)
      { name: 'fundingRateBps', type: 'int64' },
      // protocolState: 0=Active, 1=Stressed, 2=Paused, 3=Emergency
      { name: 'protocolState', type: 'uint8' },
    ]
  }], stateMutability: 'view' },
  // getCurrentTWAP: returns the current time-weighted average price and spread
  { type: 'function', name: 'getCurrentTWAP', inputs: [], outputs: [{ name: 'twap', type: 'uint128' }, { name: 'spreadBps', type: 'uint16' }], stateMutability: 'view' },
  // getMaxLeverage: returns the current dynamic max leverage cap in basis points
  { type: 'function', name: 'getMaxLeverage', inputs: [], outputs: [{ name: 'maxLeverageBps', type: 'int32' }], stateMutability: 'view' },
  // getFundingRate: returns the current funding rate that balances long/short demand
  { type: 'function', name: 'getFundingRate', inputs: [], outputs: [{ name: 'rateBps', type: 'int256' }], stateMutability: 'view' },
  // getCarryRate: returns the annual borrow cost for leveraged positions
  { type: 'function', name: 'getCarryRate', inputs: [], outputs: [{ name: 'annualBps', type: 'uint256' }], stateMutability: 'view' },
  // getJuniorValue: returns total junior tranche value and per-share price (for LP dashboards)
  { type: 'function', name: 'getJuniorValue', inputs: [], outputs: [{ name: 'totalValue', type: 'uint256' }, { name: 'sharePrice', type: 'uint256' }], stateMutability: 'view' },

  // --- Events ---

  // Deposit event emitted when a user opens a position or deposits to junior tranche
  { type: 'event', name: 'Deposit', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'leverage', type: 'int32' }, { name: 'isSenior', type: 'bool' }] },
  // Withdraw event emitted when a user closes a position, includes realized PnL
  { type: 'event', name: 'Withdraw', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'pnl', type: 'uint256' }] },
  // LeverageAdjusted event for tracking leverage changes on existing positions
  { type: 'event', name: 'LeverageAdjusted', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'oldLeverage', type: 'int32' }, { name: 'newLeverage', type: 'int32' }] },
]

// Pyth adapter ABI -- wraps the Pyth oracle for xLever-specific price reads
export const PYTH_ADAPTER_ABI = [
  // getUpdateFee: estimates the ETH fee Pyth charges for a price update (sent as msg.value)
  { type: 'function', name: 'getUpdateFee', inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'fee', type: 'uint256' }], stateMutability: 'view' },
  // readPrice: fetches a cached price from the Pyth contract if it's fresh enough
  { type: 'function', name: 'readPrice', inputs: [{ name: 'feedId', type: 'bytes32' }, { name: 'maxAgeSec', type: 'uint256' }], outputs: [{ name: 'price', type: 'int64' }, { name: 'conf', type: 'uint64' }, { name: 'publishTime', type: 'uint64' }], stateMutability: 'view' },
  // isStale: checks if the on-chain price is too old and needs a fresh update
  { type: 'function', name: 'isStale', inputs: [{ name: 'feedId', type: 'bytes32' }, { name: 'maxAgeSec', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
]

// Re-export so existing consumers keep working
export { ASSET_FEED_MAP }

let activeAsset = 'QQQ'

export function setActiveAsset(symbol) {
  activeAsset = symbol
}

export function getActiveFeedId() {
  return ASSET_FEED_MAP[activeAsset] || PYTH_FEEDS['QQQ/USD']
}

// ═══════════════════════════════════════════════════════════════
// CLIENT SETUP
// ═══════════════════════════════════════════════════════════════

// Singleton public client for read-only RPC calls (no wallet needed)
let publicClient = null
// Singleton wallet client for write transactions (requires connected wallet)
let walletClient = null

// Lazily creates and caches a viem public client for reading on-chain state
export function getPublicClient() {
  // Reuse the existing client to avoid creating redundant RPC connections
  if (!publicClient) {
    // Public client uses HTTP transport to the Ink Sepolia RPC endpoint
    publicClient = createPublicClient({
      chain: inkSepolia,
      transport: http(),
    })
  }
  return publicClient
}

// Lazily creates and caches a viem wallet client for signing and sending transactions
export function getWalletClient() {
  // Only create if not cached AND the browser wallet (MetaMask, etc.) is available
  if (!walletClient && window.ethereum) {
    // Uses custom transport wrapping window.ethereum so tx signing goes through the user's wallet
    walletClient = createWalletClient({
      chain: inkSepolia,
      transport: custom(window.ethereum),
    })
  }
  return walletClient
}

// Fetches the user's connected wallet address, throwing if no wallet is available
async function getAccount() {
  // Get the wallet client first; it will be null if no browser wallet exists
  const wc = getWalletClient()
  // Throw a clear error so callers can show an appropriate "connect wallet" message
  if (!wc) throw new Error('No wallet connected')
  // Get all addresses from the wallet; the first one is the active account
  const [account] = await wc.getAddresses()
  // Guard against edge case where wallet is connected but has no accounts
  if (!account) throw new Error('No account found')
  return account
}

// ═══════════════════════════════════════════════════════════════
// ERC-20 READS
// ═══════════════════════════════════════════════════════════════

// Fetches a user's token balance with both raw (bigint) and human-readable (string) formats
export async function getBalance(tokenAddress, userAddress) {
  // Use the public client since balance reads don't require a wallet signature
  const pc = getPublicClient()
  // Read the raw balance in the token's smallest unit (e.g., 1e6 for USDC)
  const balance = await pc.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [userAddress],
  })
  // Read decimals so we can convert the raw balance to a human-readable string
  const decimals = await pc.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
  })
  // Return all three so callers can use whichever format they need
  return { raw: balance, formatted: formatUnits(balance, decimals), decimals }
}

// Checks how much of a token the spender (vault) is approved to transfer on behalf of the owner
export async function getAllowance(tokenAddress, ownerAddress, spenderAddress) {
  // Simple read call; result is used to determine if an approve tx is needed before deposit
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

// Approves the spender (vault) to transfer a specific amount of tokens from the user
export async function approveToken(tokenAddress, spenderAddress, amount) {
  // Need the user's address to sign the approval transaction
  const account = await getAccount()
  // Submit the ERC-20 approve transaction through the user's wallet
  const hash = await getWalletClient().writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spenderAddress, amount],
    account,
    // Explicitly pass chain to ensure the wallet targets the correct network
    chain: inkSepolia,
  })
  // Wait for the approval to be mined before proceeding to the deposit
  return waitForTx(hash)
}

// ═══════════════════════════════════════════════════════════════
// VAULT READS
// ═══════════════════════════════════════════════════════════════

// Fetches a user's full position struct from the vault contract
export async function getPosition(userAddress) {
  // Return null if the vault hasn't been deployed yet (demo mode)
  if (!ADDRESSES.vault) return null
  // Read the position struct which contains deposit, leverage, entry price, fees, etc.
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getPosition',
    args: [userAddress],
  })
}

// Fetches the current mark-to-market value and unrealized PnL for a user's position
export async function getPositionValue(userAddress) {
  // Return zero values if vault isn't deployed, so UI can show $0 gracefully
  if (!ADDRESSES.vault) return { value: 0n, pnl: 0n }
  // On-chain calculation accounts for leverage, entry price vs current price, and accrued fees
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getPositionValue',
    args: [userAddress],
  })
}

// Fetches the aggregate pool state (TVL, exposure, funding rate, protocol health)
export async function getPoolState() {
  // Return null if vault isn't deployed; UI shows placeholder data in demo mode
  if (!ADDRESSES.vault) return null
  // Pool state is used for the analytics dashboard and risk monitoring
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getPoolState',
  })
}

// Fetches the current TWAP (time-weighted average price) and spread from the vault
export async function getTWAP() {
  // Return zero TWAP if vault isn't deployed; prevents NaN in price displays
  if (!ADDRESSES.vault) return { twap: 0n, spreadBps: 0 }
  // TWAP is used as the entry/exit price for positions to prevent manipulation
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getCurrentTWAP',
  })
}

// Fetches the current dynamic maximum leverage allowed by the vault
export async function getMaxLeverage() {
  // Default to 4x (40000 bps) if vault isn't deployed; matches the UI slider range
  if (!ADDRESSES.vault) return 40000
  // Max leverage tightens automatically under pool stress to protect the junior tranche
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getMaxLeverage',
  })
}

// Fetches the current funding rate that balances long vs short demand
export async function getFundingRate() {
  // Return zero if no vault; UI shows 0% funding in demo mode
  if (!ADDRESSES.vault) return 0n
  // Positive rate means longs pay shorts; negative means shorts pay longs
  return getPublicClient().readContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'getFundingRate',
  })
}

// Fetches the total value and per-share price of the junior (LP) tranche
export async function getJuniorValue() {
  // Return zeros if no vault; LP dashboard shows $0 in demo mode
  if (!ADDRESSES.vault) return { totalValue: 0n, sharePrice: 0n }
  // Used to display LP share price appreciation and total junior TVL
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
 * Fetch Pyth price update + compute the ETH fee to send with the tx.
 * Every vault write path calls this first.
 * @returns {{ updateData: string[], fee: bigint }}
 */
// Internal helper that fetches a fresh Pyth price update and estimates the required ETH fee
async function fetchPythUpdate() {
  // Get the Pyth feed ID for whichever asset the user is currently trading
  const feedId = getActiveFeedId()
  // Fetch signed price data from Pyth's off-chain Hermes API (pull oracle pattern)
  const { updateData } = await getPriceForFeed(feedId)

  // Start with a conservative default fee in case the on-chain fee estimation fails
  let fee = parseUnits('0.001', 18) // 0.001 ETH safe default
  // Try to get the exact fee from the Pyth adapter contract if it's deployed
  if (ADDRESSES.pythAdapter) {
    try {
      // Read the exact fee Pyth charges for this specific update payload
      fee = await getPublicClient().readContract({
        address: ADDRESSES.pythAdapter,
        abi: PYTH_ADAPTER_ABI,
        functionName: 'getUpdateFee',
        args: [updateData],
      })
      // Add 10% buffer so the tx doesn't revert if the fee increases slightly between estimation and execution
      fee = fee + (fee / 10n) // add 10% buffer for gas margin
    } catch {
      // If fee estimation reverts, fall back to the conservative 0.001 ETH default
    }
  }
  // Return both the signed price data (for the vault) and the fee (as msg.value)
  return { updateData, fee }
}

/**
 * Open a leveraged position
 * @param {string} amountUsdc - Human-readable USDC amount (e.g., "1000")
 * @param {number} leverage - Leverage as float (e.g., 2.0 or -3.0)
 * @returns {Object} { hash, receipt }
 */
// Opens a new leveraged position: approves USDC, fetches Pyth price, and calls vault.deposit
export async function openPosition(amountUsdc, leverage) {
  // Vault must be deployed for real transactions
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  // USDC address must be set to know which token to approve
  if (!ADDRESSES.usdc) throw new Error('USDC address not set')

  // Get the user's wallet address for signing
  const account = await getAccount()
  // Convert human-readable USDC string to uint256 with 6 decimals (USDC standard)
  const amount = parseUnits(amountUsdc, 6) // USDC = 6 decimals
  // Convert float leverage to basis points as the contract expects (2.0 -> 20000, -3.0 -> -30000)
  const leverageBps = Math.round(leverage * 10000) // 2.0 -> 20000

  // Fetch a fresh Pyth oracle price update (required by the vault's pull-oracle design)
  const { updateData, fee } = await fetchPythUpdate()

  // Check current USDC allowance and approve if the vault doesn't have enough
  const allowance = await getAllowance(ADDRESSES.usdc, account, ADDRESSES.vault)
  // Only send an approve tx if the current allowance is insufficient (saves gas on repeat deposits)
  if (allowance < amount) {
    await approveToken(ADDRESSES.usdc, ADDRESSES.vault, amount)
  }

  // Submit the deposit transaction with Pyth price data and ETH fee for the oracle update
  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'deposit',
    args: [amount, leverageBps, updateData],
    // msg.value pays the Pyth oracle update fee
    value: fee,
    account,
    chain: inkSepolia,
  })
  // Wait for the transaction to be mined and return the hash + receipt
  return waitForTx(hash)
}

/**
 * Close position and withdraw
 * @param {string} amountUsdc - Amount to withdraw (human-readable)
 */
// Closes a leveraged position by withdrawing USDC from the vault
export async function closePosition(amountUsdc) {
  // Vault must be deployed for real transactions
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  // Get the user's wallet address for signing
  const account = await getAccount()
  // Convert human-readable amount to uint256 with 6 decimals
  const amount = parseUnits(amountUsdc, 6)

  // Fetch fresh Pyth price data so the vault can calculate fair exit value
  const { updateData, fee } = await fetchPythUpdate()

  // Submit the withdrawal transaction
  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'withdraw',
    args: [amount, updateData],
    // msg.value pays the Pyth oracle update fee
    value: fee,
    account,
    chain: inkSepolia,
  })
  // Wait for confirmation and return the result
  return waitForTx(hash)
}

/**
 * Adjust leverage on existing position
 * @param {number} newLeverage - New leverage as float
 */
// Changes the leverage on an existing position without depositing or withdrawing collateral
export async function adjustLeverage(newLeverage) {
  // Vault must be deployed for real transactions
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  // Get the user's wallet address for signing
  const account = await getAccount()
  // Convert float leverage to basis points for the contract
  const leverageBps = Math.round(newLeverage * 10000)

  // Fetch fresh Pyth price data so the vault can recalculate exposure at current price
  const { updateData, fee } = await fetchPythUpdate()

  // Submit the leverage adjustment transaction
  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'adjustLeverage',
    args: [leverageBps, updateData],
    // msg.value pays the Pyth oracle update fee
    value: fee,
    account,
    chain: inkSepolia,
  })
  // Wait for confirmation and return the result
  return waitForTx(hash)
}

/**
 * Deposit into junior tranche (LP)
 * @param {string} amountUsdc - Amount in human-readable USDC
 */
// Adds USDC liquidity to the junior (LP) tranche that absorbs risk and earns fees from leveraged traders
export async function depositJunior(amountUsdc) {
  // Vault must be deployed for real transactions
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  // USDC address must be set to know which token to approve
  if (!ADDRESSES.usdc) throw new Error('USDC address not set')
  // Get the user's wallet address for signing
  const account = await getAccount()
  // Convert human-readable amount to uint256 with 6 decimals
  const amount = parseUnits(amountUsdc, 6)

  // Check and approve USDC spending if needed (same pattern as openPosition)
  const allowance = await getAllowance(ADDRESSES.usdc, account, ADDRESSES.vault)
  // Only approve if the current allowance is insufficient
  if (allowance < amount) {
    await approveToken(ADDRESSES.usdc, ADDRESSES.vault, amount)
  }

  // Submit the junior deposit -- no Pyth update needed since junior tranche isn't price-sensitive at entry
  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'depositJunior',
    args: [amount],
    account,
    chain: inkSepolia,
  })
  // Wait for confirmation and return the result
  return waitForTx(hash)
}

/**
 * Withdraw from junior tranche
 * @param {string} shares - Shares to withdraw
 */
// Redeems junior tranche shares back to USDC
export async function withdrawJunior(shares) {
  // Vault must be deployed for real transactions
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  // Get the user's wallet address for signing
  const account = await getAccount()
  // Junior shares use 18 decimals (standard ERC-20 share token precision)
  const amount = parseUnits(shares, 18)

  // Submit the junior withdrawal -- burns shares and returns proportional USDC
  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'withdrawJunior',
    args: [amount],
    account,
    chain: inkSepolia,
  })
  // Wait for confirmation and return the result
  return waitForTx(hash)
}

// ═══════════════════════════════════════════════════════════════
// ORACLE HEALTH — surfaces Pyth data quality for UI + risk engine
// ═══════════════════════════════════════════════════════════════

/**
 * Read current oracle health for the active asset.
 * Returns age, confidence, price, staleness status, and raw Pyth data.
 */
export async function getOracleHealth() {
  const feedId = getActiveFeedId()
  const { price, conf, publishTime, symbol } = await getPriceForFeed(feedId)
  const now = Math.floor(Date.now() / 1000)
  const age = now - publishTime
  const isStale = age > 300
  const freshness = age < 60 ? 'fresh' : age < 300 ? 'ok' : 'stale'

  let onChainStale = null
  if (ADDRESSES.pythAdapter) {
    try {
      onChainStale = await getPublicClient().readContract({
        address: ADDRESSES.pythAdapter,
        abi: PYTH_ADAPTER_ABI,
        functionName: 'isStale',
        args: [feedId, 300n],
      })
    } catch { /* adapter may not be reachable */ }
  }

  return {
    price, conf, age, publishTime, isStale, freshness, feedId, symbol,
    onChainStale,
    confPercent: price > 0 ? ((conf / price) * 100).toFixed(4) : '0',
  }
}

/**
 * Read on-chain oracle price via the Pyth adapter.
 */
export async function readOnChainPrice(feedId, maxAgeSec = 300) {
  if (!ADDRESSES.pythAdapter) throw new Error('Pyth adapter not deployed')
  const result = await getPublicClient().readContract({
    address: ADDRESSES.pythAdapter,
    abi: PYTH_ADAPTER_ABI,
    functionName: 'readPrice',
    args: [feedId || getActiveFeedId(), BigInt(maxAgeSec)],
  })
  return {
    price: Number(result[0]) / 1e8,
    conf: Number(result[1]) / 1e8,
    publishTime: Number(result[2]),
  }
}

// ═══════════════════════════════════════════════════════════════
// TX HELPERS
// ═══════════════════════════════════════════════════════════════

// Waits for a transaction to be included in a block and returns both hash and receipt
async function waitForTx(hash) {
  // viem's waitForTransactionReceipt polls the node until the tx is mined
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash })
  // Return both so callers can check receipt.status and display the hash
  return { hash, receipt }
}

// Builds a block explorer URL for a transaction hash (used in the success modal)
export function getExplorerUrl(hash) {
  // Concatenates the Ink Sepolia explorer base URL with the tx path
  return `${inkSepolia.blockExplorers.default.url}/tx/${hash}`
}

// Builds a block explorer URL for a wallet/contract address
export function getAddressExplorerUrl(address) {
  // Used for linking to user profiles or contract pages in the explorer
  return `${inkSepolia.blockExplorers.default.url}/address/${address}`
}

// ═══════════════════════════════════════════════════════════════
// POSITION FORMATTING HELPERS
// ═══════════════════════════════════════════════════════════════

// Converts the raw on-chain position struct into a UI-friendly object with formatted strings
export function formatPosition(pos) {
  // Return null for inactive or nonexistent positions so the UI can show "no position" state
  if (!pos || !pos.isActive) return null
  // Convert basis points back to a float for display (20000 -> 2.0)
  const leverageFloat = Number(pos.leverageBps) / 10000
  // Return a clean object with all the fields the UI needs, pre-formatted
  return {
    // Convert 6-decimal USDC amount to human-readable string
    deposit: formatUnits(pos.depositAmount, 6),
    // Raw float leverage for calculations
    leverage: leverageFloat,
    // Pre-formatted display string with sign and "x" suffix (e.g., "+2.0x")
    leverageDisplay: (leverageFloat > 0 ? '+' : '') + leverageFloat.toFixed(1) + 'x',
    // Boolean flags so the UI can branch on direction without re-checking the number
    isLong: leverageFloat > 0,
    isShort: leverageFloat < 0,
    // Entry TWAP with 8 decimal precision (matches Pyth price format)
    entryPrice: formatUnits(pos.entryTWAP, 8),
    // Accrued fees formatted as human-readable USDC
    fees: formatUnits(pos.settledFees, 6),
    // Pass through the active flag for convenience
    isActive: pos.isActive,
  }
}

// Converts the raw on-chain pool state struct into a UI-friendly object for the analytics dashboard
export function formatPoolState(pool) {
  // Return null if pool data is unavailable (vault not deployed)
  if (!pool) return null
  return {
    // Senior TVL = total deposits from leveraged traders (6-decimal USDC)
    seniorTVL: formatUnits(pool.totalSeniorDeposits, 6),
    // Junior TVL = total deposits from LP/risk-absorbers (6-decimal USDC)
    juniorTVL: formatUnits(pool.totalJuniorDeposits, 6),
    // Insurance fund balance that backstops extreme losses
    insurance: formatUnits(pool.insuranceFund, 6),
    // Net directional exposure (longs minus shorts) as formatted USDC
    netExposure: formatUnits(pool.netExposure, 6),
    // Total notional of all long positions
    grossLong: formatUnits(pool.grossLongExposure, 6),
    // Total notional of all short positions
    grossShort: formatUnits(pool.grossShortExposure, 6),
    // Dynamic max leverage as a float (40000 bps -> 4.0x)
    maxLeverage: Number(pool.currentMaxLeverageBps) / 10000,
    // Human-readable protocol state string mapped from the enum
    state: ['Active', 'Stressed', 'Paused', 'Emergency'][pool.protocolState] || 'Unknown',
    // Junior ratio = junior / total TVL; used to display pool health indicators
    juniorRatio: Number(pool.totalJuniorDeposits) / (Number(pool.totalSeniorDeposits) + Number(pool.totalJuniorDeposits) || 1),
  }
}

// Expose the entire contracts API on window so non-module scripts (ux.js, inline handlers) can use it
window.xLeverContracts = {
  // Address registry and setters
  ADDRESSES, setAddress,
  // Asset-to-feed mapping and active asset management
  ASSET_FEED_MAP, setActiveAsset, getActiveFeedId,
  // ERC-20 read/write functions for balance checks and approvals
  getBalance, getAllowance, approveToken,
  // Vault read functions for position data, pool state, and oracle prices
  getPosition, getPositionValue, getPoolState, getTWAP, getMaxLeverage, getFundingRate, getJuniorValue,
  // Vault write functions for opening/closing positions and managing junior tranche
  openPosition, closePosition, adjustLeverage, depositJunior, withdrawJunior,
  // Utility functions for explorer links and data formatting
  getExplorerUrl, getAddressExplorerUrl,
  formatPosition, formatPoolState,
  // Oracle health reporting
  getOracleHealth, readOnChainPrice,
  // Client accessors for advanced usage
  getPublicClient, getWalletClient,
}
