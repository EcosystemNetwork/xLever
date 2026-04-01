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

const API_BASE = '/api/openbb'

// ═══════════════════════════════════════════════════════════════
// CORE FETCHER
// ═══════════════════════════════════════════════════════════════

async function fetchOBB(path, params = {}) {
  const url = new URL(API_BASE + path, window.location.origin)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v)
  }
  const resp = await fetch(url)
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`OpenBB ${path}: ${resp.status} ${body}`)
  }
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
export async function getQuote(symbol) {
  return fetchOBB(`/quote/${symbol}`)
}

/**
 * Get real-time quotes for multiple symbols.
 * @param {string[]} symbols - e.g. ["QQQ", "SPY", "AAPL"]
 * @returns {Promise<Object>} { symbols, provider, data: [{ ... }] }
 */
export async function getQuotes(symbols) {
  return fetchOBB('/quotes', { symbols: symbols.join(',') })
}

/**
 * Get historical OHLCV data via OpenBB.
 * @param {string} symbol
 * @param {Object} opts - { start_date?, end_date?, interval?, provider? }
 * @returns {Promise<Object>} { symbol, provider, count, data: [{ ... }] }
 */
export async function getHistorical(symbol, opts = {}) {
  return fetchOBB(`/historical/${symbol}`, opts)
}

/**
 * Get broad market snapshots (top movers, volume leaders).
 * @param {string} provider - default "fmp"
 * @returns {Promise<Object>} { provider, count, data: [{ ... }] }
 */
export async function getMarketSnapshots(provider = 'fmp') {
  return fetchOBB('/snapshots', { provider })
}

/**
 * Get options chain for a symbol.
 * @param {string} symbol
 * @param {Object} opts - { provider?, expiration? }
 * @returns {Promise<Object>} { symbol, provider, count, data: [{ ... }] }
 */
export async function getOptionsChain(symbol, opts = {}) {
  return fetchOBB(`/options/${symbol}`, opts)
}

/**
 * Pre-built dashboard context: quotes for all tracked xLever assets.
 * @returns {Promise<Object>} { provider, assets, quotes: [{ ... }] }
 */
export async function getDashboardContext() {
  return fetchOBB('/dashboard-context')
}

// ═══════════════════════════════════════════════════════════════
// EXPOSE GLOBALLY
// ═══════════════════════════════════════════════════════════════

window.xLeverOpenBB = {
  getQuote,
  getQuotes,
  getHistorical,
  getMarketSnapshots,
  getOptionsChain,
  getDashboardContext,
}
