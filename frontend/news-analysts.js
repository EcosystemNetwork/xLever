/**
 * xLever Parallel Analyst Agents
 * ───────────────────────────────
 * Three specialized agents that process news items concurrently:
 *
 *  1. SentimentAnalyst  — NLP-style sentiment extraction from headlines/body
 *  2. TechnicalAnalyst  — Correlates news with price action & technicals
 *  3. MacroAnalyst      — Evaluates macro/fundamental impact on portfolio
 *
 * Each agent:
 *  - Accepts a news item + market context
 *  - Returns a typed signal { direction, confidence, reasoning, ... }
 *  - Runs independently (designed for Promise.all parallelism)
 */

const NewsAnalysts = (() => {

  // ═══════════════════════════════════════════════════════════════
  // SIGNAL SCHEMA
  // ═══════════════════════════════════════════════════════════════

  // direction: 'bullish' | 'bearish' | 'neutral'
  // confidence: 0..1 (0 = no signal, 1 = maximum conviction)
  // urgency: 'immediate' | 'short-term' | 'long-term'
  // action: 'increase' | 'decrease' | 'close' | 'hold' | 'open'

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

  // Correlates news with current price state from Pyth + OpenBB
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

  // Evaluates macro/fundamental impact on portfolio-level risk

  // Macro event categories and their typical impact directions
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

  // Run all analysts in parallel on a single news item
  // Includes LLM analyst (Perplexity AI) when API key is configured
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
