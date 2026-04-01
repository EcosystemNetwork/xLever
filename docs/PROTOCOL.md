# Protocol Mechanics

Core design of the Leveraged Tokenized Asset Protocol (LTAP).

---

## Fixed-Entry Leverage (Not Daily Rebalance)

This is the critical design choice that differentiates xLever from products like TQQQ/SPXL.

### How TQQQ Works (Daily Rebalance)

TQQQ targets 3x of *each day's* return. Every day, the fund rebalances to reset leverage relative to that day's closing NAV. This creates **volatility decay** — in choppy markets, TQQQ underperforms 3x the cumulative QQQ return.

**Example:** QQQ goes +10% then -10%:
- QQQ: $100 -> $110 -> $99 (net -1%)
- TQQQ: $100 -> $130 -> $91 (net **-9%**, not -3%)

### How xLever Works (Fixed Entry)

xLever measures PnL from the **entry price**, not from each day's close. No daily rebalance, no volatility decay.

**Same example** (QQQ +10% then -10%):
- QQQ: $100 -> $110 -> $99 (net -1%)
- xLever at 3x: PnL = 3 x (-1%) = **-3%** of deposit (not -9%)

### Position Value Formula

```
Value = D x (1 + L x (P_now - P_entry) / P_entry) - F_accrued
```

Where:
- `D` = deposit amount (USDC)
- `L` = leverage multiplier (signed; negative for shorts)
- `P_entry` = TWAP at position open or last leverage adjustment
- `P_now` = current TWAP
- `F_accrued` = accumulated fees

### Advantages

- No volatility decay in choppy/ranging markets
- Outperforms daily-rebalanced products in trending markets
- Simpler mental model — "2x means 2x of the move from when I entered"

### Trade-offs

- In a sustained downtrend, xLever holds full leverage the entire way down (until auto-deleverage triggers), while TQQQ would gradually reduce exposure via daily rebalance
- The auto-deleverage cascade compensates — it's the protocol-level equivalent of TQQQ's daily rebalance, but triggered by health factor thresholds rather than time

---

## Two-Tranche System

### Senior Tranche (Leverage Traders)

- Deposit USDC, select leverage from -4x to +4x
- PnL = Deposit x Leverage x Price Change
- Max loss capped at deposit amount
- No liquidation, no debt
- Can adjust leverage or exit at any time (subject to cooldowns)

### Junior Tranche (First-Loss Capital)

- Deposits USDC as a risk buffer
- Earns 70% of all protocol fees
- Absorbs losses before they reach senior users
- Can be fully wiped in extreme tail events
- High risk, high yield profile

### Why This Works

Longs and shorts within the pool cancel out (exposure netting), reducing external hedging. Junior LPs provide a buffer that socializes risk across the protocol rather than liquidating individuals.

---

## Exposure Netting

Longs and shorts within the pool cancel out, reducing external hedging requirements:

```
Example pool:
  User A: +3x on $100K = $300K long
  User B: +2x on $200K = $400K long
  User C: -2x on $150K = $300K short

  Gross long:  $700K
  Gross short: $300K
  Net exposure: $400K long

  Protocol only hedges $400K on Euler V2 (not $700K)
  Capital efficiency: 43% reduction in external positions
```

**Net exposure formula:**

```
Net = SUM(D_i x L_i)   (where L_i is signed, negative for shorts)
```

---

## Fee Structure

xLever uses a three-component fee model with dynamic spread pricing.

### Component 1: Dynamic Entry/Exit Fee

Entry/exit fees scale with spot-TWAP divergence, pricing oracle latency risk into the trade continuously.

```
Fee = BaseFee x (1 + k x |Spot - TWAP|)
```

- Base fee: 0.08% entry, 0.04% exit
- k = 50 (scaling factor per 1% divergence)

