/**
 * xLever Multi-Chain Lending Adapters
 * ────────────────────────────────────────────────────────────────
 * Chain-agnostic interface with protocol-specific implementations:
 *  - Euler V2 (Ink Sepolia + Ethereum Mainnet)
 *  - Kamino Finance (Solana)
 *  - EVAA Protocol (TON)
 *
 * Each adapter implements the ILendingAdapter interface so the
 * LendingAgent can operate identically across all chains.
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { Address, beginCell, toNano } from '@ton/core'
import { TonClient } from '@ton/ton'

// Heavy protocol SDKs are loaded dynamically to avoid WASM bundling issues
// and reduce initial bundle size — they're only needed for write operations.
let _kaminoSdk = null
async function loadKaminoSdk() {
  if (!_kaminoSdk) {
    const mod = await import('@kamino-finance/klend-sdk')
    const BN = (await import('bn.js')).default
    _kaminoSdk = { KaminoMarket: mod.KaminoMarket, KaminoAction: mod.KaminoAction, VanillaObligation: mod.VanillaObligation, BN }
  }
  return _kaminoSdk
}

let _evaaSdk = null
async function loadEvaaSdk() {
  if (!_evaaSdk) {
    const mod = await import('@evaafi/sdk')
    _evaaSdk = {
      EvaaMasterClassic: mod.EvaaMasterClassic,
      MAINNET_POOL_CONFIG: mod.MAINNET_POOL_CONFIG,
      TON_MAINNET: mod.TON_MAINNET,
      JUSDT_MAINNET: mod.JUSDT_MAINNET,
      JUSDC_MAINNET: mod.JUSDC_MAINNET,
      STTON_MAINNET: mod.STTON_MAINNET,
      getTonConnectSender: mod.getTonConnectSender,
      getLastSentBoc: mod.getLastSentBoc,
    }
  }
  return _evaaSdk
}

// ═══════════════════════════════════════════════════════════════
// CHAIN REGISTRY — canonical chain IDs used throughout the system
// ═══════════════════════════════════════════════════════════════

export const CHAINS = {
  INK_SEPOLIA: 'ink-sepolia',
  ETHEREUM: 'ethereum',
  SOLANA: 'solana',
  TON: 'ton',
}

export const CHAIN_CONFIG = {
  [CHAINS.INK_SEPOLIA]: {
    name: 'Ink Sepolia',
    chainId: 763373,
    protocol: 'euler-v2',
    rpc: 'https://rpc-gel-sepolia.inkonchain.com',
    explorer: 'https://explorer-sepolia.inkonchain.com',
    nativeCurrency: 'ETH',
  },
  [CHAINS.ETHEREUM]: {
    name: 'Ethereum',
    chainId: 1,
    protocol: 'euler-v2',
    rpc: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io',
    nativeCurrency: 'ETH',
  },
  [CHAINS.SOLANA]: {
    name: 'Solana',
    chainId: 'solana:mainnet',
    protocol: 'kamino',
    rpc: 'https://api.mainnet-beta.solana.com',
    explorer: 'https://solscan.io',
    nativeCurrency: 'SOL',
  },
  [CHAINS.TON]: {
    name: 'TON',
    chainId: 'ton:mainnet',
    protocol: 'evaa',
    rpc: 'https://toncenter.com/api/v2/jsonRPC',
    explorer: 'https://tonscan.org',
    nativeCurrency: 'TON',
  },
}

// ═══════════════════════════════════════════════════════════════
// ILendingAdapter — interface every chain adapter must implement
// ═══════════════════════════════════════════════════════════════

/**
 * @typedef {Object} MarketData
 * @property {string} symbol - Asset symbol
 * @property {number} supplyApy - Annual percentage yield for suppliers
 * @property {number} borrowApy - Annual percentage rate for borrowers
 * @property {number} utilization - Pool utilization ratio (0-1)
 * @property {number} totalSupply - Total supplied in USD
 * @property {number} totalBorrow - Total borrowed in USD
 * @property {number} collateralFactor - Max LTV for borrowing (0-1)
 * @property {number} liquidationThreshold - Liquidation trigger LTV (0-1)
 * @property {number} decimals - Token decimals
 */

/**
 * @typedef {Object} UserPosition
 * @property {string} chain - Chain identifier
 * @property {string} protocol - Protocol name
 * @property {Array<{asset: string, amount: number, valueUsd: number, apy: number}>} supplies
 * @property {Array<{asset: string, amount: number, valueUsd: number, apy: number}>} borrows
 * @property {number|null} healthFactor
 * @property {number} totalCollateralUsd
 * @property {number} totalDebtUsd
 * @property {number} netApy
 */

/**
 * @typedef {Object} TxResult
 * @property {boolean} success
 * @property {string} hash - Transaction hash/signature
 * @property {string} explorerUrl - Link to block explorer
 */

