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
  spyVault:    '0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228',
  qqqVault:    '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
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
  // ── Deployed Vaults (on-chain verified) ──
  QQQ:  '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6',
  SPY:  '0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228',
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

