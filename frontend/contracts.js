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

export const ethSepolia = {
  id: 11155111,
  name: 'Ethereum Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://ethereum-sepolia-rpc.publicnode.com'] },
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
  // Ethereum Sepolia (11155111)
  11155111: {
    chain: ethSepolia,
    vaults: {
      QQQ:  '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
      SPY:  '0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228',
      VUG:  '0x5a446C69c8C635ae473Ed859b1853Bd580F671B7',
      VGK:  '0x5FA09F20C04533a8564F280A9127Cf63aDE08621',
      VXUS: '0x445B9A6B774E42BeF772671D2eEA6529bc28bC26',
      SGOV: '0x30A37d04aFa2648FA4427b13c7ca380490F46BaD',
      SMH:  '0x6F5C1fB59C4887dD3938fAF19D46C21d1dFF8cF6',
      XLE:  '0x73ad91867737622971D9f928AD65f2078EC3e184',
      XOP:  '0xD4F23c93237D9594b13662D1Ce7B2078efe6B0ec',
      ITA:  '0x7D2C5FA48954F601faF30ed4A1611150E7CA72b8',
      AAPL: '0x31026d0de55Eb7523EeADeBB58fec60876235f09',
      NVDA: '0xe212D68B4e18747b2bAb256090c1d09Ab9A5371a',
      TSLA: '0x5b493Fc8B66A6827f7A1658BFcFA01693534326e',
      DELL: '0xab455997817026cCf4791Bb565189Dd873ECE675',
      SMCI: '0x28AFF61B3801eE173CAfaeCdD5Ff78D65B478b3E',
      ANET: '0x63b25f2d081e02475F5B4F99f0966EA2e7a3C54a',
      VRT:  '0x4D1785862e24C9fC719B0C2ff3749C67fD315562',
      SNDK: '0xf8D8c163e8B36799e4C719384AE20DD7873A5DfE',
      KLAC: '0xb4288Ba6B4C61b64cc2d5d3Da1466dE6Cd904398',
      LRCX: '0x83B11A1A46182B933674607B10643Ac97D104247',
      AMAT: '0x2d3b2B1F563b7552f2aB24250164C4a7379a4c33',
      TER:  '0xCFd3631169Ba659744A55904774B03346795e1F1',
      CEG:  '0x3Ac370b7617350f3C7eff089541dd7F0E886f7e5',
      GEV:  '0x184D592eAf314c81877532CBda6Dc1fB8A74Ed68',
      SMR:  '0xc235cC4efCf42E98385A9132dac093d1426a5ED2',
      ETN:  '0xacF8600BCBfde39Fc5aF017E7d9009310bEC0D6B',
      PWR:  '0xCd258E69A5Cc4A7E6D6Ea7219355CeB0a3153472',
      APLD: '0x594332f239Fe809Ccf6B3Dd791Eb8252A3efA38c',
      SLV:  '0x46ce7cd72763B784977349686AEA72B84d3F86B6',
      PPLT: '0xEC9455F29A5a7A2a5F496bB7D4B428A1df3850dF',
      PALL: '0x5fcAbBc1e9ab0bEca3d6cd9EF0257F2369230D12',
      STRK: '0x0a66152096f37F83D41c56534022e746B159b052',
      BTGO: '0x6FB4b73B1e980217010d20B7DA065b06EA7802B6',
    },
  },
}

let activeChainId = 763373 // default to Ink Sepolia

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

export function getActiveChainId() { return activeChainId }
export function getActiveChainConfig() { return CHAIN_CONFIGS[activeChainId] }

// ═══════════════════════════════════════════════════════════════
// CONTRACT ADDRESSES (filled after deployment)
// ═══════════════════════════════════════════════════════════════