class ILendingAdapter {
  constructor(chain) {
    this.chain = chain
    this.config = CHAIN_CONFIG[chain]
    if (!this.config) throw new Error(`Unknown chain: ${chain}`)
  }

  /** @returns {string} Human-readable protocol name */
  get protocolName() { throw new Error('Not implemented') }

  /** @returns {boolean} Whether the adapter is ready (wallet connected, SDK loaded) */
  isReady() { throw new Error('Not implemented') }

  /** @returns {Promise<string|null>} Connected wallet address */
  async getAddress() { throw new Error('Not implemented') }

  /** @returns {Promise<Object<string, MarketData>>} All available markets */
  async getMarkets() { throw new Error('Not implemented') }

  /** @returns {Promise<UserPosition>} User's lending positions */
  async getPositions(address) { throw new Error('Not implemented') }

  /** @returns {Promise<number>} Idle stablecoin balance available to deploy */
  async getIdleBalance(address) { throw new Error('Not implemented') }

  /** @returns {Promise<TxResult>} Supply asset to lending pool */
  async supply(asset, amount) { throw new Error('Not implemented') }

  /** @returns {Promise<TxResult>} Withdraw asset from lending pool */
  async withdraw(asset, amount) { throw new Error('Not implemented') }

  /** @returns {Promise<TxResult>} Borrow asset against collateral */
  async borrow(asset, amount) { throw new Error('Not implemented') }

  /** @returns {Promise<TxResult>} Repay borrowed asset */
  async repay(asset, amount) { throw new Error('Not implemented') }

  /** @returns {string} Explorer URL for a transaction */
  explorerUrl(hash) {
    return `${this.config.explorer}/tx/${hash}`
  }
}

// ═══════════════════════════════════════════════════════════════
// EULER V2 ADAPTER (Ink Sepolia + Ethereum Mainnet)
// ═══════════════════════════════════════════════════════════════

const EULER_ADDRESSES = {
  [CHAINS.INK_SEPOLIA]: {
    evc: '0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383',
    eVaultFactory: '0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e',
    usdc: '0x6b57475467cd854d36Be7FB614caDa5207838943',
    markets: {
      USDC: { vault: '0x6b57475467cd854d36Be7FB614caDa5207838943', decimals: 6 },
      wQQQx: { vault: '0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9', decimals: 18 },
      wSPYx: { vault: '0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e', decimals: 18 },
      WETH: { vault: null, decimals: 18 },
    },
  },
  [CHAINS.ETHEREUM]: {
    evc: '0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383',
    eVaultFactory: '0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    markets: {
      USDC: { vault: '0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9', decimals: 6 },
      WETH: { vault: '0xD8b27CF359b7D15710a5BE299AF6e7Bf904984C2', decimals: 18 },
      wstETH: { vault: '0xbC4B4AC47582c3AA228917616B53b543b0367b0a', decimals: 18 },
      USDT: { vault: '0x313603FA690301b0CaeEf8069c065862f9162162', decimals: 6 },
    },
  },
}

