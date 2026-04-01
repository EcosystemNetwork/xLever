/**
 * @file agent-bridge.js
 * @module AgentBridge
 * @description
 * xLever Agent Bridge — Connects the frontend agent system to the Python AI
 * trading agent backend.
 *
 * This bridge:
 *  1. Establishes WebSocket connection to the Python agent (ws://localhost:8765 in dev,
 *     wss://{host}/ws/agent in production)
 *  2. Provides REST API methods to control the Python agent lifecycle
 *  3. Syncs state between frontend AgentCoordinator and Python agent via events
 *  4. Enables Human-In-The-Loop (HITL) approval workflow for trading decisions
 *  5. Auto-reconnects on disconnect (up to 10 attempts, 3s interval)
 *
 * Event types handled: decision_made, decision_approved, decision_rejected,
 *   position_opened/closed/updated, agent_started/stopped, health_check, error
 *
 * @exports {Object} AgentBridge - Frozen singleton exposed on window.AgentBridge
 *
 * @dependencies
 *  - window.WSBroadcast   — WebSocket event relay for forwarding agent events
 *  - window.fetchPositions — Frontend position refresh callback (optional)
 */

const AgentBridge = (() => {

  // ═══════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname) || window.location.hostname.startsWith('192.168.')
  const CONFIG = {
    // Python agent endpoints — use localhost in dev, production API otherwise
    WS_URL: isLocal ? 'ws://localhost:8765' : `wss://${window.location.host}/ws/agent`,
    API_BASE: isLocal ? 'http://localhost:8080/api' : 'https://api.xlever.markets/api',

    // Reconnection settings
    RECONNECT_INTERVAL: 3000,
    MAX_RECONNECT_ATTEMPTS: 10,
  }

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let _ws = null
  let _connected = false
  let _reconnectAttempts = 0
  let _reconnectTimer = null
  let _agentStatus = null
  let _pendingDecisions = []
  let _log = () => {}

  // Event subscribers
  const _subscribers = new Map()

  // ═══════════════════════════════════════════════════════════════
  // WEBSOCKET CONNECTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Connect to the Python agent via WebSocket.
   * Fetches initial agent status and pending decisions on successful connection.
   * Also connects WSBroadcast for event relay to other frontend consumers.
   *
   * @param {Object} [opts={}] - Connection options
   * @param {Function} [opts.log] - Logging callback with signature (label, message, color)
   */
  function connect(opts = {}) {
    _log = opts.log || console.log

    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _log('BRIDGE', 'Already connected to Python agent', 'secondary')
      return
    }

    _log('BRIDGE', `Connecting to Python agent at ${CONFIG.WS_URL}...`, 'primary')

    try {
      _ws = new WebSocket(CONFIG.WS_URL)

      _ws.onopen = () => {
        _connected = true
        _reconnectAttempts = 0
        _log('BRIDGE', '✓ Connected to Python AI Trading Agent', 'secondary')

        // Also connect WSBroadcast for event relay
        if (window.WSBroadcast) {
          window.WSBroadcast.connect(CONFIG.WS_URL)
        }

        // Fetch initial status
        fetchAgentStatus()
        fetchPendingDecisions()

        notifySubscribers('connected', { url: CONFIG.WS_URL })
      }

      _ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data)
          handleAgentEvent(event)
        } catch (err) {
          _log('BRIDGE', `Failed to parse event: ${err.message}`, 'error')
        }
      }

      _ws.onclose = () => {
        _connected = false
        _log('BRIDGE', 'Disconnected from Python agent', 'yellow-500')
        notifySubscribers('disconnected', {})
        scheduleReconnect()
      }

      _ws.onerror = (err) => {
        _log('BRIDGE', `WebSocket error: ${err.message || 'Connection failed'}`, 'error')
      }

    } catch (err) {
      _log('BRIDGE', `Failed to connect: ${err.message}`, 'error')
      scheduleReconnect()
    }
  }

  /**
   * Intentionally disconnect from the Python agent.
   * Clears reconnect timer and suppresses automatic reconnection.
   */
  function disconnect() {
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer)
      _reconnectTimer = null
    }
    if (_ws) {
      _ws.onclose = null // Prevent reconnect on intentional close
      _ws.close()
      _ws = null
    }
    _connected = false
    _log('BRIDGE', 'Disconnected from Python agent', 'on-surface-variant')
  }

  /**
   * Schedule a reconnection attempt after the configured interval.
   * Stops after MAX_RECONNECT_ATTEMPTS (10) to avoid infinite retry loops.
   */
  function scheduleReconnect() {
    if (_reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      _log('BRIDGE', 'Max reconnect attempts reached. Python agent may be offline.', 'error')
      return
    }

    _reconnectAttempts++
    _reconnectTimer = setTimeout(() => {
      _log('BRIDGE', `Reconnecting... (attempt ${_reconnectAttempts})`, 'on-surface-variant')
      connect({ log: _log })
    }, CONFIG.RECONNECT_INTERVAL)
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT HANDLING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Handle an inbound event from the Python agent WebSocket.
   * Routes events to the appropriate handler based on event_type,
   * updates internal state, and notifies subscribers.
   *
   * @param {Object} event - Agent event payload
   * @param {string} event.event_type - Event type identifier
   * @param {Object} [event.data] - Event-specific data
   * @param {string} [event.message] - Human-readable message
   * @param {string} [event.severity] - Severity level (info, warning, error, critical)
   */
  function handleAgentEvent(event) {
    const { event_type, data, message, severity } = event

    // Log significant events
    if (severity === 'warning' || severity === 'error' || severity === 'critical') {
      _log('AGENT', `[${event_type}] ${message || JSON.stringify(data)}`, severity === 'critical' ? 'error' : 'yellow-500')
    } else {
      _log('AGENT', `[${event_type}] ${message || ''}`, 'on-surface-variant')
    }

    // Handle specific event types
    switch (event_type) {
      case 'decision_made':
        _pendingDecisions.push(data)
        notifySubscribers('decision_pending', data)
        break

      case 'decision_approved':
      case 'decision_rejected':
        _pendingDecisions = _pendingDecisions.filter(d => d.decision_id !== data.decision_id)
        notifySubscribers(event_type, data)
        break

      case 'position_opened':
      case 'position_closed':
      case 'position_updated':
        notifySubscribers(event_type, data)
        // Refresh positions in frontend
        if (window.fetchPositions) window.fetchPositions()
        break

      case 'agent_started':
        _agentStatus = { ...(_agentStatus || {}), running: true }
        notifySubscribers('status_change', _agentStatus)
        break

      case 'agent_stopped':
        _agentStatus = { ...(_agentStatus || {}), running: false }
        notifySubscribers('status_change', _agentStatus)
        break

      case 'health_check':
        _agentStatus = { ...(_agentStatus || {}), healthy: true, ...data }
        break

      case 'error':
        notifySubscribers('error', { message, ...data })
        break
    }

    // Forward to WSBroadcast for other consumers
    if (window.WSBroadcast && event_type) {
      window.WSBroadcast.emit(event_type, data, message, severity)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // API METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Make an API call to the Python agent backend.
   *
   * @param {string} endpoint - API path (e.g., '/agent/status')
   * @param {string} [method='GET'] - HTTP method
   * @param {Object|null} [body=null] - Request body (JSON-serialized)
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {Error} On HTTP errors or network failures
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
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }
      return await response.json()
    } catch (err) {
      _log('BRIDGE', `API call failed: ${err.message}`, 'error')
      throw err
    }
  }

  /**
   * Fetch the current agent status from the backend and update local state.
   * @returns {Promise<Object|null>} Agent status object, or null on failure
   */
  async function fetchAgentStatus() {
    try {
      _agentStatus = await apiCall('/agent/status')
      notifySubscribers('status_change', _agentStatus)
      return _agentStatus
    } catch {
      return null
    }
  }

  /**
   * Fetch all pending trading decisions awaiting HITL approval.
   * @returns {Promise<Object[]>} Array of pending decision objects
   */
  async function fetchPendingDecisions() {
    try {
      const response = await apiCall('/agent/pending')
      _pendingDecisions = response.decisions || []
      notifySubscribers('decisions_updated', _pendingDecisions)
      return _pendingDecisions
    } catch {
      return []
    }
  }

  /**
   * Start the Python AI trading agent.
   * @returns {Promise<Object>} Backend response
   */
  async function startAgent() {
    _log('BRIDGE', 'Starting Python agent...', 'primary')
    return apiCall('/agent/start', 'POST')
  }

  /**
   * Gracefully stop the Python AI trading agent.
   * @returns {Promise<Object>} Backend response
   */
  async function stopAgent() {
    _log('BRIDGE', 'Stopping Python agent...', 'yellow-500')
    return apiCall('/agent/stop', 'POST')
  }

  /**
   * Change the Python agent's operating mode.
   * @param {string} mode - Agent mode ('safe', 'target', or 'accumulate')
   * @returns {Promise<Object>} Backend response
   */
  async function setAgentMode(mode) {
    _log('BRIDGE', `Setting agent mode to: ${mode}`, 'primary')
    return apiCall('/agent/mode', 'POST', { mode })
  }

  /**
   * Approve a pending trading decision for execution.
   * @param {string} decisionId - Decision identifier
   * @returns {Promise<Object>} Backend response
   */
  async function approveDecision(decisionId) {
    _log('BRIDGE', `Approving decision: ${decisionId}`, 'secondary')
    return apiCall(`/agent/approve/${decisionId}`, 'POST', { approved: true })
  }

  /**
   * Reject a pending trading decision with an optional reason.
   * @param {string} decisionId - Decision identifier
   * @param {string} [reason=''] - Rejection reason for audit trail
   * @returns {Promise<Object>} Backend response
   */
  async function rejectDecision(decisionId, reason = '') {
    _log('BRIDGE', `Rejecting decision: ${decisionId}`, 'error')
    return apiCall(`/agent/approve/${decisionId}`, 'POST', { approved: false, reason })
  }

  /**
   * Get all positions from the backend.
   * @returns {Promise<Object>} Positions data
   */
  async function getPositions() {
    return apiCall('/positions')
  }

  /**
   * Get recent trading decision history.
   * @param {number} [limit=50] - Maximum number of decisions to return
   * @returns {Promise<Object>} Decision history data
   */
  async function getDecisionHistory(limit = 50) {
    return apiCall(`/decisions?limit=${limit}`)
  }

  // ═══════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Subscribe to agent events by type. Use '*' to receive all events.
   *
   * @param {string} eventType - Event type to listen for (e.g., 'decision_pending', 'status_change', '*')
   * @param {Function} callback - Called with event data when the event fires
   * @returns {Function} Unsubscribe function
   */
  function subscribe(eventType, callback) {
    if (!_subscribers.has(eventType)) {
      _subscribers.set(eventType, new Set())
    }
    _subscribers.get(eventType).add(callback)

    return () => {
      const subs = _subscribers.get(eventType)
      if (subs) subs.delete(callback)
    }
  }

  /**
   * Notify all subscribers of a specific event type, plus wildcard ('*') subscribers.
   * Subscriber errors are silently caught.
   *
   * @param {string} eventType - Event type identifier
   * @param {*} data - Event data payload
   */
  function notifySubscribers(eventType, data) {
    const subs = _subscribers.get(eventType)
    if (subs) {
      subs.forEach(cb => {
        try { cb(data) } catch {}
      })
    }
    // Also notify wildcard subscribers
    const allSubs = _subscribers.get('*')
    if (allSubs) {
      allSubs.forEach(cb => {
        try { cb({ type: eventType, data }) } catch {}
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    // Connection
    connect,
    disconnect,
    get isConnected() { return _connected },

    // Agent control
    startAgent,
    stopAgent,
    setAgentMode,
    fetchAgentStatus,

    // Decisions
    fetchPendingDecisions,
    approveDecision,
    rejectDecision,
    getDecisionHistory,
    get pendingDecisions() { return [..._pendingDecisions] },

    // Positions
    getPositions,

    // State
    get status() { return _agentStatus },

    // Subscriptions
    subscribe,

    // Config
    CONFIG,
  })
})()

window.AgentBridge = AgentBridge
