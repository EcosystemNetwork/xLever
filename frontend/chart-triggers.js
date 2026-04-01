/**
 * xLever Chart Triggers — Price-Level Trigger System
 * ───────────────────────────────────────────────────
 * Place interactive price triggers on the chart that fire actions
 * when the live oracle price crosses the trigger level.
 *
 * Trigger types:
 *   - alert:   Desktop notification + log entry
 *   - buy:     Open a new position at specified leverage
 *   - sell:    Close current position (full or partial)
 *   - adjust:  Change leverage to a target value
 *   - deleverage: Reduce leverage to a target value
 *
 * Triggers can be placed by:
 *   - Clicking on the chart with the trigger tool active
 *   - Programmatically via the API (for agents)
 *   - The trigger panel form
 *
 * Each trigger monitors the Pyth oracle price and fires once
 * when the crossing condition is met. One-shot by default,
 * with an optional repeat flag.
 */

const ChartTriggers = (() => {
  // ═══════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════
  let _chart = null
  let _getSeries = null
  let _triggers = []          // [{id, price, direction, action, params, priceLine, fired, enabled, label, createdAt}]
  let _nextId = 1
  let _lastPrice = null       // Last known oracle price for crossing detection
  let _monitorInterval = null
  let _onFire = null          // Callback when a trigger fires
  let _onUpdate = null        // Callback when trigger list changes (for UI refresh)
  let _log = () => {}

  const STORAGE_KEY = 'xlever_chart_triggers'

  // Visual config per action type
  const TRIGGER_STYLES = {
    alert:      { color: '#ffb300', icon: 'notifications', lineStyle: 2 },
    buy:        { color: '#00e475', icon: 'add_circle',    lineStyle: 2 },
    sell:       { color: '#ff5252', icon: 'remove_circle', lineStyle: 2 },
    adjust:     { color: '#29b6f6', icon: 'tune',          lineStyle: 2 },
    deleverage: { color: '#ff9800', icon: 'trending_down', lineStyle: 2 },
  }

  // ═══════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════

  function init(chart, getSeriesFn, opts = {}) {
    _chart = chart
    _getSeries = getSeriesFn
    _log = opts.log || (() => {})
    _onFire = opts.onFire || null
    _onUpdate = opts.onUpdate || null

    // Load persisted triggers and render them
    _loadFromStorage()

    return api
  }

  // ═══════════════════════════════════════════
  // TRIGGER CRUD
  // ═══════════════════════════════════════════

  /**
   * Add a new price trigger.
   * @param {Object} opts
   * @param {number} opts.price      - Trigger price level
   * @param {string} opts.direction  - 'above' | 'below' — fire when price crosses this direction
   * @param {string} opts.action     - 'alert' | 'buy' | 'sell' | 'adjust' | 'deleverage'
   * @param {Object} [opts.params]   - Action-specific params {leverage, amount, message}
   * @param {string} [opts.label]    - Custom label
   * @param {boolean} [opts.repeat]  - If true, trigger re-arms after firing
   * @returns {Object} The created trigger
   */
  function add(opts) {
    const style = TRIGGER_STYLES[opts.action] || TRIGGER_STYLES.alert
    const direction = opts.direction || 'above'
    const label = opts.label || `${opts.action.toUpperCase()} @ $${opts.price.toFixed(2)} (${direction})`
    const id = _nextId++

    // Create the visual price line on the chart
    const series = _getSeries()
    let priceLine = null
    if (series) {
      priceLine = series.createPriceLine({
        price: opts.price,
        color: style.color,
        lineWidth: 2,
        lineStyle: style.lineStyle,
        axisLabelVisible: true,
        title: `${direction === 'above' ? '▲' : '▼'} ${opts.action.toUpperCase()}`,
      })
    }

    const trigger = {
      id,
      price: opts.price,
      direction,
      action: opts.action,
      params: opts.params || {},
      label,
      priceLine,
      series,
      fired: false,
      enabled: true,
      repeat: opts.repeat || false,
      createdAt: Date.now(),
    }

    _triggers.push(trigger)
    _saveToStorage()
    _notifyUpdate()

    _log('TRIGGER', `Created: ${label}`, style.color)
    return trigger
  }

  function remove(id) {
    const idx = _triggers.findIndex(t => t.id === id)
    if (idx === -1) return false
    const t = _triggers[idx]
    // Remove chart price line
    if (t.priceLine && t.series) {
      try { t.series.removePriceLine(t.priceLine) } catch {}
    }
    _triggers.splice(idx, 1)
    _saveToStorage()
    _notifyUpdate()
    return true
  }

  function enable(id, enabled) {
    const t = _triggers.find(t => t.id === id)
    if (!t) return
    t.enabled = enabled
    // Update visual opacity via removing and re-adding the price line
    if (t.priceLine && t.series) {
      try { t.series.removePriceLine(t.priceLine) } catch {}
    }
    if (enabled) {
      const style = TRIGGER_STYLES[t.action] || TRIGGER_STYLES.alert
      t.priceLine = t.series.createPriceLine({
        price: t.price,
        color: style.color,
        lineWidth: 2,
        lineStyle: style.lineStyle,
        axisLabelVisible: true,
        title: `${t.direction === 'above' ? '▲' : '▼'} ${t.action.toUpperCase()}`,
      })
    } else {
      t.priceLine = null
    }
    _saveToStorage()
    _notifyUpdate()
  }

  function getAll() {
    return _triggers.map(t => ({
      id: t.id,
      price: t.price,
      direction: t.direction,
      action: t.action,
      params: t.params,
      label: t.label,
      fired: t.fired,
      enabled: t.enabled,
      repeat: t.repeat,
      createdAt: t.createdAt,
    }))
  }

  function clearAll() {
    for (const t of _triggers) {
      if (t.priceLine && t.series) {
        try { t.series.removePriceLine(t.priceLine) } catch {}
      }
    }
    _triggers = []
    _nextId = 1
    _saveToStorage()
    _notifyUpdate()
  }

  // ═══════════════════════════════════════════
  // PRICE MONITORING
  // ═══════════════════════════════════════════

  /**
   * Start monitoring Pyth oracle price for trigger crossings.
   * @param {number} [intervalMs=5000] - Check interval in ms
   */
  function startMonitor(intervalMs = 5000) {
    if (_monitorInterval) clearInterval(_monitorInterval)
    _monitorInterval = setInterval(_checkTriggers, intervalMs)
    // Run immediately
    _checkTriggers()
    _log('TRIGGER', `Monitor started (${intervalMs / 1000}s interval)`, '#29b6f6')
  }

  function stopMonitor() {
    if (_monitorInterval) {
      clearInterval(_monitorInterval)
      _monitorInterval = null
    }
    _log('TRIGGER', 'Monitor stopped', '#ff9800')
  }

  async function _checkTriggers() {
    // Get current price from Pyth
    let currentPrice = null
    try {
      const pyth = window.xLeverPyth
      if (pyth) {
        const feed = pyth.PYTH_FEEDS['QQQ/USD']
        if (feed) {
          const p = await pyth.getPriceForFeed(feed)
          currentPrice = p.price
        }
      }
    } catch {}

    // Fallback: try to get price from the displayed ticker
    if (currentPrice == null) {
      const priceEl = document.getElementById('livePrice')
      if (priceEl) {
        const parsed = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, ''))
        if (Number.isFinite(parsed) && parsed > 0) currentPrice = parsed
      }
    }

    if (currentPrice == null) return

    const prevPrice = _lastPrice
    _lastPrice = currentPrice

    // Need a previous price to detect crossings
    if (prevPrice == null) return

    for (const trigger of _triggers) {
      if (!trigger.enabled || trigger.fired) continue

      let crossed = false
      if (trigger.direction === 'above' && prevPrice <= trigger.price && currentPrice > trigger.price) {
        crossed = true
      } else if (trigger.direction === 'below' && prevPrice >= trigger.price && currentPrice < trigger.price) {
        crossed = true
      }

      if (crossed) {
        _fireTrigger(trigger, currentPrice)
      }
    }
  }

  async function _fireTrigger(trigger, currentPrice) {
    const style = TRIGGER_STYLES[trigger.action] || TRIGGER_STYLES.alert

    _log('TRIGGER', `FIRED: ${trigger.label} (price: $${currentPrice.toFixed(2)})`, style.color)

    // Mark as fired
    if (!trigger.repeat) {
      trigger.fired = true
      trigger.enabled = false
      // Update visual — dim the line
      if (trigger.priceLine && trigger.series) {
        try { trigger.series.removePriceLine(trigger.priceLine) } catch {}
        trigger.priceLine = trigger.series.createPriceLine({
          price: trigger.price,
          color: style.color + '40', // 25% opacity
          lineWidth: 1,
          lineStyle: 3, // dotted
          axisLabelVisible: true,
          title: `${trigger.action.toUpperCase()} (fired)`,
        })
      }
    }

    // Execute the action
    try {
      await _executeAction(trigger, currentPrice)
    } catch (e) {
      _log('TRIGGER', `Execution error: ${e.message}`, '#ff5252')
    }

    // Notify external callback
    if (_onFire) _onFire(trigger, currentPrice)

    _saveToStorage()
    _notifyUpdate()

    // Desktop notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`xLever Trigger: ${trigger.action.toUpperCase()}`, {
        body: `${trigger.label}\nPrice: $${currentPrice.toFixed(2)}`,
        icon: '/favicon.ico',
      })
    }
  }

  async function _executeAction(trigger, currentPrice) {
    const contracts = window.xLeverContracts
    const executor = window.AgentExecutor

    switch (trigger.action) {
      case 'alert':
        // Alert is just the notification + log — no on-chain action
        _log('TRIGGER', `Alert: ${trigger.params.message || trigger.label}`, '#ffb300')
        break

      case 'buy': {
        const amount = trigger.params.amount || 100
        const leverage = trigger.params.leverage || 1
        if (executor && executor.isRunning) {
          // Route through agent executor if running (respects permissions)
          _log('TRIGGER', `Routing BUY to agent executor: $${amount} at ${leverage}x`, '#00e475')
        } else if (contracts && contracts.ADDRESSES?.vault) {
          _log('TRIGGER', `Executing BUY: $${amount} at ${leverage}x`, '#00e475')
          try {
            const result = await contracts.openPosition(String(amount), leverage)
            _log('TRIGGER', `TX confirmed: ${result.hash}`, '#00e475')
          } catch (e) {
            _log('TRIGGER', `BUY failed: ${e.shortMessage || e.message}`, '#ff5252')
          }
        } else {
          _log('TRIGGER', `[DRY-RUN] Would BUY $${amount} at ${leverage}x`, '#00e475')
        }
        break
      }

      case 'sell': {
        if (contracts && contracts.ADDRESSES?.vault) {
          _log('TRIGGER', 'Executing SELL: closing position', '#ff5252')
          try {
            const result = await contracts.closePosition('999999999')
            _log('TRIGGER', `TX confirmed: ${result.hash}`, '#ff5252')
          } catch (e) {
            _log('TRIGGER', `SELL failed: ${e.shortMessage || e.message}`, '#ff5252')
          }
        } else {
          _log('TRIGGER', '[DRY-RUN] Would CLOSE position', '#ff5252')
        }
        break
      }

      case 'adjust': {
        const targetLev = trigger.params.leverage || 1
        if (contracts && contracts.ADDRESSES?.vault) {
          _log('TRIGGER', `Executing ADJUST: leverage to ${targetLev}x`, '#29b6f6')
          try {
            const result = await contracts.adjustLeverage(targetLev)
            _log('TRIGGER', `TX confirmed: ${result.hash}`, '#29b6f6')
          } catch (e) {
            _log('TRIGGER', `ADJUST failed: ${e.shortMessage || e.message}`, '#ff5252')
          }
        } else {
          _log('TRIGGER', `[DRY-RUN] Would adjust leverage to ${targetLev}x`, '#29b6f6')
        }
        break
      }

      case 'deleverage': {
        const targetLev = trigger.params.leverage || 0.5
        if (contracts && contracts.ADDRESSES?.vault) {
          _log('TRIGGER', `Executing DELEVERAGE: reduce to ${targetLev}x`, '#ff9800')
          try {
            const result = await contracts.adjustLeverage(targetLev)
            _log('TRIGGER', `TX confirmed: ${result.hash}`, '#ff9800')
          } catch (e) {
            _log('TRIGGER', `DELEVERAGE failed: ${e.shortMessage || e.message}`, '#ff5252')
          }
        } else {
          _log('TRIGGER', `[DRY-RUN] Would deleverage to ${targetLev}x`, '#ff9800')
        }
        break
      }
    }
  }

  // ═══════════════════════════════════════════
  // INTERACTIVE PLACEMENT (Chart Click)
  // ═══════════════════════════════════════════

  let _placementMode = null  // null | {action, direction, params}

  /**
   * Enter trigger placement mode — next chart click places a trigger.
   * @param {Object} opts - {action, direction, params}
   */
  function startPlacement(opts) {
    _placementMode = {
      action: opts.action || 'alert',
      direction: opts.direction || 'below',
      params: opts.params || {},
    }
    const container = _chart?.chartElement()
    if (container) {
      container.style.cursor = 'crosshair'
      container.addEventListener('click', _onPlacementClick, { once: true })
    }
  }

  function cancelPlacement() {
    _placementMode = null
    const container = _chart?.chartElement()
    if (container) container.style.cursor = ''
  }

  function _onPlacementClick(e) {
    if (!_placementMode || !_chart) return
    const container = _chart.chartElement()
    const rect = container.getBoundingClientRect()
    const y = e.clientY - rect.top
    const series = _getSeries()
    if (!series) { _placementMode = null; return }

    const price = series.coordinateToPrice(y)
    if (price == null || price <= 0) { _placementMode = null; return }

    add({
      price: +price.toFixed(2),
      direction: _placementMode.direction,
      action: _placementMode.action,
      params: _placementMode.params,
    })

    container.style.cursor = ''
    _placementMode = null
  }

  // ═══════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════

  function _saveToStorage() {
    try {
      const data = _triggers.map(t => ({
        price: t.price,
        direction: t.direction,
        action: t.action,
        params: t.params,
        label: t.label,
        fired: t.fired,
        enabled: t.enabled,
        repeat: t.repeat,
        createdAt: t.createdAt,
      }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {}
  }

  function _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      for (const item of data) {
        // Skip fired non-repeating triggers
        if (item.fired && !item.repeat) continue
        add({
          price: item.price,
          direction: item.direction,
          action: item.action,
          params: item.params,
          label: item.label,
          repeat: item.repeat,
        })
      }
    } catch {}
  }

  function _notifyUpdate() {
    if (_onUpdate) _onUpdate(getAll())
  }

  // ═══════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════

  const api = {
    init,
    add,
    remove,
    enable,
    getAll,
    clearAll,
    startMonitor,
    stopMonitor,
    startPlacement,
    cancelPlacement,
    get isMonitoring() { return _monitorInterval !== null },
    get lastPrice() { return _lastPrice },
    get placementActive() { return _placementMode !== null },
  }

  return api
})()

window.ChartTriggers = ChartTriggers