// Minimal Euler V2 eVault ABI for lending operations
const EVAULT_ABI = [
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'withdraw', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'borrow', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'repay', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'debtOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalBorrows', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'interestRate', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'accountLiquidity', inputs: [{ name: 'account', type: 'address' }, { name: 'liquidation', type: 'bool' }], outputs: [{ name: 'collateral', type: 'uint256' }, { name: 'liability', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'interestAccrued', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'interestRateModel', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'asset', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'convertToAssets', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'convertToShares', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'maxDeposit', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'maxWithdraw', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
]

const ERC20_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
]

class EulerV2Adapter extends ILendingAdapter {
  constructor(chain) {
    super(chain)
    this.addresses = EULER_ADDRESSES[chain]
    if (!this.addresses) throw new Error(`Euler V2 not configured for ${chain}`)
  }

  get protocolName() { return 'Euler V2' }

  isReady() {
    // viem is loaded and wallet is available
    return !!window.xLeverContracts && !!this.addresses
  }

  async getAddress() {
    const contracts = window.xLeverContracts
    if (!contracts) return null
    const wc = contracts.getWalletClient()
    if (!wc) return null
    const [addr] = await wc.getAddresses()
    return addr || null
  }

  async getMarkets() {
    // Fetch from backend which aggregates on-chain data
    try {
      const res = await fetch(`/api/lending/markets?chain=${this.chain}`)
      if (res.ok) return await res.json()
    } catch { /* fall through */ }

    // Fallback: read directly from eVaults
    const markets = {}
    const pc = window.xLeverContracts?.getPublicClient()
    if (!pc) return markets

    for (const [symbol, config] of Object.entries(this.addresses.markets)) {
      if (!config.vault) continue
      try {
        const [totalSupply, totalBorrows] = await this._retry(() => Promise.all([
          pc.readContract({ address: config.vault, abi: EVAULT_ABI, functionName: 'totalSupply' }),
          pc.readContract({ address: config.vault, abi: EVAULT_ABI, functionName: 'totalBorrows' }),
        ]))
        const supply = Number(totalSupply) / (10 ** config.decimals)
        const borrows = Number(totalBorrows) / (10 ** config.decimals)
        const utilization = supply > 0 ? borrows / supply : 0

        markets[symbol] = {
          symbol,
          supplyApy: utilization * 8, // Simplified: real rate from interestRate()
          borrowApy: utilization * 12,
          utilization,
          totalSupply: supply,
          totalBorrow: borrows,
          collateralFactor: 0.80,
          liquidationThreshold: 0.85,
          decimals: config.decimals,
        }
      } catch { /* market may not be live yet */ }
    }
    return markets
  }

  async getPositions(address) {
    const position = {
      chain: this.chain,
      protocol: 'euler-v2',
      supplies: [],
      borrows: [],
      healthFactor: null,
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      netApy: 0,
    }

    const pc = window.xLeverContracts?.getPublicClient()
    if (!pc || !address) return position

    for (const [symbol, config] of Object.entries(this.addresses.markets)) {
      if (!config.vault) continue
      try {
        const [balance, debt] = await this._retry(() => Promise.all([
          pc.readContract({ address: config.vault, abi: EVAULT_ABI, functionName: 'balanceOf', args: [address] }),
          pc.readContract({ address: config.vault, abi: EVAULT_ABI, functionName: 'debtOf', args: [address] }).catch(() => 0n),
        ]))
        const balNum = Number(balance) / (10 ** config.decimals)
        const debtNum = Number(debt) / (10 ** config.decimals)

        if (balNum > 0) {
          position.supplies.push({ asset: symbol, amount: balNum, valueUsd: balNum, apy: 0 })
          position.totalCollateralUsd += balNum
        }
        if (debtNum > 0) {
          position.borrows.push({ asset: symbol, amount: debtNum, valueUsd: debtNum, apy: 0 })
          position.totalDebtUsd += debtNum
        }
      } catch { /* skip unavailable markets */ }
    }

    // Health factor from EVC account liquidity
    if (position.totalDebtUsd > 0) {
      position.healthFactor = (position.totalCollateralUsd * 0.85) / position.totalDebtUsd
    }

    return position
  }

  async getIdleBalance(address) {
    if (!address || !this.addresses.usdc) return 0
    try {
      const bal = await this._retry(() => window.xLeverContracts.getBalance(this.addresses.usdc, address))
      return parseFloat(bal.formatted)
    } catch { return 0 }
  }

  /**
   * Waits for a tx receipt, checks for reverts, and emits txEvents.
   * Centralizes receipt validation so supply/withdraw/borrow/repay
   * all get consistent revert detection and event-based reload.
   */
  async _waitAndValidate(pc, hash) {
    const contracts = window.xLeverContracts
    const url = this.explorerUrl(hash)
    contracts?.txEvents?.emit('submitted', { hash, explorerUrl: url })

    const receipt = await this._retry(() => pc.waitForTransactionReceipt({ hash }))
    if (receipt.status === 'reverted') {
      const err = new Error(`Transaction reverted (tx: ${hash})`)
      err._txReverted = true
      err.shortMessage = 'Transaction was mined but reverted on-chain.'
      contracts?.txEvents?.emit('failed', { hash, receipt, error: contracts?.classifyTxError?.(err) })
      throw err
    }

    contracts?.txEvents?.emit('confirmed', { hash, receipt })
    return { success: true, hash, explorerUrl: url }
  }

  async supply(asset, amount) {
    const contracts = window.xLeverContracts
    if (!contracts) throw new Error('Contracts not initialized')
    const address = await this.getAddress()
    if (!address) throw new Error('Wallet not connected')

    const config = this.addresses.markets[asset]
    if (!config?.vault) throw new Error(`No Euler vault for ${asset} on ${this.config.name}`)

    const pc = contracts.getPublicClient()
    const wc = contracts.getWalletClient()
    const amountWei = BigInt(Math.floor(amount * (10 ** config.decimals)))

    // Approve if needed
    const allowance = await this._retry(() => pc.readContract({ address: this.addresses.usdc, abi: ERC20_ABI, functionName: 'allowance', args: [address, config.vault] }))
    if (allowance < amountWei) {
      const approveTx = await this._retry(() => wc.writeContract({ address: this.addresses.usdc, abi: ERC20_ABI, functionName: 'approve', args: [config.vault, amountWei], account: address, chain: this._viemChain() }))
      await this._retry(() => pc.waitForTransactionReceipt({ hash: approveTx }))
    }

    const hash = await this._retry(() => wc.writeContract({ address: config.vault, abi: EVAULT_ABI, functionName: 'deposit', args: [amountWei, address], account: address, chain: this._viemChain() }))
    return this._waitAndValidate(pc, hash)
  }

  async withdraw(asset, amount) {
    const contracts = window.xLeverContracts
    if (!contracts) throw new Error('Contracts not initialized')
    const address = await this.getAddress()
    if (!address) throw new Error('Wallet not connected')
    const config = this.addresses.markets[asset]
    if (!config?.vault) throw new Error(`No Euler vault for ${asset} on ${this.config.name}`)

    const wc = contracts.getWalletClient()
    const pc = contracts.getPublicClient()
    const amountWei = BigInt(Math.floor(amount * (10 ** config.decimals)))

    const hash = await this._retry(() => wc.writeContract({ address: config.vault, abi: EVAULT_ABI, functionName: 'withdraw', args: [amountWei, address, address], account: address, chain: this._viemChain() }))
    return this._waitAndValidate(pc, hash)
  }

  async borrow(asset, amount) {
    const contracts = window.xLeverContracts
    if (!contracts) throw new Error('Contracts not initialized')
    const address = await this.getAddress()
    const config = this.addresses.markets[asset]
    if (!config?.vault) throw new Error(`No Euler vault for ${asset} on ${this.config.name}`)

    const wc = contracts.getWalletClient()
    const pc = contracts.getPublicClient()
    const amountWei = BigInt(Math.floor(amount * (10 ** config.decimals)))

    const hash = await this._retry(() => wc.writeContract({ address: config.vault, abi: EVAULT_ABI, functionName: 'borrow', args: [amountWei, address], account: address, chain: this._viemChain() }))
    return this._waitAndValidate(pc, hash)
  }

  async repay(asset, amount) {
    const contracts = window.xLeverContracts
    if (!contracts) throw new Error('Contracts not initialized')
    const address = await this.getAddress()
    const config = this.addresses.markets[asset]
    if (!config?.vault) throw new Error(`No Euler vault for ${asset} on ${this.config.name}`)

    const wc = contracts.getWalletClient()
    const pc = contracts.getPublicClient()
    const amountWei = BigInt(Math.floor(amount * (10 ** config.decimals)))

    // Approve repayment
    const allowance = await this._retry(() => pc.readContract({ address: this.addresses.usdc, abi: ERC20_ABI, functionName: 'allowance', args: [address, config.vault] }))
    if (allowance < amountWei) {
      const approveTx = await this._retry(() => wc.writeContract({ address: this.addresses.usdc, abi: ERC20_ABI, functionName: 'approve', args: [config.vault, amountWei], account: address, chain: this._viemChain() }))
      await this._retry(() => pc.waitForTransactionReceipt({ hash: approveTx }))
    }

    const hash = await this._retry(() => wc.writeContract({ address: config.vault, abi: EVAULT_ABI, functionName: 'repay', args: [amountWei, address], account: address, chain: this._viemChain() }))
    return this._waitAndValidate(pc, hash)
  }

  /**
   * Retry wrapper with exponential backoff for RPC calls.
   * Handles Ink Sepolia rate limiting (HTTP 429) and transient errors.
   * @param {Function} fn - Async function to retry
   * @param {number} [maxAttempts=3] - Maximum number of attempts
   * @returns {Promise<*>} Result of the function call
   */
  async _retry(fn, maxAttempts = 3) {
    const delays = [1000, 2000, 4000] // exponential backoff: 1s, 2s, 4s
    let lastError
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        const isRetryable = err?.status === 429 ||
          err?.code === 'TIMEOUT' ||
          err?.message?.includes('rate limit') ||
          err?.message?.includes('Too Many Requests') ||
          err?.message?.includes('ECONNRESET') ||
          err?.message?.includes('fetch failed')
        if (!isRetryable || attempt === maxAttempts - 1) throw err
        const delay = delays[attempt] || delays[delays.length - 1]
        console.warn(`[EulerV2] RPC call failed (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delay}ms...`, err.message)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    throw lastError
  }

  _viemChain() {
    if (this.chain === CHAINS.ETHEREUM) {
      return { id: 1, name: 'Ethereum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [this.config.rpc] } } }
    }
    // Ink Sepolia
    return { id: 763373, name: 'Ink Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [this.config.rpc] } } }
  }
}

// ═══════════════════════════════════════════════════════════════
// KAMINO ADAPTER (Solana)
// Uses @solana/web3.js + Kamino Lending SDK for supply/borrow
// ═══════════════════════════════════════════════════════════════

// Kamino Lending program and market addresses on Solana mainnet
const KAMINO_CONFIG = {
  lendingProgram: 'KLend2g3cP87ber41GJ3WVkTMWVMeM6moVsoDPGVDNR6',
  mainMarket: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
  markets: {
    USDC: {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      reserve: 'D6q6wuQSrifJKZYpR1M8R4YawnLDzrkH8b38tNPoS2yt',
      decimals: 6,
      collateralFactor: 0.85,
      liquidationThreshold: 0.90,
    },
    SOL: {
      mint: 'So11111111111111111111111111111111111111112',
      reserve: 'd4A2prbA2nCUQC27b7D79iFKfUZVtahtz5JHzAMhQ7i',
      decimals: 9,
      collateralFactor: 0.75,
      liquidationThreshold: 0.85,
    },
    USDT: {
      mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      reserve: 'H3t6qZ1JkguCNTi6SEVa7cDGXNTkLKJHEQT9zh8fP2Cz',
      decimals: 6,
      collateralFactor: 0.80,
      liquidationThreshold: 0.88,
    },
    JitoSOL: {
      mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
      reserve: 'EVbyPKrHdEYjkwijMVKS2jSJFNHfDKdUGmT4VTRn6WkP',
      decimals: 9,
      collateralFactor: 0.70,
      liquidationThreshold: 0.80,
    },
  },
}

class KaminoAdapter extends ILendingAdapter {
  constructor() {
    super(CHAINS.SOLANA)
    this._connection = null
    this._wallet = null
  }

  get protocolName() { return 'Kamino Finance' }

  isReady() {
    return !!this._getProvider()
  }

  _getProvider() {
    // Phantom, Solflare, or any Solana wallet injected by Reown AppKit
    return window.solana || window.phantom?.solana || null
  }

  _getConnection() {
    if (!this._connection) {
      this._connection = new Connection(this.config.rpc, 'confirmed')
    }
    return this._connection
  }

  async getAddress() {
    const provider = this._getProvider()
    if (!provider?.publicKey) return null
    return provider.publicKey.toString()
  }

  async getMarkets() {
    // Fetch from xLever backend which caches Kamino on-chain data
    try {
      const res = await fetch(`/api/lending/markets?chain=${this.chain}`)
      if (res.ok) return await res.json()
    } catch { /* fall through */ }

    // Fallback: return static config with estimated rates
    const markets = {}
    for (const [symbol, config] of Object.entries(KAMINO_CONFIG.markets)) {
      markets[symbol] = {
        symbol,
        supplyApy: 0,
        borrowApy: 0,
        utilization: 0,
        totalSupply: 0,
        totalBorrow: 0,
        collateralFactor: config.collateralFactor,
        liquidationThreshold: config.liquidationThreshold,
        decimals: config.decimals,
      }
    }
    return markets
  }

  async getPositions(address) {
    const position = {
      chain: this.chain,
      protocol: 'kamino',
      supplies: [],
      borrows: [],
      healthFactor: null,
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      netApy: 0,
    }

    try {
      const res = await fetch(`/api/lending/positions/${address}?chain=${this.chain}`)
      if (res.ok) {
        const data = await res.json()
        position.supplies = data.supplies || []
        position.borrows = data.borrows || []
        position.healthFactor = data.healthFactor
        position.totalCollateralUsd = data.totalCollateralUsd || 0
        position.totalDebtUsd = data.totalDebtUsd || 0
        position.netApy = data.netApy || 0
      }
    } catch { /* degrade gracefully */ }

    return position
  }

  async getIdleBalance(address) {
    const conn = this._getConnection()
    if (!conn || !address) return 0

    try {
      const usdcMint = new PublicKey(KAMINO_CONFIG.markets.USDC.mint)
      const ownerPk = new PublicKey(address)
      const tokenAccounts = await conn.getParsedTokenAccountsByOwner(ownerPk, { mint: usdcMint })
      if (tokenAccounts.value.length > 0) {
        return tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0
      }
      return 0
    } catch { return 0 }
  }

  // ─── Transaction methods (Kamino Lending SDK) ───────────────

  async _loadMarket() {
    const { KaminoMarket } = await loadKaminoSdk()
    const conn = this._getConnection()
    const market = await KaminoMarket.load(
      conn,
      new PublicKey(KAMINO_CONFIG.mainMarket),
      400,
      new PublicKey(KAMINO_CONFIG.lendingProgram),
      true
    )
    if (!market) throw new Error('Failed to load Kamino market')
    return market
  }

  async _buildAndSend(actionBuilder) {
    const { KaminoAction, VanillaObligation } = await loadKaminoSdk()
    const provider = this._getProvider()
    if (!provider?.publicKey) throw new Error('Solana wallet not connected')

    const market = await this._loadMarket()
    const owner = provider.publicKey
    const obligation = new VanillaObligation(new PublicKey(KAMINO_CONFIG.lendingProgram))

    const action = await actionBuilder(market, owner, obligation)
    const ixs = KaminoAction.actionToIxs(action)
    const conn = this._getConnection()
    const { blockhash } = await conn.getLatestBlockhash('confirmed')

    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: owner })
    tx.add(...ixs)

    const signed = await provider.signTransaction(tx)
    const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false })
    await conn.confirmTransaction(sig, 'confirmed')
    return sig
  }

  async supply(asset, amount) {
    const { KaminoAction, BN } = await loadKaminoSdk()
    const config = KAMINO_CONFIG.markets[asset]
    if (!config) throw new Error(`Kamino market not found for ${asset}`)
    const rawAmount = new BN(Math.floor(amount * 10 ** config.decimals))
    return this._buildAndSend((market, owner, obligation) =>
      KaminoAction.buildDepositTxns(
        market, rawAmount, new PublicKey(config.mint), owner, obligation,
        false, undefined, 0, true, false,
        { skipInitialization: false, skipLutCreation: false }
      )
    )
  }

  async withdraw(asset, amount) {
    const { KaminoAction, BN } = await loadKaminoSdk()
    const config = KAMINO_CONFIG.markets[asset]
    if (!config) throw new Error(`Kamino market not found for ${asset}`)
    const rawAmount = new BN(Math.floor(amount * 10 ** config.decimals))
    return this._buildAndSend((market, owner, obligation) =>
      KaminoAction.buildWithdrawTxns(
        market, rawAmount, new PublicKey(config.mint), owner, obligation,
        false, undefined, 0, true, false,
        { skipInitialization: false, skipLutCreation: false }
      )
    )
  }

  async borrow(asset, amount) {
    const { KaminoAction, BN } = await loadKaminoSdk()
    const config = KAMINO_CONFIG.markets[asset]
    if (!config) throw new Error(`Kamino market not found for ${asset}`)
    const rawAmount = new BN(Math.floor(amount * 10 ** config.decimals))
    return this._buildAndSend((market, owner, obligation) =>
      KaminoAction.buildBorrowTxns(
        market, rawAmount, new PublicKey(config.mint), owner, obligation,
        false, undefined, 0, true, false,
        { skipInitialization: false, skipLutCreation: false }
      )
    )
  }

  async repay(asset, amount) {
    const { KaminoAction, BN } = await loadKaminoSdk()
    const config = KAMINO_CONFIG.markets[asset]
    if (!config) throw new Error(`Kamino market not found for ${asset}`)
    const rawAmount = new BN(Math.floor(amount * 10 ** config.decimals))
    const conn = this._getConnection()
    const slot = await conn.getSlot('confirmed')
    return this._buildAndSend((market, owner, obligation) =>
      KaminoAction.buildRepayTxns(
        market, rawAmount, new PublicKey(config.mint), owner, obligation,
        false, undefined, slot, undefined, 0, true, false,
        { skipInitialization: false, skipLutCreation: false }
      )
    )
  }

  explorerUrl(hash) {
    return `${this.config.explorer}/tx/${hash}`
  }
}

