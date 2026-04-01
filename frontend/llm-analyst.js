/**
 * xLever LLM Analyst — Provider-Agnostic Market Intelligence
 * ────────────────────────────────────────────────────────────
 * Fourth analyst agent in the news-to-trade pipeline.
 * Supports multiple LLM backends via a unified interface:
 *
 *   groq      — Free tier, 30 req/min, Llama 3.3 70B (DEFAULT)
 *   ollama    — Local, free forever, any model, offline capable
 *   openrouter — Multi-model gateway, free tiers available
 *   gemini    — Google AI, free tier 15 req/min
 *   perplexity — Online LLM with web search (paid)
 *
 * Integrates into NewsAnalysts.analyzeAll() alongside sentiment, technical, macro.
 *
 * Config via window.__ENV__ or setProvider() / setApiKey() at runtime.
 */

const LLMAnalyst = (() => {

  // ═══════════════════════════════════════════════════════════════
  // PROVIDER REGISTRY
  // ═══════════════════════════════════════════════════════════════

  const PROVIDERS = {
    groq: {
      name: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama-3.3-70b-versatile',
      keyEnv: 'GROQ_API_KEY',
      rateLimit: 30,
      authHeader: key => `Bearer ${key}`,
      buildPayload: (messages, model) => ({
        model,
        messages,
        temperature: 0.5,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
      parseResponse: data => ({
        content: data.choices?.[0]?.message?.content || '',
        model: data.model || '',
        usage: data.usage || {},
      }),
    },

    ollama: {
      name: 'Ollama (local)',
      url: 'http://localhost:11434/api/chat',
      model: 'llama3.1',
      keyEnv: null,  // No API key needed
      rateLimit: 60,
      authHeader: () => null,
      buildPayload: (messages, model) => ({
        model,
        messages,
        stream: false,
        options: { temperature: 0.5, num_predict: 600 },
        format: 'json',
      }),
      parseResponse: data => ({
        content: data.message?.content || '',
        model: data.model || '',
        usage: { prompt_tokens: data.prompt_eval_count || 0, completion_tokens: data.eval_count || 0 },
      }),
    },

    openrouter: {
      name: 'OpenRouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      keyEnv: 'OPENROUTER_API_KEY',
      rateLimit: 20,
      authHeader: key => `Bearer ${key}`,
      extraHeaders: { 'HTTP-Referer': 'https://xlever.markets', 'X-Title': 'xLever Trading Agent' },
      buildPayload: (messages, model) => ({
        model,
        messages,
        temperature: 0.5,
        max_tokens: 600,
      }),
      parseResponse: data => ({
        content: data.choices?.[0]?.message?.content || '',
        model: data.model || '',
        usage: data.usage || {},
      }),
    },

    gemini: {
      name: 'Google Gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
      model: 'gemini-2.0-flash',
      keyEnv: 'GEMINI_API_KEY',
      rateLimit: 15,
      authHeader: () => null,  // Key passed as query param
      buildUrl: (baseUrl, model, key) => baseUrl.replace('{model}', model) + `?key=${key}`,
      buildPayload: (messages) => ({
        contents: messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : m.role === 'system' ? 'user' : m.role,
          parts: [{ text: m.content }],
        })),
        generationConfig: { temperature: 0.5, maxOutputTokens: 600, responseMimeType: 'application/json' },
      }),
      parseResponse: data => ({
        content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
        model: data.modelVersion || '',
        usage: { prompt_tokens: data.usageMetadata?.promptTokenCount || 0, completion_tokens: data.usageMetadata?.candidatesTokenCount || 0 },
      }),
    },

    perplexity: {
      name: 'Perplexity',
      url: 'https://api.perplexity.ai/chat/completions',
      model: 'llama-3.1-sonar-small-128k-online',
      keyEnv: 'PERPLEXITY_API_KEY',
      rateLimit: 10,
      authHeader: key => `Bearer ${key}`,
      buildPayload: (messages, model) => ({
        model,
        messages,
        temperature: 0.5,
        max_tokens: 600,
        return_citations: true,
        return_images: false,
      }),
      parseResponse: data => ({
        content: data.choices?.[0]?.message?.content || '',
        citations: data.citations || [],
        model: data.model || '',
        usage: data.usage || {},
      }),
    },
  }

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let _activeProvider = 'groq'    // Default to free Groq
  let _modelOverride = null       // Override the provider's default model
  let _ollamaUrl = null           // Override Ollama base URL

  const MAX_RETRIES = 2
  const TIMEOUT_MS = 15000

  // Rate limiter
  const _rateLimiter = {
    timestamps: [],
  }

  // Stats
  const _stats = {
    provider: 'groq',
    queries: 0,
    successes: 0,
    failures: 0,
    rateLimited: 0,
    avgLatencyMs: 0,
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════

  function getProvider() {
    return PROVIDERS[_activeProvider]
  }

  function getApiKey() {
    const provider = getProvider()
    if (!provider) return null

    // Ollama needs no key
    if (!provider.keyEnv) return '__local__'

    const env = window.__ENV__ || {}
    // Check provider-specific key first
    if (env[provider.keyEnv]) return env[provider.keyEnv]
    // Check window-level
    if (window[provider.keyEnv]) return window[provider.keyEnv]
    // Legacy: check PERPLEXITY_API_KEY if that provider is active
    if (_activeProvider === 'perplexity' && env.PERPLEXITY_API_KEY) return env.PERPLEXITY_API_KEY
    return null
  }

  function isAvailable() {
    // Ollama: try to assume it's available (no key check needed)
    if (_activeProvider === 'ollama') return true
    return !!getApiKey()
  }

  function getActiveModel() {
    return _modelOverride || getProvider()?.model || 'unknown'
  }

  // ═══════════════════════════════════════════════════════════════
  // RATE LIMITER
  // ═══════════════════════════════════════════════════════════════

  function acquireRateSlot() {
    const provider = getProvider()
    const limit = provider?.rateLimit || 10
    const now = Date.now()
    _rateLimiter.timestamps = _rateLimiter.timestamps.filter(t => t > now - 60000)

    if (_rateLimiter.timestamps.length >= limit) {
      _stats.rateLimited++
      return false
    }

    _rateLimiter.timestamps.push(now)
    return true
  }

  // ═══════════════════════════════════════════════════════════════
  // UNIFIED LLM CLIENT
  // ═══════════════════════════════════════════════════════════════

  async function queryLLM(prompt, systemPrompt) {
    const provider = getProvider()
    if (!provider) throw new Error(`Unknown provider: ${_activeProvider}`)

    const apiKey = getApiKey()
    if (!apiKey) throw new Error(`No API key for ${provider.name}`)

    const model = getActiveModel()

    // Build messages
    const messages = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: prompt })

    // Build request URL
    let url = provider.url
    if (_activeProvider === 'ollama' && _ollamaUrl) {
      url = _ollamaUrl + '/api/chat'
    }
    if (provider.buildUrl) {
      url = provider.buildUrl(url, model, apiKey)
    }

    // Build payload
    const payload = provider.buildPayload(messages, model)

    // Build headers
    const headers = { 'Content-Type': 'application/json' }
    const authVal = provider.authHeader(apiKey)
    if (authVal) headers['Authorization'] = authVal
    if (provider.extraHeaders) Object.assign(headers, provider.extraHeaders)

    // Fire request
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`${provider.name} ${res.status}: ${errText.slice(0, 200)}`)
      }

      const data = await res.json()
      return provider.parseResponse(data)

    } catch (e) {
      clearTimeout(timeoutId)
      if (e.name === 'AbortError') throw new Error(`${provider.name} request timed out`)
      throw e
    }
  }

  async function queryWithRetry(prompt, systemPrompt) {
    let lastErr
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await queryLLM(prompt, systemPrompt)
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

    const directionRaw = String(data.direction || 'neutral').toLowerCase()
    const direction = ['bullish', 'bearish', 'neutral'].includes(directionRaw) ? directionRaw : 'neutral'

    const confidence = Math.max(0, Math.min(100, Number(data.confidence) || 0)) / 100

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
      reasoning: `LLM (${getProvider()?.name || _activeProvider}): ${reasoning}`,
      affectedAssets,
      timestamp: Date.now(),
      meta: {
        provider: _activeProvider,
        model: getActiveModel(),
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
        provider: _activeProvider,
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

    try {
      const pyth = window.xLeverPyth
      if (pyth) {
        const feed = pyth.PYTH_FEEDS['QQQ/USD']
        const p = await pyth.getPriceForFeed(feed)
        ctx.oraclePrice = p.price
      }
    } catch {}

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

  async function analyze(newsItem) {
    if (!isAvailable()) {
      return makeFallbackSignal(`No API key for ${getProvider()?.name || _activeProvider}`)
    }

    if (!acquireRateSlot()) {
      return makeFallbackSignal(`Rate limited (${getProvider()?.rateLimit || '?'} req/min)`)
    }

    _stats.queries++
    _stats.provider = _activeProvider
    const start = performance.now()

    try {
      const marketContext = await gatherMarketContext()
      const prompt = buildPrompt(newsItem, marketContext)
      const response = await queryWithRetry(prompt, SYSTEM_PROMPT)
      const signal = parseResponse(response.content, newsItem)

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
  // STANDALONE MARKET ANALYSIS
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
  // AUTO-DETECT BEST AVAILABLE PROVIDER
  // ═══════════════════════════════════════════════════════════════

  function autoDetect() {
    const env = window.__ENV__ || {}
    // Priority: groq (free+fast) > ollama (local) > openrouter > gemini > perplexity
    if (env.GROQ_API_KEY || window.GROQ_API_KEY)               return 'groq'
    if (env.OPENROUTER_API_KEY || window.OPENROUTER_API_KEY)     return 'openrouter'
    if (env.GEMINI_API_KEY || window.GEMINI_API_KEY)             return 'gemini'
    if (env.PERPLEXITY_API_KEY || window.PERPLEXITY_API_KEY)     return 'perplexity'
    // Ollama as last resort (may not be running)
    return 'ollama'
  }

  // Run auto-detect on load
  _activeProvider = autoDetect()

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    // Core
    analyze,
    analyzeMarket,
    isAvailable,

    // Provider info
    get provider() { return _activeProvider },
    get providerName() { return getProvider()?.name || _activeProvider },
    get model() { return getActiveModel() },
    get providers() { return Object.keys(PROVIDERS) },
    get stats() { return { ..._stats } },

    // Configuration
    setProvider(name, opts = {}) {
      if (!PROVIDERS[name]) throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(PROVIDERS).join(', ')}`)
      _activeProvider = name
      _modelOverride = opts.model || null
      _rateLimiter.timestamps = []  // Reset rate limiter for new provider
      _stats.provider = name
      if (name === 'ollama' && opts.url) _ollamaUrl = opts.url
    },

    setApiKey(key, provider) {
      window.__ENV__ = window.__ENV__ || {}
      const p = provider || _activeProvider
      const prov = PROVIDERS[p]
      if (prov?.keyEnv) window.__ENV__[prov.keyEnv] = key
    },

    setModel(model) { _modelOverride = model },
    setRateLimit(rpm) { const p = getProvider(); if (p) p.rateLimit = rpm },
    autoDetect() { _activeProvider = autoDetect(); return _activeProvider },
  })
})()

window.LLMAnalyst = LLMAnalyst
