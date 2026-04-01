/**
 * xLever Asset Registry
 * ─────────────────────
 * Single source of truth for every xStock asset supported by the platform.
 * All other modules (pyth.js, contracts.js, app.js, HTML) derive from this.
 *
 * To add a new asset: add one entry to ASSETS below. Everything else auto-wires.
 */

// ═══════════════════════════════════════════════════════════════
// ASSET REGISTRY
// ═══════════════════════════════════════════════════════════════

const ASSETS = Object.freeze([
  // ── Index ETFs ──
  { sym: 'QQQ',  name: 'Nasdaq-100 ETF',                  cat: 'index',      feed: '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d' },
  { sym: 'SPY',  name: 'S&P 500 ETF',                     cat: 'index',      feed: '0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5' },
  { sym: 'VUG',  name: 'Vanguard Growth ETF',             cat: 'index',      feed: '0x8c64b089d95170429ba39ec229a0a6fc36b267e09c3210fbb9d9eb2d4c203bc5' },
  { sym: 'VGK',  name: 'Vanguard FTSE Europe ETF',        cat: 'index',      feed: '0x0648195b6826d833f3c4eb261c81223a90ceb3a26e86e9b18f6e11f0212cad18' },
  { sym: 'VXUS', name: 'Vanguard Total Intl Stock ETF',   cat: 'index',      feed: '0x48a13d42218646bba8cc114cd394a283b11c0e07dd14a885efd5caec640c5289' },
  { sym: 'SGOV', name: 'iShares 0-3M Treasury Bond ETF',  cat: 'index',      feed: '0x8d6a29bb5ed522931d711bb12c4bbf92af986936e52af582032913b5ffcbf4d5' },

  // ── Sector ETFs ──
  { sym: 'SMH',  name: 'VanEck Semiconductor ETF',        cat: 'sector',     feed: '0x2487b620e66468404ba251bfaa6b8382774010cbb5d504ac48ec263e0b1934aa' },
  { sym: 'XLE',  name: 'Energy Select Sector SPDR',       cat: 'sector',     feed: '0x8bf649e08e5a86129c57990556c8eec30e296069b524f4639549282bc5c07bb4' },
  { sym: 'XOP',  name: 'SPDR S&P Oil & Gas Exploration',  cat: 'sector',     feed: '0xc706cce81639eed699bf23a427ea8742ac6e7cc775b2a8a8e70cba8a49393e42' },
  { sym: 'ITA',  name: 'iShares Aerospace & Defense ETF',  cat: 'sector',     feed: '0x79f7f0b79a6b7fdc0d7d9e8b6337fd709b8eea9dc6f57b6174c84816cae88bfd' },

  // ── Mega-cap Tech ──
  { sym: 'AAPL', name: 'Apple',                           cat: 'tech',       feed: '0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688' },
  { sym: 'NVDA', name: 'NVIDIA',                          cat: 'tech',       feed: '0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593' },
  { sym: 'TSLA', name: 'Tesla',                           cat: 'tech',       feed: '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1' },
  { sym: 'DELL', name: 'Dell Technologies',               cat: 'tech',       feed: '0xa2950270a22ce39a22cb3488ba91e60474cd93c6d01da2ecc5a97c1dd40f4995' },
  { sym: 'SMCI', name: 'Super Micro Computer',            cat: 'tech',       feed: '0x8f34132a42f8bb7a47568d77a910f97174a30719e16904e9f2915d5b2c6c2d52' },
  { sym: 'ANET', name: 'Arista Networks',                 cat: 'tech',       feed: '0x31cc7558642dc348a3e2894146a998031438de8ccc56b7af2171bcd5e5d83eda' },
  { sym: 'VRT',  name: 'Vertiv Holdings',                 cat: 'tech',       feed: '0x84dad6b760396a7904d04a3d83039a3fc18f10819fd97d023ac5535997d70108' },
  { sym: 'SNDK', name: 'Sandisk',                         cat: 'tech',       feed: '0xc86a1f20cd7d5d07932baea30bcd8e479b775c4f51f82526bf1de6dc79fa3f76' },

  // ── Semiconductors ──
  { sym: 'KLAC', name: 'KLA Corporation',                 cat: 'semi',       feed: '0x9c27675f282bfe54b5d0a7b187b29b09184d32d4462de7e3060629c7b8895aad' },
  { sym: 'LRCX', name: 'Lam Research',                    cat: 'semi',       feed: '0x01a67883f58bd0f0e9cf8f52f21d7cf78c144d7e7ae32ce9256420834b33fb75' },
  { sym: 'AMAT', name: 'Applied Materials',               cat: 'semi',       feed: '0xb9bc74cc1243b706efacf664ed206d08ab1dda79e8b87752c7c44b3bdf1b9e08' },
  { sym: 'TER',  name: 'Teradyne',                        cat: 'semi',       feed: '0x58ab181e7512766728d2cc3581839bbb913e6cd24457ba422cbe2a33df64416e' },

  // ── Energy & Infrastructure ──
  { sym: 'CEG',  name: 'Constellation Energy',            cat: 'energy',     feed: '0xa541bc5c4b69961442e45e9198c7cce151ff9c2a1003f620c6d4a9785c77a4d9' },
  { sym: 'GEV',  name: 'GE Vernova',                      cat: 'energy',     feed: '0x57e28b0f0ab18923f5c987629c0c714b9b46c87e729ed95ed6e23e466e8d1e0c' },
  { sym: 'SMR',  name: 'NuScale Power',                   cat: 'energy',     feed: '0x69155365daba71df19c2c0416467b64581052cfa75f44b77f352a92698b81639' },
  { sym: 'ETN',  name: 'Eaton Corporation',               cat: 'energy',     feed: '0xb1cf984febc32fbd98f0c5d31fed29d050d56a272406bae9de64dd94ba7e5e1e' },
  { sym: 'PWR',  name: 'Quanta Services',                 cat: 'energy',     feed: '0xa189b9eee6d023e3b79a726804aeb748d54e52cf6ebcebe0f7d5c8dae4988357' },
  { sym: 'APLD', name: 'Applied Digital',                 cat: 'energy',     feed: '0x7fc1e64946aff450748e8f60644d052ae787e5708dc48c6c73c546ee94218cc3' },

  // ── Commodities & Precious Metals ──
  { sym: 'SLV',  name: 'iShares Silver Trust',            cat: 'commodity',  feed: '0x6fc08c9963d266069cbd9780d98383dabf2668322a5bef0b9491e11d67e5d7e7' },
  { sym: 'PPLT', name: 'abrdn Physical Platinum',         cat: 'commodity',  feed: '0x782410278b6c8aa2d437812281526012808404aa14c243f73fb9939eeb88d430' },
  { sym: 'PALL', name: 'abrdn Physical Palladium',        cat: 'commodity',  feed: '0xfeeb371f721e75853604c47104967f0ab3fa92b988837013f5004f749a8a0599' },

  // ── Crypto-adjacent ──
  { sym: 'STRK', name: 'Strategy (MicroStrategy)',        cat: 'crypto',     feed: '0xcdea273301806de445b481e91a8dbe292ba23fcff8f7dec2053311555a0656c3' },
  { sym: 'BTGO', name: 'BitGo',                           cat: 'crypto',     feed: '0x6540ed0004047d446b252bc49bff9e23e667c5c7d0437ad0db8e120e7b19c311' },
])