// ═══════════════════════════════════════════════════════════════
// EVAA ADAPTER (TON)
// Uses @ton/ton SDK for supply/borrow on EVAA Protocol
// ═══════════════════════════════════════════════════════════════

const EVAA_CONFIG = {
  // EVAA master contract on TON mainnet
  masterAddress: 'EQC8rUZqR_pWV1BylWUlPNBzyiTYVoBEmQkMIQDZXICfnuRr',
  markets: {
    TON: {
      poolId: 0,
      decimals: 9,
      collateralFactor: 0.75,
      liquidationThreshold: 0.82,
    },
    USDT: {
      // jUSDT jetton on TON
      jettonMaster: 'EQBynBO23ywHy_CgarY9NK9FTz0yDRg00_EXvfg5LMGdig',
      poolId: 1,
      decimals: 6,
      collateralFactor: 0.85,
      liquidationThreshold: 0.90,
    },
    USDC: {
      // jUSDC jetton on TON
      jettonMaster: 'EQB-MPwrd1G6WKNkLz_VnV6WCz-4XhR3vKEcqIwuwMY-anon',
      poolId: 2,
      decimals: 6,
      collateralFactor: 0.85,
      liquidationThreshold: 0.90,
    },
    stTON: {
      jettonMaster: 'EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k',
      poolId: 3,
      decimals: 9,
      collateralFactor: 0.65,
      liquidationThreshold: 0.75,
    },
  },
}

