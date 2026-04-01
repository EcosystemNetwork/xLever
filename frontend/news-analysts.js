/**
 * @file news-analysts.js
 * @module NewsAnalysts
 * @description
 * xLever Parallel Analyst Agents — Multi-analyst sentiment scoring system.
 * Three (optionally four) specialized agents that process news items concurrently:
 *
 *  1. SentimentAnalyst  — Keyword-weight NLP sentiment extraction from headlines/body
 *  2. TechnicalAnalyst  — Correlates news with live Pyth oracle prices and OpenBB technicals
 *  3. MacroAnalyst      — Evaluates macro/fundamental impact using event pattern matching
 *  4. LLMAnalyst        — AI-powered analysis via Perplexity/Groq/etc. (optional, via window.LLMAnalyst)
 *
 * Each agent:
 *  - Accepts a news item and returns a typed signal { direction, confidence, reasoning, ... }
 *  - Runs independently (designed for Promise.all parallelism)
 *  - Degrades gracefully when external data sources are unavailable
 *
 * @exports {Object} NewsAnalysts - Frozen singleton exposed on window.NewsAnalysts
 *
 * @dependencies
 *  - window.xLeverPyth    — Pyth oracle for live price feeds (used by TechnicalAnalyst)
 *  - window.xLeverOpenBB  — OpenBB market data (used by TechnicalAnalyst)
 *  - window.xLeverAssets  — Asset registry and feed ID mapping
 *  - window.RiskLive      — Live risk engine state (used by MacroAnalyst)
 *  - window.LLMAnalyst    — LLM-based analyst (optional fourth analyst)
 */

