# Spawn Prompt: Agent-Core

## CONTEXT

You are building the core trading logic for the xLever AI Trading Agent.

**PRD Location**: `docs/prds/2026-04-01-xlever-ai-agent/PRD.md`
**Target Repo**: `xLever/agent/`
**Dependencies**: Agent-Foundation must be complete

### Protocol Constraints (CRITICAL)
```python
# Leverage
MIN_LEVERAGE_BPS = -40000  # -4x short
MAX_LEVERAGE_BPS = 40000   # +4x long

# Timing locks
LEVERAGE_INCREASE_LOCK = 3600      # 1 hour
DIRECTION_FLIP_LOCK = 14400        # 4 hours

# Fee thresholds
MAX_DIVERGENCE_BPS = 300           # 3% = reject
BASE_ENTRY_FEE_BPS = 8             # 0.08%

# Health score levels
HS_SAFE = 1.5
HS_WARNING = 1.4
HS_LEVEL_1 = 1.3                   # Reduce 25%
HS_LEVEL_2 = 1.2                   # Reduce 50%
HS_LEVEL_3 = 1.1                   # Max 1.5x
HS_EMERGENCY = 1.05                # Full exit
```

### Dynamic Leverage Caps
```python
def get_max_leverage(junior_ratio: float) -> int:
    if junior_ratio >= 0.40: return 40000  # 4x
    if junior_ratio >= 0.30: return 30000  # 3x
    if junior_ratio >= 0.20: return 20000  # 2x
    return 15000  # 1.5x
```

---

## SCOPE

Extend the agent structure with:

```
agent/
├── intelligence/
│   ├── market.py             # Task 9
│   └── sentiment.py          # Task 10
│
├── strategy/                  # Tasks 11-12
│   ├── __init__.py
│   ├── llm_strategy.py
│   ├── rules.py
│   └── signals.py
│
├── risk/                      # Tasks 15-17
│   ├── __init__.py
│   ├── sizing.py
│   ├── health.py
│   └── limits.py
│
├── execution/
│   ├── tx_builder.py         # Task 13
│   └── positions.py          # Task 14
│
├── hitl/                      # Task 18
│   ├── __init__.py
│   └── controller.py
│
├── monitor/                   # Task 19
│   ├── __init__.py
│   ├── metrics.py
│   └── alerts.py
│
└── main.py                    # Task 20
```

---

## YOUR TASKS

### Task 9: Market Intelligence Module
Create `agent/intelligence/market.py`:
- Aggregate data from multiple sources:
  - Perplexity API (via client from Foundation)
  - On-chain pool state (net exposure, funding rate)
  - TWAP and spot prices from Pyth
- Build `MarketState` dataclass with all relevant fields
- Cache and refresh logic (15 min default, immediate on >1% price move)

### Task 10: Sentiment Analysis
Create `agent/intelligence/sentiment.py`:
- Parse Perplexity responses into structured sentiment
- Extract upcoming events, risk factors
- Generate position bias recommendation
- Confidence scoring

### Task 11: Strategy Engine - LLM Integration
Create `agent/strategy/llm_strategy.py`:
- Build prompts dynamically from market state
- Parse LLM responses into `Decision` objects
- Handle malformed responses gracefully
- Implement retry logic for LLM failures

**Use the exact prompts from PRD Section 2.2.**

### Task 12: Strategy Engine - Rule Engine
Create `agent/strategy/rules.py`:
- Implement all 8 rules from PRD:
  - R1: Max Leverage
  - R2: Leverage Lock
  - R3: Flip Lock
  - R4: Divergence Gate
  - R5: Health Guard
  - R6: Position Size Limit
  - R7: Daily Loss Limit
  - R8: Gas Guard
- Each rule returns `(passed: bool, reason: str)`
- Rules can BLOCK or MODIFY decisions

### Task 13: Transaction Builder
Create `agent/execution/tx_builder.py`:
- Build transactions for:
  - `openLongPosition(collateral, leverage)`
  - `openShortPosition(collateral, leverage)`
  - `closePosition()`
- Gas estimation
- Slippage protection parameters

