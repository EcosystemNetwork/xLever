/**
 * xLever Agent Executor — Bounded Smart-Account Automation
 * ─────────────────────────────────────────────────────────
 * Replaces the simulated agent with a real decision loop that:
 *  1. Reads live state from Pyth oracle + on-chain contracts
 *  2. Optionally queries OpenBB for market context
 *  3. Evaluates policy rules against live data
 *  4. Executes real contract transactions (or dry-run previews)
 *  5. Enforces permission boundaries in code
 *
 * Three policy modes: Safe, Target Exposure, Accumulation
 */

// ═══════════════════════════════════════════════════════════════
// AGENT STATE
// ═══════════════════════════════════════════════════════════════

const AgentExecutor = (() => {
  let _interval = null
  let _policy = null
  let _paused = false
  let _log = () => {} // external log callback
  let _onStats = () => {} // stats update callback
  let _dryRun = true // default to dry-run until wallet connected
  let _actionCount = 0
  let _lastCheckTime = 0

  // Permission boundaries — enforced in code, not just UI
  const PERMISSIONS = {
    safe: {
      canIncreaseLeverage: false,
      canOpenNew: false,
      canWithdraw: false,
      canReduceLeverage: true,
      canClose: true,
    },
    target: {
      canIncreaseLeverage: true, // only within band
      canOpenNew: false,
      canWithdraw: false,
      canReduceLeverage: true,
      canClose: false,
    },
    accumulate: {
      canIncreaseLeverage: false,
      canOpenNew: true, // bounded by buyAmount
      canWithdraw: false,
      canReduceLeverage: false,
      canClose: false, // unless profit-take
    },
  }

  // ─── LIVE DATA GATHERING ───

  async function gatherLiveState() {
    const state = {
      oracleAge: null,
      oraclePrice: null,
      oracleConf: null,
      position: null,
      positionValue: null,
      poolState: null,
      riskState: null,
      marketContext: null,
    }

    // 1. Pyth oracle
    try {
      const pyth = window.xLeverPyth
      if (pyth) {
        const feed = pyth.PYTH_FEEDS['QQQ/USD']
        const p = await pyth.getPriceForFeed(feed)
        state.oracleAge = pyth.oracleAge(p.publishTime)
        state.oraclePrice = p.price
        state.oracleConf = p.conf
      }
    } catch (e) {
      _log('WATCHER', 'Pyth oracle fetch failed: ' + e.message, 'error')
    }

    // 2. On-chain position + pool
    try {
      const contracts = window.xLeverContracts
      if (contracts && contracts.ADDRESSES.vault) {
        const wc = contracts.getWalletClient()
        if (wc) {
          const [addr] = await wc.getAddresses()
          if (addr) {
            const pos = await contracts.getPosition(addr)
            state.position = contracts.formatPosition(pos)

            const pv = await contracts.getPositionValue(addr)
            state.positionValue = {
              value: Number(pv.value || pv[0] || 0n) / 1e6,
              pnl: Number(pv.pnl || pv[1] || 0n) / 1e6,
            }
          }
        }

        const pool = await contracts.getPoolState()
        state.poolState = contracts.formatPoolState(pool)
      }
    } catch (e) {
      _log('WATCHER', 'Contract state fetch failed: ' + e.message, 'on-surface-variant')
    }

    // 3. Risk engine evaluation
    try {
      if (window.RiskEngine && state.oracleAge !== null) {
        const riskInputs = {
          oracleAgeSec: state.oracleAge,
          oracleDivergence: state.oracleConf && state.oraclePrice ? state.oracleConf / state.oraclePrice : 0,
          drawdown: 0,
          healthFactor: state.poolState ? (1 / (parseFloat(state.poolState.seniorTVL) / (parseFloat(state.poolState.seniorTVL) + parseFloat(state.poolState.juniorTVL) || 1))) : 2.0,
          volatility: state.oracleConf && state.oraclePrice ? Math.min((state.oracleConf / state.oraclePrice) * 50, 1.5) : 0.2,
          utilization: state.poolState ? (1 - state.poolState.juniorRatio) : 0.3,
        }
        state.riskState = window.RiskEngine.evaluate(riskInputs)
      }
    } catch (e) {
      // Risk engine evaluation is best-effort
    }

    // 4. OpenBB market context (non-blocking)
    try {
      const obb = window.xLeverOpenBB
      if (obb) {
        const ctx = await obb.getDashboardContext()
        if (ctx && ctx.quotes) {
          const qqq = ctx.quotes.find(q => (q.symbol || '').toUpperCase() === 'QQQ')
          if (qqq) {
            state.marketContext = {
              regularMarketPrice: qqq.regular_market_price || qqq.last_price || qqq.close,
              regularMarketChangePercent: qqq.regular_market_change_percent || qqq.change_percent || 0,
              fiftyDayAverage: qqq.fifty_day_average || null,
            }
          }
        }
      }
    } catch (e) {
      // OpenBB is optional context
    }

    return state
  }

  // ─── DECISION FUNCTIONS PER MODE ───

  async function decideSafe(state, policy) {
    // Safe mode: monitor volatility, de-leverage if threshold breached
    const actions = []

    if (state.riskState && (state.riskState.state === 'RESTRICTED' || state.riskState.state === 'EMERGENCY')) {
      actions.push({
        type: 'deleverage',
        reason: `Risk state ${state.riskState.state}: ${state.riskState.reasons[0]?.reason || 'system stress'}`,
        targetLeverage: 0, // close position
        severity: 'error',
      })
      return actions
    }

    // Check oracle health
    if (state.oracleAge !== null && state.oracleAge > 300) {
      _log('WATCHER', `Oracle stale (${state.oracleAge}s). Holding — no actions until fresh.`, 'yellow-500')
      return actions // don't act on stale data
    }

    // Check daily move from OpenBB context
    if (state.marketContext) {
      const dailyMove = Math.abs(state.marketContext.regularMarketChangePercent || 0)
      _log('WATCHER', `Daily QQQ move: ${dailyMove.toFixed(2)}%. Trigger: ${policy.volTrigger}%.`, 'on-surface-variant')

      if (dailyMove > policy.volTrigger) {
        actions.push({
          type: 'deleverage',
          reason: `Volatility ${dailyMove.toFixed(1)}% exceeds ${policy.volTrigger}% trigger`,
          targetLeverage: policy.deleverageTarget,
          severity: 'yellow-500',
        })
      }
    }

    // Check position drawdown
    if (state.positionValue && state.position && state.position.isActive) {
      const deposit = parseFloat(state.position.deposit)
      const pnlPct = deposit > 0 ? (state.positionValue.pnl / deposit) * 100 : 0
      if (pnlPct < -policy.maxDrawdown) {
        actions.push({
          type: 'close',
          reason: `Drawdown ${pnlPct.toFixed(1)}% exceeds -${policy.maxDrawdown}% limit`,
          severity: 'error',
        })
      }
    }

    if (actions.length === 0) {
      _log('WATCHER', 'All clear. Position within safe parameters.', 'on-surface-variant')
    }

    return actions
  }

  async function decideTarget(state, policy) {
    const actions = []

    if (!state.position || !state.position.isActive) {
      _log('WATCHER', 'No active position. Target mode waiting for position.', 'on-surface-variant')
      return actions
    }

    const currentLev = state.position.leverage
    const lo = policy.targetLev - policy.band
    const hi = policy.targetLev + policy.band

    _log('WATCHER', `Leverage: ${currentLev.toFixed(2)}x. Band: [${lo.toFixed(2)}x - ${hi.toFixed(2)}x].`, 'on-surface-variant')

    if (currentLev < lo) {
      actions.push({
        type: 'adjust',
        reason: `Leverage ${currentLev.toFixed(2)}x below ${lo.toFixed(2)}x floor`,
        targetLeverage: policy.targetLev,
        severity: 'secondary',
      })
    } else if (currentLev > hi) {
      actions.push({
        type: 'adjust',
        reason: `Leverage ${currentLev.toFixed(2)}x above ${hi.toFixed(2)}x ceiling`,
        targetLeverage: policy.targetLev,
        severity: 'secondary',
      })
    }

    return actions
  }

  async function decideAccumulate(state, policy) {
    const actions = []

    // Check profit-take first
    if (policy.profitTake && state.positionValue && state.position && state.position.isActive) {
      const deposit = parseFloat(state.position.deposit)
      const pnlPct = deposit > 0 ? (state.positionValue.pnl / deposit) * 100 : 0
      if (pnlPct > policy.profitThreshold) {
        actions.push({
          type: 'close-partial',
          reason: `Unrealized gain +${pnlPct.toFixed(1)}% exceeds ${policy.profitThreshold}% take-profit`,
          severity: 'secondary',
        })
        return actions
      }
    }

    // DCA buy on interval (simplified: check if enough time since last action)
    const intervalMs = { 'hourly': 3600000, 'daily': 86400000, 'weekly': 604800000 }
    const minWait = intervalMs[policy.interval] || 86400000
    const now = Date.now()

    if (now - _lastCheckTime >= minWait || _actionCount === 0) {
      actions.push({
        type: 'buy',
        reason: `DCA: $${policy.buyAmount} at ${policy.leverage}x (${policy.interval} interval)`,
        amount: policy.buyAmount,
        leverage: policy.leverage,
        severity: 'secondary',
      })
    } else {
      const remaining = Math.ceil((minWait - (now - _lastCheckTime)) / 60000)
      _log('SCHEDULER', `Next DCA buy in ~${remaining}m.`, 'on-surface-variant')
    }

    return actions
  }

  // ─── ACTION EXECUTION ───

  async function executeAction(action) {
    const perms = PERMISSIONS[_policy.mode]
    const contracts = window.xLeverContracts

    if (action.type === 'deleverage' || action.type === 'adjust') {
      if (!perms.canReduceLeverage && action.targetLeverage < (_policy.targetLev || 0)) {
        _log('POLICY', `BLOCKED: ${action.type} not permitted by ${_policy.mode} policy.`, 'error')
        return false
      }
      if (!perms.canIncreaseLeverage && action.targetLeverage > (_policy.targetLev || 0)) {
        _log('POLICY', `BLOCKED: leverage increase not permitted by ${_policy.mode} policy.`, 'error')
        return false
      }

      if (_dryRun || !contracts || !contracts.ADDRESSES.vault) {
        _log('EXECUTOR', `[DRY-RUN] Would adjust leverage to ${action.targetLeverage}x. Reason: ${action.reason}`, action.severity)
        return true
      }

      _log('EXECUTOR', `Adjusting leverage to ${action.targetLeverage}x. Reason: ${action.reason}`, action.severity)
      try {
        const result = await contracts.adjustLeverage(action.targetLeverage)
        _log('SYSTEM', `TX confirmed: ${result.hash}`, 'primary')
        _log('AGENT', `Leverage adjusted to ${action.targetLeverage}x.`, 'secondary')
        return true
      } catch (e) {
        _log('SYSTEM', `TX failed: ${e.shortMessage || e.message}`, 'error')
        return false
      }
    }

    if (action.type === 'close') {
      if (!perms.canClose) {
        _log('POLICY', `BLOCKED: close not permitted by ${_policy.mode} policy.`, 'error')
        return false
      }

      if (_dryRun || !contracts || !contracts.ADDRESSES.vault) {
        _log('EXECUTOR', `[DRY-RUN] Would close position. Reason: ${action.reason}`, action.severity)
        return true
      }

      _log('EXECUTOR', `Closing position. Reason: ${action.reason}`, action.severity)
      try {
        // Use max uint to withdraw all
        const result = await contracts.closePosition('999999999')
        _log('SYSTEM', `TX confirmed: ${result.hash}`, 'primary')
        _log('AGENT', 'Position closed. Manual control restored.', 'secondary')
        return true
      } catch (e) {
        _log('SYSTEM', `TX failed: ${e.shortMessage || e.message}`, 'error')
        return false
      }
    }

    if (action.type === 'buy') {
      if (!perms.canOpenNew) {
        _log('POLICY', `BLOCKED: new positions not permitted by ${_policy.mode} policy.`, 'error')
        return false
      }

      if (_dryRun || !contracts || !contracts.ADDRESSES.vault) {
        _log('EXECUTOR', `[DRY-RUN] Would buy $${action.amount} QQQx at ${action.leverage}x. Reason: ${action.reason}`, action.severity)
        return true
      }

      _log('EXECUTOR', `Buying $${action.amount} QQQx at ${action.leverage}x. ${action.reason}`, action.severity)
      try {
        const result = await contracts.openPosition(String(action.amount), action.leverage)
        _log('SYSTEM', `TX confirmed: ${result.hash}`, 'primary')
        _log('AGENT', `Bought $${action.amount} QQQx at ${action.leverage}x.`, 'secondary')
        _lastCheckTime = Date.now()
        return true
      } catch (e) {
        _log('SYSTEM', `TX failed: ${e.shortMessage || e.message}`, 'error')
        return false
      }
    }

    if (action.type === 'close-partial') {
      _log('EXECUTOR', `[DRY-RUN] Would take partial profit. ${action.reason}`, action.severity)
      return true
    }

    return false
  }

  // ─── MAIN LOOP ───

  async function tick() {
    if (_paused || !_policy) return

    try {
      _log('WATCHER', 'Gathering live state...', 'on-surface-variant')
      const state = await gatherLiveState()

      // Log oracle status
      if (state.oracleAge !== null) {
        const freshness = state.oracleAge < 60 ? 'fresh' : state.oracleAge < 300 ? 'ok' : 'STALE'
        _log('WATCHER', `Oracle: $${state.oraclePrice?.toFixed(2) || '?'} (age: ${state.oracleAge}s, ${freshness})`, state.oracleAge > 300 ? 'yellow-500' : 'on-surface-variant')
      }

      // Log position if active
      if (state.position && state.position.isActive) {
        _log('WATCHER', `Position: ${state.position.leverageDisplay} | Entry: $${state.position.entryPrice} | PnL: $${state.positionValue?.pnl?.toFixed(2) || '?'}`, 'on-surface-variant')
      }

      // Decide based on mode
      let actions = []
      if (_policy.mode === 'safe') {
        actions = await decideSafe(state, _policy)
      } else if (_policy.mode === 'target') {
        actions = await decideTarget(state, _policy)
      } else if (_policy.mode === 'accumulate') {
        actions = await decideAccumulate(state, _policy)
      }

      // Execute actions
      for (const action of actions) {
        const success = await executeAction(action)
        if (success) _actionCount++
      }

      _onStats({ actions: _actionCount })
    } catch (e) {
      _log('SYSTEM', 'Tick error: ' + e.message, 'error')
    }
  }

  // ─── PUBLIC API ───

  return {
    /**
     * Start the agent with a policy.
     * @param {Object} policy - { mode, volTrigger, deleverageTarget, ... }
     * @param {Object} opts - { log, onStats, dryRun, intervalMs }
     */
    start(policy, opts = {}) {
      _policy = policy
      _log = opts.log || (() => {})
      _onStats = opts.onStats || (() => {})
      _dryRun = opts.dryRun !== undefined ? opts.dryRun : true
      _paused = false
      _actionCount = 0
      _lastCheckTime = 0

      // Check if wallet is connected to determine dry-run
      try {
        const wc = window.xLeverContracts?.getWalletClient()
        if (!wc) {
          _dryRun = true
          _log('SYSTEM', 'No wallet connected — running in DRY-RUN mode. Actions are previewed, not executed.', 'yellow-500')
        } else if (_dryRun) {
          _log('SYSTEM', 'DRY-RUN mode enabled. Connect wallet and re-activate to execute real transactions.', 'yellow-500')
        } else {
          _log('SYSTEM', 'LIVE mode — transactions will be submitted on-chain.', 'secondary')
        }
      } catch {
        _dryRun = true
      }

      const intervalMs = opts.intervalMs || 15000 // 15s default
      _log('SYSTEM', `Agent executor started. Mode: ${policy.mode}. Check interval: ${intervalMs / 1000}s.`, 'primary')

      // First tick immediately
      tick()

      // Then periodic
      if (_interval) clearInterval(_interval)
      _interval = setInterval(tick, intervalMs)
    },

    stop() {
      if (_interval) clearInterval(_interval)
      _interval = null
      _policy = null
      _paused = false
      _log('SYSTEM', 'Agent executor stopped.', 'error')
    },

    pause() {
      _paused = !_paused
      _log('USER', _paused ? 'Agent paused.' : 'Agent resumed.', _paused ? 'yellow-500' : 'secondary')
      return _paused
    },

    get isPaused() { return _paused },
    get isRunning() { return _interval !== null },
    get actionCount() { return _actionCount },
    get isDryRun() { return _dryRun },

    setDryRun(val) { _dryRun = val },
  }
})()

window.AgentExecutor = AgentExecutor
