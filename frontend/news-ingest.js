/**
 * @file news-ingest.js
 * @module NewsIngest
 * @description
 * xLever News Ingestion Pipeline + Priority Queue.
 * Streams news from multiple sources, classifies priority,
 * deduplicates, and routes to analyst agents via the coordinator.
 *
 * Sources:
 *  1. Backend /api/news/stream (SSE) — primary real-time aggregated feed
 *  2. Backend /api/news/poll — fallback polling (30s interval)
 *  3. Manual inject via ingest() — programmatic or testing input
 *
 * Priority levels (lower number = higher urgency):
 *  CRITICAL (0) — Fed decisions, circuit breakers, black swan events
 *  HIGH (1)     — Earnings beats/misses, sector rotation, macro data
 *  MEDIUM (2)   — Analyst upgrades/downgrades, options flow
 *  LOW (3)      — General market commentary, sector news
 *
 * @exports {Object} NewsIngest - Frozen singleton exposed on window.NewsIngest
 *
 * @dependencies
 *  - window.xLeverAssets — Asset registry for symbol tracking (optional)
 */

const NewsIngest = (() => {

  // ═══════════════════════════════════════════════════════════════
  // PRIORITY QUEUE — min-heap ordered by (priority, timestamp)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Min-heap priority queue ordered by (priority, timestamp).
   * Lower priority numbers surface first; ties broken by earlier timestamps.
   * Used to ensure CRITICAL news is always processed before lower-priority items.
   */
  class PriorityQueue {
    constructor() { this._heap = [] }

    /** @returns {number} Number of items currently in the queue */
    get size() { return this._heap.length }

    /**
     * Add an item to the queue and re-heapify upward.
     * @param {Object} item - News item with at least { priority, timestamp }
     */
    enqueue(item) {
      this._heap.push(item)
      this._bubbleUp(this._heap.length - 1)
    }

    /**
     * Remove and return the highest-priority (lowest number) item.
     * @returns {Object|null} The top-priority news item, or null if empty
     */
    dequeue() {
      if (this._heap.length === 0) return null
      const top = this._heap[0]
      const last = this._heap.pop()
      if (this._heap.length > 0) {
        this._heap[0] = last
        this._sinkDown(0)
      }
      return top
    }

    /** @returns {Object|null} The top-priority item without removing it */
    peek() { return this._heap[0] || null }

    /**
     * Remove and return up to `max` items from the queue in priority order.
     * @param {number} [max=Infinity] - Maximum number of items to drain
     * @returns {Object[]} Array of dequeued news items
     */
    drain(max = Infinity) {
      const items = []
      while (this._heap.length > 0 && items.length < max) {
        items.push(this.dequeue())
      }
      return items
    }

    /** @param {number} i - Index to bubble up from */
    _bubbleUp(i) {
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (this._compare(this._heap[i], this._heap[parent]) < 0) {
          [this._heap[i], this._heap[parent]] = [this._heap[parent], this._heap[i]]
          i = parent
        } else break
      }
    }

    /** @param {number} i - Index to sink down from */
    _sinkDown(i) {
      const n = this._heap.length
      while (true) {
        let smallest = i
        const l = 2 * i + 1, r = 2 * i + 2
        if (l < n && this._compare(this._heap[l], this._heap[smallest]) < 0) smallest = l
        if (r < n && this._compare(this._heap[r], this._heap[smallest]) < 0) smallest = r
        if (smallest === i) break;
        [this._heap[i], this._heap[smallest]] = [this._heap[smallest], this._heap[i]]
        i = smallest
      }
    }

    // Lower priority number = higher urgency; break ties by earlier timestamp
    _compare(a, b) {
      if (a.priority !== b.priority) return a.priority - b.priority
      return a.timestamp - b.timestamp
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════

  const PRIORITY = Object.freeze({
    CRITICAL: 0,
    HIGH:     1,
    MEDIUM:   2,
    LOW:      3,
  })

  // Keywords that bump priority — matched against headline + body
  const CRITICAL_PATTERNS = [
    /\bfed\s+(rate|cut|hike|decision|meeting|fomc)\b/i,
    /\bcircuit\s+breaker\b/i,
    /\bblack\s+swan\b/i,
    /\bflash\s+crash\b/i,
    /\bmarket\s+halt\b/i,
    /\bemergency\b/i,
    /\bwar\b/i,
    /\bdefault\b/i,
    /\brecession\s+(confirm|official|declare)/i,
    /\btariff\b/i,
  ]

  const HIGH_PATTERNS = [
    /\bearnings\s+(beat|miss|surprise|shock)\b/i,
    /\bguidance\s+(raise|lower|cut|slash)\b/i,
    /\b(upgrade|downgrade)\b.*\b(buy|sell|hold|outperform|underperform)\b/i,
    /\bcpi\b|\binflation\b|\bjobs\s+report\b|\bnonfarm\b|\bgdp\b/i,
    /\bipo\b|\bmerger\b|\bacquisition\b|\bbuyout\b/i,
    /\bsec\s+(investig|charg|sue|fine)\b/i,
    /\blayoff\b|\brestructur\b/i,
    /\boptions?\s+(flow|sweep|unusual)\b/i,
  ]

  const MEDIUM_PATTERNS = [
    /\banalyst\b.*\b(target|price|rating)\b/i,
    /\binsider\s+(buy|sell|trading)\b/i,
    /\bshort\s+interest\b/i,
    /\bdividend\b/i,
    /\bstock\s+split\b/i,
    /\bsector\s+rotation\b/i,
  ]

  // Assets we care about — match against our registry
  const TRACKED_SYMBOLS = new Set()

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  const _queue = new PriorityQueue()
  let _eventSource = null       // SSE connection
  let _pollInterval = null      // Fallback polling timer
  let _subscribers = []         // Callbacks notified on new items
  let _running = false
  let _stats = { ingested: 0, processed: 0, dropped: 0 }
  let _log = () => {}
  let _dedupeSet = new Set()    // Track recent headline hashes to avoid duplicates
  const MAX_DEDUPE = 500

  // ═══════════════════════════════════════════════════════════════
  // CLASSIFICATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Classify the priority of a news item by matching headline + body text
   * against keyword patterns for each priority tier.
   *
   * @param {string} headline - News headline
   * @param {string} [body=''] - Optional article body text
   * @returns {number} Priority level: 0 (CRITICAL), 1 (HIGH), 2 (MEDIUM), or 3 (LOW)
   */
  function classifyPriority(headline, body = '') {
    const text = `${headline} ${body}`
    if (CRITICAL_PATTERNS.some(p => p.test(text))) return PRIORITY.CRITICAL
    if (HIGH_PATTERNS.some(p => p.test(text)))     return PRIORITY.HIGH
    if (MEDIUM_PATTERNS.some(p => p.test(text)))   return PRIORITY.MEDIUM
    return PRIORITY.LOW
  }

  /**
   * Extract tracked ticker symbols mentioned in the headline and body.
   * Uses whole-word matching to avoid false positives (e.g., "IT" inside "it").
   *
   * @param {string} headline - News headline
   * @param {string} [body=''] - Optional article body text
   * @returns {string[]} Array of matched ticker symbols (uppercase)
   */
  function extractSymbols(headline, body = '') {
    const text = `${headline} ${body}`.toUpperCase()
    const found = []
    for (const sym of TRACKED_SYMBOLS) {
      // Match whole word to avoid false positives (e.g., "IT" matching in "it")
      const re = new RegExp(`\\b${sym}\\b`)
      if (re.test(text)) found.push(sym)
    }
    return found
  }

  /**
   * Generate a fast 32-bit hash of a headline string for deduplication.
   * Uses the djb2-like hash algorithm (shift-and-subtract variant).
   *
   * @param {string} s - Headline string to hash
   * @returns {number} 32-bit integer hash
   */
  function hashHeadline(s) {
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0
    }
    return h
  }

  // ═══════════════════════════════════════════════════════════════
  // INGESTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Ingest a single news item into the priority queue.
   * Performs deduplication, priority classification, symbol extraction,
   * and notifies subscribers immediately for CRITICAL items.
   *
   * @param {Object} item - Raw news item
   * @param {string} item.headline - News headline (required)
   * @param {string} [item.body] - Full article body
   * @param {string} [item.source] - Source identifier
   * @param {number} [item.timestamp] - Unix timestamp (defaults to now)
   * @param {string[]} [item.symbols] - Pre-extracted ticker symbols
   * @param {number} [item.priority] - Pre-classified priority (skips auto-classification)
   * @returns {Object|null} The enriched news item added to the queue, or null if duplicate/empty
   */
  function ingest(item) {
    const headline = item.headline || ''
    if (!headline) return null

    // Dedup
    const h = hashHeadline(headline)
    if (_dedupeSet.has(h)) { _stats.dropped++; return null }
    _dedupeSet.add(h)
    if (_dedupeSet.size > MAX_DEDUPE) {
      // Evict oldest entries by recreating from last half
      const arr = [..._dedupeSet]
      _dedupeSet = new Set(arr.slice(arr.length >> 1))
    }

    const priority = item.priority ?? classifyPriority(headline, item.body || '')
    const symbols = item.symbols || extractSymbols(headline, item.body || '')
    const timestamp = item.timestamp || Date.now()

    const newsItem = {
      id: `${timestamp}-${h}`,
      headline,
      body: item.body || '',
      source: item.source || 'unknown',
      symbols,
      priority,
      timestamp,
      receivedAt: Date.now(),
    }

    _queue.enqueue(newsItem)
    _stats.ingested++

    const priorityLabel = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'][priority] || 'LOW'
    _log('INGEST', `[${priorityLabel}] ${headline.slice(0, 80)}`, priority === 0 ? 'error' : priority === 1 ? 'yellow-500' : 'on-surface-variant')

    // Notify subscribers immediately for CRITICAL items
    if (priority === PRIORITY.CRITICAL) {
      _notifySubscribers()
    }

    return newsItem
  }

  /**
   * Batch-ingest multiple news items from an API response.
   * Notifies subscribers once after all items are processed.
   *
   * @param {Object[]} items - Array of raw news items (same shape as ingest() input)
   * @returns {Object[]} Array of successfully ingested news items (excludes duplicates)
   */
  function ingestBatch(items) {
    const results = []
    for (const item of items) {
      const r = ingest(item)
      if (r) results.push(r)
    }
    if (results.length > 0) _notifySubscribers()
    return results
  }

  // ═══════════════════════════════════════════════════════════════
  // SSE STREAMING (primary)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Establish an SSE (Server-Sent Events) connection to the backend news stream.
   * On connection loss, automatically falls back to polling mode.
   * Incoming messages are expected as JSON: either a single item or an array of items.
   */
  function connectSSE() {
    if (_eventSource) _eventSource.close()

    try {
      _eventSource = new EventSource('/api/news/stream')

      _eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (Array.isArray(data)) {
            // Validate each item is a non-null object before ingesting
            const validItems = data.filter(item => item && typeof item === 'object' && typeof item.headline === 'string')
            if (validItems.length > 0) ingestBatch(validItems)
          } else if (data && typeof data === 'object' && typeof data.headline === 'string') {
            ingest(data)
          } else {
            _log('INGEST', 'SSE message missing required "headline" field. Skipping.', 'yellow-500')
          }
        } catch (e) {
          _log('INGEST', `SSE parse error: ${e.message}`, 'error')
        }
      }

      _eventSource.onerror = () => {
        _log('INGEST', 'SSE connection lost. Falling back to polling.', 'yellow-500')
        _eventSource.close()
        _eventSource = null
        // Fall back to polling
        if (!_pollInterval) startPolling()
      }

      _log('INGEST', 'SSE stream connected.', 'secondary')
    } catch (e) {
      _log('INGEST', `SSE unavailable: ${e.message}. Using polling.`, 'yellow-500')
      startPolling()
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // POLLING (fallback)
  // ═══════════════════════════════════════════════════════════════

  let _lastPollTs = 0

  /**
   * Poll the backend for new news items since the last poll timestamp.
   * Failures are silently ignored since polling is a fallback mechanism.
   * @returns {Promise<void>}
   */
  async function poll() {
    try {
      const resp = await fetch(`/api/news/poll?since=${_lastPollTs}`)
      if (!resp.ok) return
      const data = await resp.json()
      if (data.items && data.items.length > 0) {
        ingestBatch(data.items)
        _lastPollTs = Date.now()
      }
    } catch {
      // Silent — polling failures are expected when backend is down
    }
  }

  /**
   * Start the fallback polling timer. Triggers an immediate first poll.
   * @param {number} [intervalMs=30000] - Polling interval in milliseconds
   */
  function startPolling(intervalMs = 30000) {
    if (_pollInterval) clearInterval(_pollInterval)
    _pollInterval = setInterval(poll, intervalMs)
    poll() // Immediate first poll
  }

  /** Stop the fallback polling timer. */
  function stopPolling() {
    if (_pollInterval) clearInterval(_pollInterval)
    _pollInterval = null
  }

  // ═══════════════════════════════════════════════════════════════
  // SUBSCRIBER NOTIFICATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Notify all registered subscribers with the current queue reference.
   * Subscriber errors are silently caught to prevent crashing the ingest pipeline.
   */
  function _notifySubscribers() {
    for (const cb of _subscribers) {
      try { cb(_queue) } catch (e) { /* subscriber error shouldn't crash ingest */ }
    }
  }

  /**
   * Register a callback to be notified when new items enter the queue.
   * @param {Function} callback - Called with the PriorityQueue instance
   * @returns {Function} Unsubscribe function — call to remove the callback
   */
  function subscribe(callback) {
    _subscribers.push(callback)
    return () => {
      _subscribers = _subscribers.filter(cb => cb !== callback)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start the news ingestion pipeline.
   * Populates tracked symbols from the asset registry and connects via SSE.
   *
   * @param {Object} [opts={}] - Configuration options
   * @param {Function} [opts.log] - Logging callback with signature (label, message, color)
   */
  function start(opts = {}) {
    if (_running) return
    _running = true
    _log = opts.log || (() => {})

    // Populate tracked symbols from asset registry
    const assets = window.xLeverAssets
    if (assets && assets.ASSETS) {
      for (const a of assets.ASSETS) {
        TRACKED_SYMBOLS.add(a.sym)
        TRACKED_SYMBOLS.add(a.name.split(' ')[0].toUpperCase()) // First word of name
      }
    }

    _log('INGEST', `News pipeline started. Tracking ${TRACKED_SYMBOLS.size} symbols.`, 'primary')

    // Try SSE first, poll as fallback
    connectSSE()
  }

  /** Stop the news ingestion pipeline — closes SSE and polling connections. */
  function stop() {
    _running = false
    if (_eventSource) { _eventSource.close(); _eventSource = null }
    stopPolling()
    _log('INGEST', 'News pipeline stopped.', 'error')
  }

  return Object.freeze({
    // Lifecycle
    start,
    stop,

    // Manual ingestion
    ingest,
    ingestBatch,

    // Queue access
    get queue() { return _queue },
    drain(max) { return _queue.drain(max) },
    get queueSize() { return _queue.size },
    peek() { return _queue.peek() },

    // Classification utilities
    classifyPriority,
    extractSymbols,
    PRIORITY,

    // Subscriptions
    subscribe,

    // Stats
    get stats() { return { ..._stats } },
    get isRunning() { return _running },
  })
})()

window.NewsIngest = NewsIngest
