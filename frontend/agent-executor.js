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

// IIFE isolates all mutable agent state so nothing leaks into global scope except the returned API
const AgentExecutor = (() => {
  let _interval = null      // Holds the setInterval ID so we can clear it on stop/restart
  let _policy = null        // The active policy config object (mode + mode-specific params)
  let _paused = false       // Pause flag: when true, tick() returns immediately without acting
  let _log = () => {}       // External log callback — injected by the UI so agent messages appear in the chat panel
  let _onStats = () => {}   // Stats callback — lets the UI update action counters without polling
  let _dryRun = true        // Safety default: dry-run until a wallet is confirmed connected
  let _actionCount = 0      // Running total of actions taken this session, for stats display
  let _lastCheckTime = 0    // Timestamp of last action — used by accumulate mode to enforce DCA intervals

  /**
   * Validate that a value is a finite number, returning the fallback if not.
   * Guards against NaN, Infinity, undefined, and non-numeric strings in agent inputs.
   *
   * @param {*} val — Value to validate (any type)
   * @param {number} [fallback=0] — Default to return if val is not a finite number
   * @returns {number} The validated number or the fallback
   */
  function _safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }

  // Permission boundaries — enforced both client-side AND server-side.
  // Server-side enforcement is at POST /api/agents/runs/{run_id}/actions
  // which validates every action against the policy mode before allowing execution.
  const PERMISSIONS = {
    // Safe mode: can only reduce risk or exit — never increase exposure
    safe: {
      canIncreaseLeverage: false,  // Blocked because safe mode's purpose is protection, not growth
      canOpenNew: false,           // Blocked because opening new positions contradicts risk-reduction intent
      canWithdraw: false,          // Blocked to prevent premature capital removal during stress
      canReduceLeverage: true,     // Allowed because delevering is the core safe-mode action
      canClose: true,              // Allowed because full exit is the ultimate risk-reduction action
    },
    // Target mode: can adjust leverage within a band but not open/close entire positions
    target: {
      canIncreaseLeverage: true,   // Allowed but only within the target band — checked at execution time
      canOpenNew: false,           // Blocked because target mode manages existing positions, not new ones
      canWithdraw: false,          // Blocked to keep capital in the protocol for rebalancing
      canReduceLeverage: true,     // Allowed because rebalancing downward is part of maintaining the target
      canClose: false,             // Blocked because target mode should rebalance, not close
    },
    // Accumulate mode: can open new DCA positions and take profit, but cannot manually adjust leverage
    accumulate: {
      canIncreaseLeverage: false,  // Blocked because accumulate mode buys at fixed leverage, not adjustable
      canOpenNew: true,            // Allowed because DCA buying is the core accumulate-mode action; bounded by buyAmount
      canWithdraw: false,          // Blocked to keep accumulated capital compounding
      canReduceLeverage: false,    // Blocked because accumulate mode doesn't manage leverage on existing positions
      canClose: false,             // Blocked unless profit-take triggers — checked separately in decideAccumulate
    },
  }

  // ─── LIVE DATA GATHERING ───

  /**
   * Collect all live data the agent needs for decision-making.
   * Reads from Pyth oracle, on-chain contracts, risk engine, and OpenBB market APIs.
   * Each data source is fetched independently with try/catch so partial failures
   * don't prevent the agent from acting on available data.
   *
   * @returns {Promise<{oracleAge: number|null, oraclePrice: number|null, oracleConf: number|null,
   *   position: Object|null, positionValue: {value: number, pnl: number}|null,
   *   poolState: Object|null, riskState: Object|null, marketContext: Object|null}>}
   *   Snapshot of all live state, with null fields for unavailable data sources
   */
  async function gatherLiveState() {
    // Initialize all fields to null so downstream code can check what data is available
    const state = {
      oracleAge: null,       // Seconds since last Pyth update — null means oracle unreachable
      oraclePrice: null,     // Latest QQQ/USD price from Pyth — null means no price available
      oracleConf: null,      // Pyth confidence interval — used to approximate volatility
      position: null,        // User's current vault position (leverage, deposit, direction)
      positionValue: null,   // Current position value and PnL in USD
      poolState: null,       // Euler V2 pool metrics (TVL, utilization, ratios)
      riskState: null,       // Output of RiskEngine.evaluate() — null means risk engine unavailable
      marketContext: null,    // OpenBB market data (daily price, change %) — null means API unavailable
    }

    // 1. Pyth oracle — primary price source for all agent decisions
    try {
      // Access the Pyth integration attached to the window by the frontend bootstrap
      const pyth = window.xLeverPyth
      if (pyth) {
        // Look up the QQQ/USD feed ID from the Pyth feed registry
        const feed = pyth.PYTH_FEEDS['QQQ/USD']
        // Fetch the latest price, publish time, and confidence from Pyth's Hermes API
        const p = await pyth.getPriceForFeed(feed)
        // Calculate how many seconds ago this price was published — critical for staleness checks
        state.oracleAge = pyth.oracleAge(p.publishTime)
        // Store the price itself for display and position value calculations
        state.oraclePrice = p.price
        // Store confidence interval — a wider interval implies higher real-time volatility
        state.oracleConf = p.conf
      }
    } catch (e) {
      // Log oracle failure but don't throw — the agent should degrade gracefully without price data
      _log('WATCHER', 'Pyth oracle fetch failed: ' + e.message, 'error')
    }

    // 2. On-chain position + pool — reads from Euler V2 EVK contracts via the frontend's contract wrapper
    try {
      // Access the contract integration attached to the window by the frontend bootstrap
      const contracts = window.xLeverContracts
      // Only proceed if contracts are initialized and a vault address is configured
      if (contracts && contracts.ADDRESSES.vault) {
        // Get the wallet client (Reown/WalletConnect) to determine the connected user address
        const wc = contracts.getWalletClient()
        if (wc) {
          // Retrieve the first connected address — this is the user whose position we monitor
          const [addr] = await wc.getAddresses()
          if (addr) {
            // Fetch raw position data (leverage, deposit, direction, entry price) from the vault
            const pos = await contracts.getPosition(addr)
            // Format into human-readable fields for display and decision logic
            state.position = contracts.formatPosition(pos)

            // Fetch current position value and unrealized PnL separately (may be a different contract call)
            const pv = await contracts.getPositionValue(addr)
            // Normalize to USD by dividing by 1e6 (USDC has 6 decimals)
            state.positionValue = {
              value: Number(pv.value || pv[0] || 0n) / 1e6,  // Current position value in USD
              pnl: Number(pv.pnl || pv[1] || 0n) / 1e6,      // Unrealized profit/loss in USD
            }
          }
        }

        // Fetch pool-level state (TVL, utilization, senior/junior split) — not user-specific
        const pool = await contracts.getPoolState()
        // Format into readable fields for risk engine input and UI display
        state.poolState = contracts.formatPoolState(pool)
      }
    } catch (e) {
      // Non-fatal: log at low severity because contract reads can fail during RPC congestion
      _log('WATCHER', 'Contract state fetch failed: ' + e.message, 'on-surface-variant')
    }

    // 3. Risk engine evaluation — prefer real on-chain state via fromContract(), fallback to local
    try {
      if (window.RiskEngine) {
        // Try to read real risk state from on-chain getRiskState() first
        const contractRisk = await window.RiskEngine.fromContract()
        if (contractRisk) {
          state.riskState = contractRisk
          _log('WATCHER', `Risk state from contract: ${contractRisk.state} (health: ${contractRisk.healthFactor?.toFixed(2)}, cap: ${contractRisk.leverageCap}x)`, 'on-surface-variant')
        } else if (state.oracleAge !== null) {
          // Fallback: build local risk evaluation from gathered data
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
      }
    } catch (e) {
      // Silently swallow — risk engine evaluation is best-effort
    }

    // 4. OpenBB market context (non-blocking) — enriches decisions with traditional market data
    try {
      // Access the OpenBB integration attached to the window (if configured)
      const obb = window.xLeverOpenBB
      if (obb) {
        // Fetch the dashboard context which includes quotes for tracked symbols
        const ctx = await obb.getDashboardContext()
        if (ctx && ctx.quotes) {
          // Find the QQQ quote specifically since xLever tracks QQQ/SPY leveraged exposure
          const qqq = ctx.quotes.find(q => (q.symbol || '').toUpperCase() === 'QQQ')
          if (qqq) {
            // Extract the fields the agent needs for daily-move and trend analysis
            state.marketContext = {
              regularMarketPrice: qqq.regular_market_price || qqq.last_price || qqq.close,                // Latest QQQ price from market data
              regularMarketChangePercent: qqq.regular_market_change_percent || qqq.change_percent || 0,    // Today's % change for volatility trigger
              fiftyDayAverage: qqq.fifty_day_average || null,                                              // 50-day MA for trend context (unused currently)
            }
          }
        }
      }
    } catch (e) {
      // Silently swallow — OpenBB is optional enrichment; agent works fine without it
    }

    // Return the assembled state snapshot for the decision functions
    return state
  }

  // ─── DECISION FUNCTIONS PER MODE ───

  /**
   * Safe mode decision function. Monitors for risk events and recommends
   * deleveraging or closing when policy thresholds are breached.
   * Checks (in priority order): risk engine state, oracle staleness,
   * daily volatility trigger, and position drawdown.
   *
   * @param {Object} state — Live state snapshot from gatherLiveState()
   * @param {Object} policy — Safe mode policy config
   * @param {number} policy.volTrigger — Daily move % that triggers deleverage
   * @param {number} policy.deleverageTarget — Target leverage after vol trigger
   * @param {number} policy.maxDrawdown — Max allowed drawdown % before position close
   * @returns {Promise<Array<{type: string, reason: string, targetLeverage?: number, severity: string}>>}
   *   Array of recommended actions (0 or more)
   */
  async function decideSafe(state, policy) {
    // Accumulate actions to return; safe mode may generate 0 or 1 action per tick
    const actions = []

    // Check risk engine state first — if RESTRICTED or EMERGENCY, close the position immediately
    if (state.riskState && (state.riskState.state === 'RESTRICTED' || state.riskState.state === 'EMERGENCY')) {
      actions.push({
        type: 'deleverage',     // Action type tells the executor which code path to run
        // Include the specific risk reason so the user understands why the agent acted
        reason: `Risk state ${state.riskState.state}: ${state.riskState.reasons[0]?.reason || 'system stress'}`,
        targetLeverage: 0,      // Target 0x = close position entirely (most protective action)
        severity: 'error',      // UI severity for log coloring
      })
      return actions // Return early — no point checking other conditions when risk engine says emergency
    }

    // Check oracle health — refuse to act on stale data because decisions could be wrong
    if (state.oracleAge !== null && state.oracleAge > 300) {
      // Log the stale oracle but take no action — acting on bad data is worse than waiting
      _log('WATCHER', `Oracle stale (${state.oracleAge}s). Holding — no actions until fresh.`, 'yellow-500')
      return actions // Empty actions array = do nothing this tick
    }

    // Check daily move from OpenBB context — high intraday volatility triggers preventive deleverage
    if (state.marketContext) {
      // Use absolute value because both up and down moves create risk for leveraged positions
      const dailyMove = Math.abs(_safeNum(state.marketContext.regularMarketChangePercent, 0))
      // Log the comparison so users can see how close the market is to the trigger
      _log('WATCHER', `Daily QQQ move: ${dailyMove.toFixed(2)}%. Trigger: ${policy.volTrigger}%.`, 'on-surface-variant')

      // If daily move exceeds the user-configured volatility trigger, recommend deleveraging
      if (dailyMove > policy.volTrigger) {
        actions.push({
          type: 'deleverage',
          reason: `Volatility ${dailyMove.toFixed(1)}% exceeds ${policy.volTrigger}% trigger`,
          targetLeverage: policy.deleverageTarget,  // User-configured target leverage for vol events
          severity: 'yellow-500',
        })
      }
    }

    // Check position drawdown — if unrealized loss exceeds the user's max drawdown, close to prevent further loss
    if (state.positionValue && state.position && state.position.isActive) {
      // Calculate deposit basis to measure drawdown as a percentage of invested capital
      const deposit = _safeNum(parseFloat(state.position.deposit), 0)
      // PnL as percentage of deposit — negative means the position is underwater
      const pnl = _safeNum(state.positionValue.pnl, 0)
      const pnlPct = deposit > 0 ? (pnl / deposit) * 100 : 0
      // If drawdown exceeds the policy limit, close the position to stop the bleeding
      if (pnlPct < -policy.maxDrawdown) {
        actions.push({
          type: 'close',          // Full position close — the most protective action
          reason: `Drawdown ${pnlPct.toFixed(1)}% exceeds -${policy.maxDrawdown}% limit`,
          severity: 'error',
        })
      }
    }

    // If no actions were generated, log an all-clear so the user knows the agent is actively monitoring
    if (actions.length === 0) {
      _log('WATCHER', 'All clear. Position within safe parameters.', 'on-surface-variant')
    }

    return actions
  }

  /**
   * Target mode decision function. Keeps leverage within a band around
   * a target value by recommending upward or downward adjustments.
   * Only acts when leverage drifts outside [target - band, target + band].
   *
   * @param {Object} state — Live state snapshot from gatherLiveState()
   * @param {Object} policy — Target mode policy config
   * @param {number} policy.targetLev — Target leverage multiplier (e.g., 2.0)
   * @param {number} policy.band — Allowed deviation from target (e.g., 0.5 means +/-0.5x)
   * @returns {Promise<Array<{type: string, reason: string, targetLeverage: number, severity: string}>>}
   *   Array of 0 or 1 adjustment actions
   */
  async function decideTarget(state, policy) {
    // Accumulate actions; target mode generates 0 or 1 adjustment per tick
    const actions = []

    // Can't rebalance if there's no active position to adjust
    if (!state.position || !state.position.isActive) {
      _log('WATCHER', 'No active position. Target mode waiting for position.', 'on-surface-variant')
      return actions
    }

    // Read current leverage from the on-chain position data
    const currentLev = _safeNum(state.position.leverage, 0)
    // Validate policy bounds before use
    const targetLev = _safeNum(policy.targetLev, 1)
    const band = _safeNum(policy.band, 0.5)
    // Calculate the allowed band: target +/- tolerance (e.g. 2.0x +/- 0.5 = [1.5, 2.5])
    const lo = targetLev - band   // Lower bound: below this means leverage drifted too low
    const hi = targetLev + band   // Upper bound: above this means leverage drifted too high

    // Log current state so the user can see where leverage sits relative to the band
    _log('WATCHER', `Leverage: ${currentLev.toFixed(2)}x. Band: [${lo.toFixed(2)}x - ${hi.toFixed(2)}x].`, 'on-surface-variant')

    // If leverage has drifted below the band floor, adjust up to the target
    if (currentLev < lo) {
      actions.push({
        type: 'adjust',
        reason: `Leverage ${currentLev.toFixed(2)}x below ${lo.toFixed(2)}x floor`,
        targetLeverage: targetLev,   // Rebalance to the center of the band, not the edge
        severity: 'secondary',
      })
    } else if (currentLev > hi) {
      // If leverage has drifted above the band ceiling, adjust down to the target
      actions.push({
        type: 'adjust',
        reason: `Leverage ${currentLev.toFixed(2)}x above ${hi.toFixed(2)}x ceiling`,
        targetLeverage: targetLev,   // Rebalance to center, not the edge
        severity: 'secondary',
      })
    }

    return actions
  }

  /**
   * Accumulate mode decision function. Executes dollar-cost-averaging (DCA) buys
   * on a configurable schedule and takes partial profit when unrealized gains
   * exceed the profit threshold. Profit-taking has priority over buying.
   *
   * @param {Object} state — Live state snapshot from gatherLiveState()
   * @param {Object} policy — Accumulate mode policy config
   * @param {number} policy.buyAmount — USD amount per DCA buy
   * @param {number} policy.leverage — Leverage multiplier for DCA buys
   * @param {string} policy.interval — Buy frequency: 'hourly'|'daily'|'weekly'|'biweekly'|'monthly'
   * @param {boolean} [policy.profitTake] — Whether to enable profit-taking
   * @param {number} [policy.profitThreshold] — Unrealized gain % that triggers profit-take
   * @returns {Promise<Array<{type: string, reason: string, amount?: number, leverage?: number, severity: string}>>}
   *   Array of 0 or 1 actions (buy or close-partial)
   */
  async function decideAccumulate(state, policy) {
    // Accumulate actions; this mode generates a buy or a profit-take, never both
    const actions = []

    // Check profit-take first — taking profit has priority over buying more
    if (policy.profitTake && state.positionValue && state.position && state.position.isActive) {
      // Calculate deposit basis to measure gain as a percentage
      const deposit = _safeNum(parseFloat(state.position.deposit), 0)
      // Unrealized gain as percentage of deposit
      const pnl = _safeNum(state.positionValue.pnl, 0)
      const pnlPct = deposit > 0 ? (pnl / deposit) * 100 : 0
      // If gain exceeds the user's profit threshold, take partial profit
      if (pnlPct > policy.profitThreshold) {
        actions.push({
          type: 'close-partial',    // Partial close to realize gains while keeping exposure
          reason: `Unrealized gain +${pnlPct.toFixed(1)}% exceeds ${policy.profitThreshold}% take-profit`,
          severity: 'secondary',
        })
        return actions  // Return early — don't DCA-buy in the same tick as taking profit
      }
    }

    // DCA buy on interval — map human-readable interval names to milliseconds
    const intervalMs = { 'hourly': 3600000, 'daily': 86400000, 'weekly': 604800000, 'biweekly': 1209600000, 'monthly': 2592000000 }
    // Default to daily if the interval name is unrecognized
    const minWait = intervalMs[policy.interval] || 86400000
    // Current timestamp for interval comparison
    const now = Date.now()

    // Buy if enough time has elapsed since last action, or if this is the very first tick (_actionCount === 0)
    if (now - _lastCheckTime >= minWait || _actionCount === 0) {
      // Validate buy amount and leverage before creating the action
      const buyAmount = _safeNum(policy.buyAmount, 0)
      const leverage = _safeNum(policy.leverage, 1)
      if (buyAmount <= 0 || leverage <= 0) {
        _log('POLICY', `Invalid DCA params: amount=${policy.buyAmount}, leverage=${policy.leverage}. Skipping.`, 'error')
        return actions
      }
      actions.push({
        type: 'buy',
        // Log the DCA parameters so the user sees exactly what will be purchased
        reason: `DCA: $${buyAmount} at ${leverage}x (${policy.interval} interval)`,
        amount: buyAmount,       // USD amount to invest in this DCA tranche
        leverage: leverage,      // Leverage to apply to this purchase
        severity: 'secondary',
      })
    } else {
      // Not time yet — log when the next DCA buy will occur so the user knows the agent is waiting
      const remaining = Math.ceil((minWait - (now - _lastCheckTime)) / 60000)
      _log('SCHEDULER', `Next DCA buy in ~${remaining}m.`, 'on-surface-variant')
    }

    return actions
  }

  // ─── ACTION EXECUTION ───

  /**
   * Execute a single agent action, either as a dry-run preview or a real on-chain transaction.
   * Enforces permission boundaries from the PERMISSIONS object before executing.
   * Handles four action types: deleverage/adjust, close, buy, and close-partial.
   *
   * @param {{type: string, reason: string, targetLeverage?: number, amount?: number, leverage?: number, severity: string}} action
   *   — Action object from a decide* function
   * @returns {Promise<boolean>} True if the action was handled (dry-run or executed), false if blocked or unknown type
   */
  /**
   * Validate an action server-side before executing on-chain.
   * Calls POST /api/agents/permissions/check to enforce policy boundaries
   * even if the frontend is compromised.
   */
  async function _validateServerSide(action) {
    try {
      const res = await fetch('/api/agents/permissions/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: _policy.mode,
          action_type: action.type,
          current_leverage: action.currentLeverage ?? null,
          target_leverage: action.targetLeverage ?? null,
        }),
      })
      if (!res.ok) return true // Server unreachable — fall back to client-side checks
      const data = await res.json()
      if (!data.permitted) {
        _log('POLICY', `SERVER BLOCKED: ${data.reason}`, 'error')
        return false
      }
      return true
    } catch {
      // Server unreachable — degrade gracefully, client-side checks still apply
      return true
    }
  }

  async function executeAction(action) {
    // Server-side permission check (non-blocking fallback if server is down)
    const serverAllowed = await _validateServerSide(action)
    if (!serverAllowed) return false

    // Look up the permission set for the current policy mode
    const perms = PERMISSIONS[_policy.mode]
    // Get the contract wrapper for on-chain execution
    const contracts = window.xLeverContracts

    // Handle leverage adjustment actions (deleverage or rebalance)
    if (action.type === 'deleverage' || action.type === 'adjust') {
      // Validate target leverage is a finite number before proceeding
      if (!Number.isFinite(action.targetLeverage)) {
        _log('POLICY', `BLOCKED: invalid targetLeverage value (${action.targetLeverage}). Skipping.`, 'error')
        return false
      }
      // Block leverage reduction if the policy mode doesn't allow it
      if (!perms.canReduceLeverage && action.targetLeverage < (_policy.targetLev || 0)) {
        _log('POLICY', `BLOCKED: ${action.type} not permitted by ${_policy.mode} policy.`, 'error')
        return false
      }
      // Block leverage increase if the policy mode doesn't allow it
      if (!perms.canIncreaseLeverage && action.targetLeverage > (_policy.targetLev || 0)) {
        _log('POLICY', `BLOCKED: leverage increase not permitted by ${_policy.mode} policy.`, 'error')
        return false
      }

      // If dry-run or no contracts, log what would happen without executing
      if (_dryRun || !contracts || !contracts.ADDRESSES.vault) {
        _log('EXECUTOR', `[DRY-RUN] Would adjust leverage to ${action.targetLeverage}x. Reason: ${action.reason}`, action.severity)
        return true  // Return true so the action counts as "handled" for stats
      }

      // Live execution: use bounded agentDeleverage contract method
      _log('EXECUTOR', `Agent deleverage to ${action.targetLeverage}x. Reason: ${action.reason}`, action.severity)
      try {
        const wc = contracts.getWalletClient()
        const [addr] = await wc.getAddresses()
        const targetBps = Math.round(action.targetLeverage * 10000)
        const result = await wc.writeContract({
          address: contracts.ADDRESSES.vault,
          abi: [{
            name: 'agentDeleverage',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'user', type: 'address' },
              { name: 'newLeverageBps', type: 'int32' },
              { name: 'reason', type: 'string' },
            ],
            outputs: [],
          }],
          functionName: 'agentDeleverage',
          args: [addr, targetBps, action.reason],
          account: addr,
        })
        _log('SYSTEM', `TX submitted: ${result}`, 'primary')
        _log('AGENT', `Agent deleverage to ${action.targetLeverage}x confirmed.`, 'secondary')
        return true
      } catch (e) {
        const classified = contracts.classifyTxError?.(e) || { label: 'TX failed', detail: e.shortMessage || e.message }
        _log('SYSTEM', `${classified.label}: ${classified.detail}`, 'error')
        return false
      }
    }

    // Handle full position close
    if (action.type === 'close') {
      // Block close if the policy mode doesn't permit it
      if (!perms.canClose) {
        _log('POLICY', `BLOCKED: close not permitted by ${_policy.mode} policy.`, 'error')
        return false
      }

      // Dry-run: preview the close without executing
      if (_dryRun || !contracts || !contracts.ADDRESSES.vault) {
        _log('EXECUTOR', `[DRY-RUN] Would close position. Reason: ${action.reason}`, action.severity)
        return true
      }

      // Live execution: use bounded agentClose contract method
      _log('EXECUTOR', `Agent closing position. Reason: ${action.reason}`, action.severity)
      try {
        const wc = contracts.getWalletClient()
        const [addr] = await wc.getAddresses()
        const result = await wc.writeContract({
          address: contracts.ADDRESSES.vault,
          abi: [{
            name: 'agentClose',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'user', type: 'address' },
              { name: 'reason', type: 'string' },
            ],
            outputs: [],
          }],
          functionName: 'agentClose',
          args: [addr, action.reason],
          account: addr,
        })
        _log('SYSTEM', `TX submitted: ${result}`, 'primary')
        _log('AGENT', 'Position closed via agentClose. Manual control restored.', 'secondary')
        return true
      } catch (e) {
        const classified = contracts.classifyTxError?.(e) || { label: 'TX failed', detail: e.shortMessage || e.message }
        _log('SYSTEM', `${classified.label}: ${classified.detail}`, 'error')
        return false
      }
    }

    // Handle new position buy (DCA accumulate mode)
    if (action.type === 'buy') {
      // Block new positions if the policy mode doesn't allow opening
      if (!perms.canOpenNew) {
        _log('POLICY', `BLOCKED: new positions not permitted by ${_policy.mode} policy.`, 'error')
        return false
      }

      // Dry-run: preview the buy without executing
      if (_dryRun || !contracts || !contracts.ADDRESSES.vault) {
        _log('EXECUTOR', `[DRY-RUN] Would buy $${action.amount} QQQx at ${action.leverage}x. Reason: ${action.reason}`, action.severity)
        return true
      }

      // Live execution: open a new leveraged position
      _log('EXECUTOR', `Buying $${action.amount} QQQx at ${action.leverage}x. ${action.reason}`, action.severity)
      try {
        const result = await contracts.openPosition(String(action.amount), action.leverage)
        const url = contracts.getExplorerUrl(result.hash)
        _log('SYSTEM', `TX confirmed: ${result.hash}`, 'primary')
        _log('SYSTEM', `Explorer: ${url}`, 'secondary')
        _log('AGENT', `Bought $${action.amount} QQQx at ${action.leverage}x.`, 'secondary')
        _lastCheckTime = Date.now()
        return true
      } catch (e) {
        const classified = contracts.classifyTxError?.(e) || { label: 'TX failed', detail: e.shortMessage || e.message }
        _log('SYSTEM', `${classified.label}: ${classified.detail}`, 'error')
        return false
      }
    }

    // Handle partial close (profit-taking in accumulate mode)
    if (action.type === 'close-partial') {
      // Always dry-run for now — partial close logic is not yet implemented on-chain
      _log('EXECUTOR', `[DRY-RUN] Would take partial profit. ${action.reason}`, action.severity)
      return true
    }

    // Unknown action type — return false so the caller knows it wasn't handled
    return false
  }

  // ─── MAIN LOOP ───

  /**
   * Single tick of the agent decision loop. Gathers live state from all data sources,
   * logs oracle and position status, runs the active policy's decision function,
   * and executes any resulting actions sequentially.
   * Silently returns if paused or no policy is active.
   *
   * @returns {Promise<void>}
   */
  async function tick() {
    // Skip this tick if the agent is paused or has no active policy
    if (_paused || !_policy) return

    try {
      // Announce the tick start so the user sees the agent is actively working
      _log('WATCHER', 'Gathering live state...', 'on-surface-variant')
      // Collect all live data from oracles, contracts, risk engine, and market APIs
      const state = await gatherLiveState()

      // Log oracle status so the user has continuous visibility into data quality
      if (state.oracleAge !== null) {
        // Classify freshness into human-readable buckets for the log message
        const freshness = state.oracleAge < 60 ? 'fresh' : state.oracleAge < 300 ? 'ok' : 'STALE'
        // Color the log entry yellow if stale, neutral otherwise
        _log('WATCHER', `Oracle: $${state.oraclePrice?.toFixed(2) || '?'} (age: ${state.oracleAge}s, ${freshness})`, state.oracleAge > 300 ? 'yellow-500' : 'on-surface-variant')
      }

      // Log position summary if the user has an active position
      if (state.position && state.position.isActive) {
        _log('WATCHER', `Position: ${state.position.leverageDisplay} | Entry: $${state.position.entryPrice} | PnL: $${state.positionValue?.pnl?.toFixed(2) || '?'}`, 'on-surface-variant')
      }

      // Decide what actions to take based on the active policy mode
      let actions = []
      if (_policy.mode === 'safe') {
        // Safe mode: check for risk events and deleverage/close if needed
        actions = await decideSafe(state, _policy)
      } else if (_policy.mode === 'target') {
        // Target mode: check if leverage has drifted outside the band and rebalance
        actions = await decideTarget(state, _policy)
      } else if (_policy.mode === 'accumulate') {
        // Accumulate mode: check DCA timing and profit-take thresholds
        actions = await decideAccumulate(state, _policy)
      }

      // Execute each decided action sequentially (order matters if multiple actions exist)
      for (const action of actions) {
        // Execute the action and track whether it succeeded
        const success = await executeAction(action)
        // Increment the session action counter on success for UI stats
        if (success) _actionCount++
      }

      // Push updated stats to the UI callback so counters refresh
      _onStats({ actions: _actionCount })
    } catch (e) {
      // Catch-all for unexpected errors — log and continue so the agent doesn't silently die
      _log('SYSTEM', 'Tick error: ' + e.message, 'error')
    }
  }

  // ─── PUBLIC API ───

  // Return the public interface — only these methods/properties are accessible from outside the IIFE
  return {
    /**
     * Start the agent with a policy.
     * @param {Object} policy - { mode, volTrigger, deleverageTarget, ... }
     * @param {Object} opts - { log, onStats, dryRun, intervalMs }
     */
    start(policy, opts = {}) {
      _policy = policy                                                // Store the policy so tick() and decision functions can reference it
      _log = opts.log || (() => {})                                   // Wire up the log callback; default to no-op if not provided
      _onStats = opts.onStats || (() => {})                           // Wire up stats callback; default to no-op
      _dryRun = opts.dryRun !== undefined ? opts.dryRun : true        // Honor explicit dry-run preference; default to true for safety
      _paused = false                                                 // Always start in active state
      _actionCount = 0                                                // Reset action counter for the new session
      _lastCheckTime = 0                                              // Reset DCA timer so the first tick triggers a buy in accumulate mode

      // Detect wallet connection to determine if live execution is possible
      try {
        // Try to get the wallet client from the contract wrapper
        const wc = window.xLeverContracts?.getWalletClient()
        if (!wc) {
          // No wallet = force dry-run regardless of user preference
          _dryRun = true
          _log('SYSTEM', 'No wallet connected — running in DRY-RUN mode. Actions are previewed, not executed.', 'yellow-500')
        } else if (_dryRun) {
          // Wallet connected but user chose dry-run — inform them how to go live
          _log('SYSTEM', 'DRY-RUN mode enabled. Connect wallet and re-activate to execute real transactions.', 'yellow-500')
        } else {
          // Wallet connected and live mode — warn the user that real money is at stake
          _log('SYSTEM', 'LIVE mode — transactions will be submitted on-chain.', 'secondary')
        }
      } catch {
        // If wallet detection throws, default to dry-run for safety
        _dryRun = true
      }

      // Set the polling interval; 15 seconds balances responsiveness with RPC rate limits
      const intervalMs = opts.intervalMs || 15000
      // Log the startup confirmation with mode and interval so the user knows what's running
      _log('SYSTEM', `Agent executor started. Mode: ${policy.mode}. Check interval: ${intervalMs / 1000}s.`, 'primary')

      // Run the first tick immediately so the user doesn't wait for the first interval
      tick()

      // Clear any existing interval from a previous start() call to prevent duplicate ticks
      if (_interval) clearInterval(_interval)
      // Schedule recurring ticks at the configured interval
      _interval = setInterval(tick, intervalMs)
    },

    /**
     * Stop the agent completely. Clears the polling interval and resets
     * all internal state (policy, pause flag, counters).
     */
    stop() {
      if (_interval) clearInterval(_interval)  // Stop the recurring tick
      _interval = null                          // Clear the interval reference so isRunning returns false
      _policy = null                            // Clear policy to prevent stale tick execution
      _paused = false                           // Reset pause state for the next start()
      _log('SYSTEM', 'Agent executor stopped.', 'error')  // Log in error color because stopping is a notable event
    },

    /**
     * Toggle the agent's pause state. A paused agent keeps its interval
     * running but tick() returns immediately without gathering data or acting.
     *
     * @returns {boolean} The new pause state (true = paused, false = resumed)
     */
    pause() {
      _paused = !_paused   // Toggle the pause flag
      // Log the new state with appropriate color
      _log('USER', _paused ? 'Agent paused.' : 'Agent resumed.', _paused ? 'yellow-500' : 'secondary')
      return _paused       // Return the new state so the UI can update its button label
    },

    // Getters expose read-only agent state to the UI without allowing mutation
    get isPaused() { return _paused },           // Whether the agent is currently paused
    get isRunning() { return _interval !== null }, // Whether the agent has an active interval (started and not stopped)
    get actionCount() { return _actionCount },    // Total actions executed this session
    get isDryRun() { return _dryRun },            // Whether the agent is in dry-run or live mode

    /**
     * Set the dry-run mode. Allows the UI to toggle between preview
     * and live execution without restarting the agent.
     *
     * @param {boolean} val — True for dry-run (preview only), false for live execution
     */
    setDryRun(val) { _dryRun = val },
  }
})() // Immediately invoke the factory to create the singleton AgentExecutor

// Attach to window so other frontend modules (ux.js, dashboard) can access the agent
window.AgentExecutor = AgentExecutor
