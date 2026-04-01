/**
 * live-state.js — Fetches real protocol state from the backend
 * which reads on-chain contract state + Pyth oracle prices.
 *
 * Used by the "Live" mode of the trading UI.
 * All values come from contract reads or oracle feeds — never browser-computed.
 */

const LIVE_API_BASE = '/api/live';
const POLL_INTERVAL = 15_000; // 15 seconds — matches backend cache TTL

let _liveState = null;
let _pollTimer = null;
let _onUpdate = null; // callback when new data arrives

/**
 * Fetch full summary for all vaults.
 * Returns { vaults: { QQQ: { pool, oracle, junior, fees, pyth }, SPY: ... } }
 */
async function fetchLiveSummary() {
  try {
    const resp = await fetch(`${LIVE_API_BASE}/summary`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.warn('[live-state] summary fetch failed:', e.message);
    return null;
  }
}

/**
 * Fetch a single user's position for a given vault.
 */
async function fetchLivePosition(symbol, userAddress) {
  try {
    const resp = await fetch(`${LIVE_API_BASE}/position/${symbol}?user=${userAddress}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.warn(`[live-state] position fetch failed for ${symbol}:`, e.message);
    return null;
  }
}

/**
 * Start polling live state. Calls onUpdate(state) on each refresh.
 */
function startLivePolling(onUpdate) {
  _onUpdate = onUpdate;
  _pollOnce(); // immediate first fetch
  _pollTimer = setInterval(_pollOnce, POLL_INTERVAL);
}

function stopLivePolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

async function _pollOnce() {
  const summary = await fetchLiveSummary();
  if (summary) {
    _liveState = summary;
    if (_onUpdate) _onUpdate(_liveState);
  }
}

/**
 * Get the most recent cached live state (synchronous).
 */
function getLiveState() {
  return _liveState;
}

/**
 * Extract live economics for a specific vault from cached state.
 * Returns null values for any field that isn't available.
 */
function getLiveEconomics(symbol) {
  if (!_liveState || !_liveState.vaults || !_liveState.vaults[symbol]) {
    return null;
  }
  const v = _liveState.vaults[symbol];
  const pool = v.pool;
  const oracle = v.oracle;
  const junior = v.junior;
  const fees = v.fees;
  const pyth = v.pyth;

  // Parse USDC amounts (6 decimals)
  const parseUSDC = (val) => val ? Number(val) / 1e6 : 0;

  const totalSenior = pool ? parseUSDC(pool.totalSeniorDeposits) : 0;
  const totalJunior = pool ? parseUSDC(pool.totalJuniorDeposits) : 0;
  const insuranceFund = pool ? parseUSDC(pool.insuranceFund) : 0;
  const totalPool = totalSenior + totalJunior;
  const juniorRatio = totalPool > 0 ? totalJunior / totalPool : 0;
  const seniorRatio = totalPool > 0 ? totalSenior / totalPool : 0;

  // Junior APY from contract: sharePrice appreciation or fees/junior deposits
  const juniorTotalValue = junior ? parseUSDC(junior.totalValue) : 0;
  const juniorSharePrice = junior ? Number(junior.sharePrice) / 1e6 : 1.0;

  // Fee rates from contract
  const fundingRateBps = fees ? Number(fees.fundingRateBps) : null;
  const carryRateBps = fees ? Number(fees.carryRateBps) : null;
  const maxLeverageBps = fees ? fees.maxLeverageBps : null;

  // Oracle state
  const oracleFresh = oracle ? oracle.isFresh : null;
  const oracleCircuitBroken = oracle ? oracle.isCircuitBroken : null;
  const oracleDivergenceBps = oracle ? oracle.divergenceBps : null;
  const oracleLastUpdate = oracle ? oracle.lastUpdateTime : null;
  const displayPrice = oracle ? Number(oracle.displayPrice) / 1e18 : null;

  // Pyth price
  const pythPrice = pyth ? pyth.price : null;

  // Max leverage from contract
  const maxLeverage = maxLeverageBps ? maxLeverageBps / 10000 : null;

  // Protocol state enum
  const protocolState = pool ? pool.protocolState : null;
  const protocolStateLabel = ['NORMAL', 'WARNING', 'RESTRICTED', 'EMERGENCY'][protocolState] || 'UNKNOWN';

  return {
    // Pool composition (from contract)
    totalSenior,
    totalJunior,
    totalPool,
    insuranceFund,
    juniorRatio,
    seniorRatio,

    // Junior tranche (from contract)
    juniorTotalValue,
    juniorSharePrice,

    // Fees (from contract)
    fundingRateBps,
    carryRateBps,

    // Oracle (from contract + Pyth)
    oracleFresh,
    oracleCircuitBroken,
    oracleDivergenceBps,
    oracleLastUpdate,
    displayPrice,
    pythPrice,

    // Limits (from contract)
    maxLeverage,

    // Protocol state (from contract)
    protocolState,
    protocolStateLabel,

    // Exposure (from contract)
    netExposure: pool ? parseUSDC(pool.netExposure) : 0,
    grossLong: pool ? parseUSDC(pool.grossLongExposure) : 0,
    grossShort: pool ? parseUSDC(pool.grossShortExposure) : 0,

    // Data source info
    source: _liveState.source,
    cacheAge: _liveState.cacheAge,
  };
}

// Expose globally for app.js (non-module script)
window.liveState = {
  fetchLiveSummary,
  fetchLivePosition,
  startLivePolling,
  stopLivePolling,
  getLiveState,
  getLiveEconomics,
};
