/**
 * xLever Oracle Health Badge
 * ───────────────────────────
 * Reusable UI component that displays oracle freshness, price divergence,
 * circuit breaker status, and separated price roles (execution vs display).
 *
 * Usage:
 *   OracleHealthBadge.mount('#oracle-badge')
 *   // or subscribe to RiskLive updates automatically
 *   OracleHealthBadge.autoStart('#oracle-badge')
 */

const OracleHealthBadge = (() => {
  let _el = null
  let _unsub = null

  const COLORS = {
    fresh:  '#4caf50',
    ok:     '#ff9800',
    stale:  '#f44336',
    broken: '#d32f2f',
  }

  /**
   * Render the badge into the given DOM element.
   * @param {HTMLElement} el - Container element
   * @param {object} oracleHealth - From RiskLive.oracleHealth
   * @param {object} onChainOracle - From RiskLive.onChainOracle
   */
  function render(el, oracleHealth, onChainOracle) {
    if (!el) return

    const oh = oracleHealth || {}
    const oc = onChainOracle || {}

    const freshness = oh.freshness || 'stale'
    const isBroken = oc.isCircuitBroken || false
    const statusColor = isBroken ? COLORS.broken : COLORS[freshness] || COLORS.stale
    const statusLabel = isBroken ? 'CIRCUIT BREAKER' : freshness.toUpperCase()
    const statusIcon = isBroken ? 'warning' : freshness === 'fresh' ? 'check_circle' : freshness === 'ok' ? 'schedule' : 'error'

    const execPrice = oc.executionPrice ? oc.executionPrice.toFixed(2) : (oh.price ? oh.price.toFixed(2) : '--')
    const dispPrice = oc.displayPrice ? oc.displayPrice.toFixed(2) : '--'
    const divergence = oc.divergenceBps != null ? (oc.divergenceBps / 100).toFixed(2) : '0.00'
    const spread = oc.spreadBps != null ? oc.spreadBps : 0
    const age = oh.age != null ? oh.age : '--'
    const confPct = oh.confPercent || '0'
    const updateCount = oc.updateCount != null ? oc.updateCount : '--'

    el.innerHTML = `
      <div class="oracle-health-badge" style="
        background: rgba(0,0,0,0.4);
        border: 1px solid ${statusColor}40;
        border-radius: 8px;
        padding: 12px 16px;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 12px;
        color: #e0e0e0;
        min-width: 220px;
      ">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span class="material-symbols-outlined" style="font-size:18px; color:${statusColor}">${statusIcon}</span>
          <span style="font-weight:600; color:${statusColor}; font-size:13px;">Oracle ${statusLabel}</span>
          <span style="margin-left:auto; opacity:0.6; font-size:11px;">${age}s ago</span>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; font-size:11px;">
          <div style="opacity:0.6;">Exec Price</div>
          <div style="text-align:right; font-weight:500;">$${execPrice}</div>

          <div style="opacity:0.6;">Display (TWAP)</div>
          <div style="text-align:right; font-weight:500;">$${dispPrice}</div>

          <div style="opacity:0.6;">Divergence</div>
          <div style="text-align:right; font-weight:500; color:${Number(divergence) > 2 ? '#ff9800' : Number(divergence) > 5 ? '#f44336' : '#4caf50'}">
            ${divergence}%
          </div>

          <div style="opacity:0.6;">Spread</div>
          <div style="text-align:right; font-weight:500;">${spread} bps</div>

          <div style="opacity:0.6;">Confidence</div>
          <div style="text-align:right; font-weight:500;">${confPct}%</div>

          <div style="opacity:0.6;">Samples</div>
          <div style="text-align:right; font-weight:500;">${updateCount}</div>
        </div>

        ${isBroken ? `
          <div style="margin-top:8px; padding:6px 8px; background:${COLORS.broken}20; border-radius:4px; color:${COLORS.broken}; font-size:11px; text-align:center;">
            Trading halted: spot-TWAP divergence exceeds threshold
          </div>
        ` : ''}
      </div>
    `
  }

  return {
    /**
     * Mount the badge into a container element. Call render() manually after.
     */
    mount(selector) {
      _el = typeof selector === 'string' ? document.querySelector(selector) : selector
      return this
    },

    /**
     * Mount and auto-update via RiskLive subscription.
     */
    autoStart(selector) {
      this.mount(selector)
      if (!_el) {
        console.warn('OracleHealthBadge: selector not found:', selector)
        return this
      }

      if (_unsub) _unsub()
      if (window.RiskLive) {
        _unsub = window.RiskLive.subscribe((_state, _inputs, oracleHealth) => {
          render(_el, oracleHealth, window.RiskLive.onChainOracle)
        })
      }
      return this
    },

    /**
     * Manual render with provided data.
     */
    render(oracleHealth, onChainOracle) {
      render(_el, oracleHealth, onChainOracle)
    },

    /**
     * Stop listening and clear the badge.
     */
    destroy() {
      if (_unsub) { _unsub(); _unsub = null }
      if (_el) _el.innerHTML = ''
      _el = null
    },
  }
})()

window.OracleHealthBadge = OracleHealthBadge
