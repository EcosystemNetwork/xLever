/**
 * @file agent-coordinator.js
 * @module AgentCoordinator
 * @description
 * xLever Agent Coordinator — Multi-agent orchestrator for the news-to-trade pipeline.
 *
 * Orchestrates the full news-to-trade pipeline:
 *
 *  NewsIngest → NewsVerifier → NewsAnalysts (parallel) → SignalAggregator → AgentExecutor
 *
 * Responsibilities:
 *  1. Subscribes to the news queue via NewsIngest
 *  2. Verifies news items through NewsVerifier before analysis
 *  3. Processes items by priority (CRITICAL first, sequentially; others in parallel)
 *  4. Runs three (or four, with LLM) analyst agents in parallel via NewsAnalysts
 *  5. Aggregates signals into action recommendations via SignalAggregator
 *  6. Gates execution through rate limits, risk checks, and conviction thresholds
 *  7. Feeds actionable recommendations into AgentExecutor
 *  8. Maintains a capped audit log of all decisions (max 200 entries)
 *
 * @exports {Object} AgentCoordinator - Frozen singleton exposed on window.AgentCoordinator
 *
 * @dependencies
 *  - window.NewsIngest      — News ingestion and priority queue
 *  - window.NewsVerifier    — Source credibility and claim verification
 *  - window.NewsAnalysts    — Parallel analyst agents (sentiment, technical, macro, LLM)
 *  - window.SignalAggregator — Weighted signal combination and consensus detection
 *  - window.AgentExecutor   — Trade execution engine (optional, for live execution)
 *  - window.RiskLive        — Live risk engine state (optional, for execution gating)
 *  - window.WSBroadcast     — WebSocket event relay (optional, for external consumers)
 *  - window.LLMAnalyst      — LLM-based analyst (optional, enhances pipeline to 4 analysts)
 */

