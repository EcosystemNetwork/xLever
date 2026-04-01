# Spawn Prompt: Agent-Tests

## CONTEXT

You are building the test suite and supporting infrastructure for the xLever AI Trading Agent.

**PRD Location**: `docs/prds/2026-04-01-xlever-ai-agent/PRD.md`
**Target Repo**: `xLever/agent/`
**Dependencies**: Agent-Foundation (mostly), Agent-Core (for integration/E2E)

---

## SCOPE

Create the following:

```
agent/
├── api/                       # Task 28
│   ├── __init__.py
│   ├── server.py
│   └── routes/
│       ├── __init__.py
│       ├── agent.py
│       ├── positions.py
│       └── decisions.py
│
└── backtest/                  # Task 27
    ├── __init__.py
    ├── simulator.py
    ├── data_loader.py
    └── metrics.py

tests/
├── __init__.py
├── conftest.py               # Shared fixtures
├── test_rules.py             # Task 21
├── test_risk.py              # Task 22
├── test_decisions.py         # Task 23
├── integration/
│   ├── __init__.py
│   ├── test_web3.py          # Task 24
│   └── test_perplexity.py    # Task 25
└── e2e/
    ├── __init__.py
    └── test_paper_trading.py # Task 26
```

---

## YOUR TASKS

### Task 21: Unit Tests - Rule Engine
Create `tests/test_rules.py`:

Test all 8 rules with edge cases:

```python
class TestRuleEngine:
    # R1: Max Leverage
    def test_leverage_exceeds_cap_is_blocked(self):
        """Request 4x when cap is 3x → blocked or reduced"""

    def test_leverage_within_cap_passes(self):
        """Request 3x when cap is 4x → passes"""

    # R2: Leverage Lock
    def test_leverage_increase_during_lock_blocked(self):
        """Increase leverage within 1 hour of last increase → blocked"""

    def test_leverage_decrease_during_lock_allowed(self):
        """Decrease leverage anytime → allowed"""

    # R3: Flip Lock
    def test_long_to_short_flip_during_lock_blocked(self):
        """Flip direction within 4 hours → blocked"""

    # R4: Divergence Gate
    def test_entry_at_high_divergence_blocked(self):
        """TWAP divergence > 3% → entry blocked"""

    def test_exit_at_high_divergence_allowed(self):
        """Exits always allowed regardless of divergence"""

    # R5: Health Guard
    def test_low_health_forces_deleverage(self):
        """HS < 1.4 → force reduce leverage"""

    # R6: Position Size Limit
    def test_position_exceeding_pool_percentage_blocked(self):
        """Position > 20% of pool → blocked"""

    # R7: Daily Loss Limit
    def test_trading_paused_after_daily_loss(self):
        """Realized loss > 5% → pause trading"""

    # R8: Gas Guard
    def test_non_urgent_delayed_on_high_gas(self):
        """Gas > 100 gwei, urgency=low → delayed"""

    def test_urgent_executes_on_high_gas(self):
        """Gas > 100 gwei, urgency=high → executes"""
```

### Task 22: Unit Tests - Risk Manager
Create `tests/test_risk.py`:

```python
class TestPositionSizing:
    def test_base_sizing(self):
        """25% of capital at 100% confidence"""

    def test_confidence_scaling(self):
        """Lower confidence → smaller position"""

    def test_volatility_adjustment(self):
        """High volatility → smaller position"""

    def test_pool_concentration_limit(self):
        """Cannot exceed 20% of pool"""

class TestStopLoss:
    def test_stop_loss_triggers_at_threshold(self):
        """Position at -15% → trigger stop loss"""

    def test_trailing_stop_updates(self):
        """New high → trailing stop moves up"""

class TestHealthMonitor:
    def test_warning_at_1_4(self):
        """HS 1.4 → warning alert"""

    def test_level_1_at_1_3(self):
        """HS 1.3 → reduce 25%"""

    def test_emergency_at_1_05(self):
        """HS < 1.05 → full exit"""
```

