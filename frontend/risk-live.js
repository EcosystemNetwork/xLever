/**
 * xLever Live Risk Connector
 * ───────────────────────────
 * Auto-polls Pyth oracle + on-chain contracts + OpenBB context,
 * feeds live data into the RiskEngine, and exposes the current
 * risk state for any screen (dashboard, risk, trading, agent).
 *
 * Enforces leverage restrictions: when risk state restricts leverage,
 * UI controls and contract calls should respect the cap.
 */

const RiskLive = (() => {
  let _interval = null
  let _state = null        // Latest RiskEngine evaluation result
  let _inputs = null       // Latest raw inputs fed to RiskEngine
  let _oracleHealth = null // Latest oracle health snapshot
  let _onChainOracle = null // Latest on-chain oracle state (separated prices)
  let _listeners = []      // Callbacks notified on every update
  let _peakPrice = 0       // Tracks peak QQQ price for drawdown calc

  /**
   * Gather all live inputs, evaluate risk, and notify listeners.
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
      console.warn('RiskLive: Pyth fetch failed:', e.message)
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
      console.warn('RiskLive: Contract state fetch failed:', e.message)
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
      console.warn('RiskLive: On-chain oracle state fetch failed:', e.message)
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
     * Start auto-polling. Default 15s interval.
     */
    start(intervalMs = 15000) {
      if (_interval) clearInterval(_interval)
      tick() // immediate first tick
      _interval = setInterval(tick, intervalMs)
    },

    stop() {
      if (_interval) clearInterval(_interval)
      _interval = null
    },

    /** Force a single update right now. */
    refresh() { return tick() },

    /** Subscribe to risk state changes. Returns unsubscribe function. */
    subscribe(cb) {
      _listeners.push(cb)
      // Immediately call with current state if available
      if (_state) try { cb(_state, _inputs, _oracleHealth) } catch {}
      return () => { _listeners = _listeners.filter(l => l !== cb) }
    },

    /** Current risk evaluation (may be null before first tick). */
    get state() { return _state },
    get inputs() { return _inputs },
    get oracleHealth() { return _oracleHealth },
    /** On-chain oracle state with separated prices (execution, display, risk). */
    get onChainOracle() { return _onChainOracle },

    /** Current leverage cap (safe default 4.0 if not evaluated yet). */
    get leverageCap() { return _state ? _state.leverageCap : 4.0 },

    /** Whether a given leverage value is currently allowed. */
    isLeverageAllowed(lev) {
      return Math.abs(lev) <= this.leverageCap
    },

    get isRunning() { return _interval !== null },
  }
})()

window.RiskLive = RiskLive
