/**
 * xLever LLM Analyst — Perplexity-Powered Market Intelligence
 * ─────────────────────────────────────────────────────────────
 * Fourth analyst agent in the news-to-trade pipeline.
 * Uses Perplexity AI (online LLM with live web search) to:
 *
 *  1. Analyze news items with real-time market context
 *  2. Generate structured trading signals (direction, confidence, reasoning)
 *  3. Provide AI-driven recommendations that complement heuristic analysts
 *
 * Integrates into NewsAnalysts.analyzeAll() alongside sentiment, technical, macro.
 *
 * Requires: PERPLEXITY_API_KEY in environment / window.__ENV__
 */

const LLMAnalyst = (() => {

  // ═══════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════

  const API_URL = 'https://api.perplexity.ai/chat/completions'
  const MODEL = 'llama-3.1-sonar-small-128k-online'
  const MAX_TOKENS = 600
  const TEMPERATURE = 0.5          // Low temp for consistent trading decisions
  const TIMEOUT_MS = 15000         // 15s max per request
  const MAX_RETRIES = 2

  // Rate limiter state
  const _rateLimiter = {
    maxPerMinute: 10,
    timestamps: [],               // Request timestamps within the window
  }

  // Stats
  const _stats = {
    queries: 0,
    successes: 0,
    failures: 0,
    rateLimited: 0,
    avgLatencyMs: 0,
  }

  // ═══════════════════════════════════════════════════════════════
  // API KEY
  // ═══════════════════════════════════════════════════════════════

  function getApiKey() {
    // Check multiple sources for the API key
    if (window.__ENV__?.PERPLEXITY_API_KEY) return window.__ENV__.PERPLEXITY_API_KEY
    if (window.PERPLEXITY_API_KEY) return window.PERPLEXITY_API_KEY
    return null
  }

  function isAvailable() {
    return !!getApiKey()
  }

  // ═══════════════════════════════════════════════════════════════
  // RATE LIMITER
  // ═══════════════════════════════════════════════════════════════

  function acquireRateSlot() {
    const now = Date.now()
    const windowMs = 60000
    // Purge timestamps older than 1 minute
    _rateLimiter.timestamps = _rateLimiter.timestamps.filter(t => t > now - windowMs)

    if (_rateLimiter.timestamps.length >= _rateLimiter.maxPerMinute) {
      _stats.rateLimited++
      return false
    }

    _rateLimiter.timestamps.push(now)
    return true
  }

  // ═══════════════════════════════════════════════════════════════
  // PERPLEXITY CLIENT
  // ═══════════════════════════════════════════════════════════════

  async function queryPerplexity(prompt, systemPrompt) {
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('No Perplexity API key configured')

    const messages = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: prompt })

    const payload = {
      model: MODEL,
      messages,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      return_citations: true,
      return_images: false,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Perplexity API ${res.status}: ${errText.slice(0, 200)}`)
      }

      const data = await res.json()
      return {
        content: data.choices?.[0]?.message?.content || '',
        citations: data.citations || [],
        model: data.model || MODEL,
        usage: data.usage || {},
      }
    } catch (e) {
      clearTimeout(timeoutId)
      if (e.name === 'AbortError') throw new Error('Perplexity request timed out')
      throw e
    }
  }

  async function queryWithRetry(prompt, systemPrompt) {
    let lastErr
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await queryPerplexity(prompt, systemPrompt)
      } catch (e) {
        lastErr = e
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2 ** attempt * 1000))
        }
      }
    }
    throw lastErr
  }

  // ═══════════════════════════════════════════════════════════════
  // PROMPT ENGINEERING
  // ═══════════════════════════════════════════════════════════════

  const SYSTEM_PROMPT = `You are a trading analyst for xLever, a leveraged trading platform for tokenized index assets (wQQQx, wSPYx).

Analyze the news item and respond with ONLY valid JSON in this exact format:
{
  "direction": "bullish|bearish|neutral",
  "confidence": 0-100,
  "action": "increase|decrease|close|hold",
  "urgency": "immediate|short-term|long-term",
  "reasoning": "2-3 sentence explanation",
  "affected_assets": ["QQQ", "SPY"]
}

Rules:
- Use LIVE web data to verify claims before forming an opinion
- Be conservative: default to "hold" unless signal is clear
- confidence 0-30 = noise, 30-60 = weak signal, 60-80 = actionable, 80+ = high conviction
- Consider: market momentum, volatility regime, event risk, position crowding
- If the news is stale or already priced in, confidence should be low
- Factor in the current risk environment (tariffs, Fed policy, geopolitical tensions)`

  function buildPrompt(newsItem, marketContext) {
    const parts = [
      `NEWS HEADLINE: ${newsItem.headline}`,
    ]

    if (newsItem.body) {
      parts.push(`BODY: ${newsItem.body.slice(0, 500)}`)
    }

    parts.push(`SOURCE: ${newsItem.source || 'unknown'}`)
    parts.push(`PRIORITY: ${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'][newsItem.priority] || 'UNKNOWN'}`)

    if (newsItem.symbols?.length) {
      parts.push(`MENTIONED TICKERS: ${newsItem.symbols.join(', ')}`)
    }

    // Add live market context if available
    if (marketContext) {
      if (marketContext.oraclePrice) {
        parts.push(`CURRENT QQQ PRICE (Pyth oracle): $${marketContext.oraclePrice.toFixed(2)}`)
      }
      if (marketContext.dailyChange !== null && marketContext.dailyChange !== undefined) {
        parts.push(`TODAY'S QQQ MOVE: ${marketContext.dailyChange > 0 ? '+' : ''}${marketContext.dailyChange.toFixed(2)}%`)
      }
      if (marketContext.riskState) {
        parts.push(`RISK ENGINE STATE: ${marketContext.riskState}`)
      }
    }

    parts.push('')
    parts.push('Analyze this news and provide your trading signal as JSON.')

    return parts.join('\n')
  }

  // ═══════════════════════════════════════════════════════════════
  // RESPONSE PARSING
  // ═══════════════════════════════════════════════════════════════

  function extractJSON(content) {
    content = content.trim()

    // Direct parse
    try { return JSON.parse(content) } catch {}

    // Markdown code block
    const codeBlock = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (codeBlock) {
      try { return JSON.parse(codeBlock[1]) } catch {}
    }

    // Find first { ... } block
    const braceMatch = content.match(/\{[\s\S]*\}/)
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]) } catch {}
    }

    return null
  }

  function parseResponse(content, newsItem) {
    const data = extractJSON(content)

    if (!data) {
      return makeFallbackSignal('Could not parse LLM response', content)
    }

    // Validate and clamp values
    const directionRaw = String(data.direction || 'neutral').toLowerCase()
    const direction = ['bullish', 'bearish', 'neutral'].includes(directionRaw) ? directionRaw : 'neutral'

    const confidence = Math.max(0, Math.min(100, Number(data.confidence) || 0)) / 100 // Normalize to 0..1

    const actionRaw = String(data.action || 'hold').toLowerCase()
    const action = ['increase', 'decrease', 'close', 'hold', 'open'].includes(actionRaw) ? actionRaw : 'hold'

    const urgencyRaw = String(data.urgency || 'short-term').toLowerCase()
    const urgency = ['immediate', 'short-term', 'long-term'].includes(urgencyRaw) ? urgencyRaw : 'short-term'

    const reasoning = String(data.reasoning || 'No reasoning provided')

    const affectedAssets = Array.isArray(data.affected_assets)
      ? data.affected_assets.map(String)
      : (newsItem.symbols || [])

    return {
      analyst: 'llm',
      direction,
      confidence,
      urgency,
      action,
      reasoning: `LLM: ${reasoning}`,
      affectedAssets,
      timestamp: Date.now(),
      meta: {
        rawResponse: content.slice(0, 500),
        parseSuccess: true,
      },
    }
  }

  function makeFallbackSignal(reason, rawResponse = '') {
    return {
      analyst: 'llm',
      direction: 'neutral',
      confidence: 0,
      urgency: 'short-term',
      action: 'hold',
      reasoning: `LLM fallback: ${reason}`,
      affectedAssets: [],
      timestamp: Date.now(),
      meta: {
        rawResponse: rawResponse.slice(0, 500),
        parseSuccess: false,
      },
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MARKET CONTEXT GATHERING
  // ═══════════════════════════════════════════════════════════════

  async function gatherMarketContext() {
    const ctx = {}

    // Pyth oracle price
    try {
      const pyth = window.xLeverPyth
      if (pyth) {
        const feed = pyth.PYTH_FEEDS['QQQ/USD']
        const p = await pyth.getPriceForFeed(feed)
        ctx.oraclePrice = p.price
      }
    } catch {}

    // OpenBB daily context
    try {
      const obb = window.xLeverOpenBB
      if (obb) {
        const dash = await obb.getDashboardContext()
        if (dash?.quotes) {
          const qqq = dash.quotes.find(q => (q.symbol || '').toUpperCase() === 'QQQ')
          if (qqq) ctx.dailyChange = qqq.regular_market_change_percent || qqq.change_percent || 0
        }
      }
    } catch {}

    // Risk engine state
    try {
      if (window.RiskLive?.state) {
        ctx.riskState = window.RiskLive.state.state
      }
    } catch {}

    return ctx
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN ANALYSIS FUNCTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Analyze a news item using Perplexity AI.
   * Returns a signal compatible with NewsAnalysts.makeSignal() schema.
   *
   * @param {Object} newsItem - { headline, body, source, priority, symbols }
   * @returns {Object} signal - { analyst, direction, confidence, urgency, action, reasoning, affectedAssets }
   */
  async function analyze(newsItem) {
    // No API key — return empty signal (graceful degradation)
    if (!isAvailable()) {
      return makeFallbackSignal('No Perplexity API key configured')
    }

    // Rate limit check
    if (!acquireRateSlot()) {
      return makeFallbackSignal('Rate limited (10 req/min)')
    }

    _stats.queries++
    const start = performance.now()

    try {
      // Gather live market context to enrich the prompt
      const marketContext = await gatherMarketContext()

      // Build and send prompt
      const prompt = buildPrompt(newsItem, marketContext)
      const response = await queryWithRetry(prompt, SYSTEM_PROMPT)

      // Parse the structured response
      const signal = parseResponse(response.content, newsItem)

      // Track latency
      const latency = performance.now() - start
      _stats.avgLatencyMs = (_stats.avgLatencyMs * _stats.successes + latency) / (_stats.successes + 1)
      _stats.successes++

      return signal

    } catch (e) {
      _stats.failures++
      return makeFallbackSignal(`Error: ${e.message}`)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STANDALONE MARKET ANALYSIS (for direct use outside news pipeline)
  // ═══════════════════════════════════════════════════════════════

  async function analyzeMarket(asset = 'QQQ') {
    if (!isAvailable()) return null
    if (!acquireRateSlot()) return null

    const prompt = `Analyze current market conditions for ${asset}. Provide: market sentiment, recent price action, key technical levels, and 2-3 factors most likely to drive price in the next 24 hours. Keep under 300 words.`
    const systemPrompt = 'You are a concise financial market analyst. Focus on recent data and quantifiable metrics.'

    try {
      return await queryWithRetry(prompt, systemPrompt)
    } catch {
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    analyze,
    analyzeMarket,
    isAvailable,

    get stats() { return { ..._stats } },

    // Allow runtime config
    setApiKey(key) { window.__ENV__ = window.__ENV__ || {}; window.__ENV__.PERPLEXITY_API_KEY = key },
    setRateLimit(rpm) { _rateLimiter.maxPerMinute = rpm },
  })
})()

window.LLMAnalyst = LLMAnalyst
