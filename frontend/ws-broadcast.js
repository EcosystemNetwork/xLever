/**
 * @file ws-broadcast.js — xLever WebSocket Broadcast Client
 *
 * Real-time event broadcasting for agent decisions, position updates,
 * and market events. Allows external consumers (dashboards, bots, mobile)
 * to subscribe to the agent pipeline's output.
 *
 * Two modes:
 *  1. Server mode -- runs a local WebSocket server (Node.js / service worker)
 *  2. Client mode -- connects to an external WS endpoint and relays events
 *
 * In browser context, operates as a client-side event bus that:
 *  - Buffers events when no listeners are connected (up to MAX_BUFFER=200)
 *  - Connects to a configurable WS endpoint with exponential-backoff reconnect
 *  - Provides local pub/sub for in-page consumers (typed + wildcard subscriptions)
 *  - Relays inbound WS messages to local subscribers (bidirectional comms)
 *
 * @module WSBroadcast
 * @exports {Object} window.WSBroadcast (frozen singleton)
 * @exports {Function} WSBroadcast.emit - Emit event to local subs and remote WS
 * @exports {Function} WSBroadcast.subscribe - Subscribe to events by type or wildcard
 * @exports {Object} WSBroadcast.EventType - Frozen enum of all event types
 * @exports {Function} WSBroadcast.connect - Connect to a remote WS relay endpoint
 * @exports {Function} WSBroadcast.disconnect - Close WS connection
 *
 * @dependencies None (self-contained, uses native WebSocket API)
 */