class EvaaAdapter extends ILendingAdapter {
  constructor() {
    super(CHAINS.TON)
    this._client = null
  }

  get protocolName() { return 'EVAA Protocol' }

  isReady() {
    return !!this._getProvider()
  }

  _getProvider() {
    // TonConnect or TON wallet injected by Reown AppKit
    return window.tonConnectUI || window.ton || null
  }

  _getTonClient() {
    if (!this._client) {
      this._client = new TonClient({ endpoint: this.config.rpc })
    }
    return this._client
  }

  async getAddress() {
    const provider = this._getProvider()
    if (!provider) return null
    // TonConnect stores connected wallet
    if (provider.account?.address) return provider.account.address
    if (provider.wallet?.account?.address) return provider.wallet.account.address
    return null
  }

  async getMarkets() {
    try {
      const res = await fetch(`/api/lending/markets?chain=${this.chain}`)
      if (res.ok) return await res.json()
    } catch { /* fall through */ }

    // Fallback: return config-based skeleton
    const markets = {}
    for (const [symbol, config] of Object.entries(EVAA_CONFIG.markets)) {
      markets[symbol] = {
        symbol,
        supplyApy: 0,
        borrowApy: 0,
        utilization: 0,
        totalSupply: 0,
        totalBorrow: 0,
        collateralFactor: config.collateralFactor,
        liquidationThreshold: config.liquidationThreshold,
        decimals: config.decimals,
      }
    }
    return markets
  }