### Task 14: Position Manager
Create `agent/execution/positions.py`:
- Track active positions in database
- Calculate PnL (unrealized and realized)
- Update position state after transactions
- Handle partial fills (shouldn't happen, but defensive)

### Task 15: Position Sizing
Create `agent/risk/sizing.py`:
- Kelly-inspired sizing formula (see PRD Section 2.3.1)
- Inputs: capital, leverage, confidence, volatility, pool_concentration
- Output: recommended position size in USDC

### Task 16: Health Monitor
Create `agent/risk/health.py`:
- Poll health score from Euler vaults
- Track health score history
- Trigger alerts at thresholds
- Recommend actions based on HS level

### Task 17: Stop-Loss & Take-Profit
Create `agent/risk/limits.py`:
- `RiskLimits` dataclass with configurable thresholds
- Check functions: `should_stop_loss()`, `should_take_profit()`
- Trailing stop implementation
- Daily loss tracking

### Task 18: HITL Controller
Create `agent/hitl/controller.py`:
- Mode management (AUTONOMOUS, APPROVAL_REQUIRED, etc.)
- Decision queue for pending approvals
- Approval/rejection processing
- Timeout handling based on urgency

### Task 19: Monitor & Alerts
Create `agent/monitor/metrics.py` and `alerts.py`:
- Metrics collection and storage
- Alert rule evaluation
- WebSocket event broadcast
- Dashboard data preparation

### Task 20: Main Agent Loop
Create `agent/main.py`:
- Async main loop with configurable interval
- Orchestrate all components:
  1. Refresh market intelligence
  2. Check risk limits
  3. Generate strategy decision
  4. Apply rule engine
  5. Route through HITL (if enabled)
  6. Execute trade
  7. Update monitoring
- Graceful shutdown handling
- Error recovery

---

## BOUNDARIES

**DO:**
- Use all Foundation components (don't recreate)
- Follow protocol constraints exactly
- Log all decisions with full context
- Handle all error cases
- Use async throughout

**DO NOT:**
- Skip rule engine checks (they are safety critical)
- Execute trades without logging
- Ignore health score warnings
- Use blocking I/O in the main loop
- Store trading history only in memory (use database)

---

## SUCCESS CRITERIA

- [ ] Rule engine correctly blocks invalid trades
- [ ] LLM decisions are parsed and validated
- [ ] Health score triggers correct actions
- [ ] HITL approval flow works end-to-end
- [ ] Main loop runs without crashing for 1 hour (paper mode)
- [ ] All decisions are logged to database
- [ ] WebSocket alerts are broadcast for critical events

---

## PATTERNS TO FOLLOW

### Decision Flow Pattern
```python
async def make_decision(self, market_state: MarketState) -> Decision:
    # 1. Get LLM recommendation
    llm_decision = await self.llm_strategy.decide(market_state)

    # 2. Apply rule engine
    validated = self.rule_engine.validate(llm_decision, market_state)

    # 3. Route through HITL if needed
    if self.hitl.requires_approval(validated):
        validated = await self.hitl.request_approval(validated)

    return validated
```

### Rule Engine Pattern
```python
@dataclass
class RuleResult:
    passed: bool
    rule_name: str
    reason: str
    modified_decision: Optional[Decision] = None

class RuleEngine:
    def validate(self, decision: Decision, state: MarketState) -> Decision:
        for rule in self.rules:
            result = rule.check(decision, state)
            if not result.passed:
                if result.modified_decision:
                    decision = result.modified_decision
                else:
                    decision.blocked = True
                    decision.block_reason = result.reason
        return decision
```

### Health Monitor Pattern
```python
class HealthMonitor:
    async def check_and_act(self) -> Optional[Action]:
        hs = await self.get_health_score()

        if hs < HS_EMERGENCY:
            return Action.EMERGENCY_EXIT
        elif hs < HS_LEVEL_3:
            return Action.REDUCE_TO_1_5X
        elif hs < HS_LEVEL_2:
            return Action.REDUCE_50_PERCENT
        elif hs < HS_LEVEL_1:
            return Action.REDUCE_25_PERCENT
        elif hs < HS_WARNING:
            await self.alert("Health score warning", severity="warning")

        return None
```

### Main Loop Pattern
```python
async def run(self):
    while self.running:
        try:
            # Check health first (safety)
            health_action = await self.health_monitor.check_and_act()
            if health_action:
                await self.execute_health_action(health_action)
                continue

            # Normal decision flow
            market_state = await self.intelligence.refresh()
            decision = await self.make_decision(market_state)

            if decision.action != "HOLD" and not decision.blocked:
                await self.execute(decision)

            await self.monitor.record_cycle()

        except Exception as e:
            await self.handle_error(e)

        await asyncio.sleep(self.config.loop_interval)
```
