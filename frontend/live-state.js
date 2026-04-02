/**
 * @file live-state.js — Live Application State Manager
 *
 * Fetches real protocol state from the backend API which reads
 * on-chain contract state + Pyth oracle prices. Used by the "Live"
 * mode of the trading UI.
 *
 * All values come from contract reads or oracle feeds -- never browser-computed.
 * Polls the backend at a 15-second interval (matching backend cache TTL).
 *
 * @module liveState
 * @exports {Object} window.liveState
 * @exports {Function} window.liveState.fetchLiveSummary - Fetch vault summary from API
 * @exports {Function} window.liveState.fetchLivePosition - Fetch user position for a vault
 * @exports {Function} window.liveState.startLivePolling - Start polling with callback
 * @exports {Function} window.liveState.stopLivePolling - Stop the polling interval
 * @exports {Function} window.liveState.getLiveState - Get cached state (sync)
 * @exports {Function} window.liveState.getLiveEconomics - Extract economics for a vault
 *
 * @dependencies
 *   - Backend API at /api/live/summary and /api/live/position/:symbol
 */

/** @type {string} Base URL for the live state API endpoints */
const LIVE_API_BASE = '/api/live';
/** @type {number} Polling interval in ms -- matches backend cache TTL */
const POLL_INTERVAL = 15_000;

/** @type {Object|null} Most recently fetched live state summary */
let _liveState = null;
/** @type {number|null} Interval ID for the polling timer */
let _pollTimer = null;
/** @type {Function|null} Callback invoked with new state on each successful poll */
let _onUpdate = null;

/**
 * Fetch full summary for all vaults from the backend API.
 * The backend reads on-chain contract state + Pyth oracle prices and caches for 15s.
 * @returns {Promise<{vaults: Object<string, {pool: Object, oracle: Object, junior: Object, fees: Object, pyth: Object}>, source: string, cacheAge: number}|null>}
 *   Returns null if the fetch fails.
 */
async function fetchLiveSummary() {
  try {
    const resp = await fetch(`${LIVE_API_BASE}/summary`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {

    return null;
  }
}

/**
 * Fetch a single user's position for a given vault from the backend API.
 * @param {string} symbol - Vault symbol ('QQQ' or 'SPY')
 * @param {string} userAddress - User's wallet address (hex)
 * @returns {Promise<Object|null>} Position data with depositAmount, leverageBps, isActive, or null on failure
 */
async function fetchLivePosition(symbol, userAddress) {
  try {
    const resp = await fetch(`${LIVE_API_BASE}/position/${symbol}?user=${userAddress}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {

    return null;
  }
}

/**
 * Start polling live state at POLL_INTERVAL (15s). Runs an immediate first fetch,
 * then continues at the configured interval. Calls onUpdate with the full state
 * on each successful fetch.
 * @param {Function} onUpdate - Callback invoked with the full live state summary on each refresh
 */
function startLivePolling(onUpdate) {
  _onUpdate = onUpdate;
  _pollOnce(); // immediate first fetch
  _pollTimer = setInterval(_pollOnce, POLL_INTERVAL);
}

/**
 * Stop the live state polling interval.
 */
function stopLivePolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

/**
 * Execute a single poll: fetch summary and notify the update callback.
 * @private
 */
async function _pollOnce() {
  const summary = await fetchLiveSummary();
  if (summary) {
    _liveState = summary;
    if (_onUpdate) _onUpdate(_liveState);
  }
}

/**
 * Get the most recent cached live state (synchronous, no network call).
 * Returns null if no successful fetch has been made yet.
 * @returns {Object|null} The last fetched live state summary
 */
function getLiveState() {
  return _liveState;
}

/**
 * Extract live economics for a specific vault from cached state.
 * Parses USDC amounts (6 decimals), calculates pool ratios, APY estimates,
 * and returns a flat object with all vault metrics for UI consumption.
 * Returns null if the vault data is not yet available in the cache.
 * @param {string} symbol - Vault symbol ('QQQ' or 'SPY')
 * @returns {Object|null} Flat economics object with pool, oracle, fee, exposure, and limit data
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
