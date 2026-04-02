# Troubleshooting

Common issues and solutions when using xLever.

---

## Wallet Connection

### Wallet won't connect

**Symptoms:** Clicking "Connect Wallet" does nothing, or the Reown modal doesn't appear.

**Solutions:**
1. Ensure you're using a supported browser (Chrome, Firefox, Brave, Edge)
2. Disable any ad blockers or privacy extensions that may block WebSocket connections
3. Check that your wallet extension is installed and unlocked
4. Try refreshing the page with a hard reload (Ctrl+Shift+R / Cmd+Shift+R)
5. Clear browser cache and try again

### Wrong network

**Symptoms:** Transactions fail, "wrong network" errors, or assets don't appear.

**Solutions:**
1. Open your wallet and switch to **Ink Sepolia** (Chain ID 763373)
2. If Ink Sepolia isn't listed, the app should prompt you to add it automatically
3. Manual network config:
   - **Network Name:** Ink Sepolia
   - **Chain ID:** 763373
   - **RPC URL:** Check your `.env` file or `frontend/config.js`

### Wallet disconnects unexpectedly

**Symptoms:** Wallet shows as disconnected after navigating between screens.

**Solutions:**
1. The app uses Reown AppKit with auto-reconnect — try refreshing the page
2. Check that your wallet extension is still unlocked
3. Some wallets require re-approval after browser restarts

---

## Transactions

### Transaction fails with "insufficient funds"

**Symptoms:** Transaction is rejected by the contract or wallet.

**Solutions:**
1. Ensure you have **testnet ETH** for gas fees on Ink Sepolia
2. Ensure you have sufficient **testnet USDC** for the deposit amount
3. Check that you're on the correct network (Ink Sepolia, Chain ID 763373)

### Transaction stuck or pending

**Symptoms:** Transaction submitted but never confirms.

**Solutions:**
1. Check the Ink Sepolia explorer for your transaction status
2. Testnet can be slow — wait a few minutes
3. If stuck for >5 minutes, try increasing gas in your wallet settings
4. As a last resort, reset your wallet's nonce (in wallet settings, "Reset Account")

### "Pyth price update failed" error

**Symptoms:** Transaction reverts with a Pyth-related error.

**Solutions:**
1. The Pyth price update requires a small ETH fee — ensure you have testnet ETH
2. The price feed may be temporarily unavailable — wait and retry
3. Check the oracle status indicator on the dashboard — if red, feeds are down
4. Try refreshing the page to get a fresh price attestation

### Leverage slider won't go above 3x (or 1.5x)

**Symptoms:** The leverage slider has a lower maximum than expected.

**Explanation:** This is intentional. The Risk Sentinel reduces maximum allowed leverage during elevated risk states:
- WARNING: max 3.0x
- RESTRICTED: max 1.5x
- EMERGENCY: 0.0x (no new positions)

Check the risk sentinel banner in the navbar for the current state.

---

## Price & Oracle Issues

### Prices show as stale or zero

**Symptoms:** Price displays show "stale", "--", or 0.

**Solutions:**
1. Check the Pyth oracle status indicator (should be green)
2. Pyth Hermes may be temporarily unavailable — prices will resume when the service recovers
3. Some assets may have less frequent price updates during off-market hours
4. Refresh the page to force a new price fetch

### Price doesn't match what I see on other platforms

**Symptoms:** xLever shows a different price than exchanges or Google Finance.

**Explanation:**
- xLever uses **Pyth Network** oracle prices, which may differ slightly from exchange prices
- Pyth prices represent a confidence-weighted aggregate of multiple data sources
- Small differences (< 0.5%) are normal
- Larger differences may indicate oracle staleness — check the freshness indicator

---

## Backtesting

### Backtest shows "No data available"

**Symptoms:** Running a backtest returns empty results.

**Solutions:**
1. Ensure the **data proxy server** is running (`cd server && python3 server.py`)
2. Check that the selected date range is valid (not in the future)
3. Some newer assets may have limited historical data
4. Check browser console for Yahoo Finance API errors

### Backtest takes too long

**Symptoms:** Backtest spinner runs for >30 seconds.

**Solutions:**
1. Long date ranges (10+ years) with daily data can take time — this is normal
2. Try a shorter date range first to verify the system works
3. The data proxy caches results — subsequent runs for the same asset/range will be faster

### LTAP and daily-reset lines are identical