| Divergence | Entry Fee Multiplier | Effective Fee | Action |
|-----------|---------------------|---------------|--------|
| < 0.5% | 1.0-1.25x | 0.08-0.10% | Normal |
| 0.5-1.0% | 1.25-1.50x | 0.10-0.12% | Elevated, logged |
| 1.0-2.0% | 1.50-2.00x | 0.12-0.16% | Warning, max leverage reduced |
| 2.0-3.0% | 2.00-2.50x | 0.16-0.20% | Leverage capped at 2x, new longs paused |
| > 3.0% | Rejected | -- | Emergency: only withdrawals |

### Component 2: Continuous Carry Fee

Passthrough of the protocol's actual borrowing costs on Euler V2 plus a protocol spread.

```
Carry Rate = Euler Borrow Rate x (|Net Exposure| / Gross Exposure) + Protocol Spread
```

When longs and shorts offset, the protocol's external borrowing cost drops toward zero, and so does the carry fee. Users only pay for the hedging the protocol actually needs to do.

| Pool Balance | Net/Gross Ratio | Effective Carry |
|-------------|-----------------|-----------------|
| All long, no short | 100% | Full borrow rate + spread |
| 70% long, 30% short | 57% | 57% of borrow rate + spread |
| 50/50 balanced | 0% | Protocol spread only (~0.10%) |

Protocol spread: 0.10% annually.

### Component 3: Funding Rate

Periodic payment between longs and shorts that incentivizes pool balance (similar to perpetual swap funding). Calculated every 8 hours:

```
Funding Rate = Clamp(Net Exposure / Gross Exposure x Max Rate, -0.05%, +0.05%)
```

- Positive funding (pool is net long): longs pay shorts
- Negative funding (pool is net short): shorts pay longs
- Balanced pool: funding ~ 0
- Max: 0.05% per 8-hour period (~5.5% annualized at max imbalance)

### Fee Distribution

```
Total Fees Collected
    |
    |-- 70% --> Junior Tranche (yield for first-loss capital)
    |-- 20% --> Insurance Fund (protocol backstop)
    |-- 10% --> Protocol Treasury
```

### Fee Example

User deposits $10K at +2x for 30 days, pool is 65% long / 35% short, divergence ~0.3%:

| Component | Calculation | Amount |
|-----------|------------|--------|
| Entry fee (dynamic) | $20K x 0.08% x 1.15 | $18.40 |
| Carry fee | $10K x (3.5% x 43% + 0.10%) x 30/365 | $12.63 |
| Funding (net long, pays) | ~0.02% per 8h x 90 periods | ~$36.00 |
| Exit fee (dynamic) | $20K x 0.04% x 1.10 | $8.80 |
| **Total cost** | | **~$75.83** |

---

## Dynamic Leverage Caps

Maximum leverage scales with junior tranche health:

| Junior Ratio | Max Leverage | Minimum Buffer |
|--------------|------------|----------------|
| >= 40% | 4.0x | 25% |
| 30-39% | 3.0x | 33% |
| 20-29% | 2.0x | 50% |
| < 20% | 1.5x | 67% |

### Leverage Lock Periods

Prevent toxic flow from rapid leverage switching:

| Action | Delay | Rationale |
|--------|-------|-----------|
| Leverage increase | 1 hour | Prevent front-running volatility |
| Leverage decrease | None | Always allow risk reduction |
| Full exit | None | Emergency liquidity |
| Flip long/short | 4 hours | Prevent wash trading |

---

## Euler V2 Integration

### Why Euler V2

Euler V2's modular vault architecture provides critical advantages:

- **Atomic looping:** EVC's deferred solvency checks allow the entire leverage loop in a single `evc.batch()` call — no flash loans needed
- **Risk isolation:** Sub-accounts (256 per address) isolate long hedges, short hedges, and insurance yield
- **Deterministic leverage caps:** Single vault LTV parameters are queryable on-chain
- **Collateral rehypothecation:** Lending out collateral while it's used as collateral
- **Single governance surface:** One protocol to monitor

### Atomic Looping via EVC

**For net long exposure:**

