# xLever Demo Script

**Target duration: 2 minutes (120 seconds)**

---

## Shot List

### Opening — The Problem (0:00–0:15)

**Visual:** Title card with xLever logo, then quick cut to TQQQ volatility decay chart

**Script:**
> "Leveraged ETFs like TQQQ lose value over time due to daily rebalancing. In a volatile sideways market, 3x leverage can actually lose money even when the underlying asset is flat. xLever fixes this with fixed-entry leverage — your leverage is locked at entry, so there's no volatility decay."

---

### The Solution — Protocol Overview (0:15–0:30)

**Visual:** Landing page ([index.html](frontend/index.html)), scroll through feature cards

**Script:**
> "xLever is a leveraged tokenized asset protocol built on Euler V2. Users pick any leverage from -4x to +4x. There's no liquidation risk — a junior tranche of LP capital absorbs losses first. And because leverage is fixed at entry, not rebalanced daily, you keep your edge in trending markets."

---

### Live Demo — Dashboard (0:30–0:45)

**Visual:** [01-dashboard.html](frontend/01-dashboard.html) — portfolio overview, health metrics

**Script:**
> "Here's the xLever dashboard. You can see portfolio allocation, protocol health, and market sentiment at a glance. The Bloomberg-style interface gives institutional-grade visibility into every position."

---

### Live Demo — Trading Terminal (0:45–1:05)

**Visual:** [02-trading-terminal.html](frontend/02-trading-terminal.html) — TradingView chart, leverage slider

**Actions:**
1. Show real QQQ chart loading with live data
2. Drag leverage slider from 1x to 4x, then to -2x (short)
3. Show position sizing and fee calculation updating in real-time

**Script:**
> "The trading terminal pulls real market data. You drag the leverage slider — here's 4x long, here's 2x short. The fee model is transparent: half a percent base plus half a percent per unit of leverage. No hidden costs."

---

### Live Demo — Backtesting Proof (1:05–1:30)

**Visual:** [06-analytics-backtesting.html](frontend/06-analytics-backtesting.html) — run a backtest

**Actions:**
1. Select QQQ, 3x leverage, 1-year timeframe
2. Run backtest — show LTAP vs daily-reset comparison
3. Point out the performance difference
4. Click "Invest" on a backtest result

**Script:**
> "This is the proof. We're backtesting 3x leverage on QQQ over the last year using real Yahoo Finance data. The green line is xLever's fixed-entry approach. The red line is daily-rebalanced like TQQQ. In a trending market, fixed-entry leverage significantly outperforms. And you can click any result to invest directly."

---

### Architecture — How It Works (1:30–1:45)

**Visual:** [04-vault-management.html](frontend/04-vault-management.html), then [05-risk-management.html](frontend/05-risk-management.html)

**Script:**
> "Under the hood, Euler V2's vault architecture handles lending and borrowing in a single atomic transaction — no flash loans needed. Senior users get leveraged exposure, junior LPs earn fees as first-loss capital. The risk engine monitors health across the entire protocol and auto-deleverages before problems cascade."

---

### AI Agent (1:45–1:55)

**Visual:** [03-ai-agent-operations.html](frontend/03-ai-agent-operations.html) — agent status panel

**Script:**
> "We've also built an AI agent powered by Perplexity that can monitor markets and manage positions autonomously — setting leverage, timing entries, and adjusting risk based on real-time market intelligence."

---

### Closing (1:55–2:00)

**Visual:** Landing page hero with tagline

**Script:**
> "xLever. Fixed-entry leverage, no liquidation, powered by Euler V2. Try it at our GitHub repo."

---

## Fallback Plan

If the live server is down during recording:

1. **Pre-cache data**: Load all screens once before recording so localStorage has 24h of cached data. The frontend works fully offline with cached data.
2. **Pre-record screen captures**: Record each screen individually, then edit together.
3. **Static screenshots**: If all else fails, use screen recordings from development. The backtesting engine works entirely client-side once data is cached.

## Recording Tips

- Use 1920x1080 resolution
- Dark theme works best for screen recording (already default)
- Record each section separately for clean editing
- Keep mouse movements deliberate and slow
- Use the leverage slider interaction as the "wow moment"
- The backtesting comparison (LTAP vs daily-reset) is the strongest proof point — spend the most time here