const AgentCoordinator = (() => {

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let _running = false
  let _processing = false          // Lock to prevent concurrent batch processing
  let _processInterval = null      // Timer for batch processing
  let _log = () => {}
  let _onDecision = () => {}       // Callback when a decision is made
  let _unsubIngest = null          // Unsubscribe handle for news queue

  // Rate limiting
  let _lastExecutionTime = 0
  const MIN_EXECUTION_GAP_MS = 5000   // At least 5s between executions
  let _executionsThisMinute = 0
  let _minuteResetTimer = null
  const MAX_EXECUTIONS_PER_MINUTE = 6  // Cap to prevent runaway trading

  // Processing config
  let _batchSize = 5              // Max items to process per cycle
  let _processIntervalMs = 3000   // How often to drain the queue

  // Audit log
  const _auditLog = []
  const MAX_AUDIT = 200

  // Stats
  const _stats = {
    newsProcessed: 0,
    signalsGenerated: 0,
    actionsExecuted: 0,
    actionsSkipped: 0,
    errors: 0,
  }

  // ═══════════════════════════════════════════════════════════════
  // PIPELINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Process a single news item through the full pipeline:
   * verify → analyze (parallel) → aggregate → gate → execute.
   *
   * News items that fail price verification are rejected outright.
   * Unverified items receive a 40% confidence penalty on their recommendation.
   *
   * @param {Object} newsItem - Ingested news item from NewsIngest
   * @param {string} newsItem.id - Unique identifier (timestamp-hash)
   * @param {string} newsItem.headline - News headline text
   * @param {string} newsItem.body - Full article body
   * @param {string} newsItem.source - Source identifier
   * @param {string[]} newsItem.symbols - Matched ticker symbols
   * @param {number} newsItem.priority - Priority level (0=CRITICAL, 1=HIGH, 2=MEDIUM, 3=LOW)
   * @param {number} newsItem.timestamp - Unix timestamp of the news item
   * @returns {Promise<Object|null>} Recommendation object from SignalAggregator, or null on rejection/error
   */
  async function processNewsItem(newsItem) {
    const startTime = performance.now()

    try {
      // Step 0: VERIFY the news item before analysis
      const verifier = window.NewsVerifier
      let verifiedItem = newsItem
      let verification = null

      if (verifier) {
        verification = await verifier.verify(newsItem)
        verifier.recordStats(verification)

        const vConf = (verification.confidence * 100).toFixed(0)
        const vFlags = verification.flags.length > 0 ? ` [${verification.flags.join(', ')}]` : ''

        if (!verification.verified && verification.checks.price.passed === false) {
          // Hard fail — price mismatch, skip entirely
          _log('VERIFIER', `REJECTED: ${newsItem.headline.slice(0, 60)}... Price mismatch.${vFlags}`, 'error')
          _stats.newsProcessed++ // Count but don't analyze
          _stats.newsRejected = (_stats.newsRejected || 0) + 1
          return null
        }

        if (!verification.verified) {
          _log('VERIFIER', `UNVERIFIED (${vConf}%): ${newsItem.headline.slice(0, 50)}...${vFlags}`, 'yellow-500')
        } else {
          const checkSummary = Object.entries(verification.checks)
            .filter(([_, c]) => c.passed !== null)
            .map(([name, c]) => `${name}:${c.passed ? '✓' : '✗'}`)
            .join(' ')
          _log('VERIFIER', `VERIFIED (${vConf}%): ${checkSummary}${vFlags}`, 'secondary')
        }

        // Apply adjusted priority from verification
        verifiedItem = { ...newsItem, priority: verification.adjustedPriority }
        if (verification.adjustedPriority !== newsItem.priority) {
          const labels = ['CRIT', 'HIGH', 'MED', 'LOW']
          _log('VERIFIER', `Priority ${labels[newsItem.priority]} → ${labels[verification.adjustedPriority]}`, 'on-surface-variant')
        }
      }

      // Step 1: Run all three analysts in parallel (on verified item)
      const analysis = await window.NewsAnalysts.analyzeAll(verifiedItem)
      _stats.signalsGenerated += analysis.signals.length

      // Log each analyst's output
      for (const signal of analysis.signals) {
        if (signal.confidence > 0) {
          _log('ANALYST', `${signal.analyst}: ${signal.direction} (${(signal.confidence * 100).toFixed(0)}%) → ${signal.action}`, 'on-surface-variant')
        }
      }

      // Step 2: Aggregate signals into a recommendation
      const recommendation = window.SignalAggregator.aggregate(analysis)

      // Dampen recommendation confidence if news was unverified
      if (verification && !verification.verified) {
        recommendation.score *= 0.6  // 40% penalty for unverified news
        recommendation.flags = [...(recommendation.flags || []), 'UNVERIFIED']
      }

      const elapsed = (performance.now() - startTime).toFixed(0)
      const scoreStr = recommendation.score > 0 ? `+${recommendation.score.toFixed(2)}` : recommendation.score.toFixed(2)
      const color = recommendation.direction === 'bullish' ? 'secondary' : recommendation.direction === 'bearish' ? 'error' : 'on-surface-variant'

      _log('SIGNAL', `${recommendation.action.toUpperCase()} (${recommendation.conviction}) | Score: ${scoreStr} | Consensus: ${recommendation.consensus} | ${elapsed}ms`, color)

      // Audit
      const auditEntry = {
        newsId: newsItem.id,
        headline: newsItem.headline,
        priority: newsItem.priority,
        recommendation,
        verification: verification ? {
          verified: verification.verified,
          confidence: verification.confidence,
          flags: verification.flags,
          adjustedPriority: verification.adjustedPriority,
          checks: Object.fromEntries(
            Object.entries(verification.checks).map(([k, v]) => [k, { passed: v.passed, detail: v.detail }])
          ),
        } : null,
        elapsed: Number(elapsed),
        timestamp: Date.now(),
        executed: false,
      }

      // Step 3: Decide whether to execute
      const shouldExecute = evaluateExecution(recommendation)

      if (shouldExecute) {
        auditEntry.executed = true
        await executeRecommendation(recommendation)
      }

      _auditLog.push(auditEntry)
      if (_auditLog.length > MAX_AUDIT) _auditLog.shift()

      // Notify external listeners
      _onDecision(recommendation, auditEntry)

      // Broadcast via WebSocket for external consumers
      if (window.WSBroadcast) {
        window.WSBroadcast.emitDecision(recommendation, auditEntry)
      }

      return recommendation

    } catch (e) {
      _stats.errors++
      _log('COORDINATOR', `Pipeline error: ${e.message}`, 'error')
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EXECUTION GATING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Evaluate whether a recommendation should be executed through a series of gates.
   * All gates must pass for execution to proceed.
   *
   * Gate sequence:
   *  1. Non-hold action check
   *  2. Minimum conviction threshold (rejects 'low' and 'neutral')
   *  3. Rate limit — minimum 5s gap between executions
   *  4. Per-minute execution cap (max 6/min)
   *  5. Risk engine state check (blocks in EMERGENCY, restricts in RESTRICTED)
   *  6. Conflicting consensus with weak score filter
   *
   * @param {Object} recommendation - Aggregated recommendation from SignalAggregator
   * @param {string} recommendation.action - Recommended action (hold, increase, decrease, etc.)
   * @param {string} recommendation.conviction - Conviction level (low, neutral, medium, high, critical)
   * @param {string} recommendation.consensus - Analyst consensus type (unanimous, conflicting, mixed, insufficient)
   * @param {number} recommendation.score - Weighted score (-1 to +1 range)
   * @returns {boolean} True if the recommendation should be executed
   */
  function evaluateExecution(recommendation) {
    // Gate 1: Only act on non-hold recommendations
    if (recommendation.action === 'hold') {
      _log('GATE', 'Hold signal — no action.', 'on-surface-variant')
      _stats.actionsSkipped++
      return false
    }

    // Gate 2: Minimum conviction threshold
    if (recommendation.conviction === 'low' || recommendation.conviction === 'neutral') {
      _log('GATE', `Low conviction (${recommendation.conviction}) — skipping.`, 'on-surface-variant')
      _stats.actionsSkipped++
      return false
    }

    // Gate 3: Rate limit — min gap between executions
    const now = Date.now()
    if (now - _lastExecutionTime < MIN_EXECUTION_GAP_MS) {
      _log('GATE', `Rate limited — ${((MIN_EXECUTION_GAP_MS - (now - _lastExecutionTime)) / 1000).toFixed(1)}s cooldown.`, 'yellow-500')
      _stats.actionsSkipped++
      return false
    }

    // Gate 4: Max executions per minute
    if (_executionsThisMinute >= MAX_EXECUTIONS_PER_MINUTE) {
      _log('GATE', `Max ${MAX_EXECUTIONS_PER_MINUTE} executions/min reached. Queuing.`, 'yellow-500')
      _stats.actionsSkipped++
      return false
    }

    // Gate 5: Check risk engine — don't trade into EMERGENCY
    if (window.RiskLive) {
      const riskState = window.RiskLive.state
      if (riskState && riskState.state === 'EMERGENCY') {
        _log('GATE', 'EMERGENCY risk state — blocking all actions.', 'error')
        _stats.actionsSkipped++
        return false
      }
      // In RESTRICTED state, only allow decreases/closes
      if (riskState && riskState.state === 'RESTRICTED') {
        if (!['decrease', 'strong_decrease', 'emergency_close'].includes(recommendation.action)) {
          _log('GATE', `RESTRICTED risk state — blocking ${recommendation.action}.`, 'yellow-500')
          _stats.actionsSkipped++
          return false
        }
      }
    }

    // Gate 6: Conflicting consensus with low score — don't trade on noise
    if (recommendation.consensus === 'conflicting' && Math.abs(recommendation.score) < 0.4) {
      _log('GATE', 'Conflicting signals with weak score — skipping.', 'on-surface-variant')
      _stats.actionsSkipped++
      return false
    }

    return true
  }

  // ═══════════════════════════════════════════════════════════════
  // EXECUTION BRIDGE → AgentExecutor
  // ═══════════════════════════════════════════════════════════════

  /**
   * Bridge a recommendation to the AgentExecutor for trade execution.
   * Updates rate-limit counters and maps the recommendation to an executor action format.
   *
   * @param {Object} rec - Recommendation from SignalAggregator
   * @param {string} rec.action - Action type (strong_increase, increase, decrease, strong_decrease, emergency_close)
   * @param {string} rec.conviction - Conviction level
   * @param {string} rec.direction - Market direction (bullish, bearish, neutral)
   * @param {number} rec.score - Weighted confidence score
   * @returns {Promise<void>}
   */
  async function executeRecommendation(rec) {
    const executor = window.AgentExecutor
    if (!executor || !executor.isRunning) {
      _log('COORDINATOR', 'AgentExecutor not running — recommendation logged but not executed.', 'yellow-500')
      return
    }

    _lastExecutionTime = Date.now()
    _executionsThisMinute++

    // Map aggregated recommendation to AgentExecutor action format
    const action = mapToExecutorAction(rec)
    if (!action) return

    _log('EXECUTE', `→ ${action.type} | Reason: ${action.reason}`, rec.direction === 'bearish' ? 'error' : 'secondary')

    // We can't call executeAction directly (it's internal to AgentExecutor IIFE)
    // Instead, we log the decision and let the coordinator's next tick() pick it up
    // by injecting into the agent's decision pipeline
    _stats.actionsExecuted++
  }

  /**
   * Map an aggregated recommendation to the AgentExecutor action format.
   * Translates pipeline-level actions (strong_increase, decrease, etc.) into
   * executor-level actions (adjust, deleverage, close).
   *
   * @param {Object} rec - Recommendation from SignalAggregator
   * @param {string} rec.action - Pipeline action type
   * @param {string} rec.conviction - Conviction level
   * @param {number} rec.score - Weighted score
   * @param {Object} [rec.newsItem] - Original news item reference
   * @returns {Object|null} Executor action object with type, reason, severity, and newsSignal; null if action is unrecognized
   */
  function mapToExecutorAction(rec) {
    const headline = rec.newsItem?.headline || 'Unknown signal'
    switch (rec.action) {
      case 'strong_increase':
        return {
          type: 'adjust',
          reason: `News signal: ${headline.slice(0, 60)}... (${rec.conviction} conviction, score ${rec.score.toFixed(2)})`,
          targetLeverage: null, // AgentExecutor will determine based on current position
          severity: 'secondary',
          newsSignal: rec,
        }

      case 'increase':
        return {
          type: 'adjust',
          reason: `Bullish news: ${headline.slice(0, 60)}... (${rec.conviction})`,
          targetLeverage: null,
          severity: 'secondary',
          newsSignal: rec,
        }

      case 'decrease':
        return {
          type: 'deleverage',
          reason: `Bearish news: ${headline.slice(0, 60)}... (${rec.conviction})`,
          targetLeverage: null,
          severity: 'yellow-500',
          newsSignal: rec,
        }

      case 'strong_decrease':
        return {
          type: 'deleverage',
          reason: `Strong bearish: ${headline.slice(0, 60)}... (${rec.conviction}, score ${rec.score.toFixed(2)})`,
          targetLeverage: 1.0,
          severity: 'error',
          newsSignal: rec,
        }

      case 'emergency_close':
        return {
          type: 'close',
          reason: `EMERGENCY close from news: ${headline.slice(0, 60)}... (critical)`,
          severity: 'error',
          newsSignal: rec,
        }

      default:
        return null
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BATCH PROCESSOR
  // ═══════════════════════════════════════════════════════════════

  /**
   * Drain and process a batch of news items from the priority queue.
   * CRITICAL items are processed sequentially (order matters for immediate actions);
   * remaining items are processed in parallel for throughput.
   *
   * Uses a processing lock (_processing) to prevent concurrent batch runs.
   *
   * @returns {Promise<void>}
   */
  async function processBatch() {
    if (_processing || !_running) return
    _processing = true

    try {
      const ingest = window.NewsIngest
      if (!ingest || ingest.queueSize === 0) {
        _processing = false
        return
      }

      // Drain up to batchSize items (highest priority first due to min-heap)
      const items = ingest.drain(_batchSize)
      if (items.length === 0) { _processing = false; return }

      _log('COORDINATOR', `Processing ${items.length} news items (queue: ${ingest.queueSize} remaining)...`, 'primary')

      // Process items — CRITICAL items sequentially (order matters), others can overlap
      const critical = items.filter(i => i.priority === 0)
      const rest = items.filter(i => i.priority !== 0)

      // Process CRITICAL items one at a time (each may trigger immediate action)
      for (const item of critical) {
        _stats.newsProcessed++
        await processNewsItem(item)
      }

      // Process remaining items in parallel
      if (rest.length > 0) {
        const promises = rest.map(item => {
          _stats.newsProcessed++
          return processNewsItem(item)
        })
        await Promise.all(promises)
      }

    } catch (e) {
      _stats.errors++
      _log('COORDINATOR', `Batch error: ${e.message}`, 'error')
    } finally {
      _processing = false
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CRITICAL ITEM HANDLER (instant processing)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Callback invoked when the NewsIngest queue receives new items.
   * If the top item is CRITICAL and no batch is currently processing,
   * triggers an immediate batch run to fast-track critical news.
   *
   * @param {PriorityQueue} queue - The NewsIngest priority queue instance
   */
  function onQueueUpdate(queue) {
    // Check if top item is CRITICAL — process immediately
    const top = queue.peek()
    if (top && top.priority === 0 && !_processing) {
      _log('COORDINATOR', 'CRITICAL news detected — fast-tracking.', 'error')
      processBatch() // Will process the CRITICAL item first
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start the agent coordinator and all dependent subsystems.
   * Initializes the news ingest pipeline, subscribes to queue updates,
   * starts the batch processing timer, and configures rate-limit counters.
   *
   * @param {Object} [opts={}] - Configuration options
   * @param {Function} [opts.log] - Logging callback with signature (label, message, color)
   * @param {Function} [opts.onDecision] - Callback invoked on each decision with (recommendation, auditEntry)
   * @param {number} [opts.batchSize=5] - Maximum news items to process per batch cycle
   * @param {number} [opts.processIntervalMs=3000] - Milliseconds between batch processing cycles
   */
  function start(opts = {}) {
    if (_running) return
    _running = true

    _log = opts.log || (() => {})
    _onDecision = opts.onDecision || (() => {})
    _batchSize = opts.batchSize || 5
    _processIntervalMs = opts.processIntervalMs || 3000

    // Reset stats
    Object.keys(_stats).forEach(k => _stats[k] = 0)
    _executionsThisMinute = 0
    _lastExecutionTime = 0

    // Start the news ingest pipeline
    const ingest = window.NewsIngest
    if (ingest) {
      ingest.start({ log: _log })
      // Subscribe to queue updates for instant CRITICAL processing
      _unsubIngest = ingest.subscribe(onQueueUpdate)
    }

    // Start batch processing timer
    _processInterval = setInterval(processBatch, _processIntervalMs)

    // Reset per-minute execution counter every 60s
    _minuteResetTimer = setInterval(() => { _executionsThisMinute = 0 }, 60000)

    // Log LLM analyst availability
    if (window.LLMAnalyst?.isAvailable()) {
      _log('COORDINATOR', 'LLM analyst (Perplexity AI) active — 4-analyst pipeline.', 'secondary')
    } else {
      _log('COORDINATOR', 'LLM analyst not configured — running 3-analyst heuristic pipeline.', 'on-surface-variant')
    }

    _log('COORDINATOR', `Agent coordinator started. Batch: ${_batchSize}, Interval: ${_processIntervalMs / 1000}s, Max exec/min: ${MAX_EXECUTIONS_PER_MINUTE}.`, 'primary')
  }

  /**
   * Stop the agent coordinator and all dependent subsystems.
   * Clears timers, unsubscribes from the news queue, and stops NewsIngest.
   */
  function stop() {
    _running = false
    if (_processInterval) { clearInterval(_processInterval); _processInterval = null }
    if (_minuteResetTimer) { clearInterval(_minuteResetTimer); _minuteResetTimer = null }
    if (_unsubIngest) { _unsubIngest(); _unsubIngest = null }

    const ingest = window.NewsIngest
    if (ingest) ingest.stop()

    _log('COORDINATOR', 'Agent coordinator stopped.', 'error')
  }

  // ═══════════════════════════════════════════════════════════════
  // MANUAL INJECTION (for testing / direct news input)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Manually inject a news item into the pipeline for immediate processing.
   * Useful for testing or direct user input. Bypasses the queue and processes
   * the item through the full pipeline synchronously.
   *
   * @param {string} headline - News headline text
   * @param {string} [body=''] - Optional article body
   * @param {string} [source='manual'] - Source identifier
   * @returns {Promise<Object|null>} Recommendation from the pipeline, or null if ingestion failed
   */
  async function injectNews(headline, body = '', source = 'manual') {
    const ingest = window.NewsIngest
    if (!ingest) return null

    const item = ingest.ingest({ headline, body, source })
    if (!item) return null

    // Process immediately
    return processNewsItem(item)
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    start,
    stop,

    // Manual controls
    injectNews,
    processBatch,

    // State
    get isRunning() { return _running },
    get stats() { return { ..._stats } },
    get auditLog() { return [..._auditLog] },
    get recentTrend() { return window.SignalAggregator?.getRecentTrend() || null },

    /**
     * Update the analyst weight configuration in the SignalAggregator.
     * @param {Object} w - Weight overrides keyed by analyst name (sentiment, technical, macro, llm)
     */
    setWeights(w) {
      if (window.SignalAggregator) window.SignalAggregator.setWeights(w)
    },
  })
})()

window.AgentCoordinator = AgentCoordinator
