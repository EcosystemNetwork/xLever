/**
 * @file swarm-bridge.js
 * @module SwarmBridge
 * @description
 * xLever <-> Swarm Protocol Bridge — Translates between the EcosystemNetwork/Swarm
 * protocol and xLever's internal agent system.
 *
 * Core responsibilities:
 *  1. Receives Swarm messages via polling daemon (configurable interval)
 *  2. Parses intent from natural-language or structured commands
 *  3. Routes to the correct xLever subsystem (agent, positions, market, risk, etc.)
 *  4. Returns structured results back through the Swarm relay
 *  5. Bridges xLever events to Swarm channels so other agents can react
 *
 * Supports the OpenClaw runtime adapter format:
 *   POST /chat  ->  { message, context }  ->  { response }
 *
 * Acts as a comprehensive tool registry — exposes 30+ xLever capabilities as
 * callable tools covering: agent control, HITL decisions, positions, market data,
 * market intelligence, news pipeline, risk management, lending, alerts,
 * on-chain execution, oracle data, and platform health.
 *
 * Message handling pipeline:
 *  1. Try structured tool invocation (msg.tool + msg.params)
 *  2. Parse natural language intent via keyword matching
 *  3. Forward to OpenClaw for AI processing (if configured)
 *  4. Fallback: return available tools list
 *
 * @exports {Object} SwarmBridge - Frozen singleton exposed on window.SwarmBridge
 *
 * @dependencies
 *  - window.AgentExecutor  — Agent lifecycle state
 *  - window.AgentCoordinator — News swarm coordinator
 *  - window.RiskLive / window.RiskEngine — Risk engine
 *  - window.xLeverPyth     — Pyth oracle for price data
 *  - window.xLeverContracts — On-chain execution (wallet required)
 *  - window.WSBroadcast     — Event relay for bridging to Swarm
 */

