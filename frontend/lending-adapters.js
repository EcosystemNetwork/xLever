/**
 * xLever Lending Adapters
 * ────────────────────────────────────────────────────────────────
 * Euler V2 adapter for EVM chains (Ink Sepolia + Ethereum Sepolia).
 * Implements the ILendingAdapter interface so the LendingAgent
 * can operate identically across supported EVM chains.
 */

// ═══════════════════════════════════════════════════════════════
// CHAIN REGISTRY — canonical chain IDs used throughout the system
// ═══════════════════════════════════════════════════════════════

export const CHAINS = {
  INK_SEPOLIA: 'ink-sepolia',
  ETHEREUM: 'ethereum',
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
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    protocol: 'euler-v2',
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    nativeCurrency: 'ETH',
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

/**
 * Abstract base class defining the interface every chain lending adapter must implement.
 * Subclasses: EulerV2Adapter (Ink Sepolia, Ethereum Sepolia).
 * @abstract
 */
class ILendingAdapter {
  /**
   * @param {string} chain - Chain identifier from CHAINS enum
   * @throws {Error} If chain is not configured in CHAIN_CONFIG
   */
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

/**
 * Euler V2 lending adapter for EVM chains (Ink Sepolia, Ethereum Mainnet).
 * Uses viem for contract reads/writes via the xLeverContracts singleton.
 * Supports supply, withdraw, borrow, repay with automatic approval handling.
 * @extends ILendingAdapter
 */
class EulerV2Adapter extends ILendingAdapter {
  /**
   * @param {string} chain - CHAINS.INK_SEPOLIA or CHAINS.ETHEREUM
   * @throws {Error} If Euler V2 is not configured for the given chain
   */
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
   * Wait for a transaction receipt, check for on-chain reverts, and emit
   * txEvents for UI lifecycle tracking. Centralizes receipt validation so
   * supply/withdraw/borrow/repay all get consistent revert detection.
   * @param {Object} pc - viem public client for receipt polling
   * @param {string} hash - Transaction hash to monitor
   * @returns {Promise<TxResult>} Success result with hash and explorer URL
   * @throws {Error} If the transaction reverts on-chain
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

  /**
   * Build a minimal viem chain definition for writeContract calls.
   * @returns {Object} Chain config with id, name, nativeCurrency, and rpcUrls
   * @private
   */
  _viemChain() {
    if (this.chain === CHAINS.ETHEREUM) {
      return { id: 1, name: 'Ethereum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [this.config.rpc] } } }
    }
    // Ink Sepolia
    return { id: 763373, name: 'Ink Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [this.config.rpc] } } }
  }
}

// ═══════════════════════════════════════════════════════════════
// ADAPTER REGISTRY — factory + manager for all chain adapters
// ═══════════════════════════════════════════════════════════════

/**
 * Factory and manager for all chain lending adapters.
 * Provides a unified interface to switch between chains, query markets
 * across all chains, and resolve network change events to chain IDs.
 *
 * Usage:
 *   const registry = new LendingAdapterRegistry().init()
 *   registry.setActiveChain('ethereum')
 *   const adapter = registry.active()
 *   const markets = await adapter.getMarkets()
 */
class LendingAdapterRegistry {
  constructor() {
    this._adapters = new Map()
    this._activeChain = CHAINS.INK_SEPOLIA
  }

  /**
   * Register all supported chain adapters (Euler V2 on Ink Sepolia + Ethereum Sepolia).
   * @returns {LendingAdapterRegistry} This instance for chaining
   */
  init() {
    this._adapters.set(CHAINS.INK_SEPOLIA, new EulerV2Adapter(CHAINS.INK_SEPOLIA))
    this._adapters.set(CHAINS.ETHEREUM, new EulerV2Adapter(CHAINS.ETHEREUM))
    return this
  }

  /**
   * Get the lending adapter for a specific chain.
   * @param {string} chain - Chain identifier from CHAINS enum
   * @returns {ILendingAdapter} The chain's adapter instance
   * @throws {Error} If no adapter is registered for the chain
   */
  get(chain) {
    const adapter = this._adapters.get(chain)
    if (!adapter) throw new Error(`No adapter for chain: ${chain}`)
    return adapter
  }

  /**
   * Get the currently active chain's lending adapter.
   * @returns {ILendingAdapter} The active adapter instance
   */
  active() {
    return this.get(this._activeChain)
  }

  /**
   * Switch the active chain. Subsequent calls to active() will return
   * the adapter for this chain.
   * @param {string} chain - Chain identifier from CHAINS enum
   * @throws {Error} If no adapter is registered for the chain
   */
  setActiveChain(chain) {
    if (!this._adapters.has(chain)) throw new Error(`No adapter for chain: ${chain}`)
    this._activeChain = chain
  }

  /**
   * Get the currently active chain identifier.
   * @returns {string} Chain ID from CHAINS enum
   */
  getActiveChain() {
    return this._activeChain
  }

  /**
   * Get all registered chain identifiers.
   * @returns {string[]} Array of chain IDs from CHAINS enum
   */
  chains() {
    return Array.from(this._adapters.keys())
  }

  /**
   * Get the full adapter map for direct iteration.
   * @returns {Map<string, ILendingAdapter>} Map of chain ID to adapter instance
   */
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
   * Look up the vault address for an asset on the active chain.
   * Delegates to the active adapter's getVaultForAsset if available,
   * otherwise falls back to the EVM VAULT_REGISTRY via contracts.js.
   * @param {string} symbol - Ticker symbol (e.g., 'QQQ', 'SPY')
   * @returns {string|null} Vault address/program ID, or null if not deployed
   */
  getVaultForAsset(symbol) {
    const adapter = this.active()
    if (typeof adapter.getVaultForAsset === 'function') return adapter.getVaultForAsset(symbol)
    // EVM adapters fall through to contracts.js getVaultForAsset
    if (window.xLeverContracts?.getVaultForAsset) return window.xLeverContracts.getVaultForAsset(symbol)
    return null
  }

  /**
   * Map Reown AppKit network change events to xLever chain IDs.
   * Called from nav.js when the user switches networks in the wallet.
   * @param {number|string} networkIdOrCaip - Numeric chain ID (e.g., 763373, 11155111)
   * @returns {string|null} Matching CHAINS enum value, or null if unrecognized
   */
  resolveChainFromNetwork(networkIdOrCaip) {
    if (networkIdOrCaip === 763373) return CHAINS.INK_SEPOLIA
    if (networkIdOrCaip === 1 || networkIdOrCaip === 11155111) return CHAINS.ETHEREUM
    return null
  }
}

// Create and expose singleton
const registry = new LendingAdapterRegistry().init()

window.xLeverLendingAdapters = registry

export {
  ILendingAdapter,
  EulerV2Adapter,
  LendingAdapterRegistry,
  EULER_ADDRESSES,
}

export default registry
