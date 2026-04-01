/**
 * @file news-verifier.js
 * @module NewsVerifier
 * @description
 * xLever News Verification Agent — Source credibility and claim verification.
 * Sits between NewsIngest and NewsAnalysts to verify claims before trading.
 *
 * Four verification layers (run in parallel):
 *  1. Price-verify    — Does the claimed % move match live Pyth/OpenBB data?
 *  2. Source-verify    — Is anyone else reporting this? (corroboration via backend poll)
 *  3. Calendar-verify  — Is this a scheduled event (Fed, CPI, earnings) on the right day?
 *  4. Staleness-check  — Is the news actually fresh or recycled/repackaged?
 *
 * Output: enriched verification result with composite confidence score,
 *         adjusted priority (can upgrade or downgrade), and warning flags.
 *
 * Scoring weights: price=0.35, source=0.25, calendar=0.15, staleness=0.25
 *
 * @exports {Object} NewsVerifier - Frozen singleton exposed on window.NewsVerifier
 *
 * @dependencies
 *  - window.xLeverPyth   — Pyth oracle for price verification
 *  - window.xLeverOpenBB — OpenBB for daily change comparison
 *  - window.xLeverAssets — Asset feed ID mapping
 *  - window.NewsIngest   — News pipeline for source corroboration buffer
 */

