/**
 * xLever Lending Agent — Multi-Chain Automated Lending & Borrowing
 * ────────────────────────────────────────────────────────────────
 * Chain-agnostic lending automation powered by the adapter registry:
 *  1. Monitors lending markets across Euler V2, Kamino, and EVAA
 *  2. Auto-supplies idle capital for yield on the active chain
 *  3. Manages borrow positions for leverage optimization
 *  4. Monitors health factors and auto-repays to prevent liquidation
 *  5. Rate arbitrage — moves capital between markets for best yield
 *  6. Cross-chain opportunity detection via aggregated market view
 *
 * Four policy modes: Yield, Leverage, Hedge, Monitor-Only
 * Works on: Ink Sepolia (Euler V2), Ethereum (Euler V2), Solana (Kamino), TON (EVAA)
 */

const LendingAgent = (() => {
  /** @type {number|null} Interval ID for the tick loop */
  let _interval = null
  /** @type {Object|null} Current policy config: {mode, minIdleThreshold, ...} */
  let _policy = null
  /** @type {boolean} Whether the agent is paused */
  let _paused = false
  /** @type {Function} Log callback: (category, message, level) => void */
  let _log = () => {}
  /** @type {Function} Stats callback: (stats) => void */
  let _onStats = () => {}
  /** @type {boolean} When true, actions are logged but not executed on-chain */
  let _dryRun = true
  /** @type {number} Running count of actions taken (dry or live) */
  let _actionCount = 0
  /** @type {number} Timestamp of the last tick execution */
  let _lastTickTime = 0

  // Rate limiting: minimum 5s between ticks, max 6 per minute
  /** @type {number} Minimum milliseconds between consecutive ticks */
  const MIN_TICK_GAP = 5000
  /** @type {number} Maximum ticks allowed per 60-second window */
  const MAX_TICKS_PER_MIN = 6
  /** @type {number[]} Timestamps of recent ticks for rate limit enforcement */
  let _tickTimestamps = []

  /**
   * Validates that a value is a finite number, returning the fallback if not.
   * Prevents NaN/Infinity from propagating into decision logic.
   * @param {*} val - Value to validate
   * @param {number} [fallback=0] - Default if val is not a finite number
   * @returns {number} A guaranteed finite number
   */
  function _safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }

  // ═══════════════════════════════════════════════════════════════
  // ADAPTER ACCESS — lazy reference to the registry singleton
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get a lazy reference to the LendingAdapterRegistry singleton.
   * @returns {LendingAdapterRegistry|null}
   * @private
   */
  function _getRegistry() {
    return window.xLeverLendingAdapters || null
  }

  /**
   * Get the currently active chain's lending adapter.
   * @returns {ILendingAdapter|null}
   * @private
   */
  function _getAdapter() {
    const reg = _getRegistry()
    return reg ? reg.active() : null
  }

  // ═══════════════════════════════════════════════════════════════
  // PERMISSION BOUNDARIES (code-enforced, not just UI)
  // ═══════════════════════════════════════════════════════════════

  const PERMISSIONS = {
    yield: {
      canSupply: true,
      canWithdraw: true,
      canBorrow: false,
      canRepay: false,
      canMoveMarkets: true,
      canLeverage: false,
    },
    leverage: {
      canSupply: true,
      canWithdraw: false,
      canBorrow: true,
      canRepay: true,
      canMoveMarkets: false,
      canLeverage: true,
    },
    hedge: {
      canSupply: true,
      canWithdraw: true,
      canBorrow: true,
      canRepay: true,
      canMoveMarkets: false,
      canLeverage: false,
    },
    monitor: {
      canSupply: false,
      canWithdraw: false,
      canBorrow: false,
      canRepay: false,
      canMoveMarkets: false,
      canLeverage: false,
    },
  }

  // ═══════════════════════════════════════════════════════════════
  // LIVE STATE GATHERING (chain-agnostic via adapter)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Gather comprehensive lending state from the active chain adapter.
   * Fetches: markets, user positions, health factor, idle balance,
   * oracle price, risk state, xLever position, and cross-chain markets.
   * @returns {Promise<Object>} Aggregated lending state for decision functions
   */
  async function gatherLendingState() {
    const adapter = _getAdapter()
    const registry = _getRegistry()
    const chain = registry?.getActiveChain() || 'unknown'

    const state = {
      chain,
      protocol: adapter?.protocolName || 'unknown',
      markets: {},
      userSupplies: [],
      userBorrows: [],
      healthFactor: null,
      idleBalance: null,
      oraclePrice: null,
      riskState: null,
      xLeverPosition: null,
      crossChainMarkets: null,
    }

    if (!adapter) {
      _log('LENDING', 'No adapter available for current chain', 'error')
      return state
    }

    // 1. Fetch markets from active chain adapter
    try {
      state.markets = await adapter.getMarkets()
    } catch (e) {
      _log('LENDING', `Market data fetch failed (${chain}): ${e.message}`, 'error')
    }

    // 2. Fetch user positions via adapter
    try {
      const address = await adapter.getAddress()
      if (address) {
        state.idleBalance = await adapter.getIdleBalance(address)

        const positions = await adapter.getPositions(address)
        state.userSupplies = positions.supplies || []
        state.userBorrows = positions.borrows || []
        state.healthFactor = positions.healthFactor

        // xLever position (EVM only, for hedge coordination)
        if (window.xLeverContracts) {
          try {
            const pos = await window.xLeverContracts.getPosition(address)
            state.xLeverPosition = window.xLeverContracts.formatPosition(pos)
          } catch { /* no xLever position on this chain */ }
        }
      }
    } catch (e) {
      _log('LENDING', `Position fetch failed (${chain}): ${e.message}`, 'error')
    }

    // 3. Oracle price (Pyth — available on EVM chains)
    try {
      const pyth = window.xLeverPyth
      if (pyth) {
        const feed = pyth.PYTH_FEEDS['QQQ/USD']
        const p = await pyth.getPriceForFeed(feed)
        state.oraclePrice = p.price
      }
    } catch { /* oracle not available on this chain */ }

    // 4. Risk engine state
    try {
      if (window.xLeverRisk) {
        state.riskState = window.xLeverRisk.getState()
      }
    } catch { /* risk engine may not be initialized */ }

    // 5. Cross-chain market overview (for yield comparison)
    try {
      if (registry) {
        state.crossChainMarkets = await registry.getAllMarkets()
      }
    } catch { /* non-critical */ }

    return state
  }

  // ═══════════════════════════════════════════════════════════════
  // DECISION FUNCTIONS (one per policy mode)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Yield policy decision function.
   * Auto-supplies idle stablecoins to the best APY market, detects cross-chain
   * yield opportunities, and rebalances between markets when APY differentials
   * exceed the configured threshold.
   * @param {Object} state - Gathered lending state from gatherLendingState()
   * @param {Object} config - Policy config with thresholds (minIdleThreshold, minSupplyApy, etc.)
   * @returns {Array<Object>} Actions to execute: SUPPLY, REBALANCE
   */
  function decideYield(state, config) {
    const actions = []
    const perms = PERMISSIONS.yield

    // Auto-supply idle stablecoin if above threshold
    const idleBalance = _safeNum(state.idleBalance, 0)
    if (perms.canSupply && idleBalance > _safeNum(config.minIdleThreshold, 100)) {
      const supplyAmount = idleBalance - _safeNum(config.reserveBalance, 50)
      if (supplyAmount > 0) {
        // Find best APY market on current chain
        let bestMarket = null
        let bestApy = config.minSupplyApy || 2.0

        for (const [symbol, market] of Object.entries(state.markets || {})) {
          if (market.supplyApy > bestApy) {
            bestApy = market.supplyApy
            bestMarket = { symbol, ...market }
          }
        }

        if (bestMarket) {
          actions.push({
            type: 'SUPPLY',
            asset: bestMarket.symbol,
            amount: supplyAmount.toFixed(2),
            chain: state.chain,
            reason: `Idle balance (${state.idleBalance.toFixed(2)}) exceeds threshold. Best APY on ${state.protocol}: ${bestMarket.symbol} at ${bestMarket.supplyApy.toFixed(2)}%`,
          })
        }
      }
    }

    // Cross-chain yield alert: flag if another chain has significantly better rates
    if (state.crossChainMarkets) {
      const currentBestApy = Math.max(...Object.values(state.markets || {}).map(m => m.supplyApy || 0), 0)

      for (const [chain, markets] of Object.entries(state.crossChainMarkets)) {
        if (chain === state.chain) continue
        for (const [symbol, market] of Object.entries(markets)) {
          if (market.supplyApy > currentBestApy + (config.crossChainApyThreshold || 3.0)) {
            _log('YIELD', `Cross-chain opportunity: ${symbol} on ${chain} at ${market.supplyApy.toFixed(2)}% vs local best ${currentBestApy.toFixed(2)}%`, 'info')
          }
        }
      }
    }

    // Rebalance between markets if APY differential exceeds threshold
    if (perms.canMoveMarkets && state.userSupplies.length > 0) {
      for (const supply of state.userSupplies) {
        const currentMarket = state.markets?.[supply.asset]
        const apyDiffThreshold = config.apyDiffThreshold || 1.5

        for (const [symbol, market] of Object.entries(state.markets || {})) {
          if (symbol !== supply.asset && market.supplyApy - (currentMarket?.supplyApy || 0) > apyDiffThreshold) {
            actions.push({
              type: 'REBALANCE',
              from: supply.asset,
              to: symbol,
              amount: supply.amount,
              chain: state.chain,
              reason: `APY differential: ${market.supplyApy.toFixed(2)}% vs ${currentMarket?.supplyApy?.toFixed(2) || '?'}% (${symbol} vs ${supply.asset}) on ${state.protocol}`,
            })
          }
        }
      }
    }

    return actions
  }

  /**
   * Leverage policy decision function.
   * Auto-repays when health factor drops below minimum, supplies idle collateral,
   * and borrows against collateral when health factor allows (up to maxLeverageLoops).
   * @param {Object} state - Gathered lending state
   * @param {Object} config - Policy config with targetHealthFactor, minHealthFactor, maxLeverageLoops
   * @returns {Array<Object>} Actions to execute: REPAY, SUPPLY, BORROW
   */
  function decideLeverage(state, config) {
    const actions = []
    const perms = PERMISSIONS.leverage

    const targetHF = _safeNum(config.targetHealthFactor, 1.8)
    const minHF = _safeNum(config.minHealthFactor, 1.3)
    const maxLoops = _safeNum(config.maxLeverageLoops, 3)
    const healthFactor = state.healthFactor !== null && Number.isFinite(Number(state.healthFactor)) ? Number(state.healthFactor) : null

    // Auto-repay if health factor is dangerously low
    if (perms.canRepay && healthFactor !== null && healthFactor < minHF) {
      const urgency = healthFactor < 1.1 ? 'CRITICAL' : 'WARNING'
      actions.push({
        type: 'REPAY',
        urgency,
        chain: state.chain,
        reason: `Health factor ${healthFactor.toFixed(2)} below minimum ${minHF} on ${state.protocol}. ${urgency}: auto-repaying.`,
      })
      return actions
    }

    // Supply collateral if we have idle balance
    const idleBalance = _safeNum(state.idleBalance, 0)
    if (perms.canSupply && idleBalance > _safeNum(config.minCollateral, 200)) {
      // Determine best collateral asset for this chain
      const collateralAsset = config.collateralAsset || _defaultStable(state.chain)
      actions.push({
        type: 'SUPPLY',
        asset: collateralAsset,
        amount: idleBalance.toFixed(2),
        chain: state.chain,
        reason: `Supplying ${idleBalance.toFixed(2)} ${collateralAsset} as collateral on ${state.protocol}.`,
      })
    }

    // Borrow against collateral if health factor allows
    if (perms.canBorrow && healthFactor !== null && healthFactor > targetHF) {
      const existingBorrows = state.userBorrows?.length || 0
      if (existingBorrows < maxLoops) {
        const borrowRoom = healthFactor > 0 ? (healthFactor - targetHF) / healthFactor : 0
        const borrowAsset = config.borrowAsset || _defaultStable(state.chain)
        const collateralUsd = state.userSupplies?.reduce((sum, s) => sum + (s.valueUsd || 0), 0) || 0
        const estimatedBorrow = collateralUsd * borrowRoom
        actions.push({
          type: 'BORROW',
          asset: borrowAsset,
          amount: estimatedBorrow > 0 ? estimatedBorrow.toFixed(2) : '0',
          chain: state.chain,
          reason: `Health factor ${healthFactor.toFixed(2)} above target ${targetHF} on ${state.protocol}. Room: ${(borrowRoom * 100).toFixed(1)}%. Loop ${existingBorrows + 1}/${maxLoops}.`,
        })
      }
    }

    return actions
  }

  /**
   * Hedge policy decision function.
   * Coordinates with an active xLever position: borrows to hedge long exposure,
   * supplies stablecoins alongside short positions, and auto-repays when health drops.
   * @param {Object} state - Gathered lending state (must include xLeverPosition)
   * @param {Object} config - Policy config with hedgeRatio, hedgeMinHF, hedgeAsset
   * @returns {Array<Object>} Actions to execute: BORROW, SUPPLY, REPAY
   */
  function decideHedge(state, config) {
    const actions = []
    const perms = PERMISSIONS.hedge
    const pos = state.xLeverPosition

    if (!pos) {
      _log('LENDING', `No active xLever position to hedge on ${state.chain}`, 'info')
      return actions
    }

    const hedgeRatio = _safeNum(config.hedgeRatio, 0.5)
    const depositUsd = _safeNum(parseFloat(pos.deposit), 0)
    const leverage = _safeNum(pos.leverage, 0)
    const hedgeAmount = (depositUsd * Math.abs(leverage) * hedgeRatio).toFixed(2)

    if (pos.isLong && perms.canBorrow) {
      const hedgeAsset = config.hedgeAsset || 'wQQQx'
      actions.push({
        type: 'BORROW',
        asset: hedgeAsset,
        amount: hedgeAmount,
        chain: state.chain,
        reason: `Hedging ${(hedgeRatio * 100).toFixed(0)}% of ${pos.leverageDisplay} long ($${hedgeAmount}) via ${hedgeAsset} borrow on ${state.protocol}.`,
        hedgeRatio,
      })
    }

    if (pos.isShort && perms.canSupply && _safeNum(state.idleBalance, 0) > 0) {
      const stableAsset = _defaultStable(state.chain)
      const supplyAmount = Math.min(state.idleBalance, depositUsd).toFixed(2)
      actions.push({
        type: 'SUPPLY',
        asset: stableAsset,
        amount: supplyAmount,
        chain: state.chain,
        reason: `Supplying $${supplyAmount} ${stableAsset} to earn yield alongside ${pos.leverageDisplay} short on ${state.protocol}.`,
      })
    }

    const hf = state.healthFactor !== null && Number.isFinite(Number(state.healthFactor)) ? Number(state.healthFactor) : null
    if (perms.canRepay && hf !== null && hf < _safeNum(config.hedgeMinHF, 1.5)) {
      actions.push({
        type: 'REPAY',
        urgency: 'WARNING',
        chain: state.chain,
        reason: `Hedge health factor ${hf.toFixed(2)} dropping on ${state.protocol} — reducing borrow.`,
      })
    }

    return actions
  }

  /**
   * Monitor-only policy decision function.
   * Produces no executable actions; only logs alerts for:
   * low health factors, low APYs, high utilization, and cross-chain issues.
   * @param {Object} state - Gathered lending state
   * @param {Object} _config - Unused (monitor mode has no configurable thresholds)
   * @returns {Array} Always returns empty array (no actions)
   */
  function decideMonitor(state, _config) {
    const alerts = []

    // Health factor alerts
    if (state.healthFactor !== null) {
      if (state.healthFactor < 1.1) {
        alerts.push({ level: 'CRITICAL', message: `[${state.protocol}] Health factor critically low: ${state.healthFactor.toFixed(2)}` })
      } else if (state.healthFactor < 1.3) {
        alerts.push({ level: 'WARNING', message: `[${state.protocol}] Health factor low: ${state.healthFactor.toFixed(2)}` })
      }
    }

    // APY change alerts
    for (const [symbol, market] of Object.entries(state.markets || {})) {
      if (market.supplyApy < 0.5) {
        alerts.push({ level: 'INFO', message: `[${state.protocol}] ${symbol} supply APY dropped to ${market.supplyApy.toFixed(2)}%` })
      }
      if (market.utilization > 0.95) {
        alerts.push({ level: 'WARNING', message: `[${state.protocol}] ${symbol} utilization at ${(market.utilization * 100).toFixed(1)}%` })
      }
    }

    // Cross-chain health monitoring
    if (state.crossChainMarkets) {
      for (const [chain, markets] of Object.entries(state.crossChainMarkets)) {
        for (const [symbol, market] of Object.entries(markets)) {
          if (market.utilization > 0.95) {
            alerts.push({ level: 'WARNING', message: `[${chain}] ${symbol} utilization critical: ${(market.utilization * 100).toFixed(1)}%` })
          }
        }
      }
    }

    for (const alert of alerts) {
      _log('MONITOR', `[${alert.level}] ${alert.message}`, alert.level === 'CRITICAL' ? 'error' : 'warn')
    }

    return []
  }

  // ═══════════════════════════════════════════════════════════════
  // EXECUTION ENGINE (dispatches to active chain adapter)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Execute a single lending action via the active chain adapter.
   * In dry-run mode, logs the action without executing on-chain.
   * Supports: SUPPLY, WITHDRAW, BORROW, REPAY, REBALANCE.
   * @param {Object} action - Action descriptor with type, asset, amount, chain, reason
   * @returns {Promise<{success: boolean, dryRun?: boolean, action: Object, result?: Object, error?: string}>}
   */
  async function executeAction(action) {
    const adapter = _getAdapter()
    const chainLabel = adapter ? `${adapter.protocolName} (${adapter.config.name})` : action.chain

    _log('EXECUTE', `${_dryRun ? '[DRY RUN] ' : ''}[${chainLabel}] ${action.type}: ${action.reason}`, 'info')

    if (_dryRun) {
      _actionCount++
      _onStats({ actions: _actionCount, lastAction: action })
      return { success: true, dryRun: true, action }
    }

    if (!adapter) {
      _log('EXECUTE', 'No adapter available — cannot execute', 'error')
      return { success: false, error: 'No adapter', action }
    }

    try {
      let result
      switch (action.type) {
        case 'SUPPLY':
          result = await adapter.supply(action.asset, parseFloat(action.amount))
          _log('EXECUTE', `Supplied ${action.amount} ${action.asset} on ${chainLabel}. TX: ${result.hash}`, 'success')
          break
        case 'WITHDRAW':
          result = await adapter.withdraw(action.asset, parseFloat(action.amount))
          _log('EXECUTE', `Withdrew ${action.amount} ${action.asset} on ${chainLabel}. TX: ${result.hash}`, 'success')
          break
        case 'BORROW':
          result = await adapter.borrow(action.asset, parseFloat(action.amount))
          _log('EXECUTE', `Borrowed ${action.amount} ${action.asset} on ${chainLabel}. TX: ${result.hash}`, 'success')
          break
        case 'REPAY':
          result = await adapter.repay(action.asset || _defaultStable(action.chain), parseFloat(action.amount || '0'))
          _log('EXECUTE', `Repaid on ${chainLabel}. TX: ${result.hash}`, 'success')
          break
        case 'REBALANCE':
          // Withdraw from old market, supply to new — two-step
          await adapter.withdraw(action.from, parseFloat(action.amount))
          result = await adapter.supply(action.to, parseFloat(action.amount))
          _log('EXECUTE', `Rebalanced ${action.from} → ${action.to} on ${chainLabel}. TX: ${result.hash}`, 'success')
          break
        default:
          _log('EXECUTE', `Unknown action type: ${action.type}`, 'error')
      }

      _actionCount++
      _onStats({ actions: _actionCount, lastAction: action })
      return { success: true, action, result }
    } catch (e) {
      _log('EXECUTE', `Action failed on ${chainLabel}: ${e.message}`, 'error')
      return { success: false, error: e.message, action }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get the default stablecoin symbol for a given chain.
   * @param {string} chain - Chain identifier from CHAINS enum
   * @returns {string} Stablecoin symbol (e.g., 'USDC', 'USDT')
   * @private
   */
  function _defaultStable(chain) {
    const stables = {
      'ink-sepolia': 'USDC',
      'ethereum': 'USDC',
      'solana': 'USDC',
      'ton': 'USDT',
    }
    return stables[chain] || 'USDC'
  }

  // ═══════════════════════════════════════════════════════════════
  // TICK LOOP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Single tick of the agent loop. Rate-limited to MIN_TICK_GAP and MAX_TICKS_PER_MIN.
   * Gathers state, runs the active policy's decision function, and executes resulting actions.
   * @returns {Promise<void>}
   */
  async function tick() {
    if (_paused || !_policy) return

    const now = Date.now()
    if (now - _lastTickTime < MIN_TICK_GAP) return
    _tickTimestamps = _tickTimestamps.filter(t => now - t < 60000)
    if (_tickTimestamps.length >= MAX_TICKS_PER_MIN) return
    _lastTickTime = now
    _tickTimestamps.push(now)

    const adapter = _getAdapter()
    const chainLabel = adapter ? `${adapter.protocolName} on ${adapter.config.name}` : 'unknown'

    try {
      _log('TICK', `Gathering lending state from ${chainLabel}...`, 'info')
      const state = await gatherLendingState()

      let actions = []
      switch (_policy.mode) {
        case 'yield':      actions = decideYield(state, _policy); break
        case 'leverage':   actions = decideLeverage(state, _policy); break
        case 'hedge':      actions = decideHedge(state, _policy); break
        case 'monitor':    actions = decideMonitor(state, _policy); break
        default:
          _log('TICK', `Unknown policy mode: ${_policy.mode}`, 'error')
      }

      if (actions.length === 0) {
        _log('TICK', `No actions needed on ${chainLabel}. Markets stable.`, 'info')
        return
      }

      _log('TICK', `${actions.length} action(s) proposed on ${chainLabel}`, 'info')
      for (const action of actions) {
        await executeAction(action)
      }
    } catch (e) {
      _log('TICK', `Tick failed on ${chainLabel}: ${e.message}`, 'error')
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start the lending agent with a given policy configuration.
   * Runs an immediate first tick, then ticks at the configured interval.
   * @param {Object} policy - Policy config with mode ('yield'|'leverage'|'hedge'|'monitor') and thresholds
   * @param {Object} [opts] - Options
   * @param {Function} [opts.log] - Log callback: (category, message, level) => void
   * @param {Function} [opts.onStats] - Stats update callback
   * @param {boolean} [opts.dryRun=true] - If true, actions are logged but not executed on-chain
   * @param {number} [opts.intervalMs=30000] - Tick interval in milliseconds
   */
  function start(policy, { log, onStats, dryRun = true, intervalMs = 30000 } = {}) {
    stop()
    _policy = policy
    _log = log || (() => {})
    _onStats = onStats || (() => {})
    _dryRun = dryRun
    _actionCount = 0

    const adapter = _getAdapter()
    const chainLabel = adapter ? `${adapter.protocolName} on ${adapter.config.name}` : 'no adapter'

    _log('INIT', `Lending Agent started in ${policy.mode.toUpperCase()} mode ${_dryRun ? '(DRY RUN)' : '(LIVE)'} — ${chainLabel}`, 'success')
    _log('INIT', `Permissions: ${Object.entries(PERMISSIONS[policy.mode] || {}).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none'}`, 'info')
    _log('INIT', `Supported chains: ${_getRegistry()?.chains().map(c => CHAIN_CONFIG_NAMES[c] || c).join(', ') || 'none'}`, 'info')

    tick().catch(e => _log('INIT', `Initial tick failed: ${e.message}`, 'error'))
    _interval = setInterval(tick, intervalMs)
  }

  /** Stop the agent and clear the tick interval. */
  function stop() {
    if (_interval) {
      clearInterval(_interval)
      _interval = null
    }
    _policy = null
    _paused = false
    _log('STOP', 'Lending Agent stopped', 'info')
  }

  /** Pause the agent. Ticks will be skipped until resume() is called. */
  function pause()  { _paused = true;  _log('PAUSE', 'Lending Agent paused', 'warn') }
  /** Resume a paused agent. The next tick will execute normally. */
  function resume() { _paused = false; _log('RESUME', 'Lending Agent resumed', 'success') }
  /**
   * Check if the agent is actively running (started and not paused).
   * @returns {boolean} True if the interval is active and not paused
   */
  function isRunning() { return _interval !== null && !_paused }
  /**
   * Get the current policy configuration.
   * @returns {Object|null} Active policy with mode and thresholds, or null if stopped
   */
  function getPolicy() { return _policy }

  /**
   * Get current agent statistics including action count, state, and chain info.
   * @returns {{actions: number, paused: boolean, running: boolean, mode: string|null, chain: string|null, protocol: string|null}}
   */
  function getStats() {
    const adapter = _getAdapter()
    return {
      actions: _actionCount,
      paused: _paused,
      running: !!_interval,
      mode: _policy?.mode || null,
      chain: _getRegistry()?.getActiveChain() || null,
      protocol: adapter?.protocolName || null,
    }
  }

  /**
   * Toggle dry-run mode. In dry-run mode, actions are logged but not executed on-chain.
   * @param {boolean} val - True to enable dry-run, false for live execution
   */
  function setDryRun(val) { _dryRun = val; _log('CONFIG', `Dry run: ${val}`, 'info') }

  /**
   * Switch the agent to a different chain without restarting.
   * The next tick will gather state from the new chain's adapter.
   * @param {string} chain - Chain identifier from CHAINS enum (e.g., 'ink-sepolia', 'solana')
   * @throws {Error} If the adapter registry is not initialized
   */
  function switchChain(chain) {
    const registry = _getRegistry()
    if (!registry) throw new Error('Adapter registry not initialized')
    registry.setActiveChain(chain)
    const adapter = registry.active()
    _log('CHAIN', `Switched to ${adapter.protocolName} on ${adapter.config.name}`, 'success')
  }

  /**
   * Fetch a cross-chain market snapshot from all registered adapters.
   * Returns market data keyed by chain, useful for yield comparison.
   * @returns {Promise<Object<string, Object<string, MarketData>>>} Markets keyed by chain then symbol
   */
  async function getCrossChainMarkets() {
    const registry = _getRegistry()
    if (!registry) return {}
    return registry.getAllMarkets()
  }

  // Chain config display names for logging
  const CHAIN_CONFIG_NAMES = {
    'ink-sepolia': 'Ink Sepolia (Euler V2)',
    'ethereum': 'Ethereum (Euler V2)',
    'solana': 'Solana (Kamino)',
    'ton': 'TON (EVAA)',
  }

  return {
    start, stop, pause, resume,
    isRunning, getPolicy, getStats, setDryRun,
    switchChain, getCrossChainMarkets,
    PERMISSIONS,
    gatherLendingState, tick,
  }
})()

window.xLeverLendingAgent = LendingAgent
