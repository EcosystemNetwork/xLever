"""
Comprehensive tests for admin dashboard endpoints.

Tests cover:
  - Auth (X-Admin-Key header validation)
  - Platform stats
  - User listing & detail
  - Daily/hourly activity charts
  - Session lifecycle (create, list, disconnect)
  - System health check
  - Error logs
  - Position overview
"""
import os
import sys
import pytest
import pytest_asyncio
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

# ─── Bootstrap: override config before any server module loads ──
os.environ["ADMIN_API_KEY"] = "test-admin-key"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["RPC_URL"] = "https://rpc-gel-sepolia.inkonchain.com/"
os.environ["CHAIN_ID"] = "763373"

# Create a mock Settings that database.py will use
_mock_settings = MagicMock()
_mock_settings.DATABASE_URL = "sqlite+aiosqlite:///:memory:"
_mock_settings.DEBUG = False
_mock_settings.APP_NAME = "xLever API Test"
_mock_settings.CORS_ORIGINS = ["http://localhost:3000"]
_mock_settings.RPC_URL = "https://rpc-gel-sepolia.inkonchain.com/"
_mock_settings.CHAIN_ID = 763373
_mock_settings.YAHOO_CACHE_TTL = 300

# Inject mock config module before database.py is imported
import server.api.config as config_mod
config_mod.get_settings = lambda: _mock_settings

# Now replace database.py engine with one that works for SQLite
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

# Create test engine (no pool_size/max_overflow for SQLite)
_test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
_test_session_factory = async_sessionmaker(_test_engine, expire_on_commit=False)

# Patch database module before it's used by routes
import server.api.database as db_mod
db_mod.engine = _test_engine
db_mod.async_session = _test_session_factory

# Now import the app and models
from httpx import AsyncClient, ASGITransport
from server.api.main import app
from server.api.database import Base, get_db
from server.api.models import (
    User, Position, AgentRun, Alert, UserSession,
    PositionStatus, PositionSide, AgentStatus, AlertType, AlertStatus, TrancheType,
)

ADMIN_HEADERS = {"X-Admin-Key": "test-admin-key"}
BAD_HEADERS = {"X-Admin-Key": "wrong-key"}


async def _override_get_db():
    async with _test_session_factory() as session:
        yield session