**Symptoms:** The two strategy lines overlap completely.

**Explanation:** Over very short periods or in low-volatility conditions, the difference between fixed-entry and daily-reset leverage is minimal. Try:
- A longer date range (1+ years)
- A higher leverage multiplier (3x or 4x)
- A more volatile asset

---

## AI Agent

### Agent won't start

**Symptoms:** Clicking "Start Agent" has no effect.

**Solutions:**
1. Ensure your wallet is connected
2. Select a policy mode from the dropdown
3. Check the browser console for JavaScript errors
4. If using the backend agent, ensure the FastAPI server is running

### Agent shows "dry-run" but I want live execution

**Symptoms:** Agent simulates decisions but doesn't send transactions.

**Solutions:**
1. Dry-run is the **default and recommended** mode
2. To enable live execution, toggle the "Live Mode" switch in agent settings
3. Live mode requires a funded wallet with testnet ETH for gas
4. Always test thoroughly in dry-run before going live

### Agent decisions seem wrong

**Symptoms:** Agent takes unexpected actions or makes odd decisions.

**Solutions:**
1. Review the **execution log** to understand the agent's reasoning
2. Check the **decision tree** visualization for the logic flow
3. Verify that policy parameters are set correctly
4. Remember that the agent follows deterministic policy rules — its behavior is bounded by the selected mode

---

## Local Development

### `npm run dev` fails

**Symptoms:** Vite dev server won't start.

**Solutions:**
1. Run `npm install` first
2. Ensure Node.js 18+ is installed: `node --version`
3. Check for port conflicts — default is port 3000
4. Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`

### Data proxy server won't start

**Symptoms:** `python3 server.py` fails or Yahoo Finance data unavailable.

**Solutions:**
1. Ensure Python 3.10+ is installed: `python3 --version`
2. Install dependencies: `pip install yfinance flask flask-cors`
3. Check port 8000 isn't already in use: `lsof -i :8000`
4. Yahoo Finance may rate-limit requests — wait a minute and retry

### FastAPI backend won't start

**Symptoms:** `uvicorn api.main:app` fails.

**Solutions:**
1. Install dependencies: `cd server && pip install -r requirements.txt`
2. Ensure PostgreSQL and Redis are running: `docker compose up -d`
3. Check `.env` for correct database connection string
4. Verify Redis is reachable: `redis-cli ping`

### Docker containers won't start

**Symptoms:** `docker compose up -d` fails.

**Solutions:**
1. Ensure Docker is installed and running
2. Check for port conflicts (PostgreSQL: 5432, Redis: 6379)
3. Try `docker compose down && docker compose up -d` for a fresh start
4. Check Docker logs: `docker compose logs`

### Contract tests fail

**Symptoms:** `forge test` errors.

**Solutions:**
1. Ensure Foundry is installed: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. Run `forge install` to fetch dependencies
3. Check Solidity version compatibility (^0.8.0)
4. For specific test issues: `forge test --match-contract <ContractName> -vvv` for verbose output

---

## UI & Display

### Page layout is broken

**Symptoms:** Overlapping elements, missing styles, or broken layout.

**Solutions:**
1. Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
2. Clear browser cache
3. Check that Tailwind CSS CDN is loading (requires internet connection)
4. Try a different browser to isolate the issue

### Charts don't load

**Symptoms:** TradingView chart area is blank or shows an error.

**Solutions:**
1. Ensure internet connection is active (TradingView library loads from CDN)
2. Check that ad blockers aren't blocking the TradingView Lightweight Charts library
3. Refresh the page
4. Check browser console for specific error messages

### 3D animation on landing page is slow

**Symptoms:** Spline 3D element causes lag or stuttering.

**Solutions:**
1. This is GPU-intensive — ensure hardware acceleration is enabled in your browser
2. Close other GPU-intensive tabs
3. The animation is cosmetic — it doesn't affect platform functionality

---

## Still Stuck?

If your issue isn't covered here:

1. Check the browser developer console (F12) for error messages
2. Review the relevant docs:
   - [User Guide](USER-GUIDE.md) for feature walkthroughs
   - [FAQ](FAQ.md) for common questions
   - [Deployment Guide](DEPLOYMENT.md) for setup issues
3. Check the project's GitHub issues for known problems
4. Open a new issue with:
   - What you were trying to do
   - What happened instead
   - Browser and wallet version
   - Any console error messages
