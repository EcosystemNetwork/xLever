/**
 * xLever OpenBB Intelligence Client
 * ──────────────────────────────────
 * Fetches market intelligence from the OpenBB backend for:
 *  - Dashboard context (quotes for tracked assets)
 *  - Historical data (alternative to Yahoo-only path)
 *  - Options chains (volatility/skew context)
 *  - Market snapshots (broad market overview)
 *
 * All endpoints go through the Vite proxy → FastAPI → OpenBB SDK.
 */

// Base path for OpenBB API routes — the Vite dev server proxies /api/openbb to the FastAPI backend, avoiding CORS issues
const API_BASE = '/api/openbb'

// ═══════════════════════════════════════════════════════════════
// CORE FETCHER
// ═══════════════════════════════════════════════════════════════

let _unavailableUntil = 0 // Backoff timestamp — stops hammering a down backend

/**
 * Centralized fetch wrapper for all OpenBB API calls.
 * Routes through here to ensure consistent error handling, URL construction,
 * and automatic backoff when the backend is unreachable (5-minute cooldown
 * after 502/503/504 or network errors).
 *
 * @param {string} path — API path relative to API_BASE (e.g., '/quote/QQQ')
 * @param {Object} [params={}] — Query parameters (null/undefined values are skipped)
 * @returns {Promise<Object|null>} Parsed JSON response, or null if backend is unavailable
 * @throws {Error} If the response is non-2xx and not a 502-504 gateway error
 */
async function fetchOBB(path, params = {}) {
  if (Date.now() < _unavailableUntil) return null
  // Build full URL from relative path — using window.location.origin ensures it works across dev/staging/production environments
  const url = new URL(API_BASE + path, window.location.origin)
  // Append only defined params to the query string — skipping null/undefined prevents sending "?key=undefined" to the backend
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v)
  }
  // Execute the HTTP request — goes through Vite proxy in dev, Vercel rewrite in production
  let resp
  try {
    resp = await fetch(url)
  } catch (e) {
    // Network error (backend unreachable) — back off and return null so callers degrade gracefully
    _unavailableUntil = Date.now() + 5 * 60_000
    return null
  }
  // Throw on non-2xx responses with the response body for debugging — OpenBB errors often include useful detail in the body
  if (!resp.ok) {
    // Attempt to read error body for diagnostic context; gracefully handle cases where body is unreadable
    const body = await resp.text().catch(() => '')
    // Back off on 503 (backend down) or 502/504 (proxy errors) to avoid hammering
    if (resp.status >= 502 && resp.status <= 504) {
      _unavailableUntil = Date.now() + 5 * 60_000
      return null
    }
    // Include the path and status in the error so callers can identify which endpoint failed without a stack trace
    throw new Error(`OpenBB ${path}: ${resp.status} ${body}`)
  }
  // Parse and return JSON — all OpenBB endpoints return structured JSON with provider, data, and metadata fields
  return resp.json()
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Get real-time quote for a single symbol.
 * @param {string} symbol - e.g. "QQQ"
 * @returns {Promise<Object>} { symbol, provider, data: [{ ... }] }
 */
// Single-symbol quote — used by individual asset detail views and position cards to show current market price
export async function getQuote(symbol) {
  // Interpolate symbol into the URL path — the FastAPI backend routes /quote/<symbol> to the OpenBB equity quote endpoint
  return fetchOBB(`/quote/${symbol}`)
}

/**
 * Get real-time quotes for multiple symbols.
 * @param {string[]} symbols - e.g. ["QQQ", "SPY", "AAPL"]
 * @returns {Promise<Object>} { symbols, provider, data: [{ ... }] }
 */
// Batch quote fetcher — more efficient than N individual calls; used by the portfolio overview and ticker strip
export async function getQuotes(symbols) {
  // Join symbols with commas — the backend expects a single comma-separated string, not repeated params
  return fetchOBB('/quotes', { symbols: symbols.join(',') })
}

/**
 * Get historical OHLCV data via OpenBB.
 * @param {string} symbol
 * @param {Object} opts - { start_date?, end_date?, interval?, provider? }
 * @returns {Promise<Object>} { symbol, provider, count, data: [{ ... }] }
 */
// Historical OHLCV fetcher — powers the price chart and provides backtest data for the leverage calculator
export async function getHistorical(symbol, opts = {}) {
  // Pass optional params (date range, interval, provider) — allows callers to customize the query without hardcoding defaults
  return fetchOBB(`/historical/${symbol}`, opts)
}

/**
 * Get broad market snapshots (top movers, volume leaders).
 * @param {string} provider - default "fmp"
 * @returns {Promise<Object>} { provider, count, data: [{ ... }] }
 */
// Market snapshot — provides broad market context (movers, volume leaders) for the dashboard's market overview panel
export async function getMarketSnapshots(provider = 'fmp') {
  // Default to FMP (Financial Modeling Prep) provider — it offers the most comprehensive snapshot data among OpenBB's sources
  return fetchOBB('/snapshots', { provider })
}

/**
 * Get options chain for a symbol.
 * @param {string} symbol
 * @param {Object} opts - { provider?, expiration? }
 * @returns {Promise<Object>} { symbol, provider, count, data: [{ ... }] }
 */
// Options chain fetcher — provides implied volatility and skew data used by the risk dashboard to assess leverage risk
export async function getOptionsChain(symbol, opts = {}) {
  // Pass optional provider and expiration filters — lets the UI request specific expirations for the vol surface display
  return fetchOBB(`/options/${symbol}`, opts)
}

/**
 * Pre-built dashboard context: quotes for all tracked xLever assets.
 * @returns {Promise<Object>} { provider, assets, quotes: [{ ... }] }
 */
// Dashboard context aggregator — single call fetches quotes for all xLever-tracked assets, used on initial page load
export async function getDashboardContext() {
  // The backend knows which assets to fetch — avoids hardcoding the asset list in the frontend and keeps it server-authoritative
  return fetchOBB('/dashboard-context')
}

// ═══════════════════════════════════════════════════════════════
// EXPOSE GLOBALLY
// ═══════════════════════════════════════════════════════════════

// Attach all OpenBB functions to window so non-module scripts (ux.js, agent chat, dashboard widgets) can access them
window.xLeverOpenBB = {
  // Single quote — for inline asset price lookups in non-module code
  getQuote,
  // Batch quotes — for portfolio and watchlist views in non-module code
  getQuotes,
  // Historical OHLCV — for charting and backtesting in non-module code
  getHistorical,
  // Market snapshots — for the market overview widget in non-module code
  getMarketSnapshots,
  // Options chain — for volatility analysis in non-module code
  getOptionsChain,
  // Dashboard context — for the initial data load in non-module code
  getDashboardContext,
}