export const ADDRESSES = {
  evc: '0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c',
  vault: '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',  // Active vault (switches with asset)
  usdc: '0x6b57475467cd854d36Be7FB614caDa5207838943',
  wSPYx: '0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e',
  wQQQx: '0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9',
  spyVault: '0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228',
  qqqVault: '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
  pyth: '0x2880aB155794e7179c9eE2e38200202908C17B43',
  pythAdapter: '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f',
  euler: {
    evc: '0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383',        // Euler's canonical EVC on Ink Sepolia
    eVaultFactory: '0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e',
    protocolConfig: '0x4cD6BF1D183264c02Be7748Cb5cd3A47d013351b',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  xstocks: {
    QQQx: '0xa753a7395cae905cd615da0b82a53e0560f250af',
    SPYx: '0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48',
  },
}

// ═══════════════════════════════════════════════════════════════
// VAULT REGISTRY — maps ticker symbol → deployed vault address
// Add new vault addresses here after deploying via VaultFactory
// ═══════════════════════════════════════════════════════════════

export const VAULT_REGISTRY = {
  // ── Index ETFs ──
  QQQ:  '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
  SPY:  '0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228',
  VUG:  '0x09F7D7717a67783298d5Ca6C0fe036C39951D337',
  VGK:  '0x5a446C69c8C635ae473Ed859b1853Bd580F671B7',
  VXUS: '0x5FA09F20C04533a8564F280A9127Cf63aDE08621',
  SGOV: '0x445B9A6B774E42BeF772671D2eEA6529bc28bC26',
  // ── Sector ETFs ──
  SMH:  '0x30A37d04aFa2648FA4427b13c7ca380490F46BaD',
  XLE:  '0x6F5C1fB59C4887dD3938fAF19D46C21d1dFF8cF6',
  XOP:  '0x73ad91867737622971D9f928AD65f2078efe6B0ec',
  ITA:  '0xD4F23c93237D9594b13662D1Ce7B2078efe6B0ec',
  // ── Mega-cap Tech ──
  AAPL: '0x7D2C5FA48954F601faF30ed4A1611150E7CA72b8',
  NVDA: '0x31026d0de55Eb7523EeADeBB58fec60876235f09',
  TSLA: '0xe212D68B4e18747b2bAb256090c1d09Ab9A5371a',
  DELL: '0x5b493Fc8B66A6827f7A1658BFcFA01693534326e',
  SMCI: '0xab455997817026cCf4791Bb565189Dd873ECE675',
  ANET: '0x28AFF61B3801eE173CAfaeCdD5Ff78D65B478b3E',
  VRT:  '0x63b25f2d081e02475F5B4F99f0966EA2e7a3C54a',
  SNDK: '0x4D1785862e24C9fC719B0C2ff3749C67fD315562',
  // ── Semiconductors ──
  KLAC: '0xf8D8c163e8B36799e4C719384AE20DD7873A5DfE',
  LRCX: '0xb4288Ba6B4C61b64cc2d5d3Da1466dE6Cd904398',
  AMAT: '0x83B11A1A46182B933674607B10643Ac97D104247',
  TER:  '0x2d3b2B1F563b7552f2aB24250164C4a7379a4c33',
  // ── Energy & Infrastructure ──
  CEG:  '0xCFd3631169Ba659744A55904774B03346795e1F1',
  GEV:  '0x3Ac370b7617350f3C7eff089541dd7F0E886f7e5',
  SMR:  '0x184D592eAf314c81877532CBda6Dc1fB8A74Ed68',
  ETN:  '0xc235cC4efCf42E98385A9132dac093d1426a5ED2',
  PWR:  '0xacF8600BCBfde39Fc5aF017E7d9009310bEC0D6B',
  APLD: '0xCd258E69A5Cc4A7E6D6Ea7219355CeB0a3153472',
  // ── Commodities ──
  SLV:  '0x594332f239Fe809Ccf6B3Dd791Eb8252A3efA38c',
  PPLT: '0x46ce7cd72763B784977349686AEA72B84d3F86B6',
  PALL: '0xEC9455F29A5a7A2a5F496bB7D4B428A1df3850dF',
  // ── Crypto-adjacent ──
  STRK: '0x5fcAbBc1e9ab0bEca3d6cd9EF0257F2369230D12',
  BTGO: '0x0a66152096f37F83D41c56534022e746B159b052',
}

// Backfill: Ink Sepolia uses VAULT_REGISTRY as its vault map
CHAIN_CONFIGS[763373].vaults = VAULT_REGISTRY

export function getVaultForAsset(symbol) {
  const config = CHAIN_CONFIGS[activeChainId]
  const vaults = config?.vaults || VAULT_REGISTRY
  return vaults[symbol] || null
}

export function isVaultDeployed(symbol) {
  return !!getVaultForAsset(symbol)
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
  // Write functions (Pyth pull-oracle: all accept priceUpdateData + msg.value for fee)
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'leverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'positionValue', type: 'uint256' }], stateMutability: 'payable' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'received', type: 'uint256' }], stateMutability: 'payable' },
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
  { type: 'function', name: 'getJuniorValue', inputs: [], outputs: [{ name: 'totalValue', type: 'uint256' }, { name: 'sharePrice', type: 'uint256' }], stateMutability: 'view' },

  // Events
  { type: 'event', name: 'Deposit', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'leverage', type: 'int32' }, { name: 'isSenior', type: 'bool' }] },
  { type: 'event', name: 'Withdraw', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'pnl', type: 'uint256' }] },
  { type: 'event', name: 'LeverageAdjusted', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'oldLeverage', type: 'int32' }, { name: 'newLeverage', type: 'int32' }] },
]

