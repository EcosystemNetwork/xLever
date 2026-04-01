/**
 * xLever Agent Bridge
 * ────────────────────
 * Connects the frontend agent system to the Python AI trading agent backend.
 *
 * This bridge:
 *  1. Establishes WebSocket connection to Python agent (port 8765)
 *  2. Provides API methods to control the Python agent
 *  3. Syncs state between frontend AgentCoordinator and Python agent
 *  4. Enables HITL approval workflow from the UI
 */

const AgentBridge = (() => {

  // ═══════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  const isLocal = window.location.hostname === 'localhost'
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

  async function fetchAgentStatus() {
    try {
      _agentStatus = await apiCall('/agent/status')
      notifySubscribers('status_change', _agentStatus)
      return _agentStatus
    } catch {
      return null
    }
  }

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

  async function startAgent() {
    _log('BRIDGE', 'Starting Python agent...', 'primary')
    return apiCall('/agent/start', 'POST')
  }

  async function stopAgent() {
    _log('BRIDGE', 'Stopping Python agent...', 'yellow-500')
    return apiCall('/agent/stop', 'POST')
  }

  async function setAgentMode(mode) {
    _log('BRIDGE', `Setting agent mode to: ${mode}`, 'primary')
    return apiCall('/agent/mode', 'POST', { mode })
  }

  async function approveDecision(decisionId) {
    _log('BRIDGE', `Approving decision: ${decisionId}`, 'secondary')
    return apiCall(`/agent/approve/${decisionId}`, 'POST', { approved: true })
  }

  async function rejectDecision(decisionId, reason = '') {
    _log('BRIDGE', `Rejecting decision: ${decisionId}`, 'error')
    return apiCall(`/agent/approve/${decisionId}`, 'POST', { approved: false, reason })
  }

  async function getPositions() {
    return apiCall('/positions')
  }

  async function getDecisionHistory(limit = 50) {
    return apiCall(`/decisions?limit=${limit}`)
  }

  // ═══════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════

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
