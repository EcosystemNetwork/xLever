/**
 * xLever Risk Sentinel Engine
 * ─────────────────────────────
 * Deterministic risk state machine with oracle checks,
 * dynamic leverage caps, and auto-deleverage recommendations.
 *
 * States: NORMAL → WARNING → RESTRICTED → EMERGENCY
 */

const RiskEngine = (() => {

  // ═══════════════════════════════════════════════════════════
  // RISK STATES
  // ═══════════════════════════════════════════════════════════

  const STATES = Object.freeze({
    NORMAL:     'NORMAL',
    WARNING:    'WARNING',
    RESTRICTED: 'RESTRICTED',
    EMERGENCY:  'EMERGENCY',
  });

  const STATE_META = Object.freeze({
    NORMAL:     { label: 'Normal',     color: '#00e676', icon: 'verified_user',   maxLeverage: 4.0 },
    WARNING:    { label: 'Warning',    color: '#ffd740', icon: 'warning',         maxLeverage: 3.0 },
    RESTRICTED: { label: 'Restricted', color: '#ff9100', icon: 'gpp_maybe',       maxLeverage: 1.5 },
    EMERGENCY:  { label: 'Emergency',  color: '#ff5252', icon: 'emergency',       maxLeverage: 0.0 },
  });

  // ═══════════════════════════════════════════════════════════
  // THRESHOLDS (risk policy)
  // ═══════════════════════════════════════════════════════════

  const POLICY = Object.freeze({
    // Oracle freshness
    oracleMaxStaleSec:       300,    // 5 min — WARNING
    oracleCriticalStaleSec:  900,    // 15 min — RESTRICTED

    // Oracle divergence (% diff between two feeds)
    oracleDivergenceWarn:    0.01,   // 1%
    oracleDivergenceCrit:    0.03,   // 3%

    // Drawdown thresholds (underlying price from peak)
    drawdownWarn:            0.05,   // 5%
    drawdownRestrict:        0.15,   // 15%
    drawdownEmergency:       0.30,   // 30%

    // Health factor thresholds
    healthWarn:              1.5,
    healthRestrict:          1.2,
    healthEmergency:         1.05,

    // Volatility (annualised)
    volWarn:                 0.50,   // 50%
    volRestrict:             0.80,   // 80%

    // Pool utilization
    utilizationWarn:         0.75,   // 75%
    utilizationRestrict:     0.90,   // 90%
  });

  // ═══════════════════════════════════════════════════════════
  // AUTO-DELEVERAGE LEVELS
  // ═══════════════════════════════════════════════════════════

  const DELEVERAGE_LEVELS = Object.freeze([
    { level: 0, trigger: 0.00, action: 'none',        targetLev: null, label: 'No Action' },
    { level: 1, trigger: 0.10, action: 'reduce_25',   targetLev: null, label: 'Reduce 25%' },
    { level: 2, trigger: 0.15, action: 'reduce_50',   targetLev: null, label: 'Reduce 50%' },
    { level: 3, trigger: 0.22, action: 'cap_1_5x',    targetLev: 1.5,  label: 'Cap at 1.5×' },
    { level: 4, trigger: 0.30, action: 'force_1x',    targetLev: 1.0,  label: 'Force to 1.0×' },
    { level: 5, trigger: 0.40, action: 'liquidate',    targetLev: 0.0,  label: 'Liquidation' },
  ]);

  // ═══════════════════════════════════════════════════════════
  // RISK EVALUATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Evaluate all risk inputs and return deterministic state + reasons.
   *
   * @param {Object} inputs
   * @param {number} inputs.oracleAgeSec       — seconds since last oracle update
   * @param {number} inputs.oracleDivergence   — abs % diff between primary & secondary feed
   * @param {number} inputs.drawdown           — underlying drawdown from peak (0..1)
   * @param {number} inputs.healthFactor       — Euler vault health factor
   * @param {number} inputs.volatility         — annualised vol (0..∞)
   * @param {number} inputs.utilization        — pool utilization ratio (0..1)
   * @returns {{ state, reasons[], leverageCap, deleverageLevel, deleverageAction, meta }}
   */
  function evaluate(inputs) {
    const {
      oracleAgeSec    = 0,
      oracleDivergence = 0,
      drawdown        = 0,
      healthFactor    = 999,
      volatility      = 0,
      utilization     = 0,
    } = inputs;

    const reasons = [];
    let worstState = STATES.NORMAL;

    function escalate(state, reason) {
      reasons.push({ state, reason });
      const order = [STATES.NORMAL, STATES.WARNING, STATES.RESTRICTED, STATES.EMERGENCY];
      if (order.indexOf(state) > order.indexOf(worstState)) {
        worstState = state;
      }
    }

    // — Oracle freshness —
    if (oracleAgeSec >= POLICY.oracleCriticalStaleSec) {
      escalate(STATES.RESTRICTED, `Oracle stale: ${Math.round(oracleAgeSec)}s (limit ${POLICY.oracleCriticalStaleSec}s)`);
    } else if (oracleAgeSec >= POLICY.oracleMaxStaleSec) {
      escalate(STATES.WARNING, `Oracle aging: ${Math.round(oracleAgeSec)}s (warn at ${POLICY.oracleMaxStaleSec}s)`);
    }

    // — Oracle divergence —
    if (oracleDivergence >= POLICY.oracleDivergenceCrit) {
      escalate(STATES.RESTRICTED, `Oracle divergence: ${(oracleDivergence * 100).toFixed(2)}% (limit ${POLICY.oracleDivergenceCrit * 100}%)`);
    } else if (oracleDivergence >= POLICY.oracleDivergenceWarn) {
      escalate(STATES.WARNING, `Oracle divergence: ${(oracleDivergence * 100).toFixed(2)}% (warn at ${POLICY.oracleDivergenceWarn * 100}%)`);
    }

    // — Drawdown —
    if (drawdown >= POLICY.drawdownEmergency) {
      escalate(STATES.EMERGENCY, `Drawdown: ${(drawdown * 100).toFixed(1)}% (emergency at ${POLICY.drawdownEmergency * 100}%)`);
    } else if (drawdown >= POLICY.drawdownRestrict) {
      escalate(STATES.RESTRICTED, `Drawdown: ${(drawdown * 100).toFixed(1)}% (restricted at ${POLICY.drawdownRestrict * 100}%)`);
    } else if (drawdown >= POLICY.drawdownWarn) {
      escalate(STATES.WARNING, `Drawdown: ${(drawdown * 100).toFixed(1)}% (warn at ${POLICY.drawdownWarn * 100}%)`);
    }

    // — Health factor —
    if (healthFactor <= POLICY.healthEmergency) {
      escalate(STATES.EMERGENCY, `Health factor: ${healthFactor.toFixed(2)} (emergency at ${POLICY.healthEmergency})`);
    } else if (healthFactor <= POLICY.healthRestrict) {
      escalate(STATES.RESTRICTED, `Health factor: ${healthFactor.toFixed(2)} (restricted at ${POLICY.healthRestrict})`);
    } else if (healthFactor <= POLICY.healthWarn) {
      escalate(STATES.WARNING, `Health factor: ${healthFactor.toFixed(2)} (warn at ${POLICY.healthWarn})`);
    }

    // — Volatility —
    if (volatility >= POLICY.volRestrict) {
      escalate(STATES.RESTRICTED, `Volatility: ${(volatility * 100).toFixed(0)}% (restricted at ${POLICY.volRestrict * 100}%)`);
    } else if (volatility >= POLICY.volWarn) {
      escalate(STATES.WARNING, `Volatility: ${(volatility * 100).toFixed(0)}% (warn at ${POLICY.volWarn * 100}%)`);
    }

    // — Pool utilization —
    if (utilization >= POLICY.utilizationRestrict) {
      escalate(STATES.RESTRICTED, `Pool utilization: ${(utilization * 100).toFixed(1)}% (restricted at ${POLICY.utilizationRestrict * 100}%)`);
    } else if (utilization >= POLICY.utilizationWarn) {
      escalate(STATES.WARNING, `Pool utilization: ${(utilization * 100).toFixed(1)}% (warn at ${POLICY.utilizationWarn * 100}%)`);
    }

    // — Deleverage level from drawdown —
    let deleverageLevel = 0;
    for (let i = DELEVERAGE_LEVELS.length - 1; i >= 0; i--) {
      if (drawdown >= DELEVERAGE_LEVELS[i].trigger) {
        deleverageLevel = i;
        break;
      }
    }
    const deleverage = DELEVERAGE_LEVELS[deleverageLevel];

    return {
      state:            worstState,
      reasons,
      leverageCap:      STATE_META[worstState].maxLeverage,
      deleverageLevel:  deleverage.level,
      deleverageAction: deleverage.action,
      deleverageLabel:  deleverage.label,
      meta:             STATE_META[worstState],
    };
  }

  // ═══════════════════════════════════════════════════════════
  // AUTO-DELEVERAGE RECOMMENDATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Given current leverage and the risk evaluation, compute the
   * recommended new leverage and whether to auto-execute.
   *
   * @param {number} currentLeverage — absolute current leverage (e.g. 3.0)
   * @param {Object} evaluation — output of evaluate()
   * @returns {{ recommendedLeverage, shouldAutoExecute, description }}
   */
  function deleverageRecommendation(currentLeverage, evaluation) {
    const absLev = Math.abs(currentLeverage);
    const sign = currentLeverage >= 0 ? 1 : -1;
    let newLev = absLev;
    let shouldAutoExecute = false;
    let description = 'No action required';

    // State-based cap
    if (absLev > evaluation.leverageCap) {
      newLev = evaluation.leverageCap;
      description = `Leverage capped to ${evaluation.leverageCap}× (state: ${evaluation.state})`;
    }

    // Deleverage-level based reduction
    const dl = evaluation.deleverageLevel;
    if (dl >= 5) {
      newLev = 0;
      shouldAutoExecute = true;
      description = 'LIQUIDATION — full position close';
    } else if (dl === 4) {
      newLev = Math.min(newLev, 1.0);
      shouldAutoExecute = true;
      description = 'Emergency deleverage to 1.0×';
    } else if (dl === 3) {
      newLev = Math.min(newLev, 1.5);
      shouldAutoExecute = true;
      description = 'Auto-deleverage: cap at 1.5×';
    } else if (dl === 2) {
      newLev = Math.min(newLev, absLev * 0.5);
      description = `Recommended: reduce leverage by 50% → ${(absLev * 0.5).toFixed(1)}×`;
    } else if (dl === 1) {
      newLev = Math.min(newLev, absLev * 0.75);
      description = `Recommended: reduce leverage by 25% → ${(absLev * 0.75).toFixed(1)}×`;
    }

    return {
      recommendedLeverage: parseFloat((newLev * sign).toFixed(2)),
      shouldAutoExecute,
      description,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ORACLE HEALTH CHECK
  // ═══════════════════════════════════════════════════════════

  /**
   * Check oracle health from two price feeds.
   *
   * @param {number} primaryPrice
   * @param {number} secondaryPrice
   * @param {number} lastUpdateTimestamp — unix epoch seconds
   * @param {number} nowTimestamp — unix epoch seconds
   * @returns {{ ageSec, divergence, primaryPrice, secondaryPrice, healthy }}
   */
  function checkOracle(primaryPrice, secondaryPrice, lastUpdateTimestamp, nowTimestamp) {
    const ageSec = nowTimestamp - lastUpdateTimestamp;
    const divergence = Math.abs(primaryPrice - secondaryPrice) / Math.max(primaryPrice, secondaryPrice);
    const healthy = ageSec < POLICY.oracleMaxStaleSec && divergence < POLICY.oracleDivergenceWarn;

    return { ageSec, divergence, primaryPrice, secondaryPrice, healthy };
  }

  // ═══════════════════════════════════════════════════════════
  // SIMULATED MARKET SCENARIO RUNNER
  // ═══════════════════════════════════════════════════════════

  /**
   * Run a scenario: a sequence of market snapshots, returning
   * state transitions and deleverage events for each tick.
   *
   * @param {Array<Object>} ticks — array of { oracleAgeSec, oracleDivergence, drawdown, healthFactor, volatility, utilization }
   * @param {number} startLeverage — initial leverage
   * @returns {Array<Object>} timeline of { tick, evaluation, recommendation, leverageAfter }}
   */
  function runScenario(ticks, startLeverage) {
    const timeline = [];
    let currentLev = startLeverage;

    for (let i = 0; i < ticks.length; i++) {
      const evaluation = evaluate(ticks[i]);
      const recommendation = deleverageRecommendation(currentLev, evaluation);

      if (recommendation.shouldAutoExecute) {
        currentLev = recommendation.recommendedLeverage;
      }

      timeline.push({
        tick: i,
        inputs: ticks[i],
        state: evaluation.state,
        reasons: evaluation.reasons,
        leverageCap: evaluation.leverageCap,
        deleverageLevel: evaluation.deleverageLevel,
        deleverageLabel: evaluation.deleverageLabel,
        recommendation: recommendation.description,
        shouldAutoExecute: recommendation.shouldAutoExecute,
        leverageBefore: timeline.length > 0 ? timeline[timeline.length - 1].leverageAfter : startLeverage,
        leverageAfter: recommendation.shouldAutoExecute ? recommendation.recommendedLeverage : currentLev,
      });
    }

    return timeline;
  }

  // ═══════════════════════════════════════════════════════════
  // DEMO SCENARIOS
  // ═══════════════════════════════════════════════════════════

  const DEMO_SCENARIOS = {
    normalMarket: {
      name: 'Normal Market Conditions',
      description: 'Steady market with healthy oracles — system stays in NORMAL state',
      startLeverage: 3.0,
      ticks: [
        { oracleAgeSec: 10,  oracleDivergence: 0.001, drawdown: 0.00, healthFactor: 2.5,  volatility: 0.20, utilization: 0.45 },
        { oracleAgeSec: 15,  oracleDivergence: 0.002, drawdown: 0.01, healthFactor: 2.4,  volatility: 0.22, utilization: 0.47 },
        { oracleAgeSec: 12,  oracleDivergence: 0.001, drawdown: 0.02, healthFactor: 2.3,  volatility: 0.25, utilization: 0.48 },
        { oracleAgeSec: 8,   oracleDivergence: 0.003, drawdown: 0.01, healthFactor: 2.4,  volatility: 0.23, utilization: 0.46 },
        { oracleAgeSec: 20,  oracleDivergence: 0.002, drawdown: 0.03, healthFactor: 2.2,  volatility: 0.28, utilization: 0.50 },
        { oracleAgeSec: 11,  oracleDivergence: 0.001, drawdown: 0.02, healthFactor: 2.3,  volatility: 0.24, utilization: 0.48 },
        { oracleAgeSec: 14,  oracleDivergence: 0.002, drawdown: 0.01, healthFactor: 2.5,  volatility: 0.21, utilization: 0.44 },
        { oracleAgeSec: 9,   oracleDivergence: 0.001, drawdown: 0.00, healthFactor: 2.6,  volatility: 0.19, utilization: 0.42 },
      ],
    },

    stressedMarket: {
      name: 'Market Stress → Emergency Deleverage',
      description: 'Escalating drawdown triggers WARNING → RESTRICTED → EMERGENCY with auto-deleverage',
      startLeverage: 3.0,
      ticks: [
        { oracleAgeSec: 10,  oracleDivergence: 0.002, drawdown: 0.02, healthFactor: 2.0,  volatility: 0.30, utilization: 0.55 },
        { oracleAgeSec: 30,  oracleDivergence: 0.005, drawdown: 0.06, healthFactor: 1.8,  volatility: 0.40, utilization: 0.62 },
        { oracleAgeSec: 120, oracleDivergence: 0.012, drawdown: 0.11, healthFactor: 1.4,  volatility: 0.55, utilization: 0.72 },
        { oracleAgeSec: 250, oracleDivergence: 0.018, drawdown: 0.16, healthFactor: 1.15, volatility: 0.65, utilization: 0.82 },
        { oracleAgeSec: 400, oracleDivergence: 0.025, drawdown: 0.23, healthFactor: 1.08, volatility: 0.85, utilization: 0.91 },
        { oracleAgeSec: 600, oracleDivergence: 0.035, drawdown: 0.31, healthFactor: 1.02, volatility: 0.95, utilization: 0.95 },
        { oracleAgeSec: 900, oracleDivergence: 0.040, drawdown: 0.35, healthFactor: 0.98, volatility: 1.10, utilization: 0.97 },
        { oracleAgeSec: 1200,oracleDivergence: 0.050, drawdown: 0.42, healthFactor: 0.90, volatility: 1.20, utilization: 0.99 },
      ],
    },

    oracleFailure: {
      name: 'Oracle Feed Failure',
      description: 'Oracle goes stale while market is normal — system restricts leverage preemptively',
      startLeverage: 2.5,
      ticks: [
        { oracleAgeSec: 10,   oracleDivergence: 0.001, drawdown: 0.01, healthFactor: 2.2, volatility: 0.25, utilization: 0.50 },
        { oracleAgeSec: 60,   oracleDivergence: 0.003, drawdown: 0.02, healthFactor: 2.1, volatility: 0.26, utilization: 0.51 },
        { oracleAgeSec: 180,  oracleDivergence: 0.008, drawdown: 0.02, healthFactor: 2.1, volatility: 0.27, utilization: 0.52 },
        { oracleAgeSec: 310,  oracleDivergence: 0.015, drawdown: 0.03, healthFactor: 2.0, volatility: 0.28, utilization: 0.53 },
        { oracleAgeSec: 600,  oracleDivergence: 0.020, drawdown: 0.03, healthFactor: 2.0, volatility: 0.28, utilization: 0.54 },
        { oracleAgeSec: 950,  oracleDivergence: 0.032, drawdown: 0.04, healthFactor: 1.9, volatility: 0.30, utilization: 0.55 },
        { oracleAgeSec: 30,   oracleDivergence: 0.002, drawdown: 0.02, healthFactor: 2.1, volatility: 0.25, utilization: 0.50 },
        { oracleAgeSec: 12,   oracleDivergence: 0.001, drawdown: 0.01, healthFactor: 2.2, volatility: 0.23, utilization: 0.48 },
      ],
    },
  };

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════

  return Object.freeze({
    STATES,
    STATE_META,
    POLICY,
    DELEVERAGE_LEVELS,
    DEMO_SCENARIOS,
    evaluate,
    deleverageRecommendation,
    checkOracle,
    runScenario,
  });

})();

// Export for test harness (Node-compatible) or browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RiskEngine;
}