export const PYTH_ADAPTER_ABI = [
  { type: 'function', name: 'getUpdateFee', inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'fee', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'readPrice', inputs: [{ name: 'feedId', type: 'bytes32' }, { name: 'maxAgeSec', type: 'uint256' }], outputs: [{ name: 'price', type: 'int64' }, { name: 'conf', type: 'uint64' }, { name: 'publishTime', type: 'uint64' }], stateMutability: 'view' },
  { type: 'function', name: 'isStale', inputs: [{ name: 'feedId', type: 'bytes32' }, { name: 'maxAgeSec', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
]

// Re-export so existing consumers keep working
export { ASSET_FEED_MAP }

let activeAsset = 'QQQ'

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

export function getActiveAsset() {
  return activeAsset
}

export function getActiveFeedId() {
  return ASSET_FEED_MAP[activeAsset] || PYTH_FEEDS['QQQ/USD']
}

// ═══════════════════════════════════════════════════════════════
// CLIENT SETUP
// ═══════════════════════════════════════════════════════════════

let publicClient = null
let walletClient = null

export function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({ chain: inkSepolia, transport: http() })
  }
  return publicClient
}

export function getWalletClient() {
  if (!walletClient && window.ethereum) {
    walletClient = createWalletClient({ chain: inkSepolia, transport: custom(window.ethereum) })
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
  const balance = await pc.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [userAddress] })
  const decimals = await pc.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' })
  return { raw: balance, formatted: formatUnits(balance, decimals), decimals }
}

export async function getAllowance(tokenAddress, ownerAddress, spenderAddress) {
  return getPublicClient().readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'allowance', args: [ownerAddress, spenderAddress] })
}

// ═══════════════════════════════════════════════════════════════
// ERC-20 WRITES
// ═══════════════════════════════════════════════════════════════

export async function approveToken(tokenAddress, spenderAddress, amount) {
  const account = await getAccount()
  const hash = await getWalletClient().writeContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: 'approve',
    args: [spenderAddress, amount], account, chain: inkSepolia,
  })
  return waitForTx(hash)
}

// ═══════════════════════════════════════════════════════════════
// VAULT READS
// ═══════════════════════════════════════════════════════════════

export async function getPosition(userAddress) {
  if (!ADDRESSES.vault) return null
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getPosition', args: [userAddress] })
}

export async function getPositionValue(userAddress) {
  if (!ADDRESSES.vault) return { value: 0n, pnl: 0n }
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getPositionValue', args: [userAddress] })
}

export async function getPoolState() {
  if (!ADDRESSES.vault) return null
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getPoolState' })
}

