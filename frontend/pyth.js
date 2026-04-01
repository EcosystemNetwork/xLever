/**
 * xLever Pyth Hermes Client
 * ──────────────────────────
 * Fetches price updates from Pyth Hermes (off-chain) for use in
 * on-chain pull-oracle transactions.
 *
 * Flow:  Hermes → priceUpdateData bytes → vault.deposit{value: fee}(...)
 */
import { PYTH_FEEDS, FEED_SYMBOLS } from './assets.js'

const HERMES_BASE = 'https://hermes.pyth.network'

// Re-export from registry so existing imports keep working
export { PYTH_FEEDS }

export const PYTH_CONTRACT = '0x2880aB155794e7179c9eE2e38200202908C17B43'

// ═══════════════════════════════════════════════════════════════
// HERMES API
// ═════════════════════════════════════════════════════════���═════

/**
 * Fetch latest price update data from Hermes for one or more feeds.
 * @param {string[]} feedIds — hex feed IDs (with 0x prefix)
 * @returns {Promise<{ updateData: string[], prices: Object[] }>}
 */
export async function getLatestPriceUpdate(feedIds) {
  const params = new URLSearchParams()
  for (const id of feedIds) {
    params.append('ids[]', id.replace(/^0x/, ''))
  }
  params.set('encoding', 'hex')

  const resp = await fetch(`${HERMES_BASE}/v2/updates/price/latest?${params}`)
  if (!resp.ok) throw new Error(`Hermes error: ${resp.status} ${resp.statusText}`)

  const data = await resp.json()
  const updateData = data.binary.data.map(hex => '0x' + hex)

  const prices = (data.parsed || []).map(p => ({
    feedId: '0x' + p.id,
    symbol: FEED_SYMBOLS['0x' + p.id] || p.id,
    price: Number(p.price.price) * Math.pow(10, p.price.expo),
    conf: Number(p.price.conf) * Math.pow(10, p.price.expo),
    publishTime: p.price.publish_time,
    publishTimeISO: new Date(p.price.publish_time * 1000).toISOString(),
  }))

  return { updateData, prices }
}

/**
 * Fetch the latest price for a single feed.
 * @param {string} feedId — hex feed ID
 */
export async function getPriceForFeed(feedId) {
  const { updateData, prices } = await getLatestPriceUpdate([feedId])
  const p = prices.find(x => x.feedId === feedId) || prices[0]
  return {
    updateData,
    price: p?.price ?? 0,
    conf: p?.conf ?? 0,
    publishTime: p?.publishTime ?? 0,
    publishTimeISO: p?.publishTimeISO ?? '',
    symbol: p?.symbol ?? '',
  }
}

/**
 * Fetch prices for all registered feeds at once.
 */
export async function getAllPrices() {
  return getLatestPriceUpdate(Object.values(PYTH_FEEDS))
}

export function oracleAge(publishTime) {
  return Math.floor(Date.now() / 1000) - publishTime
}

export function priceDivergence(priceA, priceB) {
  if (!priceA || !priceB) return 0
  return Math.abs(priceA - priceB) / Math.max(priceA, priceB)
}

// Expose globally for non-module scripts
window.xLeverPyth = {
  PYTH_FEEDS, PYTH_CONTRACT,
  getLatestPriceUpdate, getPriceForFeed, getAllPrices,
  oracleAge, priceDivergence,
}
