# API Integrations

All external data sources and backend services used by xLever.

---

## Pyth Network (On-Chain Oracle)

Pyth provides the price oracle for all on-chain operations using a **pull-oracle** pattern: the frontend fetches price updates off-chain and passes them to the contract for on-chain verification.

### Architecture

```
Pyth Hermes API (off-chain)
     |
     | fetch VAA bytes
     v
Frontend (pyth.js)
     |
     | pass priceUpdateData + msg.value (fee)
     v
Smart Contract (PythOracleAdapter.sol)
     |
     | verify signature, update price
     v
Pyth Contract (on-chain, Ink Sepolia)
```

### Hermes Endpoint

```
GET https://hermes.pyth.network/v2/updates/price/latest
```

**Parameters:**
- `ids[]` — Feed IDs (hex, without 0x prefix)
- `encoding` — `hex` (for contract consumption)

**Response:**
- `binary.data[]` — Array of hex-encoded VAA bytes (pass to contract as `priceUpdateData`)
- `parsed[]` — Human-readable price objects for UI display

### Registered Feed IDs

| Symbol | Feed ID | Status |
|--------|---------|--------|
| QQQ/USD | `0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d` | Active |
| SPY/USD | `0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5` | Active |
| AAPL/USD | `0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688` | Active |
| NVDA/USD | `0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593` | Active |
| TSLA/USD | `0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` | Active |
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` | Active |

### Assets Without Pyth Feeds (Not Yet Supported)

The following 9 assets do not have Pyth price feeds and cannot be supported by the protocol until feeds become available:

| Symbol | Asset |
|--------|-------|
| MOO | -- |
| URA | -- |
| VCX | -- |
| LITE | -- |
| USAR | -- |
| UUUU | -- |
| COPX | -- |
| SLMT | -- |
| KRAQ | -- |

These assets are blocked from vault creation until corresponding Pyth feeds are registered.

### Frontend Client (pyth.js)

```javascript
import { getLatestPriceUpdate, getPriceForFeed, getAllPrices, PYTH_FEEDS } from './pyth.js'

// Fetch update data for a contract call
const { updateData, prices } = await getLatestPriceUpdate([
  PYTH_FEEDS['QQQ/USD'],
  PYTH_FEEDS['SPY/USD'],
])

// Single feed
const { updateData, price, conf, publishTime } = await getPriceForFeed(PYTH_FEEDS['QQQ/USD'])

// All registered feeds at once
const { updateData, prices } = await getAllPrices()

// Check oracle staleness
import { oracleAge } from './pyth.js'
const ageSec = oracleAge(publishTime)  // seconds since update

// Check price divergence
import { priceDivergence } from './pyth.js'
const div = priceDivergence(priceA, priceB)  // 0.01 = 1%
```

### On-Chain Contract

| Contract | Address (Ink Sepolia) |
|----------|-----------------------|
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| PythAdapter | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` |

---

## Yahoo Finance (Market Data Proxy)

Historical OHLCV data for the backtesting engine. Proxied through a Python server to avoid CORS.

### Server

`server/server.py` — Simple Python CORS proxy.

```
Frontend request:
  GET /api/chart/QQQ?range=1y&interval=1d

Proxy forwards to:
  GET https://query1.finance.yahoo.com/v8/finance/chart/QQQ?range=1y&interval=1d

Returns: JSON with OHLCV arrays
```

### Frontend Usage

```javascript
// In app.js
const data = await fetchRealData('QQQ', '2023-01-01', '2024-01-01')
// Returns: { dates[], opens[], highs[], lows[], closes[], volumes[] }
```

### Running the Proxy

```bash
cd server && python3 server.py
# Runs on http://localhost:8000
```

Vite dev server proxies `/api/*` to `http://localhost:8000` automatically.

---

## OpenBB Platform (Market Intelligence)

Financial data and analytics for the AI agent context and dashboard intelligence.

### Backend Routes

`server/api/routes/openbb.py` provides:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/openbb/quote/{symbol}` | GET | Real-time quote |
| `/api/openbb/historical/{symbol}` | GET | Historical OHLCV |
| `/api/openbb/options/{symbol}` | GET | Options chain |
| `/api/openbb/snapshot` | GET | Market snapshot |

### Frontend Client (openbb.js)

```javascript
import { getQuote, getHistorical, getDashboardContext } from './openbb.js'

const quote = await getQuote('QQQ')
const history = await getHistorical('QQQ', '1y')
const context = await getDashboardContext()  // Aggregated market snapshot
```

### Use Cases

- **AI Agent:** Market context for autonomous trading decisions
- **Dashboard:** Market intelligence display
- **Risk Engine:** Volatility and correlation data

---

## FastAPI Backend

`server/api/main.py` — Full API backend with database and caching.

### Routes

| Path | Module | Description |
|------|--------|-------------|
| `/api/users` | `routes/users.py` | User data (SIWE wallet auth) |
| `/api/positions` | `routes/positions.py` | Position history and tracking |
| `/api/agents` | `routes/agents.py` | Agent execution logs |
| `/api/prices` | `routes/prices.py` | Price cache and aggregation |
| `/api/alerts` | `routes/alerts.py` | Risk alert management |
| `/api/openbb` | `routes/openbb.py` | Market intelligence proxy |
| `/api/lending` | `routes/lending.py` | Multi-chain lending markets, positions, rates (Euler V2 + Kamino + EVAA) |

### Authentication

Uses **SIWE** (Sign-In with Ethereum) — wallet-based authentication. No traditional username/password.

### Infrastructure

| Component | Technology |
|-----------|-----------|
| Framework | FastAPI + uvicorn |
| Database | PostgreSQL + SQLAlchemy ORM |
| Migrations | Alembic |
| Cache | Redis |
| Auth | SIWE (Sign-In with Ethereum) |

### Running

```bash
cd server
pip install -r requirements.txt
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

### Dependencies (requirements.txt)

- `fastapi`, `uvicorn` — Web framework
- `sqlalchemy`, `asyncpg` — Database ORM + async PostgreSQL driver
- `alembic` — Database migrations
- `redis` — Caching layer
- `siwe` — Wallet-based authentication
- `openbb[all]` — Market data platform
- `python-dotenv` — Environment variable loading