  async getPositions(address) {
    const position = {
      chain: this.chain,
      protocol: 'evaa',
      supplies: [],
      borrows: [],
      healthFactor: null,
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      netApy: 0,
    }

    try {
      const res = await fetch(`/api/lending/positions/${address}?chain=${this.chain}`)
      if (res.ok) {
        const data = await res.json()
        position.supplies = data.supplies || []
        position.borrows = data.borrows || []
        position.healthFactor = data.healthFactor
        position.totalCollateralUsd = data.totalCollateralUsd || 0
        position.totalDebtUsd = data.totalDebtUsd || 0
        position.netApy = data.netApy || 0
      }
    } catch { /* degrade gracefully */ }

    return position
  }

  async getIdleBalance(address) {
    const client = this._getTonClient()
    if (!client || !address) return 0

    try {
      const addr = Address.parse(address)
      const balance = await client.getBalance(addr)
      return Number(balance) / 1e9
    } catch { /* degrade */ }
    return 0
  }

  // ─── Transaction methods (EVAA SDK) ─────────────────────────

  async _getPoolAsset(asset) {
    const sdk = await loadEvaaSdk()
    const map = {
      TON: sdk.TON_MAINNET,
      USDT: sdk.JUSDT_MAINNET,
      USDC: sdk.JUSDC_MAINNET,
      stTON: sdk.STTON_MAINNET,
    }
    const poolAsset = map[asset]
    if (!poolAsset) throw new Error(`EVAA asset config not found for ${asset}`)
    return poolAsset
  }

