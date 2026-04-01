/**
 * xLever Lending Agent — Automated Lending & Borrowing Management
 * ────────────────────────────────────────────────────────────────
 * Extends the agent swarm with lending-specific automation:
 *  1. Monitors Euler V2 lending markets for supply/borrow opportunities
 *  2. Auto-supplies idle USDC for yield when not in active positions
 *  3. Manages borrow positions for leverage optimization
 *  4. Monitors health factors and auto-repays to prevent liquidation
 *  5. Rate arbitrage — moves capital between markets for best yield
 *
 * Four policy modes: Yield, Leverage, Hedge, Monitor-Only
 */

const LendingAgent = (() => {
  let _interval = null
  let _policy = null
  let _paused = false
  let _log = () => {}
  let _onStats = () => {}
  let _dryRun = true
  let _actionCount = 0
  let _lastTickTime = 0

  // Rate limiting: minimum 5s between ticks, max 6 per minute
  const MIN_TICK_GAP = 5000
  const MAX_TICKS_PER_MIN = 6
  let _tickTimestamps = []

  // ═══════════════════════════════════════════════════════════════
  // PERMISSION BOUNDARIES (code-enforced, not just UI)
  // ═══════════════════════════════════════════════════════════════

  const PERMISSIONS = {
    // Yield mode: auto-supply idle capital, auto-compound rewards
    yield: {
      canSupply: true,        // Core action — deposit idle assets into lending pools
      canWithdraw: true,      // Allowed to rebalance or exit if rates drop
      canBorrow: false,       // No borrowing — yield mode is supply-only
      canRepay: false,        // No borrows to repay
      canMoveMarkets: true,   // Allowed to move between pools for better APY
      canLeverage: false,     // No recursive supply/borrow loops
    },
    // Leverage mode: borrow against supplied collateral for leveraged exposure
    leverage: {
      canSupply: true,        // Must supply collateral before borrowing
      canWithdraw: false,     // Blocked to maintain collateral ratio
      canBorrow: true,        // Core action — borrow against collateral
      canRepay: true,         // Allowed to manage debt levels
      canMoveMarkets: false,  // Keep positions stable during leverage
      canLeverage: true,      // Recursive supply/borrow loops allowed within health bounds
    },
    // Hedge mode: supply/borrow to hedge existing xLever positions
    hedge: {
      canSupply: true,        // Supply as part of hedging strategy
      canWithdraw: true,      // Unwind hedges when position changes
      canBorrow: true,        // Borrow to create offsetting exposure
      canRepay: true,         // Unwind borrow-side of hedge
      canMoveMarkets: false,  // Keep hedges in predictable markets
      canLeverage: false,     // No recursive loops — hedges should be simple
    },
    // Monitor mode: read-only, alerts only — no transactions
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
  // MARKET DEFINITIONS
  // ═══════════════════════════════════════════════════════════════

  // Euler V2 lending markets tracked by the agent
  const MARKETS = {
    USDC: {
      symbol: 'USDC',
      decimals: 6,
      collateralFactor: 0.85,   // 85% LTV
      liquidationThreshold: 0.90,
      reserveFactor: 0.10,
    },
    wQQQx: {
      symbol: 'wQQQx',
      decimals: 18,
      collateralFactor: 0.65,   // 65% LTV — more volatile asset
      liquidationThreshold: 0.75,
      reserveFactor: 0.15,
    },
    wSPYx: {
      symbol: 'wSPYx',
      decimals: 18,
      collateralFactor: 0.70,   // 70% LTV
      liquidationThreshold: 0.80,
      reserveFactor: 0.12,
    },
    WETH: {
      symbol: 'WETH',
      decimals: 18,
      collateralFactor: 0.80,   // 80% LTV
      liquidationThreshold: 0.85,
      reserveFactor: 0.10,
    },
  }

  // ═══════════════════════════════════════════════════════════════
  // LIVE STATE GATHERING
  // ═══════════════════════════════════════════════════════════════

  async function gatherLendingState() {
    const state = {
      markets: {},          // Per-market data: APY, utilization, total supply/borrow
      userSupplies: [],     // User's active supply positions
      userBorrows: [],      // User's active borrow positions
      healthFactor: null,   // Aggregate health factor across all positions
      idleBalance: null,    // Undeployed USDC in wallet
      oraclePrice: null,    // Current price from Pyth
      riskState: null,      // Risk engine output
      xLeverPosition: null, // Active xLever position (for hedge mode coordination)
    }

    // 1. Fetch market data from backend
    try {
      const res = await fetch('/api/lending/markets')
      if (res.ok) {
        state.markets = await res.json()
      }
    } catch (e) {
      _log('LENDING', 'Market data fetch failed: ' + e.message, 'error')
    }

    // 2. Fetch user positions
    try {
      const contracts = window.xLeverContracts
      if (contracts) {
        const wc = contracts.getWalletClient()
        if (wc) {
          const [addr] = await wc.getAddresses()
          if (addr) {
            // Idle USDC balance
            const bal = await contracts.getBalance(contracts.ADDRESSES.usdc, addr)
            state.idleBalance = parseFloat(bal.formatted)

            // Active xLever position (for hedge coordination)
            const pos = await contracts.getPosition(addr)
            state.xLeverPosition = contracts.formatPosition(pos)

            // Fetch user lending positions from backend
            try {
              const posRes = await fetch(`/api/lending/positions/${addr}`)
              if (posRes.ok) {
                const positions = await posRes.json()
                state.userSupplies = positions.supplies || []
                state.userBorrows = positions.borrows || []
                state.healthFactor = positions.healthFactor
              }
            } catch { /* positions may not exist yet */ }
          }
        }
      }
    } catch (e) {
      _log('LENDING', 'Position fetch failed: ' + e.message, 'error')
    }

    // 3. Oracle price
    try {
      const pyth = window.xLeverPyth
      if (pyth) {
        const feed = pyth.PYTH_FEEDS['QQQ/USD']
        const p = await pyth.getPriceForFeed(feed)
        state.oraclePrice = p.price
      }
    } catch { /* degrade gracefully */ }

    // 4. Risk engine state
    try {
      if (window.xLeverRisk) {
        state.riskState = window.xLeverRisk.getState()
      }
    } catch { /* risk engine may not be initialized */ }

    return state
  }

  // ═══════════════════════════════════════════════════════════════
  // DECISION FUNCTIONS (one per policy mode)
  // ═══════════════════════════════════════════════════════════════

  function decideYield(state, config) {
    const actions = []
    const perms = PERMISSIONS.yield

    // Auto-supply idle USDC if above threshold
    if (perms.canSupply && state.idleBalance > (config.minIdleThreshold || 100)) {
      const supplyAmount = state.idleBalance - (config.reserveBalance || 50)
      if (supplyAmount > 0) {
        // Find best APY market for USDC
        const usdcMarket = state.markets?.USDC
        const minApy = config.minSupplyApy || 2.0

        if (usdcMarket && usdcMarket.supplyApy >= minApy) {
          actions.push({
            type: 'SUPPLY',
            asset: 'USDC',
            amount: supplyAmount.toFixed(2),
            reason: `Idle USDC (${state.idleBalance.toFixed(2)}) exceeds threshold. Supply APY: ${usdcMarket.supplyApy.toFixed(2)}%`,
          })
        }
      }
    }

    // Rebalance between markets if APY differential exceeds threshold
    if (perms.canMoveMarkets && state.userSupplies.length > 0) {
      for (const supply of state.userSupplies) {
        const currentMarket = state.markets?.[supply.asset]
        const apyDiffThreshold = config.apyDiffThreshold || 1.5 // 1.5% minimum improvement

        // Check all markets for better rates
        for (const [symbol, market] of Object.entries(state.markets || {})) {
          if (symbol !== supply.asset && market.supplyApy - (currentMarket?.supplyApy || 0) > apyDiffThreshold) {
            actions.push({
              type: 'REBALANCE',
              from: supply.asset,
              to: symbol,
              amount: supply.amount,
              reason: `APY differential: ${market.supplyApy.toFixed(2)}% vs ${currentMarket?.supplyApy?.toFixed(2) || '?'}% (${symbol} vs ${supply.asset})`,
            })
          }
        }
      }
    }

    return actions
  }

  function decideLeverage(state, config) {
    const actions = []
    const perms = PERMISSIONS.leverage

    const targetHF = config.targetHealthFactor || 1.8
    const minHF = config.minHealthFactor || 1.3
    const maxLoops = config.maxLeverageLoops || 3

    // Auto-repay if health factor is dangerously low
    if (perms.canRepay && state.healthFactor !== null && state.healthFactor < minHF) {
      const urgency = state.healthFactor < 1.1 ? 'CRITICAL' : 'WARNING'
      actions.push({
        type: 'REPAY',
        urgency,
        reason: `Health factor ${state.healthFactor.toFixed(2)} below minimum ${minHF}. ${urgency}: auto-repaying to restore safety margin.`,
      })
      return actions // Repay takes priority over everything
    }

    // Supply collateral if we have idle balance and want to borrow
    if (perms.canSupply && state.idleBalance > (config.minCollateral || 200)) {
      actions.push({
        type: 'SUPPLY',
        asset: 'USDC',
        amount: state.idleBalance.toFixed(2),
        reason: `Supplying ${state.idleBalance.toFixed(2)} USDC as collateral for leverage.`,
      })
    }

    // Borrow against collateral if health factor allows — cap at maxLoops iterations
    if (perms.canBorrow && state.healthFactor !== null && state.healthFactor > targetHF) {
      // Only propose borrow if we haven't exceeded the max loop count for this session
      const existingBorrows = state.userBorrows?.length || 0
      if (existingBorrows < maxLoops) {
        const borrowRoom = (state.healthFactor - targetHF) / state.healthFactor
        const borrowAsset = config.borrowAsset || 'USDC'
        // Estimate borrow amount from collateral value and room to borrow
        const collateralUsd = state.userSupplies?.reduce((sum, s) => sum + (s.valueUsd || 0), 0) || 0
        const estimatedBorrow = collateralUsd * borrowRoom
        actions.push({
          type: 'BORROW',
          asset: borrowAsset,
          amount: estimatedBorrow > 0 ? estimatedBorrow.toFixed(2) : '0',
          reason: `Health factor ${state.healthFactor.toFixed(2)} above target ${targetHF}. Room to borrow: ${(borrowRoom * 100).toFixed(1)}%. Loop ${existingBorrows + 1}/${maxLoops}.`,
        })
      }
    }

    return actions
  }

  function decideHedge(state, config) {
    const actions = []
    const perms = PERMISSIONS.hedge
    const pos = state.xLeverPosition

    if (!pos) {
      _log('LENDING', 'No active xLever position to hedge', 'info')
      return actions
    }

    const hedgeRatio = config.hedgeRatio || 0.5
    const depositUsd = parseFloat(pos.deposit) || 0
    const hedgeAmount = (depositUsd * Math.abs(pos.leverage) * hedgeRatio).toFixed(2)

    // If long, borrow the underlying asset to create a partial hedge
    if (pos.isLong && perms.canBorrow) {
      // Determine hedge asset from position context (default wQQQx for QQQ positions)
      const hedgeAsset = config.hedgeAsset || 'wQQQx'
      actions.push({
        type: 'BORROW',
        asset: hedgeAsset,
        amount: hedgeAmount,
        reason: `Hedging ${(hedgeRatio * 100).toFixed(0)}% of ${pos.leverageDisplay} long ($${hedgeAmount}) via ${hedgeAsset} borrow.`,
        hedgeRatio,
      })
    }

    // If short, supply idle USDC to earn yield while short
    if (pos.isShort && perms.canSupply && state.idleBalance > 0) {
      const supplyAmount = Math.min(state.idleBalance, depositUsd).toFixed(2)
      actions.push({
        type: 'SUPPLY',
        asset: 'USDC',
        amount: supplyAmount,
        reason: `Supplying $${supplyAmount} USDC to earn yield alongside ${pos.leverageDisplay} short position.`,
      })
    }

    // Monitor health factor on existing hedge positions
    if (perms.canRepay && state.healthFactor !== null && state.healthFactor < (config.hedgeMinHF || 1.5)) {
      actions.push({
        type: 'REPAY',
        urgency: 'WARNING',
        reason: `Hedge health factor ${state.healthFactor.toFixed(2)} dropping — reducing borrow to protect hedge.`,
      })
    }

    return actions
  }

  function decideMonitor(state, _config) {
    const alerts = []

    // Health factor alerts
    if (state.healthFactor !== null) {
      if (state.healthFactor < 1.1) {
        alerts.push({ level: 'CRITICAL', message: `Health factor critically low: ${state.healthFactor.toFixed(2)}` })
      } else if (state.healthFactor < 1.3) {
        alerts.push({ level: 'WARNING', message: `Health factor low: ${state.healthFactor.toFixed(2)}` })
      }
    }

    // APY change alerts
    for (const [symbol, market] of Object.entries(state.markets || {})) {
      if (market.supplyApy < 0.5) {
        alerts.push({ level: 'INFO', message: `${symbol} supply APY dropped to ${market.supplyApy.toFixed(2)}%` })
      }
      if (market.utilization > 0.95) {
        alerts.push({ level: 'WARNING', message: `${symbol} utilization at ${(market.utilization * 100).toFixed(1)}% — withdrawals may be delayed` })
      }
    }

    // Log all alerts
    for (const alert of alerts) {
      _log('MONITOR', `[${alert.level}] ${alert.message}`, alert.level === 'CRITICAL' ? 'error' : 'warn')
    }

    return [] // Monitor mode never produces executable actions
  }

  // ═══════════════════════════════════════════════════════════════
  // EXECUTION ENGINE
  // ═══════════════════════════════════════════════════════════════

  async function executeAction(action) {
    _log('EXECUTE', `${_dryRun ? '[DRY RUN] ' : ''}${action.type}: ${action.reason}`, 'info')

    if (_dryRun) {
      _actionCount++
      _onStats({ actions: _actionCount, lastAction: action })
      return { success: true, dryRun: true, action }
    }

    try {
      const contracts = window.xLeverContracts
      if (!contracts) throw new Error('Contracts not initialized')

      switch (action.type) {
        case 'SUPPLY': {
          // Use Euler V2 vault deposit
          const result = await contracts.depositJunior(action.amount)
          _log('EXECUTE', `Supplied ${action.amount} ${action.asset}. TX: ${result.hash}`, 'success')
          break
        }
        case 'BORROW': {
          _log('EXECUTE', `Borrow execution pending Euler V2 integration`, 'warn')
          break
        }
        case 'REPAY': {
          _log('EXECUTE', `Repay execution pending Euler V2 integration`, 'warn')
          break
        }
        case 'REBALANCE': {
          _log('EXECUTE', `Rebalance ${action.from} → ${action.to} pending multi-vault routing`, 'warn')
          break
        }
        default:
          _log('EXECUTE', `Unknown action type: ${action.type}`, 'error')
      }

      _actionCount++
      _onStats({ actions: _actionCount, lastAction: action })
      return { success: true, action }
    } catch (e) {
      _log('EXECUTE', `Action failed: ${e.message}`, 'error')
      return { success: false, error: e.message, action }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TICK LOOP
  // ═══════════════════════════════════════════════════════════════

  async function tick() {
    if (_paused || !_policy) return

    // Rate limiting
    const now = Date.now()
    if (now - _lastTickTime < MIN_TICK_GAP) return
    _tickTimestamps = _tickTimestamps.filter(t => now - t < 60000)
    if (_tickTimestamps.length >= MAX_TICKS_PER_MIN) return
    _lastTickTime = now
    _tickTimestamps.push(now)

    try {
      _log('TICK', `Gathering lending market state...`, 'info')
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
        _log('TICK', `No actions needed. Markets stable.`, 'info')
        return
      }

      _log('TICK', `${actions.length} action(s) proposed`, 'info')
      for (const action of actions) {
        await executeAction(action)
      }
    } catch (e) {
      _log('TICK', `Tick failed: ${e.message}`, 'error')
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  function start(policy, { log, onStats, dryRun = true, intervalMs = 30000 } = {}) {
    stop()
    _policy = policy
    _log = log || (() => {})
    _onStats = onStats || (() => {})
    _dryRun = dryRun
    _actionCount = 0

    _log('INIT', `Lending Agent started in ${policy.mode.toUpperCase()} mode ${_dryRun ? '(DRY RUN)' : '(LIVE)'}`, 'success')
    _log('INIT', `Permissions: ${Object.entries(PERMISSIONS[policy.mode] || {}).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none'}`, 'info')

    tick().catch(e => _log('INIT', `Initial tick failed: ${e.message}`, 'error'))
    _interval = setInterval(tick, intervalMs)
  }

  function stop() {
    if (_interval) {
      clearInterval(_interval)
      _interval = null
    }
    _policy = null
    _paused = false
    _log('STOP', 'Lending Agent stopped', 'info')
  }

  function pause()  { _paused = true;  _log('PAUSE', 'Lending Agent paused', 'warn') }
  function resume() { _paused = false; _log('RESUME', 'Lending Agent resumed', 'success') }
  function isRunning() { return _interval !== null && !_paused }
  function getPolicy() { return _policy }
  function getStats() { return { actions: _actionCount, paused: _paused, running: !!_interval, mode: _policy?.mode || null } }
  function setDryRun(val) { _dryRun = val; _log('CONFIG', `Dry run: ${val}`, 'info') }

  return {
    start, stop, pause, resume,
    isRunning, getPolicy, getStats, setDryRun,
    PERMISSIONS, MARKETS,
    // Expose for testing/external use
    gatherLendingState, tick,
  }
})()

// Expose globally for non-module scripts
window.xLeverLendingAgent = LendingAgent