### Task 23: Unit Tests - Decision Parser
Create `tests/test_decisions.py`:

```python
class TestDecisionParsing:
    def test_valid_open_long_parsed(self):
        """Valid JSON for OPEN_LONG → Decision object"""

    def test_valid_close_parsed(self):
        """Valid JSON for CLOSE → Decision object"""

    def test_malformed_json_handled(self):
        """Invalid JSON → fallback to HOLD"""

    def test_missing_fields_handled(self):
        """Missing required fields → error logged, HOLD"""

    def test_invalid_leverage_rejected(self):
        """Leverage outside -4x to +4x → rejected"""

    def test_confidence_bounds_enforced(self):
        """Confidence > 100 → clamped to 100"""
```

### Task 24: Integration Tests - Web3
Create `tests/integration/test_web3.py`:

```python
@pytest.mark.integration
class TestWeb3Integration:
    async def test_connection_to_ink_sepolia(self, web3_client):
        """Can connect to Ink Sepolia RPC"""
        assert await web3_client.is_connected()

    async def test_get_block_number(self, web3_client):
        """Can fetch current block"""
        block = await web3_client.get_block_number()
        assert block > 0

    async def test_get_balance(self, web3_client, test_address):
        """Can fetch ETH balance"""
        balance = await web3_client.get_balance(test_address)
        assert balance >= 0

    async def test_contract_call(self, web3_client):
        """Can call view function on deployed contract"""
        # Call a view function on the hedging module

    async def test_gas_estimation(self, web3_client):
        """Gas estimation works for complex transactions"""
```

### Task 25: Integration Tests - Perplexity
Create `tests/integration/test_perplexity.py`:

```python
@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("PERPLEXITY_API_KEY"), reason="No API key")
class TestPerplexityIntegration:
    async def test_basic_query(self, perplexity_client):
        """Can make a basic query"""
        response = await perplexity_client.query("What is 2+2?")
        assert response is not None

    async def test_market_analysis_query(self, perplexity_client):
        """Can get market analysis response"""
        # Use actual market analysis prompt

    async def test_response_parsing(self, perplexity_client):
        """Response is parseable into expected format"""

    async def test_rate_limiting(self, perplexity_client):
        """Rate limiting is respected"""

    async def test_error_handling(self, perplexity_client):
        """Errors are handled gracefully"""
```

### Task 26: E2E Tests - Paper Trading
Create `tests/e2e/test_paper_trading.py`:

```python
@pytest.mark.e2e
class TestPaperTrading:
    async def test_agent_starts_in_paper_mode(self, paper_agent):
        """Agent starts without errors in paper mode"""
        assert paper_agent.mode == "paper"

    async def test_decision_made_without_execution(self, paper_agent):
        """Agent makes decision but doesn't send transaction"""
        await paper_agent.run_cycle()
        assert paper_agent.last_decision is not None
        assert paper_agent.transactions_sent == 0

    async def test_simulated_position_tracking(self, paper_agent):
        """Paper positions are tracked correctly"""
        paper_agent.simulate_open_long(10000, 20000)  # $10k at 2x
        assert paper_agent.simulated_position is not None

    async def test_simulated_pnl_calculation(self, paper_agent):
        """PnL is calculated correctly in paper mode"""
        paper_agent.simulate_open_long(10000, 20000)
        paper_agent.update_price(1.05)  # 5% up
        assert paper_agent.simulated_pnl == pytest.approx(1000, rel=0.01)

    async def test_full_trading_cycle(self, paper_agent):
        """Full cycle: analyze → decide → simulate → track"""
        # Run multiple cycles
        for _ in range(5):
            await paper_agent.run_cycle()

        assert paper_agent.decisions_made > 0
```

### Task 27: Backtesting Framework
Create `agent/backtest/`:

```python
# simulator.py
class BacktestSimulator:
    def __init__(self, strategy, config: BacktestConfig):
        self.strategy = strategy
        self.config = config
        self.portfolio = SimulatedPortfolio()

    def run(self, data: pd.DataFrame) -> BacktestResult:
        """Run backtest on historical data"""

    def _simulate_fees(self, trade, divergence) -> float:
        """Calculate realistic fees including dynamic spread"""

# data_loader.py
class DataLoader:
    @staticmethod
    def load_yahoo_finance(symbol: str, start: str, end: str) -> pd.DataFrame:
        """Load OHLCV data from Yahoo Finance"""

    @staticmethod
    def load_local_csv(path: str) -> pd.DataFrame:
        """Load from local CSV file"""

# metrics.py
class BacktestMetrics:
    @staticmethod
    def sharpe_ratio(returns: pd.Series, risk_free: float = 0.02) -> float:
        """Calculate Sharpe ratio"""

    @staticmethod
    def max_drawdown(equity_curve: pd.Series) -> float:
        """Calculate maximum drawdown"""

    @staticmethod
    def win_rate(trades: List[Trade]) -> float:
        """Calculate win rate"""
```

### Task 28: API Server
Create `agent/api/`:

```python
# server.py
from fastapi import FastAPI, HTTPException
from agent.api.routes import agent, positions, decisions

app = FastAPI(title="xLever AI Agent API")
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(positions.router, prefix="/api/positions", tags=["positions"])
app.include_router(decisions.router, prefix="/api/decisions", tags=["decisions"])

# routes/agent.py
@router.get("/status", response_model=AgentStatus)
async def get_status():
    """Get agent health and state"""

@router.post("/mode", response_model=AgentStatus)
async def set_mode(request: SetModeRequest):
    """Set HITL mode"""

@router.get("/pending", response_model=List[PendingDecision])
async def get_pending_decisions():
    """List pending decisions awaiting approval"""

@router.post("/approve/{decision_id}")
async def approve_decision(decision_id: str, request: ApprovalRequest):
    """Approve or reject a pending decision"""

@router.post("/override")
async def manual_override(request: ManualTradeRequest):
    """Execute a manual trade override"""
```

---

## BOUNDARIES

**DO:**
- Use pytest and pytest-asyncio
- Create fixtures for common test data
- Mock external APIs in unit tests
- Use real APIs in integration tests (marked skipif no credentials)
- Cover edge cases thoroughly

**DO NOT:**
- Skip rule engine tests (they are safety critical)
- Make integration tests dependent on specific market conditions
- Create tests that can lose real money
- Commit API keys in test files

---

## SUCCESS CRITERIA

- [ ] All unit tests pass
- [ ] Integration tests pass (with credentials)
- [ ] E2E paper trading test runs for 10 minutes without crash
- [ ] Test coverage > 80% for risk and rule modules
- [ ] API server starts and serves status endpoint
- [ ] Backtester produces valid metrics on sample data

---

## FIXTURES (conftest.py)

```python
import pytest
import pytest_asyncio
from agent.config import Settings
from agent.execution.web3_client import Web3Client
from agent.intelligence.perplexity import PerplexityClient
from agent.websocket.server import WebSocketManager

@pytest.fixture
def mock_settings():
    return Settings(
        rpc_url="https://rpc-gel-sepolia.inkonchain.com",
        chain_id=763373,
        private_key="0x" + "1" * 64,  # Fake key for testing
        perplexity_api_key="test",
    )

@pytest_asyncio.fixture
async def web3_client(mock_settings):
    client = Web3Client(mock_settings.rpc_url)
    yield client
    await client.close()

@pytest.fixture
def sample_market_state():
    return MarketState(
        wspyx_price=5500.0,
        wqqqx_price=480.0,
        twap_divergence_bps=50,
        net_exposure="long",
        funding_rate_bps=5,
        junior_ratio=0.35,
        health_score=1.6,
    )

@pytest.fixture
def sample_decision():
    return Decision(
        action="OPEN_LONG",
        leverage_bps=20000,
        size_usdc=5000,
        confidence=75,
        reasoning="Bullish sentiment, low divergence",
        urgency="medium",
    )
```