  async _getMaster() {
    const { EvaaMasterClassic, MAINNET_POOL_CONFIG } = await loadEvaaSdk()
    return new EvaaMasterClassic({ poolConfig: MAINNET_POOL_CONFIG })
  }

  async _getSender() {
    const { getTonConnectSender } = await loadEvaaSdk()
    const provider = this._getProvider()
    if (!provider) throw new Error('TON wallet not connected')
    return getTonConnectSender(provider)
  }

  async supply(asset, amount) {
    const sdk = await loadEvaaSdk()
    const config = EVAA_CONFIG.markets[asset]
    if (!config) throw new Error(`EVAA market not found for ${asset}`)
    const poolAsset = await this._getPoolAsset(asset)
    const sender = await this._getSender()
    const userAddr = Address.parse(await this.getAddress())
    const rawAmount = BigInt(Math.floor(amount * 10 ** config.decimals))

    const master = await this._getMaster()
    const client = this._getTonClient()
    const contract = client.open(master)

    await contract.sendSupply(sender, toNano('0.3'), {
      asset: poolAsset,
      queryID: 0n,
      includeUserCode: true,
      amount: rawAmount,
      userAddress: userAddr,
      responseAddress: userAddr,
      payload: beginCell().endCell(),
    })

    return sdk.getLastSentBoc()
  }

  async withdraw(asset, amount) {
    const sdk = await loadEvaaSdk()
    const config = EVAA_CONFIG.markets[asset]
    if (!config) throw new Error(`EVAA market not found for ${asset}`)
    const poolAsset = await this._getPoolAsset(asset)
    const sender = await this._getSender()
    const userAddr = Address.parse(await this.getAddress())
    const rawAmount = BigInt(Math.floor(amount * 10 ** config.decimals))

    const master = await this._getMaster()
    const client = this._getTonClient()
    const contract = client.open(master)

    await contract.sendWithdraw(sender, toNano('0.5'), {
      queryID: 0n,
      amount: rawAmount,
      userAddress: userAddr,
      includeUserCode: true,
      asset: poolAsset,
      payload: beginCell().endCell(),
      amountToTransfer: rawAmount,
      customPayloadSaturationFlag: false,
      returnRepayRemainingsFlag: false,
    })

    return sdk.getLastSentBoc()
  }

  async borrow(asset, amount) {
    const sdk = await loadEvaaSdk()
    const config = EVAA_CONFIG.markets[asset]
    if (!config) throw new Error(`EVAA market not found for ${asset}`)
    const poolAsset = await this._getPoolAsset(asset)
    const sender = await this._getSender()
    const userAddr = Address.parse(await this.getAddress())
    const rawAmount = BigInt(Math.floor(amount * 10 ** config.decimals))

    // EVAA borrow = supply-withdraw with 0 supply, withdraw the borrowed asset
    const master = await this._getMaster()
    const client = this._getTonClient()
    const contract = client.open(master)

    await contract.sendSupplyWithdraw(sender, toNano('0.5'), {
      queryID: 0n,
      supplyAmount: 0n,
      supplyAsset: sdk.TON_MAINNET,
      withdrawAmount: rawAmount,
      withdrawAsset: poolAsset,
      withdrawRecipient: userAddr,
      includeUserCode: true,
      payload: beginCell().endCell(),
    })

    return sdk.getLastSentBoc()
  }

