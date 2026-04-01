# Risk Engine

> **Note:** The Risk Sentinel FSM (Section 1) and Frontend Deleverage Levels run **client-side** in the browser and are live at [xlever.markets](https://xlever.markets). The Auto-Deleverage Cascade based on Euler V2 health scores, Circuit Breaker System, Loss Waterfall, and Naked Short Exposure Check are part of the **planned modular Vault** and are not yet deployed on-chain.

xLever's deterministic risk management system: a 4-state sentinel, auto-deleverage cascade, circuit breakers, and loss waterfall.

---

## Risk Sentinel (4-State FSM)

The risk engine is a deterministic finite state machine that evaluates multiple inputs and produces a single risk state.

```
NORMAL ──> WARNING ──> RESTRICTED ──> EMERGENCY
  ^           |            |              |
  └───────────┴────────────┴──────────────┘
              (recovery when inputs improve)
```

### States

| State | Color | Max Leverage | Description |
|-------|-------|-------------|-------------|
| NORMAL | Green `#00e676` | 4.0x | Full operations, all functions active |
| WARNING | Yellow `#ffd740` | 3.0x | Elevated monitoring, dynamic fees kick in |
| RESTRICTED | Orange `#ff9100` | 1.5x | Limited operations, leverage increases paused |
| EMERGENCY | Red `#ff5252` | 0.0x | Withdrawals only, all new positions blocked |

### Input Thresholds

#### Oracle Freshness
| Condition | Threshold | Triggers |
|-----------|-----------|----------|
| Stale | > 5 min (300s) | WARNING |
| Critical | > 15 min (900s) | RESTRICTED |

#### Oracle Divergence (between primary and secondary feed)
| Condition | Threshold | Triggers |
|-----------|-----------|----------|
| Elevated | > 1% | WARNING |
| Critical | > 3% | RESTRICTED / EMERGENCY |

#### Drawdown (underlying price from peak)
| Condition | Threshold | Triggers |
|-----------|-----------|----------|
| Moderate | > 5% | WARNING |
| Severe | > 15% | RESTRICTED |
| Extreme | > 30% | EMERGENCY |

#### Health Factor (Euler vault)
| Condition | Threshold | Triggers |
|-----------|-----------|----------|
| Low | < 1.5 | WARNING |
| Critical | < 1.2 | RESTRICTED |
| Emergency | < 1.05 | EMERGENCY |

#### Volatility (annualized)
| Condition | Threshold | Triggers |
|-----------|-----------|----------|
| Elevated | > 50% | WARNING |
| Extreme | > 80% | RESTRICTED |

#### Pool Utilization
| Condition | Threshold | Triggers |
|-----------|-----------|----------|
| High | > 75% | WARNING |
| Critical | > 90% | RESTRICTED |

### Evaluation Logic

The engine evaluates all inputs simultaneously. The highest severity triggered by any input determines the overall state. Multiple inputs can contribute reasons to the same state.

**Output:**
- `state` — Current risk state (NORMAL/WARNING/RESTRICTED/EMERGENCY)
- `reasons[]` — Array of human-readable reasons for current state
- `leverageCap` — Maximum leverage allowed in current state
- `deleverageLevel` — Recommended auto-deleverage level (0-5)
- `deleverageAction` — Action description for current level
- `meta` — State metadata (color, icon, label)

---

## Auto-Deleverage Cascade

When Euler V2 health score drops, automatic deleveraging kicks in through a 5-level cascade.

### ADL Levels

```
Health Score > 1.5      Normal operation
     |
     v
HS 1.4-1.5              Warning: increase monitoring frequency
     |
     v
HS 1.3-1.4              Level 1: Reduce all leverage by 25%
     |                   (commit-reveal, 1-10 block delay)
     v
HS 1.2-1.3              Level 2: Reduce all leverage by 50%
     |                   (commit-reveal, 1-5 block delay)
     v
HS 1.1-1.2              Level 3: Cap all positions at 1.5x
     |                   (immediate, no delay)
     v
HS < 1.1                Level 4: Force all positions to 1x (spot only)
     |                   (immediate, emergency)
     v
HS < 1.05               Level 5: Emergency unwind, pause everything
```

### Proportional Reduction Formula

```
L_new = 1 + (L_old - 1) x reduction_factor
```

**Example at Level 1 (25% reduction, factor = 0.75):**
- User at +4x: new = 1 + (4-1) x 0.75 = **3.25x**
- User at +3x: new = 1 + (3-1) x 0.75 = **2.5x**
- User at -2x: new = 1 + (-2-1) x 0.75 = **-1.25x**
- User at +1x: unchanged (no excess leverage to reduce)

### Frontend Deleverage Levels

| Level | Drawdown Trigger | Action | Target Leverage |
|-------|-----------------|--------|-----------------|
| 0 | < 10% | None | -- |
| 1 | 10% | Reduce 25% | Proportional |
| 2 | 15% | Reduce 50% | Proportional |
| 3 | 22% | Cap at 1.5x | 1.5x max |
| 4 | 30% | Force to 1.0x | 1.0x |
| 5 | 40% | Liquidation | 0.0x |

### Anti-Gaming: Commit-Reveal ADL

**Problem:** ADL at fixed thresholds creates predictable sell pressure. Sophisticated actors can short before the cascade.

**Solution:** Two-phase ADL with randomized execution delay and compound trigger conditions.

```
Phase 1 (Commit): Keeper submits ADL trigger hash
Phase 2 (Reveal + Execute): After random delay (1-10 blocks),
  keeper reveals and executes ADL

Compound trigger (Levels 1-2 must satisfy BOTH):
  - Health Score < threshold, AND
  - Price drop > 5% from 24h high OR realized volatility > 60% annualized

If HS < threshold but price/vol conditions not met:
  - Rebalance only (reduce Euler positions, don't force-deleverage users)

Levels 3+: HS alone is sufficient (emergency, can't wait for confirmation)
```

The random delay is derived from `blockhash(block.number - 1) % 10`, making the execution timing unpredictable.

---

## Circuit Breaker System

| Level | Trigger | Response |
|-------|---------|----------|
| Green | Normal operation | All functions active |
| Yellow | Divergence > 1% OR vol > 50% | Dynamic fees kick in |
| Orange | Junior drawdown > 15% OR HS < 1.3 | Pause leverage increases, force deleverage |
| Red | Junior drawdown > 30% OR HS < 1.1 | Full pause, emergency withdraw only |
| Black | Protocol insolvency risk | Emergency unwind, pro-rata distribution |

### Circuit Breaker State

Tracked on-chain:
- `dailyVolume` / `dailyVolumeLimit` — Rolling 24h notional cap
- `lastJuniorValue` / `maxDrawdownBps` — Junior NAV monitoring
- `volatility24h` / `volatilityThresholdBps` — Realized vol check
- `state` — 0=normal, 1=warning, 2=triggered

---

## Loss Waterfall

When losses occur, they flow through three tiers before reaching senior users.

```
Pool Loss Occurs
     |
     v
TIER 1: JUNIOR TRANCHE (First Loss)
     |  If loss <= junior capacity: Junior reduced, senior untouched
     |  If loss > junior capacity: Junior wiped to zero
     |
     v (excess only)
TIER 2: INSURANCE FUND (Second Loss)
     |  If loss <= insurance: Insurance absorbs remainder
     |  If loss > insurance: Insurance depleted
     |
     v (excess only)
TIER 3: SENIOR POSITIONS (Last Resort)
     Socialized pro-rata by DEPOSIT SHARE (not notional)

     Loss per user = excess x (user_deposit / total_deposits)
```

### Why Deposit Share, Not Notional?

If losses were proportional to `|D_i x L_i|` (notional), a conservative 1x user would subsidize the risk of a 4x user. Socializing by deposit share is equitable: each user risks the same percentage of their capital regardless of leverage. The 4x user already pays more in carry fees.

### Loss Attribution Formula

For senior users (only after junior + insurance exhausted):

```
Loss_i = Excess_Loss x (D_i / SUM(D_j))
```

---

## Underwater Position Handling

When a user's position value goes negative:

1. Position automatically closed
2. Loss = |negative value| + deposit
3. Loss flows through waterfall (junior -> insurance -> senior)
4. User's position deleted
5. **No debt owed by user** — max loss is deposit
6. User can re-enter with a fresh deposit

---

## Naked Short Exposure Check

The protocol checks available Euler vault liquidity before accepting new short positions:

- If net short exposure exceeds 80% of available lending liquidity on Euler, new shorts are paused
- The protocol cannot hedge a short if it cannot borrow the underlying asset
- This prevents the protocol from taking on obligations it cannot fulfill

---

## Risk Engine API (Frontend)

```javascript
const result = RiskEngine.evaluate({
  oracleAgeSec: 120,        // seconds since last oracle update
  oracleDivergence: 0.005,  // 0.5% divergence
  drawdown: 0.08,           // 8% from peak
  healthFactor: 1.45,       // Euler vault health
  volatility: 0.55,         // 55% annualized vol
  utilization: 0.60,        // 60% pool utilization
})

// result = {
//   state: 'WARNING',
//   reasons: ['Drawdown 8.0% exceeds 5% threshold', 'Volatility 55% exceeds 50% threshold'],
//   leverageCap: 3.0,
//   deleverageLevel: 0,
//   deleverageAction: 'none',
//   meta: { label: 'Warning', color: '#ffd740', icon: 'warning', maxLeverage: 3.0 }
// }
```