const NewsAnalysts = (() => {

  // ═══════════════════════════════════════════════════════════════
  // SIGNAL SCHEMA
  // ═══════════════════════════════════════════════════════════════

  // direction: 'bullish' | 'bearish' | 'neutral'
  // confidence: 0..1 (0 = no signal, 1 = maximum conviction)
  // urgency: 'immediate' | 'short-term' | 'long-term'
  // action: 'increase' | 'decrease' | 'close' | 'hold' | 'open'

  /**
   * Create a signal object with sensible defaults, then apply overrides.
   * All analyst agents use this factory to ensure consistent signal structure.
   *
   * @param {string} analyst - Analyst identifier ('sentiment', 'technical', 'macro', 'llm')
   * @param {Object} [overrides={}] - Properties to override on the default signal
   * @param {'bullish'|'bearish'|'neutral'} [overrides.direction] - Market direction
   * @param {number} [overrides.confidence] - Confidence 0..1 (0 = no signal, 1 = max conviction)
   * @param {'immediate'|'short-term'|'long-term'} [overrides.urgency] - Time horizon
   * @param {'increase'|'decrease'|'close'|'hold'|'open'} [overrides.action] - Recommended action
   * @param {string} [overrides.reasoning] - Human-readable explanation
   * @param {string[]} [overrides.affectedAssets] - Ticker symbols affected
   * @returns {Object} Complete signal object
   */
  function makeSignal(analyst, overrides = {}) {
    return {
      analyst,
      direction: 'neutral',
      confidence: 0,
      urgency: 'short-term',
      action: 'hold',
      reasoning: '',
      affectedAssets: [],
      timestamp: Date.now(),
      ...overrides,
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. SENTIMENT ANALYST
  // ═══════════════════════════════════════════════════════════════

  // Keyword-weight sentiment scoring — fast, no LLM required
  const BULLISH_WORDS = {
    'beat':2, 'beats':2, 'exceeded':2, 'surpass':2, 'surge':2, 'soar':2, 'rally':2,
    'upgrade':1.5, 'outperform':1.5, 'buy':1.5, 'bullish':1.5,
    'growth':1, 'gain':1, 'positive':1, 'strong':1, 'record':1, 'high':1,
    'recovery':1, 'rebound':1, 'expand':1, 'optimis':1, 'boost':1, 'profit':1,
    'raise':1, 'upside':1, 'breakout':1, 'momentum':1,
  }

  const BEARISH_WORDS = {
    'miss':2, 'missed':2, 'disappoint':2, 'crash':2, 'plunge':2, 'collapse':2,
    'downgrade':1.5, 'underperform':1.5, 'sell':1.5, 'bearish':1.5,
    'decline':1, 'loss':1, 'negative':1, 'weak':1, 'low':1, 'drop':1,
    'recession':1.5, 'layoff':1, 'cut':1, 'slash':1, 'warning':1, 'risk':1,
    'default':1.5, 'bankruptcy':2, 'investigation':1.5, 'fraud':2,
    'tariff':1.5, 'sanction':1.5, 'war':1.5, 'halt':1.5,
  }

  // Amplifiers and dampeners
  const AMPLIFIERS = /\b(very|extremely|significantly|massively|sharply|dramatically)\b/gi
  const NEGATORS = /\b(not|no|never|unlikely|despite|although|however)\b/gi

  /**
   * Sentiment Analyst — keyword-weight scoring without LLM dependency.
   * Scores headline + body text against bullish/bearish word dictionaries,
   * applies amplifier/negator modifiers, and normalizes to a 0..1 confidence.
   *
   * Scoring formula:
   *  - Each word has a weight (1-2 points)
   *  - Amplifiers ("extremely", "sharply") boost all scores by 20% each
   *  - Negators ("not", "despite") dampen the dominant signal by 15% each (min 30%)
   *  - Net score normalized by dividing by ~8 (expected max), capped at 1.0
   *
   * @param {Object} newsItem - News item with headline, body, priority, and symbols
   * @returns {Object} Signal with direction, confidence (0..1), action, and reasoning
   */
  function analyzeSentiment(newsItem) {
    const text = `${newsItem.headline} ${newsItem.body}`.toLowerCase()
    const words = text.split(/\W+/)

    let bullScore = 0, bearScore = 0, matchedBull = [], matchedBear = []

    for (const w of words) {
      if (BULLISH_WORDS[w]) {
        bullScore += BULLISH_WORDS[w]
        matchedBull.push(w)
      }
      if (BEARISH_WORDS[w]) {
        bearScore += BEARISH_WORDS[w]
        matchedBear.push(w)
      }
    }

    // Amplifier boost
    const ampCount = (text.match(AMPLIFIERS) || []).length
    const multiplier = 1 + ampCount * 0.2

    // Negator dampening — reduces the dominant signal
    const negCount = (text.match(NEGATORS) || []).length
    const dampener = Math.max(0.3, 1 - negCount * 0.15)

    bullScore *= multiplier * dampener
    bearScore *= multiplier * dampener

    // Normalize to 0..1 confidence
    const totalScore = bullScore + bearScore
    if (totalScore === 0) {
      return makeSignal('sentiment', { reasoning: 'No sentiment keywords detected.' })
    }

    const netScore = bullScore - bearScore
    const direction = netScore > 0.5 ? 'bullish' : netScore < -0.5 ? 'bearish' : 'neutral'
    const confidence = Math.min(Math.abs(netScore) / 8, 1) // Cap at 1, normalize by ~8 max expected

    let action = 'hold'
    if (direction === 'bullish' && confidence > 0.5) action = 'increase'
    else if (direction === 'bearish' && confidence > 0.5) action = 'decrease'
    else if (direction === 'bearish' && confidence > 0.8) action = 'close'

    const urgency = newsItem.priority <= 1 ? 'immediate' : confidence > 0.6 ? 'short-term' : 'long-term'

    return makeSignal('sentiment', {
      direction,
      confidence,
      urgency,
      action,
      reasoning: `Sentiment: ${direction} (${(confidence * 100).toFixed(0)}%). Bull words: [${matchedBull.join(', ')}]. Bear words: [${matchedBear.join(', ')}].`,
      affectedAssets: newsItem.symbols || [],
    })
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. TECHNICAL ANALYST
  // ═══════════════════════════════════════════════════════════════

  /**
   * Technical Analyst — correlates news with current price state from Pyth oracle + OpenBB.
   *
   * Technical signals evaluated:
   *  1. Volatility spike detection (oracle confidence/price ratio > 0.5%)
   *  2. Daily momentum alignment (daily % change from OpenBB)
   *  3. Trend context from 50-day moving average
   *  4. Oracle staleness check (>300s halves confidence)
   *
   * Falls back gracefully when Pyth or OpenBB are unavailable.
   *
   * @param {Object} newsItem - News item with symbols for asset targeting
   * @returns {Promise<Object>} Signal with direction, confidence, and technical metadata
   */
  async function analyzeTechnical(newsItem) {
    const pyth = window.xLeverPyth
    const openbb = window.xLeverOpenBB
    const assets = window.xLeverAssets

    if (!pyth || !assets) {
      return makeSignal('technical', { reasoning: 'Pyth or assets not available.' })
    }

    // Get primary asset feed — prefer matched symbols, fall back to QQQ
    const targetSym = (newsItem.symbols && newsItem.symbols[0]) || 'QQQ'
    const feedId = assets.ASSET_FEED_MAP[targetSym] || assets.ASSET_FEED_MAP['QQQ']

    let price, conf, publishTime
    try {
      const p = await pyth.getPriceForFeed(feedId)
      price = p.price
      conf = p.conf
      publishTime = p.publishTime
    } catch {
      return makeSignal('technical', {
        reasoning: `Oracle unavailable for ${targetSym}.`,
        affectedAssets: newsItem.symbols || [],
      })
    }

    // Calculate oracle health metrics
    const oracleAge = pyth.oracleAge(publishTime)
    const volatilityProxy = conf / price // Confidence/price ratio as vol proxy
    const isVolatile = volatilityProxy > 0.005 // >0.5% confidence band = elevated vol

    // Try to get daily context from OpenBB
    let dailyChange = null, fiftyDayMA = null
    if (openbb) {
      try {
        const ctx = await openbb.getDashboardContext()
        if (ctx && ctx.quotes) {
          const q = ctx.quotes.find(q => (q.symbol || '').toUpperCase() === targetSym)
          if (q) {
            dailyChange = q.regular_market_change_percent || q.change_percent || 0
            fiftyDayMA = q.fifty_day_average || null
          }
        }
      } catch { /* OpenBB optional */ }
    }

    // Technical signals
    let direction = 'neutral'
    let confidence = 0.3 // Base confidence from having price data
    let action = 'hold'
    const reasons = []

    // 1. Volatility spike detection
    if (isVolatile) {
      confidence += 0.2
      reasons.push(`Elevated volatility (conf/price: ${(volatilityProxy * 100).toFixed(2)}%)`)
    }

    // 2. Daily momentum alignment with news sentiment
    if (dailyChange !== null) {
      const absDailyChange = Math.abs(dailyChange)
      if (absDailyChange > 2) {
        // Big daily move — news aligns with price action
        direction = dailyChange > 0 ? 'bullish' : 'bearish'
        confidence += Math.min(absDailyChange / 10, 0.3) // Up to 0.3 boost
        reasons.push(`Daily move: ${dailyChange > 0 ? '+' : ''}${dailyChange.toFixed(2)}%`)
      }
    }

    // 3. Trend context from 50-day MA
    if (fiftyDayMA && price) {
      const trendPct = ((price - fiftyDayMA) / fiftyDayMA) * 100
      if (Math.abs(trendPct) > 5) {
        reasons.push(`${trendPct > 0 ? 'Above' : 'Below'} 50-day MA by ${Math.abs(trendPct).toFixed(1)}%`)
        if (trendPct < -5 && direction === 'bearish') confidence += 0.1 // Bear trend confirms bear news
        if (trendPct > 5 && direction === 'bullish') confidence += 0.1 // Bull trend confirms bull news
      }
    }

    // 4. Oracle staleness check
    if (oracleAge > 300) {
      confidence *= 0.5 // Halve confidence if oracle is stale
      reasons.push(`STALE oracle (${oracleAge}s)`)
    }

    // Determine action
    confidence = Math.min(confidence, 1)
    if (direction === 'bearish' && confidence > 0.6) action = 'decrease'
    if (direction === 'bullish' && confidence > 0.6) action = 'increase'
    if (direction === 'bearish' && confidence > 0.85 && isVolatile) action = 'close'

    const urgency = isVolatile || (dailyChange && Math.abs(dailyChange) > 3) ? 'immediate' : 'short-term'

    return makeSignal('technical', {
      direction,
      confidence,
      urgency,
      action,
      reasoning: `Technical [${targetSym}]: $${price?.toFixed(2) || '?'}. ${reasons.join('. ')}.`,
      affectedAssets: newsItem.symbols || [targetSym],
      meta: { price, conf, oracleAge, dailyChange, volatilityProxy },
    })
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. MACRO ANALYST
  // ═══════════════════════════════════════════════════════════════

  /**
   * Macro event categories and their typical market impact directions.
   * Each entry contains regex patterns, expected direction, and a weight (0..1)
   * indicating the typical magnitude of market impact.
   * @type {Object.<string, {patterns: RegExp[], direction: string, weight: number}>}
   */
  const MACRO_EVENTS = {
    // Fed & monetary policy
    fedHawkish:    { patterns: [/\b(rate\s+hike|hawkish|tighter|tapering)\b/i],           direction: 'bearish', weight: 0.8 },
    fedDovish:     { patterns: [/\b(rate\s+cut|dovish|easing|stimulus|accommodative)\b/i], direction: 'bullish', weight: 0.8 },

    // Economic indicators
    strongEcon:    { patterns: [/\b(gdp\s+(beat|above|strong)|jobs\s+(beat|surge|strong)|unemployment\s+(low|drop|fell))\b/i], direction: 'bullish', weight: 0.6 },
    weakEcon:      { patterns: [/\b(gdp\s+(miss|below|weak)|jobs\s+(miss|disappoint)|unemployment\s+(rise|rose|high))\b/i],   direction: 'bearish', weight: 0.6 },

    // Inflation
    hotInflation:  { patterns: [/\b(cpi\s+(hot|high|above|surprise)|inflation\s+(surge|spike|accelerat))\b/i], direction: 'bearish', weight: 0.7 },
    coolInflation: { patterns: [/\b(cpi\s+(cool|low|below)|inflation\s+(ease|slow|deceler|moderate))\b/i],     direction: 'bullish', weight: 0.6 },

    // Geopolitical
    geopoliticalRisk: { patterns: [/\b(war|invasion|sanction|embargo|military\s+strike|nuclear|escalat)\b/i], direction: 'bearish', weight: 0.9 },
    tradeTension:     { patterns: [/\b(tariff|trade\s+war|trade\s+ban|export\s+control)\b/i],                 direction: 'bearish', weight: 0.7 },
    tradeDeal:        { patterns: [/\b(trade\s+deal|trade\s+agreement|tariff\s+reduc)\b/i],                    direction: 'bullish', weight: 0.5 },

    // Market structure
    liquidityCrisis:  { patterns: [/\b(liquidity\s+crisis|bank\s+run|systemic\s+risk|contagion|credit\s+crunch)\b/i], direction: 'bearish', weight: 0.95 },
  }

  /**
   * Macro Analyst — evaluates macro/fundamental impact on portfolio-level risk.
   *
   * Pattern-matches news text against known macro event categories (Fed policy,
   * economic indicators, geopolitical events, etc.) and computes a directional
   * signal. Confidence is amplified when the market is already in a stressed
   * state (RESTRICTED/EMERGENCY) and scaled by the news item's priority level.
   *
   * @param {Object} newsItem - News item with headline, body, priority, and symbols
   * @returns {Promise<Object>} Signal with direction, confidence, matched events, and risk context
   */
  async function analyzeMacro(newsItem) {
    const text = `${newsItem.headline} ${newsItem.body}`
    const matchedEvents = []
    let netDirection = 0 // positive = bullish, negative = bearish
    let maxWeight = 0
    const reasons = []

    for (const [name, event] of Object.entries(MACRO_EVENTS)) {
      for (const pattern of event.patterns) {
        if (pattern.test(text)) {
          matchedEvents.push(name)
          const dirMult = event.direction === 'bullish' ? 1 : -1
          netDirection += dirMult * event.weight
          maxWeight = Math.max(maxWeight, event.weight)
          reasons.push(`${name} (${event.direction}, w=${event.weight})`)
          break // Only match once per event category
        }
      }
    }

    if (matchedEvents.length === 0) {
      return makeSignal('macro', { reasoning: 'No macro events detected.' })
    }

    // Get risk engine state for context
    let riskState = null
    if (window.RiskLive) {
      riskState = window.RiskLive.state
    }

    // Already in stressed market? Amplify bearish signals
    let stressMultiplier = 1
    if (riskState && (riskState.state === 'RESTRICTED' || riskState.state === 'EMERGENCY')) {
      stressMultiplier = 1.3
      reasons.push(`Market already stressed (${riskState.state})`)
    }

    const direction = netDirection > 0 ? 'bullish' : netDirection < 0 ? 'bearish' : 'neutral'
    let confidence = Math.min(Math.abs(netDirection) * stressMultiplier / 2, 1)

    // Scale by priority — CRITICAL news gets full confidence, LOW gets dampened
    const priorityScale = [1.0, 0.85, 0.7, 0.5]
    confidence *= (priorityScale[newsItem.priority] || 0.5)

    let action = 'hold'
    if (direction === 'bearish' && confidence > 0.5) action = 'decrease'
    if (direction === 'bullish' && confidence > 0.5) action = 'increase'
    if (direction === 'bearish' && confidence > 0.8) action = 'close'

    const urgency = maxWeight > 0.8 ? 'immediate' : maxWeight > 0.5 ? 'short-term' : 'long-term'

    // Macro affects the whole portfolio, not just specific assets
    const affectedAssets = (newsItem.symbols && newsItem.symbols.length > 0)
      ? newsItem.symbols
      : ['QQQ', 'SPY'] // Default to index-level impact

    return makeSignal('macro', {
      direction,
      confidence,
      urgency,
      action,
      reasoning: `Macro: ${reasons.join('; ')}.`,
      affectedAssets,
      meta: { matchedEvents, netDirection, riskState: riskState?.state, stressMultiplier },
    })
  }

  // ═══════════════════════════════════════════════════════════════
  // PARALLEL EXECUTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run all analyst agents in parallel on a single news item.
   * Always runs the three core heuristic analysts (sentiment, technical, macro).
   * Includes the LLM analyst (Perplexity AI / Groq / etc.) when its API key is configured.
   *
   * @param {Object} newsItem - News item to analyze
   * @returns {Promise<Object>} Analysis result containing:
   *   @property {Object} newsItem - The original news item
   *   @property {Object[]} signals - Array of signals from each analyst
   *   @property {number} analysisTime - Total wall-clock time in milliseconds
   *   @property {number} timestamp - Unix timestamp of analysis completion
   */
  async function analyzeAll(newsItem) {
    const startTime = performance.now()

    // Core heuristic analysts always run
    const promises = [
      Promise.resolve(analyzeSentiment(newsItem)),
      analyzeTechnical(newsItem),
      analyzeMacro(newsItem),
    ]

    // LLM analyst runs in parallel when available (graceful degradation if not)
    const llm = window.LLMAnalyst
    if (llm && llm.isAvailable()) {
      promises.push(llm.analyze(newsItem))
    }

    const results = await Promise.all(promises)
    const elapsed = performance.now() - startTime

    return {
      newsItem,
      signals: results,
      analysisTime: elapsed,
      timestamp: Date.now(),
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    analyzeSentiment,
    analyzeTechnical,
    analyzeMacro,
    analyzeAll,
    makeSignal,
  })
})()

window.NewsAnalysts = NewsAnalysts
