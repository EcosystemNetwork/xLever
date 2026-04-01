/**
 * xLever Pyth Hermes Client
 * ──────────────────────────
 * Fetches price updates from Pyth Hermes (off-chain) for use in
 * on-chain pull-oracle transactions.
 *
 * Flow:  Hermes → priceUpdateData bytes → vault.deposit{value: fee}(...)
 */

// ═══════════════════════════════════════════════════════════════
// HERMES ENDPOINTS
// ═══════════════════════════════════════════════════════════════

const HERMES_BASE = 'https://hermes.pyth.network'

// ═══════════════════════════════════════════════════════════════
// PYTH FEED IDS — must match PythOracleAdapter.sol constants
// ═══════════════════════════════════════════════════════════════

export const PYTH_FEEDS = Object.freeze({
  'QQQ/USD':  '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d',
  'SPY/USD':  '0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5',
  'AAPL/USD': '0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
  'NVDA/USD': '0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
  'TSLA/USD': '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
  'ETH/USD':  '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
})

// Reverse lookup: feedId → symbol
const FEED_SYMBOLS = Object.fromEntries(
  Object.entries(PYTH_FEEDS).map(([sym, id]) => [id, sym])
)

// Pyth contract on Ink Sepolia
export const PYTH_CONTRACT = '0x2880aB155794e7179c9eE2e38200202908C17B43'

// ═══════════════════════════════════════════════════════════════
// HERMES API
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch latest price update data from Hermes for one or more feeds.
 * Returns the bytes[] that the vault contract expects as priceUpdateData.
 *
 * @param {string[]} feedIds — hex feed IDs (with 0x prefix)
 * @returns {Promise<{ updateData: string[], prices: Object[] }>}
 *   updateData: array of hex-encoded bytes to pass to the contract
 *   prices:     parsed price objects for UI display
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

  // The binary data is in data.binary.data — an array of hex-encoded VAA bytes
  const updateData = data.binary.data.map(hex => '0x' + hex)

  // Parse human-readable prices for UI
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
 * Fetch the latest price for a single feed (convenience wrapper).
 * @param {string} feedId — hex feed ID
 * @returns {Promise<{ updateData: string[], price: number, conf: number, publishTime: number }>}
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
 * Fetch prices for all registered xLever feeds at once.
 * Useful for the risk dashboard and trading terminal ticker strip.
 * @returns {Promise<{ updateData: string[], prices: Object[] }>}
 */
export async function getAllPrices() {
  return getLatestPriceUpdate(Object.values(PYTH_FEEDS))
}

/**
 * Compute oracle staleness from a Pyth publishTime.
 * @param {number} publishTime — unix epoch seconds
 * @returns {number} age in seconds
 */
export function oracleAge(publishTime) {
  return Math.floor(Date.now() / 1000) - publishTime
}

/**
 * Check if two prices diverge beyond a threshold.
 * @param {number} priceA
 * @param {number} priceB
 * @returns {number} absolute divergence as a fraction (0.01 = 1%)
 */
export function priceDivergence(priceA, priceB) {
  if (!priceA || !priceB) return 0
  return Math.abs(priceA - priceB) / Math.max(priceA, priceB)
}

// ═══════════════════════════════════════════════════════════════
// EXPOSE GLOBALLY
// ═══════════════════════════════════════════════════════════════

window.xLeverPyth = {
  PYTH_FEEDS,
  PYTH_CONTRACT,
  getLatestPriceUpdate,
  getPriceForFeed,
  getAllPrices,
  oracleAge,
  priceDivergence,
}
