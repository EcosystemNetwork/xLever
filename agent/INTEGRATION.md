# Integration Guide: Python AI Agent ↔ Frontend Branch

## Architecture Overview

### Two Complementary Agent Systems

The xLever platform now has **two agent systems** that serve different purposes:

```
┌─────────────────────────────────────────────────────────────────┐
│                     xLever Architecture                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────┐    ┌──────────────────────┐   │
│  │   Frontend Client-Side Agent  │    │  Python Backend Agent │   │
│  │   (Browser JavaScript)        │    │  (Server-Side)        │   │
│  ├──────────────────────────────┤    ├──────────────────────┤   │
│  │ • News analysis pipeline     │    │ • Autonomous trading  │   │
│  │ • LLM-powered analysts       │    │ • HITL controls       │   │
│  │ • Signal aggregation         │    │ • Risk management     │   │
│  │ • User-initiated execution   │    │ • 8 safety guardrails │   │
│  │ • Runs in user's browser     │    │ • Tavily intelligence │   │
│  └──────────────────────────────┘    │ • Backtesting engine  │   │
│              │                       │ • Paper trading mode  │   │
│              │                       └──────────────────────┘   │
│              │                                  │                │
│              └────────────┬─────────────────────┘                │
│                           │                                      │
│                           ▼                                      │
│              ┌──────────────────────────────┐                   │
│              │    FastAPI Backend Server     │                   │
│              │    (server/api/main.py)       │                   │
│              ├──────────────────────────────┤                   │
│              │ Routes:                       │                   │
│              │  /api/agents  (client runs)   │                   │
│              │  /api/positions (cached)      │                   │
│              │  /api/prices, /api/news       │                   │
│              │  /api/alerts, /api/lending    │                   │
│              │                               │                   │
│              │ NEW (from Python agent):      │                   │
│              │  /api/autonomous-agent/*      │                   │
│              │  /api/autonomous/decisions    │                   │
│              │  /api/autonomous/positions    │                   │
│              └──────────────────────────────┘                   │
│                           │                                      │
│                           ▼                                      │
│              ┌──────────────────────────────┐                   │
│              │    Shared WebSocket Server    │                   │
│              │    Real-time events           │                   │
│              └──────────────────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Component Comparison

| Aspect | Frontend Agent (JS) | Python Agent (Server) |
|--------|--------------------|-----------------------|
| **Location** | Browser | Server |
| **Execution** | User-triggered | Autonomous loop |
| **News Source** | OpenBB via API | Tavily AI Search |
| **Analysis** | 3 parallel LLM analysts | Single LLM with Perplexity/Tavily |
| **Guardrails** | Risk engine checks | 8 rule-based guardrails |
| **Approval** | Always requires user | HITL modes (auto/approval/notify) |
| **Persistence** | Browser session | Database + in-memory cache |
| **Wallet** | Connected wallet | Configured private key |

## ⚠️ Route Conflicts Identified

### Critical: `/api/positions` Conflict

**Frontend Server** (server/api/routes/positions.py):
```
GET  /api/positions/{wallet_address}        → Get positions for a specific wallet
GET  /api/positions/{wallet_address}/active → Get active positions for wallet
GET  /api/positions/{wallet_address}/stats  → Get position statistics
```

**Our Python Agent** (agent/agent/api/routes/positions.py):
```
GET  /api/positions                         → List all autonomous agent positions
GET  /api/positions/active                  → List active positions
GET  /api/positions/summary                 → Get summary stats
GET  /api/positions/{position_id}           → Get specific position
```

### Root Cause

The two systems have **different routing philosophies**:
- **Frontend**: Wallet-centric → `/positions/{wallet_address}/...`
- **Python Agent**: Agent-centric → `/positions/...` (single platform wallet)

### Resolution: Namespace with `/autonomous/`

Rename all Python agent routes to avoid conflicts:

| Current Python Agent Route | Renamed Route (No Conflict) |
|---------------------------|----------------------------|
| `GET /api/positions` | `GET /api/autonomous/positions` |
| `GET /api/positions/active` | `GET /api/autonomous/positions/active` |
| `GET /api/positions/summary` | `GET /api/autonomous/positions/summary` |
| `GET /api/positions/{id}` | `GET /api/autonomous/positions/{id}` |
| `GET /api/agent/status` | `GET /api/autonomous/status` |
| `POST /api/agent/mode` | `POST /api/autonomous/mode` |
| `GET /api/decisions` | `GET /api/autonomous/decisions` |

### Also Note: `/api/agents` vs `/api/agent`

No actual conflict, but confusing naming:
- **Frontend**: `/api/agents/{wallet}/runs` (plural, wallet-scoped)
- **Our Agent**: `/api/agent/status` (singular, global)

**Recommendation**: Keep the plural/singular distinction to differentiate:
- `/api/agents/*` = User-initiated agent runs (per wallet)
- `/api/autonomous/*` = Server autonomous agent (platform-controlled)

## Integration Strategy

### Option A: Unified Server (Recommended)

Merge the Python agent API into the existing Frontend server:

```
server/
├── api/
│   ├── routes/
│   │   ├── agents.py              # Existing: client-side agent runs
│   │   ├── autonomous.py          # NEW: Python agent control
│   │   ├── autonomous_decisions.py # NEW: decision history
│   │   └── autonomous_positions.py # NEW: autonomous positions
│   └── ...
├── autonomous_agent/              # NEW: Python agent module
│   ├── __init__.py
│   ├── trading_agent.py           # Main agent loop
│   ├── strategy/
│   ├── risk/
│   ├── intelligence/
│   └── execution/
```

**Benefits:**
- Single server to deploy and manage
- Shared database connection pool
- Unified authentication
- Shared WebSocket broadcaster

### Option B: Microservice (Alternative)

Keep the Python agent as a separate service:

```
┌─────────────────┐      ┌─────────────────┐
│ Frontend Server │ ←──→ │ Python Agent    │
│ (port 8000)     │      │ (port 8001)     │
└─────────────────┘      └─────────────────┘
         ↑                        ↑
         └────────────────────────┘
                   │
            Frontend UI
```

**Benefits:**
- Independent deployment
- Can scale separately
- Clear separation of concerns

## Route Mapping

### Current Python Agent Routes → New Unified Routes

| Python Agent Route | Unified Server Route |
|-------------------|---------------------|
| `GET /api/agent/status` | `GET /api/autonomous/status` |
| `POST /api/agent/mode` | `POST /api/autonomous/mode` |
| `GET /api/agent/pending` | `GET /api/autonomous/pending` |
| `POST /api/agent/approve/{id}` | `POST /api/autonomous/approve/{id}` |
| `POST /api/agent/start` | `POST /api/autonomous/start` |
| `POST /api/agent/stop` | `POST /api/autonomous/stop` |
| `GET /api/positions/*` | `GET /api/autonomous/positions/*` |
| `GET /api/decisions/*` | `GET /api/autonomous/decisions/*` |

### Existing Frontend Routes (Keep As-Is)

| Route | Purpose |
|-------|---------|
| `GET/POST /api/agents/{wallet}/runs` | Client-side agent run history |
| `GET/POST /api/agents/runs/{id}/*` | Individual run management |
| `GET /api/positions` | Cached on-chain positions |

## WebSocket Event Unification

### Current Event Types

**Frontend ws-broadcast.js:**
```javascript
EventType = {
  DECISION_MADE: 'decision_made',
  POSITION_OPENED: 'position_opened',
  MARKET_UPDATE: 'market_update',
  AGENT_STARTED: 'agent_started',
  // ...
}
```

**Python agent websocket/server.py:**
```python
class AlertType(Enum):
    DECISION_PENDING = "decision_pending"
    POSITION_OPENED = "position_opened"
    HEALTH_WARNING = "health_warning"
    # ...
```

### Unified Event Schema

```json
{
  "type": "autonomous_decision_made",
  "source": "python_agent",
  "timestamp": "2026-04-01T12:00:00Z",
  "data": {
    "decision_id": "uuid",
    "action": "OPEN_LONG",
    "asset": "wSPYx",
    "confidence": 85,
    "requires_approval": true
  }
}
```

**Namespace events by source:**
- `autonomous_*` → Python server agent
- `client_*` → Browser agent
- `system_*` → Platform-wide events

## Database Schema Integration

### New Tables for Python Agent

```sql
-- Autonomous agent runs (different from client agent_runs)
CREATE TABLE autonomous_runs (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'running',
    mode VARCHAR(30) DEFAULT 'autonomous',
    paper_mode BOOLEAN DEFAULT true,
    total_decisions INT DEFAULT 0,
    total_trades INT DEFAULT 0,
    config JSONB
);

-- Autonomous decisions
CREATE TABLE autonomous_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id INT REFERENCES autonomous_runs(id),
    action VARCHAR(20) NOT NULL,
    asset VARCHAR(20) NOT NULL,
    leverage_bps INT,
    size_usdc NUMERIC(20, 8),
    confidence INT,
    reasoning TEXT,
    blocked BOOLEAN DEFAULT false,
    block_reason TEXT,
    approved BOOLEAN,
    approved_by VARCHAR(100),
    executed BOOLEAN DEFAULT false,
    execution_tx VARCHAR(66),
    created_at TIMESTAMP DEFAULT NOW(),
    executed_at TIMESTAMP
);

-- Link to existing positions table when autonomous agent opens/closes
ALTER TABLE positions
ADD COLUMN autonomous_decision_id UUID REFERENCES autonomous_decisions(id);
```

## Integration Steps

### Step 1: Prepare for Merge

```bash
# On feat/ai-trading-agent branch
git fetch origin Frontend
git merge origin/Frontend --no-commit

# Resolve conflicts (expect conflicts in server/api/)
```

### Step 2: Reorganize Python Agent Code

Move from `agent/agent/` to `server/autonomous_agent/`:

```bash
mkdir -p server/autonomous_agent
cp -r agent/agent/* server/autonomous_agent/
```

Update imports:
```python
# Old: from agent.config import AgentConfig
# New: from autonomous_agent.config import AgentConfig
```

### Step 3: Register Routes in main.py

```python
# server/api/main.py

# Add new imports
from .routes import autonomous, autonomous_decisions, autonomous_positions

# Add new routers
app.include_router(autonomous.router, prefix="/api")
app.include_router(autonomous_decisions.router, prefix="/api")
app.include_router(autonomous_positions.router, prefix="/api")
```

### Step 4: Unify WebSocket Broadcasting

Connect Python agent to existing ws-broadcast system:

```python
# server/autonomous_agent/websocket_adapter.py

import aiohttp

class WSBroadcastAdapter:
    """Adapter to emit events to ws-broadcast.js"""

    async def emit(self, event_type: str, data: dict):
        event = {
            "type": f"autonomous_{event_type}",
            "source": "python_agent",
            "timestamp": datetime.utcnow().isoformat(),
            "data": data
        }
        # Send to internal event bus or WebSocket endpoint
        # ws-broadcast.js will relay to all subscribers
```

### Step 5: Frontend UI Updates

Add autonomous agent controls to `03-ai-agent-operations.html`:

```html
<!-- New section for autonomous agent -->
<div class="autonomous-agent-panel">
    <h3>🤖 Autonomous Agent</h3>
    <div id="autonomous-status">Stopped</div>
    <select id="hitl-mode">
        <option value="autonomous">Fully Autonomous</option>
        <option value="approval_required">Require Approval</option>
        <option value="approval_above_threshold">Approval Above $1000</option>
        <option value="notifications_only">Notify Only</option>
    </select>
    <button onclick="startAutonomousAgent()">Start</button>
    <button onclick="stopAutonomousAgent()">Stop</button>

    <!-- Pending decisions for HITL approval -->
    <div id="pending-decisions"></div>
</div>
```

## Testing the Integration

### 1. API Compatibility Test

```bash
# Start unified server
cd server && uvicorn api.main:app --reload --port 8000

# Test existing routes
curl http://localhost:8000/api/health
curl http://localhost:8000/api/agents/0x123.../runs

# Test new autonomous routes
curl http://localhost:8000/api/autonomous/status
curl -X POST http://localhost:8000/api/autonomous/start
```

### 2. WebSocket Event Test

```javascript
// In browser console
const ws = new WebSocket('ws://localhost:8000/ws');
ws.onmessage = (e) => console.log('Event:', JSON.parse(e.data));
// Should receive autonomous_* events when Python agent runs
```

### 3. End-to-End Flow Test

1. Start autonomous agent in `notifications_only` mode
2. Verify WebSocket broadcasts `autonomous_decision_made` events
3. Check decisions appear in `03-ai-agent-operations.html`
4. Switch to `approval_required` mode
5. Verify pending decisions queue works
6. Approve a decision, verify execution

## Configuration Unification

### Environment Variables

```env
# server/.env

# Existing Frontend config
DATABASE_URL=postgresql+asyncpg://...
CORS_ORIGINS=["http://localhost:5173"]
CHAIN_ID=763373

# NEW: Python agent config
TAVILY_API_KEY=tvly-xxx
PRIVATE_KEY=0x...
PAPER_MODE=true
DEFAULT_HITL_MODE=approval_required
WEB3_RPC_URL=https://rpc-gel-sepolia.inkonchain.com
```

## Migration Checklist

- [ ] Merge Frontend branch into feat/ai-trading-agent
- [ ] Move `agent/agent/` → `server/autonomous_agent/`
- [ ] Update all import paths
- [ ] Add autonomous routes to `server/api/main.py`
- [ ] Create Alembic migration for new tables
- [ ] Connect WebSocket adapter
- [ ] Update Frontend UI with autonomous controls
- [ ] Test full integration flow
- [ ] Update deployment scripts

## Notes

### Why Two Agent Systems?

1. **Frontend Agent** = User-controlled, runs in their browser, uses their connected wallet
2. **Python Agent** = Platform-controlled, runs on server, uses designated trading wallet

Both can coexist because they serve different use cases:
- Users who want AI-assisted manual trading → Frontend Agent
- Users who want fully autonomous trading → Python Agent (with HITL options)

### Security Considerations

- Python agent has its own wallet (not user wallets)
- HITL modes provide safety controls
- Rate limiting applies to both systems
- Separate audit logs for each agent type