export async function getTWAP() {
  if (!ADDRESSES.vault) return { twap: 0n, spreadBps: 0 }
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getCurrentTWAP' })
}

export async function getMaxLeverage() {
  if (!ADDRESSES.vault) return 40000
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getMaxLeverage' })
}

export async function getFundingRate() {
  if (!ADDRESSES.vault) return 0n
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getFundingRate' })
}

export async function getJuniorValue() {
  if (!ADDRESSES.vault) return { totalValue: 0n, sharePrice: 0n }
  return getPublicClient().readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'getJuniorValue' })
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
  const { updateData } = await getPriceForFeed(feedId)

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

export async function openPosition(amountUsdc, leverage) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  if (!ADDRESSES.usdc) throw new Error('USDC address not set')

  const account = await getAccount()
  const amount = parseUnits(amountUsdc, 6)
  const leverageBps = Math.round(leverage * 10000)
  const { updateData, fee } = await fetchPythUpdate()

  const allowance = await getAllowance(ADDRESSES.usdc, account, ADDRESSES.vault)
  if (allowance < amount) {
    await approveToken(ADDRESSES.usdc, ADDRESSES.vault, amount)
  }

  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'deposit',
    args: [amount, leverageBps, updateData], value: fee, account, chain: inkSepolia,
  })
  return waitForTx(hash)
}

export async function closePosition(amountUsdc) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const amount = parseUnits(amountUsdc, 6)
  const { updateData, fee } = await fetchPythUpdate()

  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'withdraw',
    args: [amount, updateData], value: fee, account, chain: inkSepolia,
  })
  return waitForTx(hash)
}

export async function adjustLeverage(newLeverage) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const leverageBps = Math.round(newLeverage * 10000)
  const { updateData, fee } = await fetchPythUpdate()

  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'adjustLeverage',
    args: [leverageBps, updateData], value: fee, account, chain: inkSepolia,
  })
  return waitForTx(hash)
}

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
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'depositJunior',
    args: [amount], account, chain: inkSepolia,
  })
  return waitForTx(hash)
}

export async function withdrawJunior(shares) {
  if (!ADDRESSES.vault) throw new Error('Vault not deployed')
  const account = await getAccount()
  const amount = parseUnits(shares, 18)

  const hash = await getWalletClient().writeContract({
    address: ADDRESSES.vault, abi: VAULT_ABI, functionName: 'withdrawJunior',
    args: [amount], account, chain: inkSepolia,
  })
  return waitForTx(hash)
}

// ═══════════════════════════════════════════════════════════════
// ORACLE HEALTH
// ═══════════════════════════════════════════════════════════════

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

export async function readOnChainPrice(feedId, maxAgeSec = 300) {
  if (!ADDRESSES.pythAdapter) throw new Error('Pyth adapter not deployed')
  const result = await getPublicClient().readContract({
    address: ADDRESSES.pythAdapter, abi: PYTH_ADAPTER_ABI,
    functionName: 'readPrice', args: [feedId || getActiveFeedId(), BigInt(maxAgeSec)],
  })
  return { price: Number(result[0]) / 1e8, conf: Number(result[1]) / 1e8, publishTime: Number(result[2]) }
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
  ADDRESSES, setAddress, VAULT_REGISTRY, CHAIN_CONFIGS,
  ASSET_FEED_MAP, setActiveAsset, getActiveAsset, getActiveFeedId,
  getVaultForAsset, isVaultDeployed,
  switchChain, getActiveChainId, getActiveChainConfig,
  getBalance, getAllowance, approveToken,
  getPosition, getPositionValue, getPoolState, getTWAP, getMaxLeverage, getFundingRate, getJuniorValue,
  openPosition, closePosition, adjustLeverage, depositJunior, withdrawJunior,
  getOracleHealth, readOnChainPrice,
  getExplorerUrl, getAddressExplorerUrl,
  formatPosition, formatPoolState,
  getPublicClient, getWalletClient,
}
