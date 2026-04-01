/**
 * xLever Risk Sentinel Engine
 * ─────────────────────────────
 * Deterministic risk state machine with oracle checks,
 * dynamic leverage caps, and auto-deleverage recommendations.
 *
 * States: NORMAL → WARNING → RESTRICTED → EMERGENCY
 */

// IIFE keeps all internals private so only the frozen public API leaks into global scope
const RiskEngine = (() => {

  // ═══════════════════════════════════════════════════════════
  // RISK STATES
  // ═══════════════════════════════════════════════════════════

  // Freeze prevents runtime mutation — state names are protocol-critical constants
  const STATES = Object.freeze({
    NORMAL:     'NORMAL',      // Healthy: all metrics within tolerance, full leverage allowed
    WARNING:    'WARNING',     // Early stress signal: one or more metrics slightly out of bounds
    RESTRICTED: 'RESTRICTED',  // Material risk: leverage must be curtailed to prevent loss
    EMERGENCY:  'EMERGENCY',   // Critical: position survival at stake, immediate deleverage required
  });

  // Each state carries UI metadata + a hard leverage cap so the frontend can render status and enforce limits in one lookup
  const STATE_META = Object.freeze({
    // NORMAL allows the protocol's max 4x because all risk indicators are healthy
    NORMAL:     { label: 'Normal',     color: '#00e676', icon: 'verified_user',   maxLeverage: 4.0 },
    // WARNING drops to 3x to provide a buffer before conditions worsen
    WARNING:    { label: 'Warning',    color: '#ffd740', icon: 'warning',         maxLeverage: 3.0 },
    // RESTRICTED caps at 1.5x because multiple risk factors are breached simultaneously
    RESTRICTED: { label: 'Restricted', color: '#ff9100', icon: 'gpp_maybe',       maxLeverage: 1.5 },
    // EMERGENCY sets 0x (no leverage) — positions must be unwound to protect depositors
    EMERGENCY:  { label: 'Emergency',  color: '#ff5252', icon: 'emergency',       maxLeverage: 0.0 },
  });

  // ═══════════════════════════════════════════════════════════
  // THRESHOLDS (risk policy)
  // ═══════════════════════════════════════════════════════════

  // Frozen policy object ensures thresholds cannot be changed at runtime, making the risk engine deterministic
  const POLICY = Object.freeze({
    // 5 min staleness triggers WARNING because Pyth feeds should update every few seconds; lag implies network issues
    oracleMaxStaleSec:       300,
    // 15 min staleness triggers RESTRICTED because pricing data is now unreliable for leverage decisions
    oracleCriticalStaleSec:  900,

    // 1% divergence between primary and secondary oracle feed indicates possible manipulation or delayed feed
    oracleDivergenceWarn:    0.01,
    // 3% divergence is severe — one feed may be compromised, so leverage must be restricted
    oracleDivergenceCrit:    0.03,

    // 5% drawdown from peak is a normal correction; flag it so operators are aware
    drawdownWarn:            0.05,
    // 15% drawdown materially erodes leveraged positions; restrict new exposure
    drawdownRestrict:        0.15,
    // 30% drawdown is a crash-level event; emergency protocols must activate
    drawdownEmergency:       0.30,

    // Health factor below 1.5 means collateral cushion is thinning — warn early
    healthWarn:              1.5,
    // Below 1.2 the vault is approaching under-collateralization — restrict activity
    healthRestrict:          1.2,
    // Below 1.05 the vault is moments from insolvency — emergency deleverage
    healthEmergency:         1.05,

    // 50% annualised vol signals a choppy market where leveraged positions face outsized risk
    volWarn:                 0.50,
    // 80% vol is extreme (e.g. 2020 crash); restrict leverage to avoid forced liquidations
    volRestrict:             0.80,

    // 75% pool utilization means liquidity is tightening — warn so users can plan exits
    utilizationWarn:         0.75,
    // 90% utilization means withdrawals may fail — restrict new borrows to preserve remaining liquidity
    utilizationRestrict:     0.90,
  });

  // ═══════════════════════════════════════════════════════════
  // AUTO-DELEVERAGE LEVELS
  // ═══════════════════════════════════════════════════════════

  // Ordered deleverage ladder tied to drawdown severity; the engine walks this array to find the matching level
  const DELEVERAGE_LEVELS = Object.freeze([
    // Level 0: no drawdown — do nothing
    { level: 0, trigger: 0.00, action: 'none',        targetLev: null, label: 'No Action' },
    // Level 1: 10% drawdown — reduce exposure by 25% to lower risk without panicking
    { level: 1, trigger: 0.10, action: 'reduce_25',   targetLev: null, label: 'Reduce 25%' },
    // Level 2: 15% drawdown — halve exposure because the drop is accelerating
    { level: 2, trigger: 0.15, action: 'reduce_50',   targetLev: null, label: 'Reduce 50%' },
    // Level 3: 22% drawdown — hard-cap at 1.5x to contain tail risk
    { level: 3, trigger: 0.22, action: 'cap_1_5x',    targetLev: 1.5,  label: 'Cap at 1.5×' },
    // Level 4: 30% drawdown — force to 1x (market-neutral) because further leverage is reckless
    { level: 4, trigger: 0.30, action: 'force_1x',    targetLev: 1.0,  label: 'Force to 1.0×' },
    // Level 5: 40% drawdown — full liquidation to salvage remaining capital
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
    // Destructure with safe defaults so missing inputs don't crash the engine
    const {
      oracleAgeSec    = 0,        // Default 0 = fresh oracle (safest assumption for missing data)
      oracleDivergence = 0,       // Default 0 = feeds agree perfectly
      drawdown        = 0,        // Default 0 = no drawdown from peak
      healthFactor    = 999,      // Default very high = vault is extremely well-collateralized
      volatility      = 0,        // Default 0 = zero vol (calm market)
      utilization     = 0,        // Default 0 = pool is empty (plenty of liquidity)
    } = inputs;

    // Accumulate every triggered rule so the UI can show exactly why a state was reached
    const reasons = [];
    // Start at NORMAL; each check can only escalate, never de-escalate (worst-of-all-checks wins)
    let worstState = STATES.NORMAL;

    // Helper: records a reason and promotes worstState if this check is more severe
    function escalate(state, reason) {
      // Push the reason regardless — even lower-severity reasons are useful for the audit trail
      reasons.push({ state, reason });
      // Severity order array lets us compare states by index position
      const order = [STATES.NORMAL, STATES.WARNING, STATES.RESTRICTED, STATES.EMERGENCY];
      // Only upgrade worstState; never downgrade (deterministic worst-case aggregation)
      if (order.indexOf(state) > order.indexOf(worstState)) {
        worstState = state;
      }
    }

    // — Oracle freshness — stale oracle means the protocol is pricing off old data, a major risk
    if (oracleAgeSec >= POLICY.oracleCriticalStaleSec) {
      // 15+ min stale: restrict leverage because the price may have moved significantly since last update
      escalate(STATES.RESTRICTED, `Oracle stale: ${Math.round(oracleAgeSec)}s (limit ${POLICY.oracleCriticalStaleSec}s)`);
    } else if (oracleAgeSec >= POLICY.oracleMaxStaleSec) {
      // 5+ min stale: warn because the oracle should have updated by now
      escalate(STATES.WARNING, `Oracle aging: ${Math.round(oracleAgeSec)}s (warn at ${POLICY.oracleMaxStaleSec}s)`);
    }

    // — Oracle divergence — two feeds disagreeing implies data quality or manipulation issues
    if (oracleDivergence >= POLICY.oracleDivergenceCrit) {
      // 3%+ divergence: restrict because one feed may be compromised
      escalate(STATES.RESTRICTED, `Oracle divergence: ${(oracleDivergence * 100).toFixed(2)}% (limit ${POLICY.oracleDivergenceCrit * 100}%)`);
    } else if (oracleDivergence >= POLICY.oracleDivergenceWarn) {
      // 1%+ divergence: warn because feeds should normally track within basis points
      escalate(STATES.WARNING, `Oracle divergence: ${(oracleDivergence * 100).toFixed(2)}% (warn at ${POLICY.oracleDivergenceWarn * 100}%)`);
    }

    // — Drawdown — measures how far the underlying (QQQ/SPY) has fallen from its peak
    if (drawdown >= POLICY.drawdownEmergency) {
      // 30%+ drop: emergency because leveraged positions face catastrophic loss
      escalate(STATES.EMERGENCY, `Drawdown: ${(drawdown * 100).toFixed(1)}% (emergency at ${POLICY.drawdownEmergency * 100}%)`);
    } else if (drawdown >= POLICY.drawdownRestrict) {
      // 15%+ drop: restrict because the downtrend is now material
      escalate(STATES.RESTRICTED, `Drawdown: ${(drawdown * 100).toFixed(1)}% (restricted at ${POLICY.drawdownRestrict * 100}%)`);
    } else if (drawdown >= POLICY.drawdownWarn) {
      // 5%+ drop: warn because leveraged positions amplify even modest declines
      escalate(STATES.WARNING, `Drawdown: ${(drawdown * 100).toFixed(1)}% (warn at ${POLICY.drawdownWarn * 100}%)`);
    }

    // — Health factor — Euler V2 vault collateral ratio; below 1.0 means under-collateralized
    if (healthFactor <= POLICY.healthEmergency) {
      // 1.05 or below: emergency because the vault is nearly insolvent
      escalate(STATES.EMERGENCY, `Health factor: ${healthFactor.toFixed(2)} (emergency at ${POLICY.healthEmergency})`);
    } else if (healthFactor <= POLICY.healthRestrict) {
      // 1.2 or below: restrict because collateral buffer is dangerously thin
      escalate(STATES.RESTRICTED, `Health factor: ${healthFactor.toFixed(2)} (restricted at ${POLICY.healthRestrict})`);
    } else if (healthFactor <= POLICY.healthWarn) {
      // 1.5 or below: warn because the safety margin is shrinking
      escalate(STATES.WARNING, `Health factor: ${healthFactor.toFixed(2)} (warn at ${POLICY.healthWarn})`);
    }

    // — Volatility — high annualised vol means leveraged positions can swing violently between ticks
    if (volatility >= POLICY.volRestrict) {
      // 80%+ vol: restrict because leverage amplifies already-extreme swings
      escalate(STATES.RESTRICTED, `Volatility: ${(volatility * 100).toFixed(0)}% (restricted at ${POLICY.volRestrict * 100}%)`);
    } else if (volatility >= POLICY.volWarn) {
      // 50%+ vol: warn because market conditions are no longer orderly
      escalate(STATES.WARNING, `Volatility: ${(volatility * 100).toFixed(0)}% (warn at ${POLICY.volWarn * 100}%)`);
    }

    // — Pool utilization — high utilization means liquidity is scarce, exits become difficult
    if (utilization >= POLICY.utilizationRestrict) {
      // 90%+ utilization: restrict new borrows to preserve exit liquidity for existing users
      escalate(STATES.RESTRICTED, `Pool utilization: ${(utilization * 100).toFixed(1)}% (restricted at ${POLICY.utilizationRestrict * 100}%)`);
    } else if (utilization >= POLICY.utilizationWarn) {
      // 75%+ utilization: warn because the pool is getting crowded
      escalate(STATES.WARNING, `Pool utilization: ${(utilization * 100).toFixed(1)}% (warn at ${POLICY.utilizationWarn * 100}%)`);
    }

    // — Deleverage level from drawdown — walk the ladder backwards to find the highest triggered level
    let deleverageLevel = 0; // Start at "no action" and only escalate
    for (let i = DELEVERAGE_LEVELS.length - 1; i >= 0; i--) { // Reverse scan finds the worst matching level first
      if (drawdown >= DELEVERAGE_LEVELS[i].trigger) { // First match from the top is the most severe applicable level
        deleverageLevel = i;
        break; // Stop once worst level is found — lower levels are redundant
      }
    }
    // Cache the matched deleverage entry for the return object
    const deleverage = DELEVERAGE_LEVELS[deleverageLevel];

    // Return a single deterministic snapshot so callers don't need to re-derive anything
    return {
      state:            worstState,                       // The worst-case state across all checks
      reasons,                                            // Every triggered rule with its severity, for audit/UI display
      leverageCap:      STATE_META[worstState].maxLeverage, // Hard leverage ceiling derived from current state
      deleverageLevel:  deleverage.level,                 // Numeric deleverage level (0-5) for programmatic use
      deleverageAction: deleverage.action,                // Machine-readable action string (e.g. 'reduce_50')
      deleverageLabel:  deleverage.label,                 // Human-readable label for the UI
      meta:             STATE_META[worstState],           // Full state metadata (color, icon, label) for rendering
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
    // Work with absolute value so the logic applies equally to long (+) and short (-) positions
    const absLev = Math.abs(currentLeverage);
    // Preserve the direction sign so the recommendation returns a properly-signed leverage value
    const sign = currentLeverage >= 0 ? 1 : -1;
    // Start with current leverage; each rule below can only reduce it
    let newLev = absLev;
    // Default to manual-only; only severe deleverage levels auto-execute
    let shouldAutoExecute = false;
    // Default description; overwritten if any rule triggers
    let description = 'No action required';

    // State-based cap: if the risk state imposes a leverage ceiling lower than current, enforce it
    if (absLev > evaluation.leverageCap) {
      newLev = evaluation.leverageCap;
      description = `Leverage capped to ${evaluation.leverageCap}× (state: ${evaluation.state})`;
    }

    // Deleverage-level based reduction: progressively more aggressive actions as drawdown worsens
    const dl = evaluation.deleverageLevel;
    if (dl >= 5) {
      // Level 5: 40%+ drawdown — total liquidation, no position should remain
      newLev = 0;
      shouldAutoExecute = true; // Auto-execute because user may be unable to act in time
      description = 'LIQUIDATION — full position close';
    } else if (dl === 4) {
      // Level 4: 30%+ drawdown — force to market-neutral to stop bleeding
      newLev = Math.min(newLev, 1.0);
      shouldAutoExecute = true; // Auto-execute because delay increases loss exponentially at this drawdown
      description = 'Emergency deleverage to 1.0×';
    } else if (dl === 3) {
      // Level 3: 22%+ drawdown — cap at 1.5x to contain further downside
      newLev = Math.min(newLev, 1.5);
      shouldAutoExecute = true; // Auto-execute because the drawdown is severe enough to warrant immediate action
      description = 'Auto-deleverage: cap at 1.5×';
    } else if (dl === 2) {
      // Level 2: 15%+ drawdown — recommend halving leverage but let the user decide
      newLev = Math.min(newLev, absLev * 0.5);
      description = `Recommended: reduce leverage by 50% → ${(absLev * 0.5).toFixed(1)}×`;
    } else if (dl === 1) {
      // Level 1: 10%+ drawdown — mild recommendation to trim 25% of exposure
      newLev = Math.min(newLev, absLev * 0.75);
      description = `Recommended: reduce leverage by 25% → ${(absLev * 0.75).toFixed(1)}×`;
    }

    // Return the recommendation with the original sign restored and rounded for display
    return {
      recommendedLeverage: parseFloat((newLev * sign).toFixed(2)), // Apply sign and round to 2 decimals for clean output
      shouldAutoExecute,  // Whether the system should act without user confirmation
      description,        // Human-readable explanation for the UI/logs
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
    // Calculate how many seconds since the oracle last published — staleness is the #1 oracle risk
    const ageSec = nowTimestamp - lastUpdateTimestamp;
    // Divergence measures how much the two feeds disagree, normalized by the larger price to get a ratio
    const divergence = Math.abs(primaryPrice - secondaryPrice) / Math.max(primaryPrice, secondaryPrice);
    // Oracle is healthy only if both freshness AND agreement are within warning thresholds
    const healthy = ageSec < POLICY.oracleMaxStaleSec && divergence < POLICY.oracleDivergenceWarn;

    // Return all components so callers can display granular oracle diagnostics
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
    // Timeline accumulates the full history so the UI can render a step-by-step narrative
    const timeline = [];
    // Track leverage across ticks because auto-executes in one tick affect the starting leverage of the next
    let currentLev = startLeverage;

    // Iterate through each market snapshot in chronological order
    for (let i = 0; i < ticks.length; i++) {
      // Run the risk engine against this tick's market conditions
      const evaluation = evaluate(ticks[i]);
      // Determine what action (if any) to take given current leverage and the evaluation result
      const recommendation = deleverageRecommendation(currentLev, evaluation);

      // Only auto-execute changes for severe deleverage levels (3+); milder levels are advisory only
      if (recommendation.shouldAutoExecute) {
        currentLev = recommendation.recommendedLeverage; // Commit the deleverage so subsequent ticks start from the new level
      }

      // Record everything about this tick for the scenario timeline visualization
      timeline.push({
        tick: i,                                          // Zero-based tick index for chart x-axis
        inputs: ticks[i],                                 // Raw market inputs so the UI can show what triggered each state
        state: evaluation.state,                          // Risk state at this tick (NORMAL/WARNING/RESTRICTED/EMERGENCY)
        reasons: evaluation.reasons,                      // All triggered rules for the detail panel
        leverageCap: evaluation.leverageCap,              // Max allowed leverage at this tick
        deleverageLevel: evaluation.deleverageLevel,      // Numeric deleverage level (0-5)
        deleverageLabel: evaluation.deleverageLabel,      // Human label for the deleverage level
        recommendation: recommendation.description,       // What the engine recommends doing
        shouldAutoExecute: recommendation.shouldAutoExecute, // Whether this tick auto-executes
        // leverageBefore: the leverage entering this tick; first tick uses startLeverage
        leverageBefore: timeline.length > 0 ? timeline[timeline.length - 1].leverageAfter : startLeverage,
        // leverageAfter: the leverage exiting this tick; only changes if auto-execute fires
        leverageAfter: recommendation.shouldAutoExecute ? recommendation.recommendedLeverage : currentLev,
      });
    }

    // Return the full timeline so the UI can render the complete scenario progression
    return timeline;
  }

  // ═══════════════════════════════════════════════════════════
  // DEMO SCENARIOS
  // ═══════════════════════════════════════════════════════════

  // Pre-built scenarios let the UI demonstrate risk engine behavior without needing a live oracle
  const DEMO_SCENARIOS = {
    // Normal market: all metrics stay well within safe bounds to show the engine at rest
    normalMarket: {
      name: 'Normal Market Conditions',                     // Scenario title for the dropdown/UI
      description: 'Steady market with healthy oracles — system stays in NORMAL state', // Explains what to expect
      startLeverage: 3.0,                                   // Start at 3x to show the engine allows full leverage in calm markets
      ticks: [
        // Tick 0: Very fresh oracle, tiny divergence, no drawdown, strong health — baseline calm
        { oracleAgeSec: 10,  oracleDivergence: 0.001, drawdown: 0.00, healthFactor: 2.5,  volatility: 0.20, utilization: 0.45 },
        // Tick 1: Slight age increase and minor drawdown — still well within NORMAL bounds
        { oracleAgeSec: 15,  oracleDivergence: 0.002, drawdown: 0.01, healthFactor: 2.4,  volatility: 0.22, utilization: 0.47 },
        // Tick 2: Small uptick in drawdown and vol — normal market noise
        { oracleAgeSec: 12,  oracleDivergence: 0.001, drawdown: 0.02, healthFactor: 2.3,  volatility: 0.25, utilization: 0.48 },
        // Tick 3: Slight divergence bump — still far below the 1% warn threshold
        { oracleAgeSec: 8,   oracleDivergence: 0.003, drawdown: 0.01, healthFactor: 2.4,  volatility: 0.23, utilization: 0.46 },
        // Tick 4: Highest vol in this scenario (28%) — still comfortably below the 50% warning
        { oracleAgeSec: 20,  oracleDivergence: 0.002, drawdown: 0.03, healthFactor: 2.2,  volatility: 0.28, utilization: 0.50 },
        // Tick 5: Conditions stabilize — demonstrates mean-reversion to calm
        { oracleAgeSec: 11,  oracleDivergence: 0.001, drawdown: 0.02, healthFactor: 2.3,  volatility: 0.24, utilization: 0.48 },
        // Tick 6: Market improving — drawdown shrinking, health recovering
        { oracleAgeSec: 14,  oracleDivergence: 0.002, drawdown: 0.01, healthFactor: 2.5,  volatility: 0.21, utilization: 0.44 },
        // Tick 7: Back to near-perfect conditions — shows the engine stays NORMAL throughout
        { oracleAgeSec: 9,   oracleDivergence: 0.001, drawdown: 0.00, healthFactor: 2.6,  volatility: 0.19, utilization: 0.42 },
      ],
    },

    // Stressed market: escalating drawdown and deteriorating metrics to show the full state transition chain
    stressedMarket: {
      name: 'Market Stress → Emergency Deleverage',         // Title communicates the expected arc
      description: 'Escalating drawdown triggers WARNING → RESTRICTED → EMERGENCY with auto-deleverage', // What to watch for
      startLeverage: 3.0,                                    // Start at 3x to make deleverage steps visible
      ticks: [
        // Tick 0: Slightly elevated metrics but still NORMAL — the calm before the storm
        { oracleAgeSec: 10,  oracleDivergence: 0.002, drawdown: 0.02, healthFactor: 2.0,  volatility: 0.30, utilization: 0.55 },
        // Tick 1: Drawdown crosses 5% warn → first WARNING state; vol rising
        { oracleAgeSec: 30,  oracleDivergence: 0.005, drawdown: 0.06, healthFactor: 1.8,  volatility: 0.40, utilization: 0.62 },
        // Tick 2: Drawdown 11%, oracle divergence crosses 1% warn, vol crosses 50% warn → multiple WARNING triggers
        { oracleAgeSec: 120, oracleDivergence: 0.012, drawdown: 0.11, healthFactor: 1.4,  volatility: 0.55, utilization: 0.72 },
        // Tick 3: Drawdown 16% → RESTRICTED; health nearing restrict threshold; oracle aging past 5min warn
        { oracleAgeSec: 250, oracleDivergence: 0.018, drawdown: 0.16, healthFactor: 1.15, volatility: 0.65, utilization: 0.82 },
        // Tick 4: Drawdown 23% → deleverage level 3 (cap 1.5x auto-execute); vol crosses 80% restrict
        { oracleAgeSec: 400, oracleDivergence: 0.025, drawdown: 0.23, healthFactor: 1.08, volatility: 0.85, utilization: 0.91 },
        // Tick 5: Drawdown 31% → EMERGENCY + deleverage level 4 (force 1x); oracle critically stale
        { oracleAgeSec: 600, oracleDivergence: 0.035, drawdown: 0.31, healthFactor: 1.02, volatility: 0.95, utilization: 0.95 },
        // Tick 6: Drawdown 35% — still in EMERGENCY; oracle 15min stale (critical)
        { oracleAgeSec: 900, oracleDivergence: 0.040, drawdown: 0.35, healthFactor: 0.98, volatility: 1.10, utilization: 0.97 },
        // Tick 7: Drawdown 42% → deleverage level 5 (liquidation); total system stress
        { oracleAgeSec: 1200,oracleDivergence: 0.050, drawdown: 0.42, healthFactor: 0.90, volatility: 1.20, utilization: 0.99 },
      ],
    },

    // Oracle failure: market stays calm but the oracle feed dies, showing how staleness alone restricts leverage
    oracleFailure: {
      name: 'Oracle Feed Failure',                           // Title highlights this is an infrastructure scenario, not a market one
      description: 'Oracle goes stale while market is normal — system restricts leverage preemptively', // Key insight: oracle risk alone triggers protection
      startLeverage: 2.5,                                    // Start at 2.5x to show restriction kicks in even at moderate leverage
      ticks: [
        // Tick 0: Everything healthy — establishes baseline
        { oracleAgeSec: 10,   oracleDivergence: 0.001, drawdown: 0.01, healthFactor: 2.2, volatility: 0.25, utilization: 0.50 },
        // Tick 1: Oracle age creeping up to 60s — still fine but trending
        { oracleAgeSec: 60,   oracleDivergence: 0.003, drawdown: 0.02, healthFactor: 2.1, volatility: 0.26, utilization: 0.51 },
        // Tick 2: 3 minutes stale — approaching the 5-min WARNING threshold
        { oracleAgeSec: 180,  oracleDivergence: 0.008, drawdown: 0.02, healthFactor: 2.1, volatility: 0.27, utilization: 0.52 },
        // Tick 3: 310s stale → crosses 300s threshold → WARNING; divergence also crossing 1% warn
        { oracleAgeSec: 310,  oracleDivergence: 0.015, drawdown: 0.03, healthFactor: 2.0, volatility: 0.28, utilization: 0.53 },
        // Tick 4: 10 minutes stale — deep into WARNING territory; divergence widening
        { oracleAgeSec: 600,  oracleDivergence: 0.020, drawdown: 0.03, healthFactor: 2.0, volatility: 0.28, utilization: 0.54 },
        // Tick 5: 950s stale → crosses 900s critical threshold → RESTRICTED; divergence crosses 3% critical
        { oracleAgeSec: 950,  oracleDivergence: 0.032, drawdown: 0.04, healthFactor: 1.9, volatility: 0.30, utilization: 0.55 },
        // Tick 6: Oracle recovers (30s fresh) — system drops back to WARNING or NORMAL as staleness clears
        { oracleAgeSec: 30,   oracleDivergence: 0.002, drawdown: 0.02, healthFactor: 2.1, volatility: 0.25, utilization: 0.50 },
        // Tick 7: Fully recovered — demonstrates the system returns to NORMAL when oracle heals
        { oracleAgeSec: 12,   oracleDivergence: 0.001, drawdown: 0.01, healthFactor: 2.2, volatility: 0.23, utilization: 0.48 },
      ],
    },
  };

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════

  // Freeze the public API object so consumers cannot monkey-patch risk engine methods at runtime
  return Object.freeze({
    STATES,                    // Expose state enum so external code can compare against known values
    STATE_META,                // Expose state metadata so the UI can render colors/icons/labels
    POLICY,                    // Expose thresholds so the UI can display them and tests can assert against them
    DELEVERAGE_LEVELS,         // Expose the deleverage ladder for UI rendering and test verification
    DEMO_SCENARIOS,            // Expose demo scenarios so the scenario runner UI can list and execute them
    evaluate,                  // Core function: takes market inputs, returns deterministic risk state
    deleverageRecommendation,  // Translates a risk evaluation into a concrete leverage adjustment
    checkOracle,               // Standalone oracle health check for use outside the full evaluate flow
    runScenario,               // Runs a sequence of ticks through the engine for simulation/demo purposes
  });

})(); // Immediately invoke the factory to create the singleton RiskEngine

// Universal module export: works in Node.js (for tests) and browsers (as a global)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RiskEngine; // Node/CommonJS export for the test harness
}
if (typeof window !== 'undefined') {
  window.RiskEngine = RiskEngine;
}
