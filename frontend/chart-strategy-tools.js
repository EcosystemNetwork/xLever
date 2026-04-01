/**
 * @file chart-strategy-tools.js — TradingView Strategy Overlays
 *
 * Adds interactive drawing tools and programmatic agent strategy
 * visualization to the Lightweight Charts (LWC) ticker chart.
 *
 * Drawing Tools (user-driven via toolbar):
 *   - Horizontal Line: static price level via LWC createPriceLine
 *   - Trend Line: two-point line rendered on canvas overlay
 *   - Rectangle Zone: price/time area rendered on canvas overlay
 *   - Fibonacci Retracement: multi-level retracement between two points
 *
 * Agent Strategy API (programmatic):
 *   - drawStrategy(): Entry/TP/SL lines, entry zone, signal markers
 *   - addSignal(): Individual buy/sell/info markers merged with chart markers
 *   - setBaseMarkers(): Merge with existing chart markers (deleverage events, etc.)
 *
 * @module ChartStrategyTools
 * @exports {Object} window.ChartStrategyTools
 *
 * @dependencies
 *   - Lightweight Charts (LWC) library loaded globally
 *   - A chart instance and series getter function passed to init()
 */

const ChartStrategyTools = (() => {
  // ═══════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════
  let _chart = null
  let _series = null           // Active visible series (area or candle)
  let _getSeries = null        // Callback to get current visible series
  let _canvas = null           // Overlay canvas for custom drawings
  let _ctx = null
  let _activeTool = null       // Current drawing tool: 'hline' | 'trendline' | 'rect' | 'fib' | null
  let _drawings = []           // All drawings [{type, points, priceLines, id, ...}]
  let _pendingPoints = []      // Points being collected for current drawing
  let _nextId = 1
  let _strategyMarkers = []    // Agent-placed markers
  let _existingMarkers = []    // Markers from the main chart (deleverage events etc)

  // Colors
  const COLORS = {
    hline:     { line: '#ffb300', label: '#ffb300' },
    trendline: { line: '#29b6f6', label: '#29b6f6' },
    rect:      { fill: 'rgba(124,77,255,0.08)', stroke: '#7c4dff' },
    fib:       { lines: ['#ff5252', '#ffb300', '#00e475', '#29b6f6', '#7c4dff'], fill: 'rgba(255,255,255,0.02)' },
    entry:     '#00e475',
    exit:      '#ff5252',
    tp:        '#00e475',
    sl:        '#ff5252',
    signal:    '#ffb300',
  }

  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

  // ═══════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════

  /**
   * Initialize the strategy tools module.
   * Creates an overlay canvas on the chart, wires up event handlers,
   * and subscribes to chart scroll/zoom for redraw.
   * @param {Object} chart - Lightweight Charts IChartApi instance
   * @param {Function} getSeriesFn - Callback returning the current visible series (area or candle)
   * @returns {Object} The public API object
   */
  function init(chart, getSeriesFn) {
    _chart = chart
    _getSeries = getSeriesFn

    // Create overlay canvas
    const container = _chart.chartElement()
    _canvas = document.createElement('canvas')
    _canvas.id = 'strategy-overlay'
    _canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;'
    container.style.position = 'relative'
    container.appendChild(_canvas)
    _ctx = _canvas.getContext('2d')

    _resizeCanvas()

    // Redraw overlay when chart scrolls/zooms
    _chart.timeScale().subscribeVisibleLogicalRangeChange(_redraw)
    _chart.subscribeCrosshairMove(_onCrosshairMove)

    // Resize observer
    const ro = new ResizeObserver(_resizeCanvas)
    ro.observe(container)

    // Click handler for drawing
    container.addEventListener('click', _onClick)
    container.addEventListener('contextmenu', _onRightClick)

    return api
  }

  /**
   * Resize the overlay canvas to match the chart container dimensions
   * and trigger a redraw of all drawings.
   * @private
   */
  function _resizeCanvas() {
    if (!_canvas || !_chart) return
    const el = _chart.chartElement()
    _canvas.width = el.clientWidth
    _canvas.height = el.clientHeight
    _redraw()
  }

  // ═══════════════════════════════════════════
  // COORDINATE CONVERSION
  // ═══════════════════════════════════════════

  /**
   * Convert a time value to an X pixel coordinate on the chart.
   * @param {number} time - Unix timestamp
   * @returns {number|null} X coordinate in pixels, or null if off-screen
   * @private
   */
  function _timeToX(time) {
    const coord = _chart.timeScale().timeToCoordinate(time)
    return coord !== null ? coord : null
  }

  /**
   * Convert a price value to a Y pixel coordinate on the chart.
   * @param {number} price - Price value
   * @returns {number|null} Y coordinate in pixels, or null if off-screen
   * @private
   */
  function _priceToY(price) {
    const series = _getSeries()
    if (!series) return null
    const coord = series.priceToCoordinate(price)
    return coord !== null ? coord : null
  }

  /**
   * Convert an X pixel coordinate to a time value.
   * @param {number} x - X coordinate in pixels
   * @returns {number|null} Unix timestamp, or null if outside chart range
   * @private
   */
  function _coordToTime(x) {
    return _chart.timeScale().coordinateToTime(x)
  }

  /**
   * Convert a Y pixel coordinate to a price value.
   * @param {number} y - Y coordinate in pixels
   * @returns {number|null} Price value, or null if no series is active
   * @private
   */
  function _coordToPrice(y) {
    const series = _getSeries()
    if (!series) return null
    return series.coordinateToPrice(y)
  }

  // ═══════════════════════════════════════════
  // DRAWING TOOLS
  // ═══════════════════════════════════════════

  /**
   * Set the active drawing tool. Pass null to deactivate.
   * Updates cursor, enables/disables canvas pointer events,
   * and highlights the active toolbar button.
   * @param {'hline'|'trendline'|'rect'|'fib'|null} tool - Tool to activate
   */
  function setTool(tool) {
    _activeTool = tool
    _pendingPoints = []

    const container = _chart.chartElement()
    if (tool) {
      container.style.cursor = 'crosshair'
      _canvas.style.pointerEvents = 'auto'
    } else {
      container.style.cursor = ''
      _canvas.style.pointerEvents = 'none'
    }

    // Update toolbar UI
    document.querySelectorAll('.draw-tool-btn').forEach(btn => {
      btn.classList.toggle('bg-primary-container', btn.dataset.tool === tool)
      btn.classList.toggle('text-on-primary-container', btn.dataset.tool === tool)
      if (btn.dataset.tool !== tool) {
        btn.classList.remove('bg-primary-container', 'text-on-primary-container')
      }
    })
  }

  // Crosshair tracking for live preview
  let _cursorTime = null, _cursorPrice = null
  function _onCrosshairMove(param) {
    if (!_activeTool || !param.time) return
    _cursorTime = param.time
    const series = _getSeries()
    if (series && param.point) {
      _cursorPrice = _coordToPrice(param.point.y)
    }
    if (_pendingPoints.length > 0) _redraw()
  }

  function _onClick(e) {
    if (!_activeTool) return
    e.preventDefault()
    e.stopPropagation()

    const rect = _canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const time = _coordToTime(x)
    const price = _coordToPrice(y)

    if (time == null || price == null) return

    _pendingPoints.push({ time, price })

    switch (_activeTool) {
      case 'hline':
        _addHLine(price)
        _finishDrawing()
        break
      case 'trendline':
        if (_pendingPoints.length >= 2) {
          _addTrendLine(_pendingPoints[0], _pendingPoints[1])
          _finishDrawing()
        }
        break
      case 'rect':
        if (_pendingPoints.length >= 2) {
          _addRect(_pendingPoints[0], _pendingPoints[1])
          _finishDrawing()
        }
        break
      case 'fib':
        if (_pendingPoints.length >= 2) {
          _addFib(_pendingPoints[0], _pendingPoints[1])
          _finishDrawing()
        }
        break
    }
  }

  function _onRightClick(e) {
    if (_activeTool) {
      e.preventDefault()
      setTool(null)
    }
  }

  function _finishDrawing() {
    _pendingPoints = []
    // Keep tool active for rapid drawing — right-click or ESC to deactivate
  }

  // ─── Horizontal Line ───
  /**
   * Add a horizontal price line to the chart via LWC's createPriceLine API.
   * @param {number} price - Price level for the line
   * @param {Object} [opts] - Options: {color, label, dashed}
   * @returns {Object|null} Drawing descriptor with id, price, priceLine, or null if no series
   * @private
   */
  function _addHLine(price, opts = {}) {
    const series = _getSeries()
    if (!series) return null
    const color = opts.color || COLORS.hline.line
    const label = opts.label || '$' + price.toFixed(2)
    const id = _nextId++

    const priceLine = series.createPriceLine({
      price,
      color,
      lineWidth: 1,
      lineStyle: opts.dashed ? 2 : 0,
      axisLabelVisible: true,
      title: label,
    })

    const drawing = { type: 'hline', id, price, priceLine, series, color, label }
    _drawings.push(drawing)
    return drawing
  }

  // ─── Trend Line ───
  /**
   * Add a two-point trend line rendered on the canvas overlay.
   * @param {{time: number, price: number}} p1 - Start point
   * @param {{time: number, price: number}} p2 - End point
   * @param {Object} [opts] - Options: {color, lineWidth, label}
   * @returns {Object} Drawing descriptor with id, type, endpoints
   * @private
   */
  function _addTrendLine(p1, p2, opts = {}) {
    const id = _nextId++
    const color = opts.color || COLORS.trendline.line
    const drawing = { type: 'trendline', id, p1: { ...p1 }, p2: { ...p2 }, color, lineWidth: opts.lineWidth || 1.5, label: opts.label || '' }
    _drawings.push(drawing)
    _redraw()
    return drawing
  }

  // ─── Rectangle Zone ───
  /**
   * Add a filled rectangle zone between two price/time points on the canvas overlay.
   * @param {{time: number, price: number}} p1 - First corner
   * @param {{time: number, price: number}} p2 - Opposite corner
   * @param {Object} [opts] - Options: {fill, stroke, label}
   * @returns {Object} Drawing descriptor with id, type, corners
   * @private
   */
  function _addRect(p1, p2, opts = {}) {
    const id = _nextId++
    const fill = opts.fill || COLORS.rect.fill
    const stroke = opts.stroke || COLORS.rect.stroke
    const drawing = { type: 'rect', id, p1: { ...p1 }, p2: { ...p2 }, fill, stroke, label: opts.label || '' }
    _drawings.push(drawing)
    _redraw()
    return drawing
  }

  // ─── Fibonacci Retracement ───
  /**
   * Add a Fibonacci retracement between two price points on the canvas overlay.
   * Draws horizontal lines at standard Fib levels (0, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%)
   * with colored fills between levels and price labels.
   * @param {{time: number, price: number}} p1 - First anchor point (high or low)
   * @param {{time: number, price: number}} p2 - Second anchor point (opposite extreme)
   * @param {Object} [opts] - Options: {colors} array for level line colors
   * @returns {Object} Drawing descriptor with id, type, anchor points
   * @private
   */
  function _addFib(p1, p2, opts = {}) {
    const id = _nextId++
    const drawing = { type: 'fib', id, p1: { ...p1 }, p2: { ...p2 }, colors: opts.colors || COLORS.fib.lines }
    _drawings.push(drawing)
    _redraw()
    return drawing
  }

  // ═══════════════════════════════════════════
  // CANVAS RENDERING
  // ═══════════════════════════════════════════

  /**
   * Clear and re-render all drawings on the canvas overlay.
   * Also renders a dashed preview for the drawing currently in progress.
   * Called on chart scroll/zoom and after any drawing is added/removed.
   * @private
   */
  function _redraw() {
    if (!_ctx || !_canvas) return
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height)

    for (const d of _drawings) {
      switch (d.type) {
        case 'trendline': _drawTrendLine(d); break
        case 'rect':      _drawRect(d); break
        case 'fib':       _drawFib(d); break
        // hline is rendered by LWC's createPriceLine — no canvas needed
      }
    }

    // Draw pending preview
    if (_activeTool && _pendingPoints.length > 0 && _cursorTime != null && _cursorPrice != null) {
      const p1 = _pendingPoints[0]
      const cursor = { time: _cursorTime, price: _cursorPrice }
      _ctx.setLineDash([4, 4])
      _ctx.globalAlpha = 0.6
      switch (_activeTool) {
        case 'trendline':
          _drawTrendLine({ p1, p2: cursor, color: COLORS.trendline.line, lineWidth: 1.5 })
          break
        case 'rect':
          _drawRect({ p1, p2: cursor, fill: COLORS.rect.fill, stroke: COLORS.rect.stroke })
          break
        case 'fib':
          _drawFib({ p1, p2: cursor, colors: COLORS.fib.lines })
          break
      }
      _ctx.setLineDash([])
      _ctx.globalAlpha = 1
    }
  }

  /**
   * Render a trend line drawing on the canvas with endpoint dots and optional label.
   * @param {Object} d - Trend line drawing descriptor with p1, p2, color, lineWidth, label
   * @private
   */
  function _drawTrendLine(d) {
    const x1 = _timeToX(d.p1.time), y1 = _priceToY(d.p1.price)
    const x2 = _timeToX(d.p2.time), y2 = _priceToY(d.p2.price)
    if (x1 == null || y1 == null || x2 == null || y2 == null) return

    _ctx.beginPath()
    _ctx.moveTo(x1, y1)
    _ctx.lineTo(x2, y2)
    _ctx.strokeStyle = d.color
    _ctx.lineWidth = d.lineWidth || 1.5
    _ctx.stroke()

    // Draw endpoints
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      _ctx.beginPath()
      _ctx.arc(x, y, 3, 0, Math.PI * 2)
      _ctx.fillStyle = d.color
      _ctx.fill()
    }

    if (d.label) {
      _ctx.font = '10px JetBrains Mono'
      _ctx.fillStyle = d.color
      _ctx.fillText(d.label, (x1 + x2) / 2 + 5, (y1 + y2) / 2 - 5)
    }
  }

  /**
   * Render a filled rectangle drawing on the canvas with stroke border and optional label.
   * @param {Object} d - Rectangle drawing descriptor with p1, p2, fill, stroke, label
   * @private
   */
  function _drawRect(d) {
    const x1 = _timeToX(d.p1.time), y1 = _priceToY(d.p1.price)
    const x2 = _timeToX(d.p2.time), y2 = _priceToY(d.p2.price)
    if (x1 == null || y1 == null || x2 == null || y2 == null) return

    const rx = Math.min(x1, x2), ry = Math.min(y1, y2)
    const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1)

    _ctx.fillStyle = d.fill
    _ctx.fillRect(rx, ry, rw, rh)
    _ctx.strokeStyle = d.stroke
    _ctx.lineWidth = 1
    _ctx.strokeRect(rx, ry, rw, rh)

    if (d.label) {
      _ctx.font = '10px JetBrains Mono'
      _ctx.fillStyle = d.stroke
      _ctx.fillText(d.label, rx + 4, ry + 12)
    }
  }

  /**
   * Render a Fibonacci retracement drawing on the canvas.
   * Draws colored horizontal lines at each Fib level with shaded fill zones between them
   * and price+percentage labels at the right edge.
   * @param {Object} d - Fib drawing descriptor with p1, p2, colors
   * @private
   */
  function _drawFib(d) {
    const x1 = _timeToX(d.p1.time), y1 = _priceToY(d.p1.price)
    const x2 = _timeToX(d.p2.time), y2 = _priceToY(d.p2.price)
    if (x1 == null || y1 == null || x2 == null || y2 == null) return

    const pHigh = Math.max(d.p1.price, d.p2.price)
    const pLow = Math.min(d.p1.price, d.p2.price)
    const xLeft = Math.min(x1, x2)
    const xRight = Math.max(x1, x2)
    const width = xRight - xLeft

    for (let i = 0; i < FIB_LEVELS.length; i++) {
      const level = FIB_LEVELS[i]
      const price = pHigh - (pHigh - pLow) * level
      const y = _priceToY(price)
      if (y == null) continue

      const color = d.colors[i % d.colors.length]

      // Fill between this level and next
      if (i < FIB_LEVELS.length - 1) {
        const nextPrice = pHigh - (pHigh - pLow) * FIB_LEVELS[i + 1]
        const nextY = _priceToY(nextPrice)
        if (nextY != null) {
          _ctx.fillStyle = COLORS.fib.fill
          _ctx.fillRect(xLeft, Math.min(y, nextY), width, Math.abs(nextY - y))
        }
      }

      // Line
      _ctx.beginPath()
      _ctx.moveTo(xLeft, y)
      _ctx.lineTo(xRight, y)
      _ctx.strokeStyle = color
      _ctx.lineWidth = 1
      _ctx.stroke()

      // Label
      _ctx.font = '9px JetBrains Mono'
      _ctx.fillStyle = color
      _ctx.fillText(`${(level * 100).toFixed(1)}% — $${price.toFixed(2)}`, xRight + 6, y + 3)
    }
  }

  // ═══════════════════════════════════════════
  // AGENT STRATEGY API
  // ═══════════════════════════════════════════

  /**
   * Draw an agent's complete strategy on the chart.
   * @param {Object} strategy
   * @param {number} strategy.entry       - Entry price
   * @param {number} [strategy.takeProfit] - Take profit price
   * @param {number} [strategy.stopLoss]   - Stop loss price
   * @param {string} [strategy.direction]  - 'long' | 'short'
   * @param {string} [strategy.label]      - Strategy name
   * @param {Object} [strategy.zone]       - {high, low, timeStart, timeEnd} entry zone
   * @param {Array}  [strategy.signals]    - [{time, type:'buy'|'sell'|'info', text}]
   */
  function drawStrategy(strategy) {
    const tag = strategy.label || 'Agent'
    const isLong = (strategy.direction || 'long') === 'long'

    // Entry line
    if (strategy.entry != null) {
      _addHLine(strategy.entry, {
        color: '#7c4dff',
        label: `${tag} Entry`,
        dashed: false,
      })
    }

    // Take profit
    if (strategy.takeProfit != null) {
      _addHLine(strategy.takeProfit, {
        color: COLORS.tp,
        label: `${tag} TP`,
        dashed: true,
      })
    }

    // Stop loss
    if (strategy.stopLoss != null) {
      _addHLine(strategy.stopLoss, {
        color: COLORS.sl,
        label: `${tag} SL`,
        dashed: true,
      })
    }

    // Entry zone rectangle
    if (strategy.zone) {
      const z = strategy.zone
      _addRect(
        { time: z.timeStart, price: z.high },
        { time: z.timeEnd, price: z.low },
        {
          fill: isLong ? 'rgba(0,228,117,0.06)' : 'rgba(255,82,82,0.06)',
          stroke: isLong ? '#00e47540' : '#ff525240',
          label: `${tag} Zone`,
        }
      )
    }

    // Signal markers
    if (strategy.signals && strategy.signals.length) {
      const markers = strategy.signals.map(s => ({
        time: s.time,
        position: s.type === 'sell' ? 'aboveBar' : 'belowBar',
        color: s.type === 'buy' ? COLORS.entry : s.type === 'sell' ? COLORS.exit : COLORS.signal,
        shape: s.type === 'buy' ? 'arrowUp' : s.type === 'sell' ? 'arrowDown' : 'circle',
        text: s.text || s.type.toUpperCase(),
      }))
      _addStrategyMarkers(markers)
    }
  }

  /**
   * Add strategy markers (buy/sell/info signals) and merge them with existing chart markers.
   * @param {Array<Object>} markers - Marker objects with time, position, color, shape, text
   * @private
   */
  function _addStrategyMarkers(markers) {
    _strategyMarkers = _strategyMarkers.concat(markers)
    _applyMarkers()
  }

  /**
   * Merge existing chart markers with strategy markers, sort by time,
   * and apply them to the chart series.
   * @private
   */
  function _applyMarkers() {
    const series = _getSeries()
    if (!series) return
    const all = [..._existingMarkers, ..._strategyMarkers]
      .sort((a, b) => a.time - b.time)
    series.setMarkers(all)
  }

  /**
   * Let the main chart pass its existing markers so we merge, not overwrite.
   */
  function setBaseMarkers(markers) {
    _existingMarkers = markers || []
    _applyMarkers()
  }

  /**
   * Add a single signal marker (for live agent use).
   */
  function addSignal(time, type, text) {
    const marker = {
      time,
      position: type === 'sell' ? 'aboveBar' : 'belowBar',
      color: type === 'buy' ? COLORS.entry : type === 'sell' ? COLORS.exit : COLORS.signal,
      shape: type === 'buy' ? 'arrowUp' : type === 'sell' ? 'arrowDown' : 'circle',
      text: text || type.toUpperCase(),
    }
    _strategyMarkers.push(marker)
    _applyMarkers()
    return marker
  }

  // ═══════════════════════════════════════════
  // MANAGEMENT
  // ═══════════════════════════════════════════

  /**
   * Remove a drawing by its ID. Cleans up LWC price lines if applicable.
   * @param {number} id - Drawing ID to remove
   */
  function removeDrawing(id) {
    const idx = _drawings.findIndex(d => d.id === id)
    if (idx === -1) return
    const d = _drawings[idx]
    // Remove LWC priceLine if applicable
    if (d.priceLine && d.series) {
      d.series.removePriceLine(d.priceLine)
    }
    _drawings.splice(idx, 1)
    _redraw()
  }

  /** Remove all drawings and strategy markers from the chart. */
  function clearAll() {
    for (const d of _drawings) {
      if (d.priceLine && d.series) {
        d.series.removePriceLine(d.priceLine)
      }
    }
    _drawings = []
    _strategyMarkers = []
    _applyMarkers()
    _redraw()
  }

  /** Remove only agent-drawn overlays (Entry/TP/SL lines and strategy markers). */
  function clearStrategyOnly() {
    // Remove agent-drawn price lines
    const agentDrawings = _drawings.filter(d => d.label && (d.label.includes('TP') || d.label.includes('SL') || d.label.includes('Entry')))
    for (const d of agentDrawings) {
      removeDrawing(d.id)
    }
    _strategyMarkers = []
    _applyMarkers()
  }

  /**
   * Get a summary of all current drawings (for serialization or UI display).
   * @returns {Array<{id: number, type: string, label: string}>}
   */
  function getDrawings() {
    return _drawings.map(d => ({ id: d.id, type: d.type, label: d.label }))
  }

  // ═══════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════

  const api = {
    init,
    setTool,
    clearAll,
    clearStrategyOnly,
    removeDrawing,
    getDrawings,

    // Agent strategy API
    drawStrategy,
    addSignal,
    setBaseMarkers,

    // Programmatic drawing (for agents or UI)
    addHLine:     (price, opts) => _addHLine(price, opts),
    addTrendLine: (p1, p2, opts) => _addTrendLine(p1, p2, opts),
    addRect:      (p1, p2, opts) => _addRect(p1, p2, opts),
    addFib:       (p1, p2, opts) => _addFib(p1, p2, opts),
  }

  return api
})()

// Expose globally for agent-executor and other modules
window.ChartStrategyTools = ChartStrategyTools