// ═══════════════════════════════════════════════════════════════
// DERIVED LOOKUPS (computed once at load, frozen)
// ═══════════════════════════════════════════════════════════════

// { 'QQQ/USD': '0x...', 'SPY/USD': '0x...', ... }  — keyed by "SYM/USD"
export const PYTH_FEEDS = Object.freeze(
  Object.fromEntries(ASSETS.map(a => [`${a.sym}/USD`, a.feed]))
)

// { QQQ: '0x...', SPY: '0x...', ... }  — keyed by bare symbol
export const ASSET_FEED_MAP = Object.freeze(
  Object.fromEntries(ASSETS.map(a => [a.sym, a.feed]))
)

// { '0x...': 'QQQ/USD', ... }  — reverse lookup: feedId → symbol
export const FEED_SYMBOLS = Object.freeze(
  Object.fromEntries(ASSETS.map(a => [a.feed, `${a.sym}/USD`]))
)

// { QQQ: 'QQQ (Nasdaq-100 ETF)', ... }  — for UI display
export const TICKER_NAMES = Object.freeze(
  Object.fromEntries(ASSETS.map(a => [a.sym, `${a.sym} (${a.name})`]))
)

// { 'QQQx': 'QQQ', 'SPYx': 'SPY', ... }  — maps xStock ticker to bare symbol
export const TICKER_MAP = Object.freeze(
  Object.fromEntries(ASSETS.map(a => [`${a.sym}x`, a.sym]))
)

// All ticker symbols with 'x' suffix, ordered by registry: ['QQQx', 'SPYx', ...]
export const ALL_TICKERS = Object.freeze(ASSETS.map(a => `${a.sym}x`))

// Category groupings for UI sections
export const CATEGORIES = Object.freeze({
  index:     ASSETS.filter(a => a.cat === 'index'),
  sector:    ASSETS.filter(a => a.cat === 'sector'),
  tech:      ASSETS.filter(a => a.cat === 'tech'),
  semi:      ASSETS.filter(a => a.cat === 'semi'),
  energy:    ASSETS.filter(a => a.cat === 'energy'),
  commodity: ASSETS.filter(a => a.cat === 'commodity'),
  crypto:    ASSETS.filter(a => a.cat === 'crypto'),
})

// Raw registry access
export { ASSETS }

// Expose globally for non-module scripts
window.xLeverAssets = {
  ASSETS, PYTH_FEEDS, ASSET_FEED_MAP, FEED_SYMBOLS,
  TICKER_NAMES, TICKER_MAP, ALL_TICKERS, CATEGORIES,
}
