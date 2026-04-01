/**
 * @file llm-analyst.js
 * @module LLMAnalyst
 * @description
 * xLever LLM Analyst — Provider-agnostic AI-powered market analysis.
 * Fourth analyst agent in the news-to-trade pipeline.
 *
 * Supports multiple LLM backends via a unified interface:
 *   groq       — Free tier, 30 req/min, Llama 3.3 70B (DEFAULT, auto-detected first)
 *   ollama     — Local, free forever, any model, offline capable (fallback)
 *   openrouter — Multi-model gateway, free tiers available
 *   gemini     — Google AI, free tier 15 req/min
 *   perplexity — Online LLM with web search (paid)
 *
 * Integrates into NewsAnalysts.analyzeAll() alongside sentiment, technical, macro.
 * Auto-detects the best available provider on load based on configured API keys.
 *
 * Features:
 *  - Per-provider rate limiting (sliding window, 1-minute buckets)
 *  - Exponential backoff retry (up to 2 retries)
 *  - 15-second request timeout with AbortController
 *  - Robust JSON extraction from LLM responses (handles markdown, code blocks)
 *  - Market context gathering from Pyth oracle, OpenBB, and RiskLive
 *
 * Config via window.__ENV__ or setProvider() / setApiKey() at runtime.
 *
 * @exports {Object} LLMAnalyst - Frozen singleton exposed on window.LLMAnalyst
 *
 * @dependencies
 *  - window.__ENV__     — Environment variables for API keys
 *  - window.xLeverPyth  — Pyth oracle for market context (optional)
 *  - window.xLeverOpenBB — OpenBB for daily change context (optional)
 *  - window.RiskLive     — Risk engine state for prompt context (optional)
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

  /**
   * Get the currently active provider configuration object.
   * @returns {Object|undefined} Provider config with url, model, buildPayload, parseResponse, etc.
   */
  function getProvider() {
    return PROVIDERS[_activeProvider]
  }

  /**
   * Resolve the API key for the active provider.
   * Checks window.__ENV__, then window-level globals.
   * Returns '__local__' for Ollama (no key needed).
   *
   * @returns {string|null} API key string or null if not configured
   */
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

  /**
   * Check if the active provider is available (has API key or is local).
   * @returns {boolean} True if the provider can accept queries
   */
  function isAvailable() {
    // Ollama: try to assume it's available (no key check needed)
    if (_activeProvider === 'ollama') return true
    return !!getApiKey()
  }

  /**
   * Get the model name that will be used for the next query.
   * Returns the manual override if set, otherwise the provider's default model.
   * @returns {string} Model identifier
   */
  function getActiveModel() {
    return _modelOverride || getProvider()?.model || 'unknown'
  }

  // ═══════════════════════════════════════════════════════════════
  // RATE LIMITER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Try to acquire a rate-limit slot for the current provider.
   * Uses a sliding 60-second window with per-provider request caps.
   *
   * @returns {boolean} True if a slot was acquired; false if rate-limited
   */
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

  /**
   * Send a single query to the active LLM provider.
   * Handles URL construction, payload building, auth headers, and response parsing
   * for all supported providers through their config objects.
   *
   * @param {string} prompt - User message / analysis prompt
   * @param {string} systemPrompt - System prompt with role instructions
   * @returns {Promise<Object>} Parsed response with content, model, and usage fields
   * @throws {Error} On HTTP errors, timeouts, or missing API key
   */
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

  /**
   * Query the LLM with exponential backoff retry (up to MAX_RETRIES attempts).
   * Delay doubles with each retry: 1s, 2s, 4s, etc.
   *
   * @param {string} prompt - User message
   * @param {string} systemPrompt - System prompt
   * @returns {Promise<Object>} Parsed LLM response
   * @throws {Error} After all retries are exhausted
   */
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

  /**
   * Build a structured analysis prompt from news item data and live market context.
   * Includes headline, body (truncated to 500 chars), source, priority,
   * mentioned tickers, oracle price, daily move, and risk state.
   *
   * @param {Object} newsItem - News item to analyze
   * @param {Object} [marketContext] - Live market context data
   * @param {number} [marketContext.oraclePrice] - Current QQQ price from Pyth
   * @param {number} [marketContext.dailyChange] - Today's QQQ % change
   * @param {string} [marketContext.riskState] - Current risk engine state
   * @returns {string} Formatted prompt string
   */
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

  /**
   * Extract a JSON object from LLM response content.
   * Tries three strategies in order: direct parse, markdown code block extraction,
   * and brace-delimited extraction. Handles common LLM formatting quirks.
   *
   * @param {string} content - Raw LLM response text
   * @returns {Object|null} Parsed JSON object, or null if extraction fails
   */
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

  /**
   * Parse and validate the LLM response into a typed analyst signal.
   * Extracts JSON, validates/clamps all fields, and normalizes confidence from 0-100 to 0-1.
   *
   * @param {string} content - Raw LLM response text
   * @param {Object} newsItem - Original news item for fallback asset extraction
   * @returns {Object} Analyst signal conforming to the NewsAnalysts signal schema
   */
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

  /**
   * Create a neutral fallback signal when the LLM query fails or is unavailable.
   * Returns zero confidence to ensure the fallback doesn't influence aggregation.
   *
   * @param {string} reason - Human-readable failure reason
   * @param {string} [rawResponse=''] - Raw response text for debugging (truncated to 500 chars)
   * @returns {Object} Neutral signal with zero confidence and parseSuccess=false
   */
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

  /**
   * Gather current market context from all available data sources.
   * Collects oracle price (Pyth), daily change (OpenBB), and risk state.
   * Each source is individually try/caught for graceful degradation.
   *
   * @returns {Promise<Object>} Market context object with optional oraclePrice, dailyChange, riskState
   */
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

  /**
   * Main analysis entry point — analyze a news item using the active LLM provider.
   * Gathers market context, builds a structured prompt, queries the LLM,
   * and parses the response into a typed signal.
   *
   * Returns a neutral fallback signal if the provider is unavailable, rate-limited, or errors.
   *
   * @param {Object} newsItem - News item to analyze
   * @returns {Promise<Object>} Analyst signal with direction, confidence, action, reasoning, and metadata
   */
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

  /**
   * Standalone market analysis — query the LLM for general market conditions
   * for a given asset. Not part of the news pipeline; intended for on-demand use.
   *
   * @param {string} [asset='QQQ'] - Ticker symbol to analyze
   * @returns {Promise<Object|null>} Raw LLM response with content, model, and usage; null on failure
   */
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

  /**
   * Auto-detect the best available LLM provider based on configured API keys.
   * Priority order: groq (free+fast) > openrouter > gemini > perplexity > ollama (local fallback).
   *
   * @returns {string} Provider key (e.g., 'groq', 'ollama')
   */
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
    /**
     * Switch to a different LLM provider.
     * @param {string} name - Provider key ('groq', 'ollama', 'openrouter', 'gemini', 'perplexity')
     * @param {Object} [opts={}] - Provider options
     * @param {string} [opts.model] - Override the provider's default model
     * @param {string} [opts.url] - Ollama base URL override (ollama provider only)
     * @throws {Error} If provider name is not recognized
     */
    setProvider(name, opts = {}) {
      if (!PROVIDERS[name]) throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(PROVIDERS).join(', ')}`)
      _activeProvider = name
      _modelOverride = opts.model || null
      _rateLimiter.timestamps = []  // Reset rate limiter for new provider
      _stats.provider = name
      if (name === 'ollama' && opts.url) _ollamaUrl = opts.url
    },

    /**
     * Set an API key for a provider at runtime.
     * Stores in window.__ENV__ under the provider's keyEnv name.
     * @param {string} key - API key value
     * @param {string} [provider] - Provider name (defaults to active provider)
     */
    setApiKey(key, provider) {
      window.__ENV__ = window.__ENV__ || {}
      const p = provider || _activeProvider
      const prov = PROVIDERS[p]
      if (prov?.keyEnv) window.__ENV__[prov.keyEnv] = key
    },

    /** @param {string} model - Override the provider's default model */
    setModel(model) { _modelOverride = model },
    /** @param {number} rpm - Override the provider's rate limit (requests per minute) */
    setRateLimit(rpm) { const p = getProvider(); if (p) p.rateLimit = rpm },
    /**
     * Re-run auto-detection to select the best available provider.
     * @returns {string} The newly selected provider key
     */
    autoDetect() { _activeProvider = autoDetect(); return _activeProvider },
  })
})()

window.LLMAnalyst = LLMAnalyst