```
EVC.batch([
    1. Deposit USDC into Euler USDC collateral vault (sub-account 0)
    2. Enable USDC vault as collateral for xQQQ debt vault
    3. Borrow USDC from xQQQ-denominated debt vault
    4. Swap USDC -> xQQQ on DEX
    5. Deposit xQQQ into Euler xQQQ collateral vault
    6. Enable xQQQ vault as additional collateral
    7. Repeat steps 3-6 for loop iterations
    // Solvency check deferred until here
])
```

**For net short exposure:**

```
EVC.batch([
    1. Deposit USDC into Euler USDC collateral vault (sub-account 1)
    2. Enable USDC vault as collateral
    3. Borrow xQQQ from Euler xQQQ vault
    4. Swap xQQQ -> USDC on DEX
    5. Deposit additional USDC as collateral
    6. Repeat steps 3-5 for loop iterations
    // Solvency check deferred until here
])
```

### Achievable Leverage vs. LTV

For a single-asset loop, the theoretical max leverage is `L_max = 1 / (1 - LTV)`:

| Asset LTV | Max Loop Leverage | Safe Operating Leverage |
|-----------|-------------------|------------------------|
| 75% | 4.00x | 3.00x |
| 80% | 5.00x | 3.50x |
| 82.5% | 5.71x | 4.00x |
| 85% | 6.67x | 4.50x |

For xLever's 4x max, an Euler vault with >= 82.5% borrow LTV for xQQQ/USDC is required. The protocol dynamically caps leverage to what the Euler vault can actually support.

### Sub-Account Isolation

| Sub-Account | Purpose | Risk Profile |
|------------|---------|-------------|
| 0 | Net long hedging | xQQQ collateral, USDC debt |
| 1 | Net short hedging | USDC collateral, xQQQ debt |
| 2 | Insurance fund yield | External protocol yield |
| 3-10 | Reserved | Future strategies |

If the long position in sub-account 0 gets liquidated on Euler, it does **not** affect the short hedge in sub-account 1 or the insurance fund in sub-account 2.

### Slippage Protection

Every DEX swap inside the EVC batch includes an explicit 2% max slippage check. If liquidity is too thin, the batch reverts entirely.

| Scenario | On Slippage Revert |
|----------|-------------------|
| Deposit / leverage increase | User retains USDC, no position opened |
| Withdrawal / leverage decrease | User enters slow withdrawal queue |
| ADL forced deleverage | Retry after 5 blocks with fresh quote |

### Slow Withdrawal Queue

When instant withdrawal reverts due to slippage, the withdrawal is queued for TWAP execution over 4-24 hours. The protocol splits the unwind into smaller chunks executed across multiple blocks, minimizing market impact.

- 1 chunk per $50K notional, min 4 chunks, max 96 (24 hours at 15 min intervals)
- Each chunk includes its own slippage check
- Keeper executes chunks permissionlessly

---

## TWAP Oracle

15-minute time-weighted average price from Pyth with continuous spread pricing:

- **Samples:** Every 12 seconds (1 block)
- **Buffer:** 75 samples (75 x 12s = 900s = 15 min)
- **Update:** Permissionless — anyone can call
- **Calculation:** `TWAP = sum(prices[0..74]) / 75`

### Dynamic Spread

| Spot-TWAP Spread | Dynamic Fee Impact | Additional Action |
|------------------|-------------------|-------------------|
| < 0.5% | 1.0-1.25x base fee | Normal operation |
| 0.5-1.0% | 1.25-1.50x base fee | Warning logged |
| 1.0-2.0% | 1.50-2.00x base fee | Max leverage reduced to 2x |
| 2.0-3.0% | 2.00-2.50x base fee | New positions paused, only exits |
| > 3.0% | Transactions rejected | Emergency oracle fallback |

### Staleness Protection

- Oracle age > 5 min: WARNING state
- Oracle age > 15 min: RESTRICTED state
- Oracle divergence > 1%: WARNING
- Oracle divergence > 3%: RESTRICTED / EMERGENCY
