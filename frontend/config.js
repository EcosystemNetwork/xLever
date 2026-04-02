/**
 * @file config.js — Environment-aware configuration for xLever frontend
 *
 * Loads contract addresses and chain config from:
 *   1. window.__XLEVER_CONFIG__ (injected by deployment/server at build/serve time)
 *   2. Hardcoded testnet defaults (Ink Sepolia) as fallback
 *
 * In production, the serving layer (Vercel, Nginx, etc.) should inject a script tag:
 *   <script>window.__XLEVER_CONFIG__ = { addresses: {...}, chainId: 763373 }</script>
 * BEFORE loading any module scripts.
 *
 * @module config
 */

const injected = window.__XLEVER_CONFIG__ || {}

/**
 * Active chain ID. Override via window.__XLEVER_CONFIG__.chainId
 * @type {number}
 */
export const CHAIN_ID = injected.chainId || 763373

/**
 * Contract addresses. Override any/all via window.__XLEVER_CONFIG__.addresses
 * @type {Object}
 */
export const CONTRACT_ADDRESSES = {
  evc:         '0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c',
  usdc:        '0x6b57475467cd854d36Be7FB614caDa5207838943',
  wSPYx:       '0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e',
  wQQQx:       '0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9',
  spyVault:    '0x6bbb5fe4f82b14bd29fd8d7b9cc1f45a6e19c3dd',
  qqqVault:    '0xd76378af8494eafa6251d13dcbcaa4f39e70b90b',
  pyth:        '0x2880aB155794e7179c9eE2e38200202908C17B43',
  pythAdapter: '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f',
  euler: {
    evc:            '0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383',
    eVaultFactory:  '0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e',
    protocolConfig: '0x4cD6BF1D183264c02Be7748Cb5cd3A47d013351b',
    permit2:        '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  xstocks: {
    QQQx: '0xa753a7395cae905cd615da0b82a53e0560f250af',
    SPYx: '0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48',
  },
  // Spread injected overrides on top of defaults
  ...(injected.addresses || {}),
}

/**
 * Vault registry — maps ticker symbol to deployed vault address.
 * Override via window.__XLEVER_CONFIG__.vaultRegistry
 * @type {Object<string, string>}
 */
const INK_SEPOLIA_VAULTS = {
  // ── Index ETFs ──
  QQQ:  '0xd76378af8494eafa6251d13dcbcaa4f39e70b90b',
  SPY:  '0x6bbb5fe4f82b14bd29fd8d7b9cc1f45a6e19c3dd',
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

// Default: Ink Sepolia is the canonical source; override per-chain via injected config
export const VAULT_REGISTRY_CONFIG = injected.vaultRegistry || INK_SEPOLIA_VAULTS

/**
 * Per-chain vault registries — clones the full Ink Sepolia vault set to every
 * supported EVM chain so asset selection is consistent across chains.
 * Override individual chains via window.__XLEVER_CONFIG__.chainVaults[chainId].
 * @type {Object<number, Object<string, string>>}
 */
const injectedChainVaults = injected.chainVaults || {}
export const CHAIN_VAULT_REGISTRIES = {
  763373:   injectedChainVaults[763373]   || { ...INK_SEPOLIA_VAULTS },
  11155111: injectedChainVaults[11155111] || { ...INK_SEPOLIA_VAULTS },
}

/**
 * Solana vault program IDs — maps ticker symbol to on-chain program address.
 * Kamino adapter uses these for position management on Solana.
 * Override via window.__XLEVER_CONFIG__.solanaVaults
 * @type {Object<string, string>}
 */
export const SOLANA_VAULT_REGISTRY = injected.solanaVaults || Object.fromEntries(
  Object.keys(INK_SEPOLIA_VAULTS).map(sym => [sym, `xlever_${sym.toLowerCase()}_solana`])
)

/**
 * TON vault contract addresses — maps ticker symbol to TON contract address.
 * EVAA adapter uses these for position management on TON.
 * Override via window.__XLEVER_CONFIG__.tonVaults
 * @type {Object<string, string>}
 */
export const TON_VAULT_REGISTRY = injected.tonVaults || Object.fromEntries(
  Object.keys(INK_SEPOLIA_VAULTS).map(sym => [sym, `xlever_${sym.toLowerCase()}_ton`])
)

/**
 * RPC URLs per chain. Override via window.__XLEVER_CONFIG__.rpcUrls
 * @type {Object<number, string>}
 */
export const RPC_URLS = {
  763373:   (injected.rpcUrls || {})[763373]   || 'https://rpc-gel-sepolia.inkonchain.com',
  11155111: (injected.rpcUrls || {})[11155111] || 'https://ethereum-sepolia-rpc.publicnode.com',
}

/**
 * API base URL. Override via window.__XLEVER_CONFIG__.apiBaseUrl
 * @type {string}
 */
export const API_BASE_URL = injected.apiBaseUrl || ''

/**
 * Whether this is a production deployment.
 * @type {boolean}
 */
export const IS_PRODUCTION = injected.isProduction || window.location.hostname === 'xlever.markets'

// Log config source on load
if (injected.addresses || injected.chainId) {
  console.log('[config] Using injected config:', Object.keys(injected))
} else {
  console.log('[config] Using default testnet config (Ink Sepolia)')
}