app.dependency_overrides[get_db] = _override_get_db


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create all tables before each test, drop after. Reset rate limiter."""
    # Reset rate limiter so tests don't hit 429
    from server.api.main import _rate_bucket
    _rate_bucket._hits.clear()

    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def db():
    async with _test_session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def seed_data(db: AsyncSession):
    """Seed DB with users, positions, sessions, agents, alerts."""
    u1 = User(wallet_address="0x" + "a" * 40)
    u2 = User(wallet_address="0x" + "b" * 40)
    db.add_all([u1, u2])
    await db.flush()

    p1 = Position(
        user_id=u1.id, wallet_address=u1.wallet_address,
        asset="QQQ", tranche=TrancheType.JUNIOR,
        deposit_amount=1000, leverage_bps=20000,
        side=PositionSide.LONG, status=PositionStatus.OPEN,
    )
    p2 = Position(
        user_id=u1.id, wallet_address=u1.wallet_address,
        asset="SPY", tranche=TrancheType.SENIOR,
        deposit_amount=500, leverage_bps=30000,
        side=PositionSide.SHORT, status=PositionStatus.CLOSED,
        realized_pnl=50, fees_paid=2.5,
    )
    p3 = Position(
        user_id=u2.id, wallet_address=u2.wallet_address,
        asset="QQQ", tranche=TrancheType.JUNIOR,
        deposit_amount=2000, leverage_bps=40000,
        side=PositionSide.LONG, status=PositionStatus.OPEN,
    )
    db.add_all([p1, p2, p3])

    a1 = AgentRun(
        user_id=u1.id, wallet_address=u1.wallet_address,
        strategy="momentum", asset="QQQ", status=AgentStatus.RUNNING,
    )
    a2 = AgentRun(
        user_id=u2.id, wallet_address=u2.wallet_address,
        strategy="mean_reversion", asset="SPY", status=AgentStatus.COMPLETED,
    )
    db.add_all([a1, a2])

    al1 = Alert(
        user_id=u1.id, wallet_address=u1.wallet_address,
        alert_type=AlertType.PRICE_ABOVE, asset="QQQ",
        threshold=500, status=AlertStatus.ACTIVE,
    )
    db.add(al1)

    s1 = UserSession(
        user_id=u1.id, wallet_address=u1.wallet_address, page="dashboard",
    )
    s2 = UserSession(
        user_id=u2.id, wallet_address=u2.wallet_address, page="trading",
        disconnected_at=datetime.now(timezone.utc), duration_seconds=120,
    )
    db.add_all([s1, s2])
    await db.commit()

    return {"users": [u1, u2], "positions": [p1, p2, p3], "agents": [a1, a2]}


# ═══════════════════════════════════════════════════════════════
# AUTH TESTS
# ═══════════════════════════════════════════════════════════════

class TestAdminAuth:

    @pytest.mark.asyncio
    async def test_missing_key_returns_422(self, client):
        res = await client.get("/api/admin/stats")
        assert res.status_code == 422

    @pytest.mark.asyncio
    async def test_wrong_key_returns_403(self, client):
        res = await client.get("/api/admin/stats", headers=BAD_HEADERS)
        assert res.status_code == 403

    @pytest.mark.asyncio
    async def test_correct_key_succeeds(self, client):
        res = await client.get("/api/admin/stats", headers=ADMIN_HEADERS)
        assert res.status_code == 200

    @pytest.mark.asyncio
    async def test_auth_on_all_get_endpoints(self, client):
        endpoints = [
            "/api/admin/stats",
            "/api/admin/users",
            "/api/admin/activity/daily",
            "/api/admin/activity/hourly",
            "/api/admin/sessions",
            "/api/admin/health",
            "/api/admin/errors",
            "/api/admin/positions/overview",
        ]
        for url in endpoints:
            res = await client.get(url, headers=BAD_HEADERS)
            assert res.status_code == 403, f"GET {url} should reject bad key"

    @pytest.mark.asyncio
    async def test_missing_env_var_returns_503(self, client):
        with patch.dict(os.environ, {"ADMIN_API_KEY": ""}, clear=False):
            res = await client.get("/api/admin/stats", headers=ADMIN_HEADERS)
            assert res.status_code == 503


# ═══════════════════════════════════════════════════════════════
# PLATFORM STATS
# ═══════════════════════════════════════════════════════════════

class TestPlatformStats:

    @pytest.mark.asyncio
    async def test_empty_db_returns_zeros(self, client):
        res = await client.get("/api/admin/stats", headers=ADMIN_HEADERS)
        assert res.status_code == 200
        data = res.json()
        for key in ["total_users", "total_sessions", "active_sessions",
                     "total_positions", "open_positions",
                     "total_agent_runs", "active_agents", "total_alerts"]:
            assert data[key] == 0, f"{key} should be 0 on empty DB"

    @pytest.mark.asyncio
    async def test_with_seed_data(self, client, seed_data):
        res = await client.get("/api/admin/stats", headers=ADMIN_HEADERS)
        data = res.json()
        assert data["total_users"] == 2
        assert data["total_sessions"] == 2
        assert data["active_sessions"] == 1
        assert data["total_positions"] == 3
        assert data["open_positions"] == 2
        assert data["total_agent_runs"] == 2
        assert data["active_agents"] == 1
        assert data["total_alerts"] == 1


# ═══════════════════════════════════════════════════════════════
# USER LIST
# ═══════════════════════════════════════════════════════════════

class TestUserList:

    @pytest.mark.asyncio
    async def test_empty_list(self, client):
        res = await client.get("/api/admin/users", headers=ADMIN_HEADERS)
        assert res.status_code == 200
        assert res.json() == []

    @pytest.mark.asyncio
    async def test_returns_users_with_counts(self, client, seed_data):
        res = await client.get("/api/admin/users", headers=ADMIN_HEADERS)
        users = res.json()
        assert len(users) == 2
        for u in users:
            assert "wallet_address" in u
            assert "total_sessions" in u
            assert "total_positions" in u
            assert "total_agent_runs" in u

    @pytest.mark.asyncio
    async def test_pagination(self, client, seed_data):
        r1 = await client.get("/api/admin/users?limit=1&offset=0", headers=ADMIN_HEADERS)
        r2 = await client.get("/api/admin/users?limit=1&offset=1", headers=ADMIN_HEADERS)
        assert len(r1.json()) == 1
        assert len(r2.json()) == 1
        assert r1.json()[0]["id"] != r2.json()[0]["id"]

    @pytest.mark.asyncio
    async def test_sort_by_wallet(self, client, seed_data):
        res = await client.get("/api/admin/users?sort=wallet_address", headers=ADMIN_HEADERS)
        users = res.json()
        assert users[0]["wallet_address"] < users[1]["wallet_address"]

    @pytest.mark.asyncio
    async def test_invalid_sort_rejected(self, client):
        res = await client.get("/api/admin/users?sort=invalid", headers=ADMIN_HEADERS)
        assert res.status_code == 422


# ═══════════════════════════════════════════════════════════════
# USER DETAIL
# ═══════════════════════════════════════════════════════════════

class TestUserDetail:

    @pytest.mark.asyncio
    async def test_user_not_found(self, client):
        res = await client.get("/api/admin/users/999", headers=ADMIN_HEADERS)
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_full_detail_user1(self, client, seed_data):
        u1 = seed_data["users"][0]
        res = await client.get(f"/api/admin/users/{u1.id}", headers=ADMIN_HEADERS)
        data = res.json()
        assert data["wallet_address"] == u1.wallet_address
        assert data["total_positions"] == 2
        assert data["open_positions"] == 1
        assert data["total_agent_runs"] == 1
        assert data["active_agents"] == 1
        assert data["total_alerts"] == 1
        assert data["total_pnl"] == 50.0
        assert "preferences" in data

    @pytest.mark.asyncio
    async def test_returns_full_detail_user2(self, client, seed_data):
        u2 = seed_data["users"][1]
        res = await client.get(f"/api/admin/users/{u2.id}", headers=ADMIN_HEADERS)
        data = res.json()
        assert data["total_positions"] == 1
        assert data["open_positions"] == 1
        assert data["active_agents"] == 0
        assert data["total_alerts"] == 0
        assert data["total_pnl"] == 0


# ═══════════════════════════════════════════════════════════════
# DAILY ACTIVITY
# ═══════════════════════════════════════════════════════════════

class TestDailyActivity:

    @pytest.mark.asyncio
    async def test_empty_returns_empty(self, client):
        res = await client.get("/api/admin/activity/daily", headers=ADMIN_HEADERS)
        assert res.status_code == 200
        assert res.json() == []

    @pytest.mark.asyncio
    async def test_days_limit_exceeded(self, client):
        res = await client.get("/api/admin/activity/daily?days=91", headers=ADMIN_HEADERS)
        assert res.status_code == 422


# ═══════════════════════════════════════════════════════════════
# HOURLY ACTIVITY
# ═══════════════════════════════════════════════════════════════

class TestHourlyActivity:

    @pytest.mark.asyncio
    async def test_returns_24_hours(self, client):
        res = await client.get("/api/admin/activity/hourly", headers=ADMIN_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 24
        assert [d["hour"] for d in data] == list(range(24))

    @pytest.mark.asyncio
    async def test_all_zeros_when_empty(self, client):
        res = await client.get("/api/admin/activity/hourly", headers=ADMIN_HEADERS)
        assert all(d["sessions"] == 0 for d in res.json())


# ═══════════════════════════════════════════════════════════════
# SESSIONS
# ═══════════════════════════════════════════════════════════════

class TestSessions:

    @pytest.mark.asyncio
    async def test_list_sessions_empty(self, client):
        res = await client.get("/api/admin/sessions", headers=ADMIN_HEADERS)
        assert res.status_code == 200
        assert res.json() == []

    @pytest.mark.asyncio
    async def test_list_sessions_with_data(self, client, seed_data):
        res = await client.get("/api/admin/sessions", headers=ADMIN_HEADERS)
        assert len(res.json()) == 2

    @pytest.mark.asyncio
    async def test_create_session(self, client, seed_data):
        res = await client.post(
            "/api/admin/sessions", headers=ADMIN_HEADERS,
            json={"wallet_address": "0x" + "a" * 40, "page": "vault"},
        )
        assert res.status_code == 200
        assert res.json()["wallet_address"] == "0x" + "a" * 40
        assert res.json()["page"] == "vault"

    @pytest.mark.asyncio
    async def test_create_session_invalid_wallet(self, client):
        res = await client.post(
            "/api/admin/sessions", headers=ADMIN_HEADERS,
            json={"wallet_address": "not-a-wallet"},
        )
        assert res.status_code == 422

    @pytest.mark.asyncio
    async def test_disconnect_session(self, client, seed_data):
        res = await client.get("/api/admin/sessions?limit=50", headers=ADMIN_HEADERS)
        active = [s for s in res.json() if s["disconnected_at"] is None]
        assert len(active) >= 1
        sid = active[0]["id"]
        res = await client.patch(f"/api/admin/sessions/{sid}/disconnect", headers=ADMIN_HEADERS)
        assert res.status_code == 200
        assert res.json()["disconnected_at"] is not None

    @pytest.mark.asyncio
    async def test_disconnect_nonexistent(self, client):
        res = await client.patch("/api/admin/sessions/99999/disconnect", headers=ADMIN_HEADERS)
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_session_pagination(self, client, seed_data):
        res = await client.get("/api/admin/sessions?limit=1", headers=ADMIN_HEADERS)
        assert len(res.json()) == 1


# ═══════════════════════════════════════════════════════════════
# SYSTEM HEALTH
# ═══════════════════════════════════════════════════════════════

class TestSystemHealth:

    @pytest.mark.asyncio
    async def test_health_check(self, client):
        res = await client.get("/api/admin/health", headers=ADMIN_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["api"] == "ok"
        assert data["database"] == "connected"
        assert data["uptime_seconds"] > 0
        assert data["db_latency_ms"] is not None
        assert data["db_latency_ms"] >= 0


# ═══════════════════════════════════════════════════════════════
# ERROR LOGS
# ═══════════════════════════════════════════════════════════════

class TestErrorLogs:

    @pytest.mark.asyncio
    async def test_empty_error_log(self, client):
        await client.delete("/api/admin/errors", headers=ADMIN_HEADERS)
        res = await client.get("/api/admin/errors", headers=ADMIN_HEADERS)
        assert res.status_code == 200
        assert res.json() == []

    @pytest.mark.asyncio
    async def test_record_and_retrieve(self, client):
        from server.api.routes.admin import record_error, _error_log
        _error_log.clear()
        record_error("test", "Something broke", "stack trace")
        record_error("db", "Connection timeout")

        res = await client.get("/api/admin/errors", headers=ADMIN_HEADERS)
        errors = res.json()
        assert len(errors) == 2
        assert errors[0]["source"] == "db"
        assert errors[1]["details"] == "stack trace"

    @pytest.mark.asyncio
    async def test_filter_by_source(self, client):
        from server.api.routes.admin import record_error, _error_log
        _error_log.clear()
        record_error("api", "Error 1")
        record_error("db", "Error 2")
        record_error("api", "Error 3")

        res = await client.get("/api/admin/errors?source=api", headers=ADMIN_HEADERS)
        assert len(res.json()) == 2
        assert all(e["source"] == "api" for e in res.json())

    @pytest.mark.asyncio
    async def test_clear_errors(self, client):
        from server.api.routes.admin import record_error, _error_log
        _error_log.clear()
        record_error("test", "err1")
        record_error("test", "err2")

        res = await client.delete("/api/admin/errors", headers=ADMIN_HEADERS)
        assert res.json()["cleared"] == 2

        res2 = await client.get("/api/admin/errors", headers=ADMIN_HEADERS)
        assert res2.json() == []

    @pytest.mark.asyncio
    async def test_error_limit(self, client):
        from server.api.routes.admin import record_error, _error_log
        _error_log.clear()
        for i in range(10):
            record_error("test", f"Error {i}")
        res = await client.get("/api/admin/errors?limit=3", headers=ADMIN_HEADERS)
        assert len(res.json()) == 3


# ═══════════════════════════════════════════════════════════════
# POSITION OVERVIEW
# ═══════════════════════════════════════════════════════════════

class TestPositionOverview:

    @pytest.mark.asyncio
    async def test_empty_positions(self, client):
        res = await client.get("/api/admin/positions/overview", headers=ADMIN_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert data["total_positions"] == 0
        assert data["open_positions"] == 0
        assert data["total_volume"] == 0
        assert data["assets"] == {}

    @pytest.mark.asyncio
    async def test_with_seed_data(self, client, seed_data):
        res = await client.get("/api/admin/positions/overview", headers=ADMIN_HEADERS)
        data = res.json()
        assert data["total_positions"] == 3
        assert data["open_positions"] == 2
        assert data["total_volume"] == 3500
        assert data["total_pnl"] == 50
        assert data["total_fees"] == 2.5
        assert data["long_count"] == 2
        assert data["short_count"] == 1
        assert data["assets"]["QQQ"] == 2
        assert data["assets"]["SPY"] == 1
        assert data["avg_leverage"] > 0


# ═══════════════════════════════════════════════════════════════
# EDGE CASES
# ═══════════════════════════════════════════════════════════════

class TestEdgeCases:

    @pytest.mark.asyncio
    async def test_stats_response_schema(self, client):
        data = (await client.get("/api/admin/stats", headers=ADMIN_HEADERS)).json()
        for field in ["total_users", "total_sessions", "active_sessions",
                       "total_positions", "open_positions",
                       "total_agent_runs", "active_agents", "total_alerts"]:
            assert field in data
            assert isinstance(data[field], int)

    @pytest.mark.asyncio
    async def test_health_response_schema(self, client):
        data = (await client.get("/api/admin/health", headers=ADMIN_HEADERS)).json()
        for field in ["api", "database", "rpc", "uptime", "uptime_seconds"]:
            assert field in data

    @pytest.mark.asyncio
    async def test_concurrent_requests(self, client, seed_data):
        import asyncio
        tasks = [client.get("/api/admin/stats", headers=ADMIN_HEADERS) for _ in range(5)]
        results = await asyncio.gather(*tasks)
        for r in results:
            assert r.status_code == 200
            assert r.json()["total_users"] == 2

    @pytest.mark.asyncio
    async def test_large_offset_returns_empty(self, client, seed_data):
        res = await client.get("/api/admin/users?offset=1000", headers=ADMIN_HEADERS)
        assert res.json() == []
