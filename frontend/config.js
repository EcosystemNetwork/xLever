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
  usdc:        '0xFabab97dCE620294D2B0b0e46C68964e326300Ac',
  wSPYx:       '0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e',
  wQQQx:       '0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9',
  spyVault:    '0x94CaA35F38FD11AeBBB385E9f07520FAFaD7570F',
  qqqVault:    '0xDEC80165b7F26e0EEA3c4fCF9a2B8E3D25a4f792',
  vaultFactory:'0xA589dAFBF41452c1f334F85e077116043f8220F3',
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
  // ── Canonical Vault (modular: TWAPOracle + PositionModule + FeeEngine + JuniorTranche + RiskModule) ──
  QQQ:  '0xDEC80165b7F26e0EEA3c4fCF9a2B8E3D25a4f792',
  SPY:  '0x94CaA35F38FD11AeBBB385E9f07520FAFaD7570F',
  VUG:  '0xc3127C1F354a8778430294E6FDE07fa1359aA205',
  VGK:  '0x80ce92F57DfbE6b5197BE1A237491352Db22d4B4',
  VXUS: '0x3a474227fBeDa680E88F6bEF6Fc7e16F120ad82b',
  SGOV: '0x218d6cc20b76f9c076dCaa1E68c0fCD5eDe7416f',
  SMH:  '0x336f5cBf77fA925d4E82A1f7857277b9260F99D0',
  XLE:  '0x423bCD2983326f2A628a322dF7d1edf0001C8411',
  XOP:  '0x6A0bfbf4e4Af420973C0da7662ac234e325CBdFB',
  ITA:  '0xF16060467A5941f7d19FfDAfE277A0867F0C63EA',
  AAPL: '0x12f7BcBbC4d5f53eF475ad667a5830b3CBB1e973',
  NVDA: '0x89EE351032D63e8EA9A5473A8107FB4c3572BF74',
  TSLA: '0x1A4ca4031F8f37C86a098aD769e1F5659Ac9F312',
  DELL: '0x0a5187d8Fccc4F6feaf418A3c867A6e2d2371eC3',
  SMCI: '0x0B5D43D42FAFa2B6621c6Ff6C8bB9F70F2078980',
  ANET: '0x4f1a8BD176508162fB93F5F9AdDA6ceB674D6fA9',
  VRT:  '0xD5d47be432df8712f4C2D28e9Ce148E23fCd70c2',
  SNDK: '0x9315061C7C86766C6DAB3A5f6Ba5e6c5c4c54fe3',
  KLAC: '0xf088B6395cD88CeE3793659A88021fCC1926E4Ab',
  LRCX: '0xc6904648da1bc7071F0Fd23d7Df7E1F6Db0FE381',
  AMAT: '0xAaEd0F1D182BB46eDAa3BCAB28b2545695bd4BFB',
  TER:  '0xAC60CcEe41a1CA4428926791F05B0a12C02BEDdE',
  CEG:  '0xA5D557C41e6f742D01018cD8B315abe633546b67',
  GEV:  '0xbCdC9e93a665c8ab10F0Bcf975A84f69d7327Ec5',
  SMR:  '0x76eC319af8994392fE1d28f3c1617dd2939B8167',
  ETN:  '0xD64Eeb1F907A66EEffaEb3c2f99824B2c830aa88',
  PWR:  '0x9E1b206808D21319995F6539028326CdED970Cdb',
  APLD: '0x46BAdCe00f81e8D2ab707Cf780798fD4B2F1b035',
  SLV:  '0x225CbD837050f242062D05e96bDab14C9D29E093',
  PPLT: '0x4Fd21629CA9CA2D62B2600C21470f2a018634E91',
  PALL: '0x4a073f6B10f20552A460C35F7434f208991e61ac',
  STRK: '0xC92B0fD28863f26165E29f47Ee35Cc2E967CFAf2',
  BTGO: '0x54bF86D669989C4b614c22B220Da9b6832F777A9',
}

const ETH_SEPOLIA_VAULTS = {
  // No vaults deployed on Eth Sepolia yet
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
  11155111: injectedChainVaults[11155111] || { ...ETH_SEPOLIA_VAULTS },
}

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

