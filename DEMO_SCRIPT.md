# xLever Demo Script

**Target duration: 2 minutes (120 seconds)**
**Record at:** 1920x1080, dark theme (default)

---

## Shot 1 -- The Problem (0:00-0:15)

**Visual:** Title card with xLever logo, then quick comparison chart showing volatility decay

**Script:**
> "Leveraged ETFs like TQQQ lose value over time because they reset daily. In a volatile sideways market, 3x leverage can lose money even when the underlying is flat. xLever fixes this: your leverage is locked at entry, not rebalanced daily."

---

## Shot 2 -- Connect Wallet (0:15-0:30)

**Visual:** [xlever.markets](https://xlever.markets) landing page

**Actions:**
1. Click **Connect Wallet** (top right)
2. Select MetaMask
3. Switch to **Ink Sepolia** when prompted
4. Show wallet address appear in nav

**Script:**
> "Let's demo the live product. We connect a wallet to Ink Sepolia, where our 33 vault contracts are deployed."

---

## Shot 3 -- Open a Position (0:30-1:00)

**Visual:** Trading Terminal (Screen 2)

**Actions:**
1. Select **QQQ** asset
2. Point out the green "Live Pyth Feed" badge -- prices are real
3. Drag leverage slider to **2.0x**
4. Enter USDC amount (e.g. 10 USDC)
5. Click **Open Position**
6. Show button lifecycle: Approving USDC -> Tx Submitted -> Confirming -> Confirmed
7. Position card appears below with on-chain data

**Script:**
> "On the trading terminal, we select QQQ with 2x leverage. These are live Pyth oracle prices. We deposit 10 USDC -- this is a real on-chain transaction on Ink Sepolia. The button tracks the full transaction lifecycle. And here's our confirmed position."

---

## Shot 4 -- Close Position (1:00-1:20)

**Visual:** Trading Terminal, position card visible

**Actions:**
1. Click **Close Position** on the position card
2. Confirm in wallet
3. Show toast with explorer link
4. Position card disappears

**Script:**
> "Closing is just as simple. One click, confirm in wallet, and the USDC is returned. Every action is verifiable on the block explorer."

---

## Shot 5 -- Backtest Proof (1:20-1:50)

**Visual:** Analytics screen (Screen 6)

**Actions:**
1. Select QQQ, 3x leverage, 1-year timeframe
2. Click **Run Backtest**
3. Point out the two lines: green (LTAP) vs red (daily-reset)
4. Highlight the performance difference

**Script:**
> "Here's the proof. We backtest 3x leverage on QQQ over the last year using real Yahoo Finance data. The green line is xLever's fixed-entry approach. The red line is daily-rebalanced like TQQQ. In a trending market, fixed-entry leverage significantly outperforms."

---

## Shot 6 -- Closing (1:50-2:00)

**Visual:** Landing page or title card

**Script:**
> "xLever. Fixed-entry leverage on tokenized assets. No volatility decay. 33 assets live on Ink Sepolia. Try it at xlever.markets."

---

## Pre-Recording Checklist

- [ ] Wallet has Ink Sepolia ETH for gas
- [ ] Wallet has test USDC (faucet or pre-funded)
- [ ] Data proxy running (`cd server && python3 server.py`)
- [ ] Frontend running (`npm run dev`)
- [ ] Test the full flow once before recording: connect -> open -> close
- [ ] Pre-load chart data by visiting trading terminal once (caches for 24h)

## If Something Breaks During Recording

- **RPC error on open/close:** The retry logic (5 attempts, exponential backoff) handles transient failures. Wait for it to resolve or re-record the shot.
- **Pyth price stale:** Refresh the page. Pyth Hermes reconnects automatically.
- **Chart not loading:** Data proxy may be down. The backtest engine works with cached data. Ensure `server.py` is running.

## Do NOT Show

- Dashboard screen (demo data until real positions exist)
- AI agent executing real trades (it's dry-run only)
- Risk sentinel claiming on-chain enforcement (it's client-side only)
- The full LTAP protocol story (modular Vault.sol, junior tranche, Euler hedging) -- this is designed but not deployed