  async repay(asset, amount) {
    const sdk = await loadEvaaSdk()
    const config = EVAA_CONFIG.markets[asset]
    if (!config) throw new Error(`EVAA market not found for ${asset}`)
    const poolAsset = await this._getPoolAsset(asset)
    const sender = await this._getSender()
    const userAddr = Address.parse(await this.getAddress())
    const rawAmount = BigInt(Math.floor(amount * 10 ** config.decimals))

    // EVAA repay = supply the debt asset back (same as supply operation)
    const master = await this._getMaster()
    const client = this._getTonClient()
    const contract = client.open(master)

    await contract.sendSupply(sender, toNano('0.3'), {
      asset: poolAsset,
      queryID: 0n,
      includeUserCode: true,
      amount: rawAmount,
      userAddress: userAddr,
      responseAddress: userAddr,
      payload: beginCell().endCell(),
      returnRepayRemainingsFlag: true,
    })

    return sdk.getLastSentBoc()
  }

  explorerUrl(hash) {
    return `${this.config.explorer}/tx/${hash}`
  }
}

// ═══════════════════════════════════════════════════════════════
// ADAPTER REGISTRY — factory + manager for all chain adapters
// ═══════════════════════════════════════════════════════════════

class LendingAdapterRegistry {
  constructor() {
    this._adapters = new Map()
    this._activeChain = CHAINS.INK_SEPOLIA
  }

  /** Register all supported adapters */
  init() {
    this._adapters.set(CHAINS.INK_SEPOLIA, new EulerV2Adapter(CHAINS.INK_SEPOLIA))
    this._adapters.set(CHAINS.ETHEREUM, new EulerV2Adapter(CHAINS.ETHEREUM))
    this._adapters.set(CHAINS.SOLANA, new KaminoAdapter())
    this._adapters.set(CHAINS.TON, new EvaaAdapter())
    return this
  }

  /** Get adapter for a specific chain */
  get(chain) {
    const adapter = this._adapters.get(chain)
    if (!adapter) throw new Error(`No adapter for chain: ${chain}`)
    return adapter
  }

  /** Get the currently active chain's adapter */
  active() {
    return this.get(this._activeChain)
  }

  /** Switch active chain */
  setActiveChain(chain) {
    if (!this._adapters.has(chain)) throw new Error(`No adapter for chain: ${chain}`)
    this._activeChain = chain
  }

  /** Get active chain ID */
  getActiveChain() {
    return this._activeChain
  }

  /** Get all registered chain IDs */
  chains() {
    return Array.from(this._adapters.keys())
  }

  /** Get all adapters */
  all() {
    return this._adapters
  }

  /**
   * Aggregate positions across ALL chains for a given set of addresses.
   * @param {Object} addresses - Map of chain → wallet address
   * @returns {Promise<UserPosition[]>} Positions from every chain
   */
  async getAllPositions(addresses) {
    const results = await Promise.allSettled(
      this.chains().map(async chain => {
        const addr = addresses[chain]
        if (!addr) return null
        const adapter = this.get(chain)
        return adapter.getPositions(addr)
      })
    )
    return results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
  }

  /**
   * Aggregate markets across ALL chains.
   * @returns {Promise<Object>} Markets keyed by chain
   */
  async getAllMarkets() {
    const marketsByChain = {}
    const results = await Promise.allSettled(
      this.chains().map(async chain => {
        const adapter = this.get(chain)
        const markets = await adapter.getMarkets()
        return { chain, markets }
      })
    )
    for (const r of results) {
      if (r.status === 'fulfilled') {
        marketsByChain[r.value.chain] = r.value.markets
      }
    }
    return marketsByChain
  }

  /**
   * Map AppKit network change events to xLever chain IDs.
   * Called from nav.js when user switches networks.
   */
  resolveChainFromNetwork(networkIdOrCaip) {
    if (networkIdOrCaip === 763373) return CHAINS.INK_SEPOLIA
    if (networkIdOrCaip === 1) return CHAINS.ETHEREUM
    if (networkIdOrCaip === 'solana:mainnet') return CHAINS.SOLANA
    if (networkIdOrCaip === 'ton:mainnet') return CHAINS.TON
    return null
  }
}

// Create and expose singleton
const registry = new LendingAdapterRegistry().init()

window.xLeverLendingAdapters = registry

export {
  ILendingAdapter,
  EulerV2Adapter,
  KaminoAdapter,
  EvaaAdapter,
  LendingAdapterRegistry,
  KAMINO_CONFIG,
  EVAA_CONFIG,
  EULER_ADDRESSES,
}

export default registry