const NewsVerifier = (() => {

  // ═══════════════════════════════════════════════════════════════
  // VERIFICATION RESULT SCHEMA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a fresh verification result object with all checks in 'pending' state.
   *
   * @param {Object} newsItem - The news item being verified
   * @returns {Object} Verification result with checks map, confidence, flags, and adjustedPriority
   */
  function makeVerification(newsItem) {
    return {
      newsItem,
      checks: {
        price:    { status: 'pending', passed: null, detail: '', data: null },
        source:   { status: 'pending', passed: null, detail: '', data: null },
        calendar: { status: 'pending', passed: null, detail: '', data: null },
        staleness:{ status: 'pending', passed: null, detail: '', data: null },
      },
      verified: false,       // True if enough checks pass
      confidence: 0,         // 0..1 composite verification confidence
      adjustedPriority: newsItem.priority,  // May be downgraded if unverified
      flags: [],             // Warning flags for the analyst pipeline
      verifiedAt: null,
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. PRICE VERIFICATION
  // ═══════════════════════════════════════════════════════════════
  // Check if claimed price moves match reality

  // Patterns that claim a specific price move
  const PRICE_CLAIM_PATTERNS = [
    /(?:surge|soar|rally|jump|gain|rise|rose|climb)s?\s+(\d+\.?\d*)%/i,
    /(?:crash|plunge|plummet|drop|fall|fell|decline|tumble|sink|slide)s?\s+(\d+\.?\d*)%/i,
    /(?:up|down)\s+(\d+\.?\d*)%/i,
    /(\d+\.?\d*)%\s+(?:gain|loss|drop|rise|move|jump|decline)/i,
  ]

  const DIRECTION_BEARISH = /crash|plunge|plummet|drop|fall|fell|decline|tumble|sink|slide|down|loss/i

  async function verifyPrice(newsItem, check) {
    const text = `${newsItem.headline} ${newsItem.body}`
    const symbols = newsItem.symbols || []

    // Extract claimed move
    let claimedPct = null
    let claimedBearish = false
    for (const pattern of PRICE_CLAIM_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        claimedPct = parseFloat(match[1])
        claimedBearish = DIRECTION_BEARISH.test(text)
        if (claimedBearish) claimedPct = -claimedPct
        break
      }
    }

    if (claimedPct === null) {
      // No specific price claim — can't verify, pass it through
      check.status = 'skipped'
      check.passed = true
      check.detail = 'No specific price claim to verify.'
      return
    }

    // Get live data to compare against
    const targetSym = symbols[0] || 'QQQ'

    // Try Pyth first
    const pyth = window.xLeverPyth
    const assets = window.xLeverAssets
    if (pyth && assets) {
      const feedId = assets.ASSET_FEED_MAP[targetSym] || assets.ASSET_FEED_MAP['QQQ']
      if (feedId) {
        try {
          const p = await pyth.getPriceForFeed(feedId)
          check.data = { oraclePrice: p.price, oracleConf: p.conf, oracleAge: pyth.oracleAge(p.publishTime) }
        } catch { /* Oracle unavailable */ }
      }
    }

    // Try OpenBB for daily change
    const openbb = window.xLeverOpenBB
    let actualDailyChange = null
    if (openbb) {
      try {
        const ctx = await openbb.getDashboardContext()
        if (ctx && ctx.quotes) {
          const q = ctx.quotes.find(q => (q.symbol || '').toUpperCase() === targetSym)
          if (q) {
            actualDailyChange = q.regular_market_change_percent || q.change_percent || null
            check.data = { ...check.data, actualDailyChange, quote: q }
          }
        }
      } catch { /* OpenBB unavailable */ }
    }

    if (actualDailyChange !== null) {
      // Compare claimed vs actual
      const diff = Math.abs(claimedPct - actualDailyChange)
      const tolerance = Math.max(Math.abs(claimedPct) * 0.5, 1.0) // 50% tolerance or 1% minimum

      if (diff <= tolerance) {
        check.status = 'done'
        check.passed = true
        check.detail = `Claimed ${claimedPct > 0 ? '+' : ''}${claimedPct.toFixed(1)}% vs actual ${actualDailyChange > 0 ? '+' : ''}${actualDailyChange.toFixed(1)}% for ${targetSym}. Within tolerance.`
      } else {
        check.status = 'done'
        check.passed = false
        check.detail = `MISMATCH: Claimed ${claimedPct > 0 ? '+' : ''}${claimedPct.toFixed(1)}% but actual is ${actualDailyChange > 0 ? '+' : ''}${actualDailyChange.toFixed(1)}% for ${targetSym}. Diff: ${diff.toFixed(1)}%.`
      }
    } else if (check.data && check.data.oraclePrice) {
      // No daily change available but have oracle price — partial verification
      check.status = 'done'
      check.passed = true
      check.detail = `Oracle live at $${check.data.oraclePrice.toFixed(2)} (age: ${check.data.oracleAge}s). Cannot verify % claim without baseline.`
    } else {
      check.status = 'done'
      check.passed = null // Inconclusive
      check.detail = 'No market data available to verify price claim.'
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. SOURCE CORROBORATION
  // ═══════════════════════════════════════════════════════════════
  // Check if other sources are reporting the same story

  async function verifySource(newsItem, check) {
    // Check the news buffer for corroborating headlines
    const ingest = window.NewsIngest
    if (!ingest) {
      check.status = 'skipped'
      check.passed = null
      check.detail = 'NewsIngest not available.'
      return
    }

    // Also try the backend poll endpoint for broader source check
    let backendItems = []
    try {
      const since = Date.now() - 600000 // Last 10 minutes
      const resp = await fetch(`/api/news/poll?since=${since}`)
      if (resp.ok) {
        const data = await resp.json()
        backendItems = data.items || []
      }
    } catch { /* Backend unavailable */ }

    // Extract key terms from the headline for fuzzy matching
    const keyTerms = extractKeyTerms(newsItem.headline)
    if (keyTerms.length === 0) {
      check.status = 'done'
      check.passed = null
      check.detail = 'No key terms extracted for corroboration.'
      return
    }

    // Search for corroborating stories
    const corroborating = []
    for (const item of backendItems) {
      if (item.id === newsItem.id) continue // Skip self
      if (item.source === newsItem.source) continue // Same source doesn't count

      const otherTerms = extractKeyTerms(item.headline)
      const overlap = keyTerms.filter(t => otherTerms.includes(t)).length
      const overlapRatio = overlap / keyTerms.length

      if (overlapRatio >= 0.4) { // 40% term overlap = likely same story
        corroborating.push({
          headline: item.headline,
          source: item.source,
          overlap: overlapRatio,
          age: Date.now() - (item.timestamp || 0),
        })
      }
    }

    check.data = { keyTerms, corroborating, searchedCount: backendItems.length }

    if (corroborating.length >= 2) {
      check.status = 'done'
      check.passed = true
      check.detail = `Corroborated by ${corroborating.length} other sources: ${corroborating.map(c => c.source).join(', ')}.`
    } else if (corroborating.length === 1) {
      check.status = 'done'
      check.passed = true
      check.detail = `Partially corroborated by 1 source: ${corroborating[0].source}.`
    } else {
      check.status = 'done'
      check.passed = false
      check.detail = `No corroboration found across ${backendItems.length} recent items. Single-source report.`
    }
  }

  function extractKeyTerms(headline) {
    const stopWords = new Set([
      'the','a','an','is','are','was','were','be','been','being','have','has','had',
      'do','does','did','will','would','could','should','may','might','shall','can',
      'of','in','to','for','with','on','at','by','from','as','into','through','during',
      'after','before','above','below','between','and','but','or','nor','not','so','yet',
      'this','that','these','those','it','its','they','them','their','he','she','we',
      'says','said','report','reports','new','market','stock','stocks','shares','trading',
    ])
    return headline
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. CALENDAR VERIFICATION
  // ═══════════════════════════════════════════════════════════════
  // Check if claimed events match known economic calendar

  // Known recurring events and their typical schedule patterns
  const ECONOMIC_CALENDAR = {
    fomc: {
      patterns: [/\bfomc\b/i, /\bfed\s+(rate|decision|meeting|announce)/i],
      // FOMC meetings happen ~8 times per year, always on Wed
      verifyDay: () => new Date().getDay() === 3, // Wednesday
      description: 'FOMC decisions are announced on Wednesdays during scheduled meetings.',
    },
    cpi: {
      patterns: [/\bcpi\b/i, /\bconsumer\s+price/i, /\binflation\s+(data|report|reading)/i],
      // CPI released 2nd or 3rd week of each month, usually Tuesday or Wednesday
      verifyDay: () => {
        const d = new Date()
        const day = d.getDate()
        const dow = d.getDay()
        return day >= 10 && day <= 20 && (dow >= 2 && dow <= 4) // Tue-Thu, 10th-20th
      },
      description: 'CPI is released mid-month (10th-20th), typically Tuesday-Thursday.',
    },
    jobs: {
      patterns: [/\bjobs\s+report\b/i, /\bnonfarm\s+payroll/i, /\bunemployment\s+(rate|data|report)/i],
      // Jobs report: first Friday of each month
      verifyDay: () => {
        const d = new Date()
        return d.getDay() === 5 && d.getDate() <= 7 // First Friday
      },
      description: 'Jobs report released first Friday of each month.',
    },
    gdp: {
      patterns: [/\bgdp\s+(report|data|reading|growth|estimate)/i],
      // GDP released last week of month following quarter end
      verifyDay: () => {
        const d = new Date()
        return d.getDate() >= 25 // Last week
      },
      description: 'GDP released in the last week of the month following quarter end.',
    },
    earnings: {
      patterns: [/\bearnings\b/i, /\bquarterly\s+results/i, /\bq[1-4]\s+(report|results|earnings)/i],
      // Earnings season: mid-Jan, mid-Apr, mid-Jul, mid-Oct (roughly 4-6 weeks)
      verifyDay: () => {
        const month = new Date().getMonth()
        // Jan, Feb, Apr, May, Jul, Aug, Oct, Nov
        return [0, 1, 3, 4, 6, 7, 9, 10].includes(month)
      },
      description: 'Earnings season occurs ~4x/year starting mid-Jan/Apr/Jul/Oct.',
    },
  }

  // Also try to verify against a backend calendar endpoint
  async function verifyCalendar(newsItem, check) {
    const text = `${newsItem.headline} ${newsItem.body}`

    // Check against known event patterns
    let matchedEvent = null
    for (const [name, event] of Object.entries(ECONOMIC_CALENDAR)) {
      for (const pattern of event.patterns) {
        if (pattern.test(text)) {
          matchedEvent = { name, ...event }
          break
        }
      }
      if (matchedEvent) break
    }

    if (!matchedEvent) {
      check.status = 'skipped'
      check.passed = true
      check.detail = 'No calendar-dependent event detected.'
      return
    }

    // Try backend economic calendar first
    let backendVerified = null
    try {
      const resp = await fetch('/api/news/calendar')
      if (resp.ok) {
        const data = await resp.json()
        if (data.events) {
          const today = new Date().toISOString().slice(0, 10)
          const todayEvents = data.events.filter(e =>
            e.date === today && e.type === matchedEvent.name
          )
          if (todayEvents.length > 0) {
            backendVerified = true
            check.data = { matchedEvent: matchedEvent.name, calendarEvents: todayEvents }
          } else {
            backendVerified = false
            check.data = { matchedEvent: matchedEvent.name, calendarEvents: [], allEvents: data.events.slice(0, 5) }
          }
        }
      }
    } catch { /* Backend calendar unavailable — fall back to heuristic */ }

    if (backendVerified !== null) {
      check.status = 'done'
      check.passed = backendVerified
      check.detail = backendVerified
        ? `${matchedEvent.name.toUpperCase()} confirmed on today's economic calendar.`
        : `${matchedEvent.name.toUpperCase()} NOT found on today's calendar. ${matchedEvent.description}`
      return
    }

    // Fallback: heuristic day-of-week check
    const dayCheck = matchedEvent.verifyDay()
    check.status = 'done'
    check.passed = dayCheck
    check.data = { matchedEvent: matchedEvent.name, heuristicCheck: true }
    check.detail = dayCheck
      ? `${matchedEvent.name.toUpperCase()} plausible for today (heuristic). ${matchedEvent.description}`
      : `${matchedEvent.name.toUpperCase()} unlikely today (heuristic). ${matchedEvent.description}`
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. STALENESS CHECK
  // ═══════════════════════════════════════════════════════════════
  // Detect recycled/old news being repackaged as new

  function verifyStaleness(newsItem, check) {
    const now = Date.now()
    const itemAge = now - (newsItem.timestamp || now)
    const ageMinutes = itemAge / 60000

    // Check 1: Timestamp age
    if (ageMinutes > 60) {
      check.status = 'done'
      check.passed = false
      check.detail = `News is ${Math.round(ageMinutes)} minutes old. Likely stale/recycled.`
      check.data = { ageMinutes, reason: 'timestamp_old' }
      return
    }

    // Check 2: Past-tense language suggesting this already happened long ago
    const text = newsItem.headline.toLowerCase()
    const stalePhrases = [
      /\blast\s+(week|month|quarter|year)\b/,
      /\b(monday|tuesday|wednesday|thursday|friday)\b(?!\s+(will|expected|forecast))/,
      /\bpreviously\s+reported\b/,
      /\bas\s+reported\s+earlier\b/,
      /\brecap\b/,
      /\bin\s+review\b/,
    ]

    for (const pattern of stalePhrases) {
      if (pattern.test(text)) {
        check.status = 'done'
        check.passed = false
        check.detail = `Headline contains stale language: "${text.match(pattern)[0]}". Likely not breaking news.`
        check.data = { ageMinutes, reason: 'stale_language', match: text.match(pattern)[0] }
        return
      }
    }

    // Check 3: "Breaking" or "just in" markers suggest freshness
    const freshPhrases = /\b(breaking|just\s+in|alert|developing|happening\s+now|live)\b/i
    const isFreshTagged = freshPhrases.test(text)

    check.status = 'done'
    check.passed = true
    check.data = { ageMinutes, isFreshTagged }
    check.detail = ageMinutes < 5
      ? `Fresh (${Math.round(ageMinutes)}min old)${isFreshTagged ? ', tagged as breaking' : ''}.`
      : `Recent (${Math.round(ageMinutes)}min old). Acceptable freshness.`
  }

  // ═══════════════════════════════════════════════════════════════
  // COMPOSITE VERIFICATION
  // ═══════════════════════════════════════════════════════════════

  async function verify(newsItem) {
    const result = makeVerification(newsItem)
    const checks = result.checks

    // Run all four checks in parallel
    const [_p, _s, _c, _st] = await Promise.all([
      verifyPrice(newsItem, checks.price),
      verifySource(newsItem, checks.source),
      verifyCalendar(newsItem, checks.calendar),
      Promise.resolve(verifyStaleness(newsItem, checks.staleness)),
    ])

    // Score the verification
    const weights = { price: 0.35, source: 0.25, calendar: 0.15, staleness: 0.25 }
    let totalScore = 0
    let totalWeight = 0
    let failCount = 0
    let passCount = 0

    for (const [name, check] of Object.entries(checks)) {
      const w = weights[name] || 0.25
      if (check.passed === true) {
        totalScore += w
        passCount++
      } else if (check.passed === false) {
        failCount++
        // Price mismatch is a hard flag
        if (name === 'price') result.flags.push('PRICE_MISMATCH')
        if (name === 'source') result.flags.push('SINGLE_SOURCE')
        if (name === 'calendar') result.flags.push('CALENDAR_MISMATCH')
        if (name === 'staleness') result.flags.push('STALE_NEWS')
      } else {
        // Inconclusive — give partial credit
        totalScore += w * 0.5
      }
      totalWeight += w
    }

    result.confidence = totalWeight > 0 ? totalScore / totalWeight : 0

    // Determine overall verification status
    // Verified if confidence > 0.5 and no hard failures on price
    const hasPriceFail = checks.price.passed === false
    const hasStaleFail = checks.staleness.passed === false

    if (hasPriceFail) {
      // Price mismatch = strong downgrade regardless of other checks
      result.verified = false
      result.adjustedPriority = Math.min(newsItem.priority + 2, 3) // Downgrade by 2 levels, cap at LOW
      result.flags.push('UNVERIFIED_PRICE')
    } else if (hasStaleFail) {
      // Stale news = downgrade by 1
      result.verified = result.confidence > 0.4
      result.adjustedPriority = Math.min(newsItem.priority + 1, 3)
    } else if (result.confidence >= 0.5) {
      result.verified = true
      // Highly verified = potential upgrade
      if (result.confidence >= 0.8 && passCount >= 3) {
        result.adjustedPriority = Math.max(newsItem.priority - 1, 0) // Upgrade by 1
        result.flags.push('HIGH_CONFIDENCE')
      }
    } else {
      result.verified = false
      result.adjustedPriority = Math.min(newsItem.priority + 1, 3) // Downgrade by 1
    }

    result.verifiedAt = Date.now()
    return result
  }

  // ═══════════════════════════════════════════════════════════════
  // BATCH VERIFICATION
  // ═══════════════════════════════════════════════════════════════

  async function verifyBatch(newsItems) {
    return Promise.all(newsItems.map(item => verify(item)))
  }

  // ═══════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════

  const _stats = { verified: 0, failed: 0, downgraded: 0, upgraded: 0 }

  function recordStats(result) {
    if (result.verified) _stats.verified++
    else _stats.failed++
    if (result.adjustedPriority > result.newsItem.priority) _stats.downgraded++
    if (result.adjustedPriority < result.newsItem.priority) _stats.upgraded++
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  return Object.freeze({
    verify,
    verifyBatch,

    // Individual checks (for testing/debugging)
    verifyPrice:    (item) => { const c = { status:'pending', passed:null, detail:'', data:null }; return verifyPrice(item, c).then(() => c) },
    verifySource:   (item) => { const c = { status:'pending', passed:null, detail:'', data:null }; return verifySource(item, c).then(() => c) },
    verifyCalendar: (item) => { const c = { status:'pending', passed:null, detail:'', data:null }; return verifyCalendar(item, c).then(() => c) },
    verifyStaleness:(item) => { const c = { status:'pending', passed:null, detail:'', data:null }; verifyStaleness(item, c); return c },

    // Stats
    get stats() { return { ..._stats } },
    recordStats,
  })
})()

window.NewsVerifier = NewsVerifier