const SwarmBridge = (() => {

  // ═══════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname) || window.location.hostname.startsWith('192.168.')
  const CONFIG = {
    // Swarm hub endpoint
    SWARM_HUB: 'https://swarmprotocol.fun',
    // xLever API base (same as AgentBridge)
    API_BASE: isLocal ? 'http://localhost:8080/api' : 'https://api.xlever.markets/api',
    // Swarm agent identity (set during register())
    AGENT_ID: null,
    AGENT_NAME: 'xLever-Agent',
    AGENT_SKILLS: ['trading', 'defi', 'leverage', 'risk-management', 'market-intelligence', 'lending'],
    // Polling interval for daemon mode (ms)
    DAEMON_INTERVAL: 10000,
    // OpenClaw runtime endpoint (when bridging TO an OpenClaw instance)
    OPENCLAW_URL: isLocal ? 'http://localhost:3000/chat' : null,
  }

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let _registered = false
  let _daemonInterval = null
  let _lastPollTimestamp = 0
  let _keypair = null          // Ed25519 keypair for Swarm auth
  let _log = () => {}
  let _messageQueue = []       // Inbound messages from Swarm
  const _subscribers = new Map()

  // ═══════════════════════════════════════════════════════════════
  // TOOL REGISTRY — Every xLever capability as a callable tool
  // ═══════════════════════════════════════════════════════════════

  const TOOLS = {

    // ─── Agent Control ───
    agent_status: {
      name: 'agent_status',
      description: 'Get the current status of the AI trading agent (running, mode, health, uptime)',
      parameters: {},
      async execute() {
        return await apiCall('/agent/status')
      }
    },

    agent_start: {
      name: 'agent_start',
      description: 'Start the AI trading agent. It will begin monitoring markets and making decisions.',
      parameters: { mode: 'string (paper|live)', interval: 'number (seconds between ticks)' },
      async execute(params = {}) {
        return await apiCall('/agent/start', 'POST', params)
      }
    },

    agent_stop: {
      name: 'agent_stop',
      description: 'Stop the AI trading agent gracefully.',
      parameters: {},
      async execute() {
        return await apiCall('/agent/stop', 'POST')
      }
    },

    agent_set_mode: {
      name: 'agent_set_mode',
      description: 'Change the agent operating mode: "safe" (risk-reduction only), "target" (maintain leverage band), or "accumulate" (DCA buying).',
      parameters: { mode: 'string (safe|target|accumulate)' },
      async execute(params) {
        return await apiCall('/agent/mode', 'POST', params)
      }
    },

    // ─── Decisions / HITL ───
    pending_decisions: {
      name: 'pending_decisions',
      description: 'Get all pending trading decisions awaiting human approval.',
      parameters: {},
      async execute() {
        return await apiCall('/agent/pending')
      }
    },

    approve_decision: {
      name: 'approve_decision',
      description: 'Approve a pending trading decision for execution.',
      parameters: { decision_id: 'string (required)' },
      async execute(params) {
        if (!params.decision_id || !/^[a-f0-9-]{8,36}$/i.test(params.decision_id)) {
          return { error: 'Invalid decision_id format (expected UUID)' }
        }
        return await apiCall(`/agent/approve/${encodeURIComponent(params.decision_id)}`, 'POST', { approved: true })
      }
    },

    reject_decision: {
      name: 'reject_decision',
      description: 'Reject a pending trading decision with an optional reason.',
      parameters: { decision_id: 'string (required)', reason: 'string (optional)' },
      async execute(params) {
        if (!params.decision_id || !/^[a-f0-9-]{8,36}$/i.test(params.decision_id)) {
          return { error: 'Invalid decision_id format (expected UUID)' }
        }
        return await apiCall(`/agent/approve/${encodeURIComponent(params.decision_id)}`, 'POST', { approved: false, reason: params.reason || '' })
      }
    },

    decision_history: {
      name: 'decision_history',
      description: 'Get recent trading decisions made by the agent.',
      parameters: { limit: 'number (default 50)' },
      async execute(params = {}) {
        return await apiCall(`/decisions?${new URLSearchParams({ limit: params.limit || 50 })}`)
      }
    },

    // ─── Positions ───
    get_positions: {
      name: 'get_positions',
      description: 'Get all positions for a wallet address, optionally filtered by status (open/closed) and asset.',
      parameters: { wallet_address: 'string (required)', status: 'string (open|closed)', asset: 'string' },
      async execute(params) {
        let url = `/positions/${encodeURIComponent(params.wallet_address)}`
        const qs = new URLSearchParams()
        if (params.status) qs.set('status', params.status)
        if (params.asset) qs.set('asset', params.asset)
        const qsStr = qs.toString()
        if (qsStr) url += '?' + qsStr
        return await apiCall(url)
      }
    },

    get_active_positions: {
      name: 'get_active_positions',
      description: 'Get all currently open positions for a wallet.',
      parameters: { wallet_address: 'string (required)' },
      async execute(params) {
        return await apiCall(`/positions/${encodeURIComponent(params.wallet_address)}/active`)
      }
    },

    position_stats: {
      name: 'position_stats',
      description: 'Get aggregate statistics for a wallet\'s trading history (total PnL, win rate, etc.).',
      parameters: { wallet_address: 'string (required)' },
      async execute(params) {
        return await apiCall(`/positions/stats/${encodeURIComponent(params.wallet_address)}`)
      }
    },

    // ─── Market Data ───
    get_price: {
      name: 'get_price',
      description: 'Get historical OHLCV price data for a symbol (e.g. QQQ, ETH, BTC). Supports periods like 1d, 5d, 1mo, 3mo, 1y, 5y, max.',
      parameters: { symbol: 'string (required)', period: 'string (default 1y)', interval: 'string (default 1d)' },
      async execute(params) {
        const qs = new URLSearchParams({ period: params.period || '1y', interval: params.interval || '1d' })
        return await apiCall(`/prices/${encodeURIComponent(params.symbol)}?${qs}`)
      }
    },

    get_latest_price: {
      name: 'get_latest_price',
      description: 'Get the current/latest price for a symbol.',
      parameters: { symbol: 'string (required)' },
      async execute(params) {
        return await apiCall(`/prices/${encodeURIComponent(params.symbol)}/latest`)
      }
    },

    // ─── Market Intelligence (OpenBB) ───
    market_dashboard: {
      name: 'market_dashboard',
      description: 'Get the full market intelligence dashboard — quotes, news, and context for tracked symbols.',
      parameters: {},
      async execute() {
        return await apiCall('/intelligence/dashboard')
      }
    },

    market_news: {
      name: 'market_news',
      description: 'Get aggregated market news from multiple sources.',
      parameters: {},
      async execute() {
        return await apiCall('/intelligence/news')
      }
    },

    technicals: {
      name: 'technicals',
      description: 'Get technical analysis for a symbol (moving averages, RSI, MACD, Bollinger Bands, etc.).',
      parameters: { symbol: 'string (required)' },
      async execute(params) {
        return await apiCall(`/intelligence/technicals/${encodeURIComponent(params.symbol)}`)
      }
    },

    options_data: {
      name: 'options_data',
      description: 'Get options chain data for a symbol (calls, puts, IV, Greeks).',
      parameters: { symbol: 'string (required)' },
      async execute(params) {
        return await apiCall(`/intelligence/options/${encodeURIComponent(params.symbol)}`)
      }
    },

    // ─── News Pipeline ───
    news_stream: {
      name: 'news_stream',
      description: 'Get recent news items from the streaming pipeline. Returns the latest batch.',
      parameters: { since: 'string (ISO timestamp, optional)' },
      async execute(params = {}) {
        const since = params.since || new Date(Date.now() - 3600000).toISOString()
        return await apiCall(`/news/poll?${new URLSearchParams({ since })}`)
      }
    },

    inject_news: {
      name: 'inject_news',
      description: 'Inject a manual news item into the agent pipeline for immediate analysis.',
      parameters: { headline: 'string (required)', body: 'string', source: 'string' },
      async execute(params) {
        return await apiCall('/news/inject', 'POST', params)
      }
    },

    news_sources: {
      name: 'news_sources',
      description: 'List all configured news sources and their current status.',
      parameters: {},
      async execute() {
        return await apiCall('/news/sources')
      }
    },

    economic_calendar: {
      name: 'economic_calendar',
      description: 'Get upcoming economic events (FOMC, CPI, earnings, etc.) that may impact markets.',
      parameters: {},
      async execute() {
        return await apiCall('/news/calendar')
      }
    },

    // ─── Risk Management ───
    risk_state: {
      name: 'risk_state',
      description: 'Get the current risk engine state (NORMAL, WARNING, RESTRICTED, EMERGENCY) and all active risk factors.',
      parameters: {},
      async execute() {
        if (window.RiskLive) {
          return {
            state: window.RiskLive.state,
            history: window.RiskLive.history?.slice(-10) || [],
          }
        }
        if (window.RiskEngine) {
          return { engine: 'available', note: 'Call with live inputs for evaluation' }
        }
        return { error: 'Risk engine not initialized' }
      }
    },

    evaluate_risk: {
      name: 'evaluate_risk',
      description: 'Run the risk engine with custom inputs to evaluate a hypothetical scenario. Returns risk state and triggered reasons.',
      parameters: {
        oracleAgeSec: 'number', oracleDivergence: 'number', drawdown: 'number',
        healthFactor: 'number', volatility: 'number', utilization: 'number'
      },
      async execute(params) {
        if (!window.RiskEngine) return { error: 'Risk engine not loaded' }
        return window.RiskEngine.evaluate(params)
      }
    },

    // ─── Lending / Euler V2 ───
    lending_markets: {
      name: 'lending_markets',
      description: 'Get all available Euler V2 lending markets with APY, TVL, and utilization data.',
      parameters: {},
      async execute() {
        return await apiCall('/lending/markets')
      }
    },

    lending_positions: {
      name: 'lending_positions',
      description: 'Get a wallet\'s lending/borrowing positions across all Euler V2 markets.',
      parameters: { wallet_address: 'string (required)' },
      async execute(params) {
        return await apiCall(`/lending/positions/${encodeURIComponent(params.wallet_address)}`)
      }
    },

    // ─── Alerts ───
    get_alerts: {
      name: 'get_alerts',
      description: 'Get all active alerts for a wallet.',
      parameters: { wallet_address: 'string (required)' },
      async execute(params) {
        return await apiCall(`/alerts/${encodeURIComponent(params.wallet_address)}`)
      }
    },

    create_alert: {
      name: 'create_alert',
      description: 'Create a new price/health/PnL alert.',
      parameters: { wallet_address: 'string', type: 'string (price|health|pnl)', condition: 'object', message: 'string' },
      async execute(params) {
        return await apiCall('/alerts', 'POST', params)
      }
    },

    // ─── On-Chain Execution (via frontend contracts) ───
    open_position: {
      name: 'open_position',
      description: 'Open a new leveraged position on-chain. Requires a connected wallet.',
      parameters: { amount: 'string (USDC amount)', leverage: 'number (1-10x)' },
      async execute(params) {
        const contracts = window.xLeverContracts
        if (!contracts) return { error: 'Contracts not initialized — wallet not connected' }
        try {
          const result = await contracts.openPosition(params.amount, params.leverage)
          return { success: true, tx_hash: result.hash, explorer: contracts.getExplorerUrl(result.hash) }
        } catch (e) {
          const classified = contracts.classifyTxError?.(e) || { label: 'TX failed', detail: e.message }
          return { error: classified.label, detail: classified.detail }
        }
      }
    },

    close_position: {
      name: 'close_position',
      description: 'Close an existing position on-chain. Use amount="max" for full close.',
      parameters: { amount: 'string (USDC amount or "max")' },
      async execute(params) {
        const contracts = window.xLeverContracts
        if (!contracts) return { error: 'Contracts not initialized — wallet not connected' }
        try {
          const amt = params.amount === 'max' ? '999999999' : params.amount
          const result = await contracts.closePosition(amt)
          return { success: true, tx_hash: result.hash, explorer: contracts.getExplorerUrl(result.hash) }
        } catch (e) {
          const classified = contracts.classifyTxError?.(e) || { label: 'TX failed', detail: e.message }
          return { error: classified.label, detail: classified.detail }
        }
      }
    },

    adjust_leverage: {
      name: 'adjust_leverage',
      description: 'Adjust the leverage on an existing position.',
      parameters: { target_leverage: 'number (new leverage multiplier)' },
      async execute(params) {
        const contracts = window.xLeverContracts
        if (!contracts) return { error: 'Contracts not initialized — wallet not connected' }
        try {
          const result = await contracts.adjustLeverage(params.target_leverage)
          return { success: true, tx_hash: result.hash, explorer: contracts.getExplorerUrl(result.hash) }
        } catch (e) {
          const classified = contracts.classifyTxError?.(e) || { label: 'TX failed', detail: e.message }
          return { error: classified.label, detail: classified.detail }
        }
      }
    },

    // ─── Oracle / Pyth ───
    oracle_price: {
      name: 'oracle_price',
      description: 'Get the latest Pyth oracle price for QQQ/USD including confidence interval and staleness.',
      parameters: {},
      async execute() {
        const pyth = window.xLeverPyth
        if (!pyth) return { error: 'Pyth oracle not initialized' }
        try {
          const feed = pyth.PYTH_FEEDS['QQQ/USD']
          const p = await pyth.getPriceForFeed(feed)
          return {
            price: p.price,
            confidence: p.conf,
            publish_time: p.publishTime,
            age_seconds: pyth.oracleAge(p.publishTime),
          }
        } catch (e) {
          return { error: e.message }
        }
      }
    },

    // ─── News Swarm Coordinator ───
    swarm_stats: {
      name: 'swarm_stats',
      description: 'Get statistics from the news-to-trade swarm pipeline (items processed, signals generated, actions executed/skipped).',
      parameters: {},
      async execute() {
        if (!window.AgentCoordinator) return { error: 'AgentCoordinator not loaded' }
        return {
          stats: window.AgentCoordinator.stats,
          isRunning: window.AgentCoordinator.isRunning,
          recentTrend: window.AgentCoordinator.recentTrend,
          auditLog: window.AgentCoordinator.auditLog.slice(-5),
        }
      }
    },

    swarm_inject_news: {
      name: 'swarm_inject_news',
      description: 'Inject a news headline directly into the agent swarm coordinator for immediate analysis by all 3 analyst agents.',
      parameters: { headline: 'string (required)', body: 'string', source: 'string' },
      async execute(params) {
        if (!window.AgentCoordinator) return { error: 'AgentCoordinator not loaded' }
        const result = await window.AgentCoordinator.injectNews(params.headline, params.body || '', params.source || 'swarm')
        return result || { status: 'queued' }
      }
    },

    // ─── Platform Health ───
    health: {
      name: 'health',
      description: 'Check if the xLever backend API is healthy and which chain it\'s connected to.',
      parameters: {},
      async execute() {
        return await apiCall('/health')
      }
    },

    platform_stats: {
      name: 'platform_stats',
      description: 'Get platform-wide statistics (total users, TVL, positions, volume).',
      parameters: {},
      async execute() {
        return await apiCall('/admin/stats')
      }
    },
  }

  // ═══════════════════════════════════════════════════════════════
  // API HELPER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Make an API call to the xLever backend. Returns { error } on failure
   * instead of throwing, to keep tool execution safe.
   *
   * @param {string} endpoint - API path (e.g., '/agent/status')
   * @param {string} [method='GET'] - HTTP method
   * @param {Object|null} [body=null] - Request body (JSON-serialized)
   * @returns {Promise<Object>} Parsed JSON response, or { error: string } on failure
   */
  async function apiCall(endpoint, method = 'GET', body = null) {
    const url = `${CONFIG.API_BASE}${endpoint}`
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    if (body) options.body = JSON.stringify(body)

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        const status = response.status
        const errorType = status === 401 || status === 403 ? 'auth'
          : status === 429 ? 'rate_limit'
          : status >= 400 && status < 500 ? 'validation'
          : 'server'
        return { error: `HTTP ${status}: ${response.statusText}`, error_type: errorType, status }
      }
      return await response.json()
    } catch (err) {
      return { error: err.message, error_type: 'network' }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MESSAGE PARSING — Natural language → Tool invocation
  // ═══════════════════════════════════════════════════════════════

  /**
   * Parse an inbound Swarm message and route it to the correct tool.
   * Supports two formats:
   *  1. Structured:  { tool: "get_price", params: { symbol: "QQQ" } }
   *  2. Natural language: "what's the current price of QQQ?"
   */
  async function handleMessage(msg) {
    const text = typeof msg === 'string' ? msg : (msg.text || msg.message || '')
    const context = msg.context || {}

    // 1. Try structured tool invocation
    if (msg.tool && TOOLS[msg.tool]) {
      _log('SWARM', `Tool call: ${msg.tool}`, 'primary')
      const result = await TOOLS[msg.tool].execute(msg.params || {})
      return { tool: msg.tool, result }
    }

    // 2. Parse natural language intent
    const intent = parseIntent(text)

    // If parsing found a validation error (e.g. bad amount/leverage), return it
    if (intent.error) {
      return { error: intent.error, parsed_from: text }
    }

    if (intent.tool && TOOLS[intent.tool]) {
      _log('SWARM', `Parsed intent: ${intent.tool} from "${text.slice(0, 60)}..."`, 'primary')
      const result = await TOOLS[intent.tool].execute(intent.params)
      return {
        tool: intent.tool,
        result,
        parsed_from: text,
      }
    }

    // 3. If OpenClaw is connected, forward the message for AI processing
    if (CONFIG.OPENCLAW_URL) {
      return await forwardToOpenClaw(text, context)
    }

    // 4. Fallback: return available tools
    return {
      message: 'I didn\'t understand that command. Here are the available tools:',
      available_tools: Object.keys(TOOLS).map(k => ({
        name: TOOLS[k].name,
        description: TOOLS[k].description,
      })),
    }
  }

  /**
   * Simple intent parser — maps keywords to tools.
   * For production, replace with LLM-based parsing.
   */
  function parseIntent(text) {
    const lower = text.toLowerCase().trim()

    // Agent control
    if (/\b(agent|bot)\b.*\b(status|state|health)\b/.test(lower)) return { tool: 'agent_status', params: {} }
    if (/\bstart\b.*\bagent\b|\bagent\b.*\bstart\b/.test(lower)) return { tool: 'agent_start', params: {} }
    if (/\bstop\b.*\bagent\b|\bagent\b.*\bstop\b/.test(lower)) return { tool: 'agent_stop', params: {} }
    if (/\bset\b.*\bmode\b.*\b(safe|target|accumulate)\b/.test(lower)) {
      const mode = lower.match(/\b(safe|target|accumulate)\b/)[1]
      return { tool: 'agent_set_mode', params: { mode } }
    }

    // Decisions
    if (/\bpending\b.*\bdecision/.test(lower)) return { tool: 'pending_decisions', params: {} }
    if (/\bapprove\b.*\bdecision\b/.test(lower)) {
      const id = text.match(/\b([a-f0-9-]+)\b/i)?.[1]
      return id ? { tool: 'approve_decision', params: { decision_id: id } } : { tool: 'pending_decisions', params: {} }
    }
    if (/\breject\b.*\bdecision\b/.test(lower)) {
      const id = text.match(/\b([a-f0-9-]+)\b/i)?.[1]
      return id ? { tool: 'reject_decision', params: { decision_id: id } } : { tool: 'pending_decisions', params: {} }
    }
    if (/\bdecision\b.*\bhistory\b|\brecent\b.*\bdecision/.test(lower)) return { tool: 'decision_history', params: {} }

    // Positions
    if (/\bactive\b.*\bposition|\bopen\b.*\bposition/.test(lower)) {
      const addr = extractAddress(text)
      return addr ? { tool: 'get_active_positions', params: { wallet_address: addr } } : { tool: 'get_active_positions', params: { wallet_address: 'me' } }
    }
    if (/\bposition\b.*\bstat|\bportfolio\b.*\bstat|\bpnl\b|\bwin\s*rate\b/.test(lower)) {
      const addr = extractAddress(text)
      return addr ? { tool: 'position_stats', params: { wallet_address: addr } } : { tool: 'position_stats', params: { wallet_address: 'me' } }
    }
    if (/\bposition/.test(lower)) {
      const addr = extractAddress(text)
      return addr ? { tool: 'get_positions', params: { wallet_address: addr } } : { tool: 'get_positions', params: { wallet_address: 'me' } }
    }

    // Market data
    if (/\bprice\b.*\bof\b|\bcurrent\b.*\bprice|\blatest\b.*\bprice|\bhow\s+much\s+is\b/.test(lower)) {
      const symbol = extractSymbol(text) || 'QQQ'
      return { tool: 'get_latest_price', params: { symbol } }
    }
    if (/\bhistor(y|ical)\b.*\bprice|\bchart\b|\bohlcv\b/.test(lower)) {
      const symbol = extractSymbol(text) || 'QQQ'
      return { tool: 'get_price', params: { symbol } }
    }

    // Market intelligence
    if (/\bmarket\b.*\bdashboard\b|\bmarket\b.*\boverview\b/.test(lower)) return { tool: 'market_dashboard', params: {} }
    if (/\btechnical\b.*\banalysis|\btechnicals\b/.test(lower)) {
      const symbol = extractSymbol(text) || 'QQQ'
      return { tool: 'technicals', params: { symbol } }
    }
    if (/\boptions?\b.*\bchain|\boptions?\b.*\bdata|\bgreeks\b|\bimplied\s*vol/.test(lower)) {
      const symbol = extractSymbol(text) || 'QQQ'
      return { tool: 'options_data', params: { symbol } }
    }

    // News
    if (/\bnews\b.*\bstream|\blatest\b.*\bnews|\brecent\b.*\bnews/.test(lower)) return { tool: 'news_stream', params: {} }
    if (/\bnews\b.*\bsource/.test(lower)) return { tool: 'news_sources', params: {} }
    if (/\bcalendar\b|\beconomic\b.*\bevent|\bfomc\b|\bcpi\b|\bearnings\b/.test(lower)) return { tool: 'economic_calendar', params: {} }

    // Risk
    if (/\brisk\b.*\bstate|\brisk\b.*\bstatus|\brisk\b.*\blevel/.test(lower)) return { tool: 'risk_state', params: {} }

    // Lending
    if (/\blending\b.*\bmarket|\bborrow\b.*\brate|\bsupply\b.*\brate|\bapy\b/.test(lower)) return { tool: 'lending_markets', params: {} }

    // Oracle
    if (/\boracle\b.*\bprice|\bpyth\b/.test(lower)) return { tool: 'oracle_price', params: {} }

    // Swarm / platform
    if (/\bswarm\b.*\bstat|\bpipeline\b.*\bstat/.test(lower)) return { tool: 'swarm_stats', params: {} }
    if (/\bhealth\b.*\bcheck|\bapi\b.*\bhealth|\bstatus\b/.test(lower)) return { tool: 'health', params: {} }
    if (/\bplatform\b.*\bstat|\btvl\b|\btotal\b.*\buser/.test(lower)) return { tool: 'platform_stats', params: {} }

    // Execution
    if (/\bopen\b.*\bposition\b.*\$?\d/.test(lower)) {
      const amount = text.match(/\$?([\d,.]+)/)?.[1]?.replace(/,/g, '')
      const leverage = text.match(/(\d+(?:\.\d+)?)\s*x/i)?.[1]
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        return { tool: null, params: {}, error: 'Could not parse a valid amount. Please specify e.g. "open position $500 at 3x".' }
      }
      const leverageNum = leverage ? Number(leverage) : null
      if (leverageNum !== null && (isNaN(leverageNum) || leverageNum < 1 || leverageNum > 10)) {
        return { tool: null, params: {}, error: `Invalid leverage: ${leverage}x. Must be between 1x and 10x.` }
      }
      return { tool: 'open_position', params: { amount, leverage: leverageNum || 2 } }
    }
    if (/\bclose\b.*\bposition/.test(lower)) {
      const amountMatch = text.match(/\$?([\d,.]+)/)
      const amount = amountMatch ? amountMatch[1].replace(/,/g, '') : 'max'
      if (amount !== 'max' && (isNaN(Number(amount)) || Number(amount) <= 0)) {
        return { tool: null, params: {}, error: 'Could not parse a valid amount. Please specify e.g. "close position $500" or "close position max".' }
      }
      return { tool: 'close_position', params: { amount } }
    }
    if (/\badjust\b.*\bleverage|\bset\b.*\bleverage|\bleverage\b.*\bto\b/.test(lower)) {
      const leverage = text.match(/(\d+(?:\.\d+)?)\s*x?/)?.[1]
      if (!leverage || isNaN(Number(leverage)) || Number(leverage) < 1 || Number(leverage) > 10) {
        return { tool: null, params: {}, error: 'Invalid leverage. Must be between 1x and 10x.' }
      }
      return { tool: 'adjust_leverage', params: { target_leverage: Number(leverage) } }
    }

    return { tool: null, params: {} }
  }

  /**
   * Extract an Ethereum address (0x + 40 hex chars) from text.
   * @param {string} text - Input text to search
   * @returns {string|null} Matched address or null
   */
  function extractAddress(text) {
    const match = text.match(/0x[a-fA-F0-9]{40}/)
    return match ? match[0] : null
  }

  // Known tickers to avoid matching noise words like "I", "A", "THE"
  const KNOWN_TICKERS = new Set([
    'QQQ', 'SPY', 'ETH', 'BTC', 'SOL', 'TON', 'NVDA', 'AAPL', 'MSFT', 'GOOG', 'GOOGL',
    'AMZN', 'META', 'TSLA', 'AMD', 'INTC', 'AVGO', 'NFLX', 'CRM', 'ORCL', 'ADBE',
    'USDC', 'USDT', 'DAI', 'WETH', 'WBTC', 'INK', 'ARB', 'OP', 'LINK', 'UNI',
    'AAVE', 'MKR', 'SNX', 'COMP', 'DOGE', 'XRP', 'ADA', 'DOT', 'MATIC', 'AVAX',
    'DIA', 'IWM', 'VTI', 'VOO', 'TQQQ', 'SQQQ', 'SOXL',
  ])

  /**
   * Extract a ticker symbol from text. Prioritizes known tickers,
   * then falls back to 2-5 uppercase letters (avoids single-char noise).
   * @param {string} text - Input text to search
   * @returns {string|null} Matched ticker symbol or null
   */
  function extractSymbol(text) {
    // First pass: look for known tickers
    const words = text.match(/\b[A-Z]{1,5}\b/g) || []
    for (const w of words) {
      if (KNOWN_TICKERS.has(w)) return w
    }
    // Fallback: any 2-5 uppercase word (skip single-char noise like "I", "A")
    const fallback = text.match(/\b([A-Z]{2,5})\b/)
    return fallback ? fallback[1] : null
  }

  // ═══════════════════════════════════════════════════════════════
  // OPENCLAW RUNTIME BRIDGE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Forward a message to an OpenClaw instance with full xLever context.
   * OpenClaw receives the tool registry so it can make structured tool calls.
   */
  async function forwardToOpenClaw(message, additionalContext = {}) {
    if (!CONFIG.OPENCLAW_URL) return { error: 'OpenClaw not configured' }

    // Build context with all available xLever state
    const context = {
      platform: 'xLever',
      description: 'DeFi leveraged trading protocol on Ink Sepolia (Ethereum L2), Solana, and TON',
      production_url: 'https://xlever.markets',

      // Available tools the OpenClaw agent can call back
      available_tools: Object.entries(TOOLS).map(([key, tool]) => ({
        name: key,
        description: tool.description,
        parameters: tool.parameters,
      })),

      // Current state snapshot
      current_state: {
        agent_running: window.AgentExecutor?.isRunning || false,
        agent_mode: window.AgentExecutor?.isDryRun ? 'dry-run' : 'live',
        risk_state: window.RiskLive?.state || null,
        swarm_running: window.AgentCoordinator?.isRunning || false,
        wallet_connected: !!window.xLeverContracts?.getWalletClient(),
      },

      // Merge any additional context from the Swarm message
      ...additionalContext,
    }

    try {
      const resp = await fetch(CONFIG.OPENCLAW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context }),
      })

      if (!resp.ok) throw new Error(`OpenClaw HTTP ${resp.status}`)
      const data = await resp.json()

      // If OpenClaw responded with a tool call, validate and execute it
      if (data.tool_call && typeof data.tool_call === 'object') {
        const toolName = data.tool_call.name
        const toolParams = data.tool_call.params || {}

        // Validate tool exists
        if (!toolName || !TOOLS[toolName]) {
          _log('OPENCLAW', `Rejected unknown tool: ${toolName}`, 'error')
          return { openclaw_response: data.response, error: `Unknown tool: ${toolName}` }
        }

        // Block high-risk financial tools from autonomous OpenClaw execution
        const REQUIRE_CONFIRMATION = ['open_position', 'close_position', 'adjust_leverage', 'agent_start', 'agent_stop', 'agent_set_mode', 'approve_decision', 'reject_decision']
        if (REQUIRE_CONFIRMATION.includes(toolName)) {
          _log('OPENCLAW', `Tool "${toolName}" requires user confirmation — not auto-executing`, 'yellow-500')
          return {
            openclaw_response: data.response,
            tool_call: toolName,
            tool_params: toolParams,
            requires_confirmation: true,
            message: `OpenClaw wants to call "${toolName}" with params: ${JSON.stringify(toolParams)}. Confirm to execute.`,
          }
        }

        // Validate params are a plain object (not array, not null prototype tricks)
        if (typeof toolParams !== 'object' || Array.isArray(toolParams)) {
          _log('OPENCLAW', `Rejected malformed params for ${toolName}`, 'error')
          return { openclaw_response: data.response, error: 'Malformed tool_call params' }
        }

        _log('OPENCLAW', `Tool call: ${toolName}`, 'primary')
        const toolResult = await TOOLS[toolName].execute(toolParams)
        return {
          openclaw_response: data.response,
          tool_call: toolName,
          tool_result: toolResult,
        }
      }

      return { response: data.response || data }
    } catch (err) {
      _log('OPENCLAW', `Error: ${err.message}`, 'error')
      return { error: `OpenClaw unreachable: ${err.message}` }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SWARM PROTOCOL — Registration & Daemon
  // ═══════════════════════════════════════════════════════════════

  /**
   * Register this xLever instance as a Swarm agent.
   * In browser context, uses HTTP polling. In Node.js, would use Ed25519 + WS.
   */
  async function register(opts = {}) {
    CONFIG.AGENT_NAME = opts.name || CONFIG.AGENT_NAME
    CONFIG.SWARM_HUB = opts.hub || CONFIG.SWARM_HUB

    try {
      // Register via the Swarm hub REST API
      const resp = await fetch(`${CONFIG.SWARM_HUB}/api/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: CONFIG.AGENT_NAME,
          skills: CONFIG.AGENT_SKILLS,
          bio: 'xLever DeFi trading agent — leveraged positions, risk management, market intelligence, and AI-driven trading on Ink Sepolia/Solana/TON.',
          runtime: 'openclaw',
          webhook: opts.webhookUrl || null,
        }),
      })

      if (!resp.ok) throw new Error(`Registration failed: ${resp.status}`)
      const data = await resp.json()

      CONFIG.AGENT_ID = data.agentId || data.id
      _registered = true
      _log('SWARM', `Registered as ${CONFIG.AGENT_NAME} (ID: ${CONFIG.AGENT_ID})`, 'secondary')

      return data
    } catch (err) {
      _log('SWARM', `Registration failed: ${err.message}`, 'error')
      return { error: err.message }
    }
  }

  /**
   * Start the daemon polling loop — checks for new Swarm messages
   * and processes them through the tool router.
   */
  function startDaemon(opts = {}) {
    if (_daemonInterval) return
    _log = opts.log || _log

    const interval = opts.interval || CONFIG.DAEMON_INTERVAL

    _daemonInterval = setInterval(async () => {
      if (!CONFIG.AGENT_ID) return

      try {
        // Poll for new messages
        const pollQs = new URLSearchParams({ agent: CONFIG.AGENT_ID, since: _lastPollTimestamp })
        const resp = await fetch(`${CONFIG.SWARM_HUB}/api/v1/messages?${pollQs}`)
        if (!resp.ok) return

        const data = await resp.json()
        const messages = data.messages || []

        for (const msg of messages) {
          _lastPollTimestamp = Math.max(_lastPollTimestamp, msg.timestamp || Date.now())
          _log('SWARM', `← ${msg.from || 'unknown'}: ${(msg.text || '').slice(0, 80)}`, 'on-surface-variant')

          // Process the message through our tool router
          const result = await handleMessage(msg)

          // Send the response back through Swarm
          await sendResponse(msg.channelId || msg.from, result)
        }
      } catch (err) {
        // Silently continue — Swarm hub may be temporarily unreachable
      }
    }, interval)

    _log('SWARM', `Daemon started (polling every ${interval / 1000}s)`, 'primary')
  }

  /** Stop the Swarm daemon polling loop. */
  function stopDaemon() {
    if (_daemonInterval) {
      clearInterval(_daemonInterval)
      _daemonInterval = null
    }
    _log('SWARM', 'Daemon stopped', 'error')
  }

  /**
   * Send a response back through the Swarm hub.
   */
  async function sendResponse(channelOrAgent, data) {
    if (!CONFIG.AGENT_ID || !CONFIG.SWARM_HUB) return

    try {
      await fetch(`${CONFIG.SWARM_HUB}/api/v1/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: CONFIG.AGENT_ID,
          to: channelOrAgent,
          text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
          attachments: typeof data === 'object' ? [{ type: 'json', data }] : [],
        }),
      })
    } catch {
      // Best-effort send
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT BRIDGE — WSBroadcast ↔ Swarm
  // ═══════════════════════════════════════════════════════════════

  /**
   * Subscribe to all xLever events and relay them to the Swarm hub
   * so other Swarm agents can react to xLever's activity.
   */
  function bridgeEvents(channelId) {
    if (!window.WSBroadcast) return

    window.WSBroadcast.subscribe('*', (event) => {
      // Only relay significant events to avoid flooding the Swarm channel
      const significant = [
        'decision_made', 'decision_executed', 'position_opened',
        'position_closed', 'risk_state_change', 'risk_alert',
        'agent_started', 'agent_stopped', 'error',
      ]
      if (significant.includes(event.event_type)) {
        sendResponse(channelId, {
          source: 'xLever',
          event_type: event.event_type,
          severity: event.severity,
          message: event.message,
          data: event.data,
          timestamp: event.timestamp,
        })
      }
    })

    _log('SWARM', `Event bridge active → channel ${channelId}`, 'secondary')
  }

  // ═══════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Subscribe to internal SwarmBridge events. Use '*' for all events.
   *
   * @param {string} eventType - Event type to listen for
   * @param {Function} callback - Called with event data
   * @returns {Function} Unsubscribe function
   */
  function subscribe(eventType, callback) {
    if (!_subscribers.has(eventType)) _subscribers.set(eventType, new Set())
    _subscribers.get(eventType).add(callback)
    return () => _subscribers.get(eventType)?.delete(callback)
  }

  /**
   * Notify subscribers for a specific event type and wildcard ('*') subscribers.
   * @param {string} eventType - Event type
   * @param {*} data - Event data
   */
  function notifySubscribers(eventType, data) {
    const subs = _subscribers.get(eventType)
    if (subs) subs.forEach(cb => { try { cb(data) } catch {} })
    const all = _subscribers.get('*')
    if (all) all.forEach(cb => { try { cb({ type: eventType, data }) } catch {} })
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    // Swarm protocol
    register,
    startDaemon,
    stopDaemon,
    bridgeEvents,
    sendResponse,

    // Message handling (usable standalone without Swarm)
    handleMessage,
    forwardToOpenClaw,

    // Tool registry
    get tools() { return { ...TOOLS } },
    /**
     * Get the full tool registry as an array of { name, description, parameters } objects.
     * Suitable for sending to external agents for tool discovery.
     * @returns {Object[]} Array of tool descriptors
     */
    getToolList() {
      return Object.entries(TOOLS).map(([key, tool]) => ({
        name: key,
        description: tool.description,
        parameters: tool.parameters,
      }))
    },
    /**
     * Invoke a tool by name with the given parameters.
     * @param {string} name - Tool name from the registry
     * @param {Object} [params={}] - Tool parameters
     * @returns {Promise<Object>} Tool execution result, or { error } if unknown tool
     */
    async invokeTool(name, params = {}) {
      if (!TOOLS[name]) return { error: `Unknown tool: ${name}` }
      return TOOLS[name].execute(params)
    },

    // OpenClaw
    /** @param {string} url - OpenClaw runtime URL to use for AI message forwarding */
    setOpenClawUrl(url) {
      if (!url) { CONFIG.OPENCLAW_URL = null; return }
      try {
        const parsed = new URL(url)
        // In production, require HTTPS (allow HTTP only for local dev)
        if (!isLocal && parsed.protocol !== 'https:') {
          _log('SWARM', `Rejected OpenClaw URL: HTTPS required in production (got ${parsed.protocol})`, 'error')
          return
        }
        // Block javascript: and data: protocols
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          _log('SWARM', `Rejected OpenClaw URL: invalid protocol ${parsed.protocol}`, 'error')
          return
        }
        CONFIG.OPENCLAW_URL = url
      } catch {
        _log('SWARM', `Rejected OpenClaw URL: invalid URL format`, 'error')
      }
    },

    // State
    get isRegistered() { return _registered },
    get isDaemonRunning() { return _daemonInterval !== null },
    get agentId() { return CONFIG.AGENT_ID },
    get config() { return { ...CONFIG } },

    // Subscriptions
    subscribe,

    // Config
    CONFIG,
  })
})()

window.SwarmBridge = SwarmBridge
