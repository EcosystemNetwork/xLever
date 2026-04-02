/**
 * @file risk-live.js — xLever Live Risk Connector
 *
 * Auto-polls Pyth oracle + on-chain contracts + OpenBB context,
 * feeds live data into the RiskEngine, and exposes the current
 * risk state for any screen (dashboard, risk, trading, agent).
 *
 * Enforces leverage restrictions: when risk state restricts leverage,
 * UI controls and contract calls should respect the cap.
 *
 * @module RiskLive
 * @exports {Object} window.RiskLive
 * @exports {Function} RiskLive.start - Begin auto-polling
 * @exports {Function} RiskLive.stop - Stop polling
 * @exports {Function} RiskLive.refresh - Force single update
 * @exports {Function} RiskLive.subscribe - Subscribe to risk state changes
 *
 * @dependencies
 *   - window.xLeverPyth (optional) for Pyth oracle price feeds
 *   - window.xLeverContracts (optional) for on-chain pool state and oracle state
 *   - window.xLeverOpenBB (optional) for market context enrichment
 *   - window.RiskEngine (optional) for risk evaluation
 */

const RiskLive = (() => {
  /** @type {number|null} Interval ID for the polling loop */
  let _interval = null
  /** @type {Object|null} Latest RiskEngine evaluation result */
  let _state = null
  /** @type {Object|null} Latest raw inputs fed to RiskEngine */
  let _inputs = null
  /** @type {Object|null} Latest oracle health snapshot (Pyth + on-chain) */
  let _oracleHealth = null
  /** @type {Object|null} Latest on-chain oracle state with separated prices */
  let _onChainOracle = null
  /** @type {Function[]} Callbacks notified on every risk state update */
  let _listeners = []
  /** @type {number} Peak QQQ price for max-drawdown calculation */
  let _peakPrice = 0
  /** @type {boolean} Suppresses repeated on-chain oracle warnings */
  let _oracleWarnLogged = false

  /**
   * Single tick of the risk evaluation loop.
   * Gathers inputs from Pyth oracle, on-chain pool state, on-chain oracle state,
   * and OpenBB market context, then evaluates them through the RiskEngine
   * and notifies all subscribers with the updated state.
   * @returns {Promise<void>}
   * @private
   */
  async function tick() {
    const inputs = {
      oracleAgeSec: 0,
      oracleDivergence: 0,
      drawdown: 0,
      healthFactor: 999,
      volatility: 0.2,
      utilization: 0.3,
    }

    // 1. Pyth oracle
    try {
      const pyth = window.xLeverPyth
      if (pyth) {
        const feed = pyth.PYTH_FEEDS['QQQ/USD']
        const p = await pyth.getPriceForFeed(feed)
        const age = pyth.oracleAge(p.publishTime)
        inputs.oracleAgeSec = age
        // Use Pyth confidence interval as initial divergence estimate (will be overridden by on-chain divergence if available)
        inputs.oracleDivergence = p.conf && p.price ? Math.min(p.conf / p.price, 0.5) : 0
        inputs.volatility = Math.min((p.conf / (p.price || 1)) * 50, 1.5)

        // Track peak price for drawdown
        if (p.price > _peakPrice) _peakPrice = p.price
        if (_peakPrice > 0 && p.price > 0) {
          inputs.drawdown = Math.max(0, (_peakPrice - p.price) / _peakPrice)
        }

        _oracleHealth = {
          price: p.price,
          conf: p.conf,
          age,
          publishTime: p.publishTime,
          isStale: age > 300,
          freshness: age < 60 ? 'fresh' : age < 300 ? 'ok' : 'stale',
          confPercent: p.price > 0 ? ((p.conf / p.price) * 100).toFixed(4) : '0',
        }
      }
    } catch (e) {

    }

    // 2. On-chain pool state
    try {
      const contracts = window.xLeverContracts
      if (contracts && contracts.ADDRESSES.vault) {
        const pool = await contracts.getPoolState()
        if (pool) {
          const fmt = contracts.formatPoolState(pool)
          // juniorRatio is 0-1 (decimal), convert to utilization (0-1 range)
          inputs.utilization = Math.max(0, Math.min(1, 1 - fmt.juniorRatio))
          inputs.healthFactor = fmt.state === 'Active' ? 2.0
            : fmt.state === 'Stressed' ? 1.3
            : fmt.state === 'Paused' ? 1.1 : 0.9
        }
      }
    } catch (e) {

    }

    // 2b. On-chain oracle state (separated prices, circuit breaker)
    try {
      const contracts = window.xLeverContracts
      if (contracts && contracts.getOnChainOracleState) {
        const oState = await contracts.getOnChainOracleState()
        if (oState) {
          _onChainOracle = oState
          // Merge on-chain divergence into risk inputs
          if (oState.divergenceBps > 0) {
            inputs.oracleDivergence = Math.max(inputs.oracleDivergence, oState.divergenceBps / 10000)
          }
          // If circuit breaker is active on-chain, force health factor down
          if (oState.isCircuitBroken) {
            inputs.healthFactor = Math.min(inputs.healthFactor, 0.8)
          }
          // Enrich oracle health with on-chain data
          if (_oracleHealth) {
            _oracleHealth.executionPrice = oState.executionPrice
            _oracleHealth.displayPrice = oState.displayPrice
            _oracleHealth.divergenceBps = oState.divergenceBps
            _oracleHealth.spreadBps = oState.spreadBps
            _oracleHealth.isCircuitBroken = oState.isCircuitBroken
            _oracleHealth.onChainFresh = oState.isFresh
            _oracleHealth.updateCount = oState.updateCount
          }
        }
      }
    } catch (e) {
      if (!_oracleWarnLogged) {

        _oracleWarnLogged = true
      }
    }

    // 3. OpenBB market context (non-blocking enrichment)
    try {
      const obb = window.xLeverOpenBB
      if (obb) {
        const ctx = await obb.getDashboardContext()
        if (ctx && ctx.quotes) {
          const qqq = ctx.quotes.find(q => (q.symbol || '').toUpperCase() === 'QQQ')
          if (qqq) {
            const dailyMove = Math.abs(qqq.regular_market_change_percent || qqq.change_percent || 0) / 100
            // Use daily move as volatility floor if it's higher than oracle-derived vol
            if (dailyMove > inputs.volatility) {
              inputs.volatility = Math.min(dailyMove * 3, 1.5) // annualize rough proxy
            }
          }
        }
      }
    } catch { /* OpenBB is optional */ }

    // 4. Evaluate
    _inputs = inputs
    if (window.RiskEngine) {
      _state = window.RiskEngine.evaluate(inputs)
    }

    // 5. Notify listeners
    for (const cb of _listeners) {
      try { cb(_state, _inputs, _oracleHealth) } catch { /* don't let a bad listener break the loop */ }
    }
  }

  return {
    /**
     * Start auto-polling the Pyth oracle, on-chain contracts, and OpenBB context.
     * Runs an immediate first tick, then polls at the specified interval.
     * @param {number} [intervalMs=15000] - Polling interval in milliseconds
     */
    start(intervalMs = 15000) {
      if (_interval) clearInterval(_interval)
      tick() // immediate first tick
      _interval = setInterval(tick, intervalMs)
    },

    /**
     * Stop the auto-polling loop and clear the interval timer.
     */
    stop() {
      if (_interval) clearInterval(_interval)
      _interval = null
    },

    /**
     * Force a single risk evaluation tick immediately.
     * Useful for on-demand refresh after user actions.
     * @returns {Promise<void>}
     */
    refresh() { return tick() },

    /**
     * Subscribe to risk state changes. The callback is invoked on every tick
     * with the latest risk evaluation, raw inputs, and oracle health snapshot.
     * If state already exists, the callback is called immediately with current values.
     * @param {Function} cb - Callback: (riskState, inputs, oracleHealth) => void
     * @returns {Function} Unsubscribe function -- call to stop receiving updates
     */
    subscribe(cb) {
      _listeners.push(cb)
      // Immediately call with current state if available
      if (_state) try { cb(_state, _inputs, _oracleHealth) } catch {}
      return () => { _listeners = _listeners.filter(l => l !== cb) }
    },

    /**
     * Current RiskEngine evaluation result. May be null before the first tick completes.
     * @type {Object|null}
     */
    get state() { return _state },
    /**
     * Raw inputs that were fed to the last RiskEngine evaluation.
     * @type {Object|null}
     */
    get inputs() { return _inputs },
    /**
     * Latest Pyth oracle health snapshot (price, confidence, age, freshness).
     * @type {Object|null}
     */
    get oracleHealth() { return _oracleHealth },
    /**
     * On-chain oracle state with separated prices (execution, display, risk)
     * and circuit breaker status.
     * @type {Object|null}
     */
    get onChainOracle() { return _onChainOracle },

    /**
     * Current maximum allowed leverage from the risk evaluation.
     * Returns 4.0 (protocol max) if no evaluation has been performed yet.
     * @type {number}
     */
    get leverageCap() { return _state ? _state.leverageCap : 4.0 },

    /**
     * Check whether a given leverage value is within the current risk-adjusted cap.
     * @param {number} lev - Leverage value to check (can be negative for shorts)
     * @returns {boolean} True if the absolute leverage is within the current cap
     */
    isLeverageAllowed(lev) {
      return Math.abs(lev) <= this.leverageCap
    },

    /**
     * Whether the auto-polling loop is currently active.
     * @type {boolean}
     */
    get isRunning() { return _interval !== null },
  }
})()

window.RiskLive = RiskLive