const WSBroadcast = (() => {

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let _ws = null                    // WebSocket connection (client mode)
  let _endpoint = null              // WS server URL to connect to
  let _reconnectTimer = null
  let _reconnectAttempts = 0
  const MAX_RECONNECT_ATTEMPTS = 10
  const RECONNECT_BASE_MS = 1000

  // Local pub/sub
  const _subscribers = new Map()    // eventType → Set<callback>
  const _allSubscribers = new Set() // Wildcard subscribers (receive all events)

  // Buffer for offline/disconnected state
  const _buffer = []
  const MAX_BUFFER = 200

  // Stats
  const _stats = {
    eventsSent: 0,
    eventsBuffered: 0,
    eventsDropped: 0,
    reconnects: 0,
    subscriberCount: 0,
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT TYPES
  // ═══════════════════════════════════════════════════════════════

  const EventType = Object.freeze({
    // Decision pipeline
    DECISION_MADE:     'decision_made',
    DECISION_EXECUTED: 'decision_executed',
    DECISION_SKIPPED:  'decision_skipped',

    // Position lifecycle
    POSITION_OPENED:   'position_opened',
    POSITION_CLOSED:   'position_closed',
    POSITION_UPDATED:  'position_updated',

    // Market intelligence
    MARKET_UPDATE:     'market_update',
    NEWS_PROCESSED:    'news_processed',
    SIGNAL_GENERATED:  'signal_generated',

    // Risk events
    RISK_STATE_CHANGE: 'risk_state_change',
    RISK_ALERT:        'risk_alert',

    // System
    AGENT_STARTED:     'agent_started',
    AGENT_STOPPED:     'agent_stopped',
    ERROR:             'error',
    HEALTH:            'health',
  })

  // ═══════════════════════════════════════════════════════════════
  // LOCAL PUB/SUB
  // ═══════════════════════════════════════════════════════════════

  /**
   * Subscribe to a specific event type.
   * @param {string} eventType - One of EventType values, or '*' for all
   * @param {Function} callback - Called with (event) on each matching event
   * @returns {Function} unsubscribe function
   */
  function subscribe(eventType, callback) {
    if (eventType === '*') {
      _allSubscribers.add(callback)
      _stats.subscriberCount++
      return () => { _allSubscribers.delete(callback); _stats.subscriberCount-- }
    }

    if (!_subscribers.has(eventType)) _subscribers.set(eventType, new Set())
    _subscribers.get(eventType).add(callback)
    _stats.subscriberCount++

    return () => {
      const subs = _subscribers.get(eventType)
      if (subs) { subs.delete(callback); if (subs.size === 0) _subscribers.delete(eventType) }
      _stats.subscriberCount--
    }
  }

  /**
   * Dispatch an event to all matching local subscribers (typed + wildcard).
   * Swallows errors from individual callbacks to prevent one bad listener from
   * breaking delivery to others.
   * @param {Object} event - Event object with event_type, data, severity, timestamp
   * @private
   */
  function notifyLocal(event) {
    // Typed subscribers
    const subs = _subscribers.get(event.event_type)
    if (subs) subs.forEach(cb => { try { cb(event) } catch {} })

    // Wildcard subscribers
    _allSubscribers.forEach(cb => { try { cb(event) } catch {} })
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT EMISSION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Emit an event to local subscribers and the remote WS endpoint.
   * @param {string} eventType - Event type from EventType
   * @param {Object} data - Event payload
   * @param {string} [message] - Human-readable description
   * @param {string} [severity] - 'info' | 'warning' | 'error' | 'critical'
   */
  function emit(eventType, data = {}, message = null, severity = 'info') {
    const event = {
      event_type: eventType,
      severity,
      timestamp: new Date().toISOString(),
      data,
      message,
    }

    // Always notify local subscribers
    notifyLocal(event)

    // Send to remote WS if connected
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      try {
        _ws.send(JSON.stringify(event))
        _stats.eventsSent++
      } catch {
        bufferEvent(event)
      }
    } else if (_endpoint) {
      // Buffer for when WS reconnects
      bufferEvent(event)
    }
  }

  /**
   * Add an event to the offline buffer for later transmission when WS reconnects.
   * Drops oldest events when buffer exceeds MAX_BUFFER.
   * @param {Object} event - Serialized event object
   * @private
   */
  function bufferEvent(event) {
    if (_buffer.length >= MAX_BUFFER) {
      _buffer.shift()
      _stats.eventsDropped++
    }
    _buffer.push(JSON.stringify(event))
    _stats.eventsBuffered++
  }

  // ═══════════════════════════════════════════════════════════════
  // CONVENIENCE EMITTERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Emit a decision event from the agent pipeline.
   * @param {Object} recommendation - Agent recommendation with action, conviction, direction, score
   * @param {Object} [auditEntry] - Audit log entry with executed flag
   */
  function emitDecision(recommendation, auditEntry) {
    emit(EventType.DECISION_MADE, {
      action: recommendation.action,
      conviction: recommendation.conviction,
      direction: recommendation.direction,
      score: recommendation.score,
      consensus: recommendation.consensus,
      headline: recommendation.newsItem?.headline,
      executed: auditEntry?.executed || false,
    }, `${recommendation.action} (${recommendation.conviction})`)
  }

  /**
   * Emit an action execution event.
   * @param {Object} action - Executed action with type, reason, targetLeverage
   */
  function emitExecution(action) {
    emit(EventType.DECISION_EXECUTED, {
      type: action.type,
      reason: action.reason,
      targetLeverage: action.targetLeverage,
    }, `Executed: ${action.type}`, action.severity === 'error' ? 'warning' : 'info')
  }

  /**
   * Emit a risk state transition event with appropriate severity.
   * @param {string} newState - New risk state (NORMAL, WARNING, RESTRICTED, EMERGENCY)
   * @param {string} oldState - Previous risk state
   */
  function emitRiskChange(newState, oldState) {
    const severity = newState === 'EMERGENCY' ? 'critical'
      : newState === 'RESTRICTED' ? 'error'
      : newState === 'WARNING' ? 'warning' : 'info'

    emit(EventType.RISK_STATE_CHANGE, {
      newState,
      oldState,
    }, `Risk: ${oldState} → ${newState}`, severity)
  }

  /**
   * Emit a news processing event after the agent processes a news item.
   * @param {Object} newsItem - Processed news item with headline, priority, source
   * @param {number} signalCount - Number of trading signals generated
   */
  function emitNewsProcessed(newsItem, signalCount) {
    emit(EventType.NEWS_PROCESSED, {
      headline: newsItem.headline?.slice(0, 100),
      priority: newsItem.priority,
      source: newsItem.source,
      signalCount,
    })
  }

  // ═══════════════════════════════════════════════════════════════
  // WEBSOCKET CLIENT (connects to external relay server)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Connect to a remote WebSocket relay server.
   * Flushes buffered events on successful connection.
   * Auto-reconnects with exponential backoff on disconnect (up to MAX_RECONNECT_ATTEMPTS).
   * @param {string} endpoint - WebSocket URL (e.g., 'wss://relay.xlever.markets/ws')
   */
  function connect(endpoint) {
    _endpoint = endpoint
    _reconnectAttempts = 0
    _connect()
  }

  function _connect() {
    if (!_endpoint) return
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return

    try {
      _ws = new WebSocket(_endpoint)

      _ws.onopen = () => {
        _reconnectAttempts = 0
        // Flush buffer
        while (_buffer.length > 0) {
          try { _ws.send(_buffer.shift()) } catch { break }
        }
        emit(EventType.HEALTH, { connected: true, endpoint: _endpoint }, 'WebSocket connected')
      }

      _ws.onclose = () => {
        _scheduleReconnect()
      }

      _ws.onerror = () => {
        // onclose will fire after onerror, which handles reconnect
      }

      _ws.onmessage = (e) => {
        // Relay inbound messages to local subscribers (for bidirectional comms)
        try {
          const event = JSON.parse(e.data)
          if (event.event_type) notifyLocal(event)
        } catch {}
      }

    } catch {
      _scheduleReconnect()
    }
  }

  function _scheduleReconnect() {
    if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return
    _reconnectAttempts++
    _stats.reconnects++
    const delay = RECONNECT_BASE_MS * 2 ** Math.min(_reconnectAttempts - 1, 5)
    _reconnectTimer = setTimeout(_connect, delay)
  }

  /**
   * Disconnect from the remote WS endpoint. Cancels any pending reconnect
   * timers and clears the endpoint so no further reconnections are attempted.
   */
  function disconnect() {
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
    if (_ws) { _ws.onclose = null; _ws.close(); _ws = null }
    _endpoint = null
    _reconnectAttempts = 0
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    // Core
    emit,
    subscribe,
    EventType,

    // Convenience
    emitDecision,
    emitExecution,
    emitRiskChange,
    emitNewsProcessed,

    // WS client
    connect,
    disconnect,
    get isConnected() { return _ws?.readyState === WebSocket.OPEN },

    // Stats
    get stats() { return { ..._stats } },
    get bufferSize() { return _buffer.length },
  })
})()

window.WSBroadcast = WSBroadcast
