/**
 * xLever Signal Aggregator
 * ─────────────────────────
 * Combines signals from the three parallel analyst agents into a single
 * weighted trading decision. Implements:
 *
 *  1. Weighted confidence scoring (configurable per analyst)
 *  2. Consensus detection (agreement across agents)
 *  3. Conflict resolution (disagreeing agents)
 *  4. Action recommendation with conviction level
 *  5. Signal history for pattern tracking
 *
 * Output: a single ActionRecommendation consumed by the AgentCoordinator
 */

const SignalAggregator = (() => {

  // ═══════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  // Default analyst weights — can be overridden at runtime
  // When LLM analyst is active, weights are rebalanced automatically
  let _weights = {
    sentiment:  0.25,   // News sentiment carries moderate weight
    technical:  0.30,   // Technical/price action carries the most (market has spoken)
    macro:      0.20,   // Macro context provides strategic backdrop
    llm:        0.25,   // Perplexity AI-driven analysis (ignored when unavailable)
  }

  // Conviction thresholds — determines when to act vs hold
  const THRESHOLDS = Object.freeze({
    STRONG_BUY:    0.70,   // High conviction bullish — increase leverage or open
    BUY:           0.45,   // Moderate conviction bullish — small increase
    HOLD_UPPER:    0.15,   // Neutral-ish, lean bullish — hold
    HOLD_LOWER:   -0.15,   // Neutral-ish, lean bearish — hold
    SELL:         -0.45,   // Moderate conviction bearish — decrease leverage
    STRONG_SELL:  -0.70,   // High conviction bearish — close or heavy deleverage
  })

  // Consensus bonus — signals strengthen when analysts agree
  const CONSENSUS_BONUS = 0.15
  // Conflict penalty — signals weaken when analysts disagree
  const CONFLICT_PENALTY = 0.25

  // ═══════════════════════════════════════════════════════════════
  // SIGNAL HISTORY
  // ═══════════════════════════════════════════════════════════════

  const MAX_HISTORY = 100
  const _history = []

  function recordSignal(recommendation) {
    _history.push(recommendation)
    if (_history.length > MAX_HISTORY) _history.shift()
  }

  // ═══════════════════════════════════════════════════════════════
  // AGGREGATION ENGINE
  // ═══════════════════════════════════════════════════════════════

  function aggregate(analysisResult) {
    const { newsItem, signals, analysisTime } = analysisResult

    // Convert direction to numeric: bullish=+1, bearish=-1, neutral=0
    const directionValue = (dir) => dir === 'bullish' ? 1 : dir === 'bearish' ? -1 : 0

    // ── Step 1: Weighted score ──
    let weightedScore = 0
    let totalWeight = 0
    const breakdown = []

    for (const signal of signals) {
      const w = _weights[signal.analyst] || 0.33
      const score = directionValue(signal.direction) * signal.confidence * w
      weightedScore += score
      totalWeight += w

      breakdown.push({
        analyst: signal.analyst,
        direction: signal.direction,
        confidence: signal.confidence,
        weight: w,
        contribution: score,
        action: signal.action,
        reasoning: signal.reasoning,
      })
    }

    // Normalize by total weight
    if (totalWeight > 0) weightedScore /= totalWeight

    // ── Step 2: Consensus detection ──
    const directions = signals.map(s => s.direction).filter(d => d !== 'neutral')
    const uniqueDirections = new Set(directions)

    let consensus = 'mixed'
    if (uniqueDirections.size === 1 && directions.length >= 2) {
      consensus = 'unanimous'
      // Boost score when all non-neutral analysts agree
      weightedScore *= (1 + CONSENSUS_BONUS)
    } else if (uniqueDirections.size === 2) {
      consensus = 'conflicting'
      // Dampen score when analysts disagree
      weightedScore *= (1 - CONFLICT_PENALTY)
    } else if (directions.length <= 1) {
      consensus = 'insufficient'
    }

    // ── Step 3: Urgency aggregation ──
    // Take the most urgent signal
    const urgencyRank = { 'immediate': 0, 'short-term': 1, 'long-term': 2 }
    const mostUrgent = signals.reduce((best, s) =>
      (urgencyRank[s.urgency] || 2) < (urgencyRank[best.urgency] || 2) ? s : best
    , signals[0])

    // ── Step 4: Determine action recommendation ──
    let action, conviction

    if (weightedScore >= THRESHOLDS.STRONG_BUY) {
      action = 'strong_increase'
      conviction = 'high'
    } else if (weightedScore >= THRESHOLDS.BUY) {
      action = 'increase'
      conviction = 'medium'
    } else if (weightedScore > THRESHOLDS.HOLD_UPPER) {
      action = 'hold'
      conviction = 'low'
    } else if (weightedScore >= THRESHOLDS.HOLD_LOWER) {
      action = 'hold'
      conviction = 'neutral'
    } else if (weightedScore >= THRESHOLDS.SELL) {
      action = 'decrease'
      conviction = 'medium'
    } else if (weightedScore >= THRESHOLDS.STRONG_SELL) {
      action = 'strong_decrease'
      conviction = 'high'
    } else {
      action = 'emergency_close'
      conviction = 'critical'
    }

    // ── Step 5: Affected assets ──
    const allAssets = new Set()
    for (const s of signals) {
      for (const a of (s.affectedAssets || [])) allAssets.add(a)
    }

    // ── Step 6: Build recommendation ──
    const recommendation = {
      // Core decision
      action,
      conviction,
      direction: weightedScore > 0 ? 'bullish' : weightedScore < 0 ? 'bearish' : 'neutral',
      score: weightedScore,

      // Context
      consensus,
      urgency: mostUrgent?.urgency || 'short-term',
      affectedAssets: [...allAssets],

      // Source
      newsItem: {
        id: newsItem.id,
        headline: newsItem.headline,
        priority: newsItem.priority,
        source: newsItem.source,
      },

      // Analyst breakdown
      breakdown,
      analysisTime,
      timestamp: Date.now(),
    }

    recordSignal(recommendation)
    return recommendation
  }

  // ═══════════════════════════════════════════════════════════════
  // TREND ANALYSIS (over recent signal history)
  // ═══════════════════════════════════════════════════════════════

  function getRecentTrend(windowMs = 300000) { // Default 5 minute window
    const cutoff = Date.now() - windowMs
    const recent = _history.filter(r => r.timestamp > cutoff)
    if (recent.length === 0) return { direction: 'neutral', avgScore: 0, count: 0 }

    const avgScore = recent.reduce((sum, r) => sum + r.score, 0) / recent.length
    return {
      direction: avgScore > 0.1 ? 'bullish' : avgScore < -0.1 ? 'bearish' : 'neutral',
      avgScore,
      count: recent.length,
      strongSignals: recent.filter(r => Math.abs(r.score) > 0.5).length,
      consensus: recent.filter(r => r.consensus === 'unanimous').length,
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BATCH AGGREGATION
  // ═══════════════════════════════════════════════════════════════

  // Aggregate multiple analysis results and pick the highest conviction
  function aggregateBatch(analysisResults) {
    const recommendations = analysisResults.map(r => aggregate(r))
    // Sort by absolute score descending — strongest signal first
    recommendations.sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    return recommendations
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    aggregate,
    aggregateBatch,
    getRecentTrend,

    // Configuration
    setWeights(w) {
      _weights = { ..._weights, ...w }
    },
    get weights() { return { ..._weights } },
    get thresholds() { return THRESHOLDS },

    // History
    get history() { return [..._history] },
    get historySize() { return _history.length },
    clearHistory() { _history.length = 0 },
  })
})()

window.SignalAggregator = SignalAggregator
