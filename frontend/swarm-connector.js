/**
 * xLever Swarm Connector
 * ──────────────────────
 * Connects xLever to the EcosystemNetwork/Swarm protocol, enabling
 * external AI agents (OpenClaw, Eliza, Hermes, etc.) to discover
 * and use all xLever tools through the Swarm network.
 *
 * This module:
 *  1. Registers xLever as a Swarm agent on startup
 *  2. Runs a daemon that polls for inbound Swarm messages
 *  3. Routes messages through SwarmBridge's tool registry
 *  4. Relays xLever events (decisions, positions, risk) back to Swarm
 *  5. Provides a chat interface for direct OpenClaw ↔ xLever conversation
 *
 * Dependencies: swarm-bridge.js, agent-bridge.js, ws-broadcast.js
 */

const SwarmConnector = (() => {

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let _connected = false
  let _log = () => {}
  let _chatHistory = []       // Conversation history for OpenClaw context
  let _eventChannel = null    // Swarm channel for event relay
  const MAX_CHAT_HISTORY = 50

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Connect xLever to the Swarm network.
   *
   * @param {Object} opts
   * @param {string} opts.hub          — Swarm hub URL (default: https://swarmprotocol.fun)
   * @param {string} opts.name         — Agent display name
   * @param {string} opts.openclawUrl  — OpenClaw runtime URL for AI processing
   * @param {string} opts.channelId    — Swarm channel to join for event relay
   * @param {Function} opts.log        — Log callback (label, message, color)
   * @param {Function} opts.onMessage  — Callback when a Swarm message is received
   */
  async function connect(opts = {}) {
    _log = opts.log || console.log

    const bridge = window.SwarmBridge
    if (!bridge) {
      _log('SWARM', 'SwarmBridge not loaded — cannot connect.', 'error')
      return { error: 'SwarmBridge not loaded' }
    }

    // Configure OpenClaw URL if provided
    if (opts.openclawUrl) {
      bridge.setOpenClawUrl(opts.openclawUrl)
      _log('SWARM', `OpenClaw runtime: ${opts.openclawUrl}`, 'on-surface-variant')
    }

    // Register with Swarm hub
    _log('SWARM', 'Registering with Swarm network...', 'primary')
    const registration = await bridge.register({
      hub: opts.hub,
      name: opts.name || 'xLever-Agent',
    })

    if (registration.error) {
      _log('SWARM', `Registration failed: ${registration.error}`, 'error')
      // Continue in offline mode — can still use tools locally
      _log('SWARM', 'Running in offline mode — tools available locally.', 'yellow-500')
    } else {
      _log('SWARM', `Connected to Swarm as "${opts.name || 'xLever-Agent'}" (${bridge.agentId})`, 'secondary')
    }

    // Start the polling daemon
    bridge.startDaemon({
      log: _log,
      interval: opts.daemonInterval || 10000,
    })

    // Bridge xLever events to Swarm
    if (opts.channelId) {
      _eventChannel = opts.channelId
      bridge.bridgeEvents(opts.channelId)
    }

    // Subscribe to inbound messages for the onMessage callback
    if (opts.onMessage) {
      bridge.subscribe('message', opts.onMessage)
    }

    _connected = true

    // Log available tools
    const tools = bridge.getToolList()
    _log('SWARM', `${tools.length} tools available for Swarm agents:`, 'on-surface-variant')
    _log('SWARM', tools.map(t => `  ${t.name}`).join('\n'), 'on-surface-variant')

    return { success: true, agentId: bridge.agentId, tools: tools.length }
  }

  /**
   * Disconnect from Swarm.
   */
  function disconnect() {
    const bridge = window.SwarmBridge
    if (bridge) {
      bridge.stopDaemon()
    }
    _connected = false
    _chatHistory = []
    _log('SWARM', 'Disconnected from Swarm network.', 'error')
  }

  // ═══════════════════════════════════════════════════════════════
  // CHAT INTERFACE — Talk to OpenClaw through xLever
  // ═══════════════════════════════════════════════════════════════

  /**
   * Send a chat message that gets processed through the full pipeline:
   *  1. Try to parse as a direct tool call
   *  2. If no tool matches, forward to OpenClaw with full xLever context
   *  3. If OpenClaw returns a tool_call, execute it
   *  4. Return the complete response
   */
  async function chat(message) {
    const bridge = window.SwarmBridge
    if (!bridge) return { error: 'SwarmBridge not loaded' }

    // Add to conversation history for context
    _chatHistory.push({ role: 'user', content: message, timestamp: Date.now() })
    if (_chatHistory.length > MAX_CHAT_HISTORY) _chatHistory.shift()

    _log('CHAT', `User: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`, 'on-surface-variant')

    // Process through the bridge (handles both structured and natural language)
    const result = await bridge.handleMessage({
      text: message,
      context: {
        chat_history: _chatHistory.slice(-10), // Last 10 messages for context
        wallet_address: getConnectedWallet(),
      },
    })

    // Add response to history
    const responseText = result.response || result.openclaw_response || formatToolResult(result)
    _chatHistory.push({ role: 'assistant', content: responseText, timestamp: Date.now() })

    _log('CHAT', `Agent: ${responseText.slice(0, 100)}${responseText.length > 100 ? '...' : ''}`, 'secondary')

    return result
  }

  /**
   * Format a tool result into a readable string for chat history.
   */
  function formatToolResult(result) {
    if (result.error) return `Error: ${result.error}`
    if (result.tool && result.result) {
      return `[${result.tool}] ${JSON.stringify(result.result).slice(0, 200)}`
    }
    if (result.message) return result.message
    return JSON.stringify(result).slice(0, 300)
  }

  /**
   * Get the currently connected wallet address (if any).
   */
  function getConnectedWallet() {
    try {
      const modal = window.xLeverWallet
      if (modal) return modal.getAddress()
    } catch {}
    return null
  }

  // ═══════════════════════════════════════════════════════════════
  // DIRECT TOOL INVOCATION — For programmatic use
  // ═══════════════════════════════════════════════════════════════

  /**
   * Invoke a tool directly by name, bypassing NLP parsing.
   */
  async function invokeTool(name, params = {}) {
    const bridge = window.SwarmBridge
    if (!bridge) return { error: 'SwarmBridge not loaded' }
    return bridge.invokeTool(name, params)
  }

  /**
   * Get the full tool registry for external consumption.
   */
  function getTools() {
    const bridge = window.SwarmBridge
    if (!bridge) return []
    return bridge.getToolList()
  }

  // ═══════════════════════════════════════════════════════════════
  // OPENCLAW PROMPT LOADER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Generate the OpenClaw system prompt dynamically with current state.
   * This is sent as context when forwarding messages to OpenClaw.
   */
  function generateSystemPrompt() {
    const tools = getTools()
    const state = {
      agent_running: window.AgentExecutor?.isRunning || false,
      agent_paused: window.AgentExecutor?.isPaused || false,
      agent_dry_run: window.AgentExecutor?.isDryRun ?? true,
      risk_state: window.RiskLive?.state || 'unknown',
      swarm_running: window.AgentCoordinator?.isRunning || false,
      wallet: getConnectedWallet() || 'not connected',
      swarm_connected: _connected,
      swarm_agent_id: window.SwarmBridge?.agentId || null,
    }

    return {
      role: 'system',
      content: `You are the xLever Trading Agent connected via the Swarm network. You have ${tools.length} tools available.

Current state:
- Agent: ${state.agent_running ? 'running' : 'stopped'}${state.agent_paused ? ' (paused)' : ''}${state.agent_dry_run ? ' [DRY-RUN]' : ' [LIVE]'}
- Risk: ${state.risk_state}
- Wallet: ${state.wallet}
- Swarm: ${state.swarm_connected ? 'connected' : 'offline'} (ID: ${state.swarm_agent_id || 'none'})
- News Swarm: ${state.swarm_running ? 'active' : 'inactive'}

Respond with tool calls when the user requests data or actions. Always check risk state before recommending trades.`,
      tools: tools.map(t => `${t.name}: ${t.description}`).join('\n'),
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UI INTEGRATION HELPERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Render the Swarm connection status badge for the UI.
   * Returns an HTML string.
   */
  function renderStatusBadge() {
    const bridge = window.SwarmBridge
    if (!bridge) return '<span class="text-surface-variant">Swarm: not loaded</span>'

    if (_connected && bridge.isRegistered) {
      return `<span class="text-secondary">Swarm: connected (${bridge.agentId?.slice(0, 8)}...)</span>`
    }
    if (_connected && !bridge.isRegistered) {
      return '<span class="text-yellow-500">Swarm: offline mode</span>'
    }
    return '<span class="text-surface-variant">Swarm: disconnected</span>'
  }

  /**
   * Render the tool count badge.
   */
  function renderToolsBadge() {
    const tools = getTools()
    return `<span class="text-on-surface-variant">${tools.length} tools</span>`
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    // Connection
    connect,
    disconnect,
    get isConnected() { return _connected },

    // Chat (OpenClaw ↔ xLever)
    chat,
    get chatHistory() { return [..._chatHistory] },
    clearHistory() { _chatHistory = [] },

    // Tools
    invokeTool,
    getTools,
    generateSystemPrompt,

    // UI helpers
    renderStatusBadge,
    renderToolsBadge,

    // State
    get eventChannel() { return _eventChannel },
  })
})()

window.SwarmConnector = SwarmConnector
