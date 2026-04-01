"""
xLever API — FastAPI backend
Run: uvicorn api.main:app --reload --port 8000
"""
# Docstring above documents the launch command so devs don't have to look it up

import time
from collections import defaultdict
# asynccontextmanager lets us define startup/shutdown logic for the FastAPI app lifecycle
from contextlib import asynccontextmanager

# FastAPI is the web framework — chosen for async support needed by SQLAlchemy async + httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
# CORSMiddleware is required because the frontend (localhost:5173 etc.) is a different origin
from fastapi.middleware.cors import CORSMiddleware
# Starlette middleware base for custom middleware
from starlette.middleware.base import BaseHTTPMiddleware

# Centralized settings so DB URL, CORS origins, chain ID etc. come from env vars / .env
from .config import get_settings
# init_db creates tables on startup — avoids manual migration steps during early development
from .database import init_db
# Import all route modules to register their endpoints with the app
from .routes import users, positions, agents, prices, alerts, openbb, news, admin, lending

# Cache the settings singleton so we don't re-parse env vars on every access
settings = get_settings()


# ─── In-memory Rate Limiter ───────────────────────────────────

class _RateBucket:
    """Simple sliding-window rate limiter per IP."""
    def __init__(self):
        self._hits: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        now = time.monotonic()
        cutoff = now - window_seconds
        hits = self._hits[key]
        # Prune expired entries
        self._hits[key] = [t for t in hits if t > cutoff]
        if len(self._hits[key]) >= max_requests:
            return False
        self._hits[key].append(now)
        return True

_rate_bucket = _RateBucket()

# Admin paths get a stricter limit (10/min), everything else gets 60/min
_ADMIN_PREFIX = "/api/admin"
_ADMIN_LIMIT = 10
_GENERAL_LIMIT = 60
_WINDOW = 60  # seconds


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path

        if path.startswith(_ADMIN_PREFIX):
            key = f"admin:{client_ip}"
            allowed = _rate_bucket.is_allowed(key, _ADMIN_LIMIT, _WINDOW)
        else:
            key = f"general:{client_ip}"
            allowed = _rate_bucket.is_allowed(key, _GENERAL_LIMIT, _WINDOW)

        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please try again later."},
            )
        return await call_next(request)


# ─── Security Headers Middleware ──────────────────────────────

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        return response


# Lifespan context manager replaces the deprecated on_event("startup")/on_event("shutdown")
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: auto-create all ORM tables (avoids needing Alembic during prototyping)
    await init_db()
    # yield separates startup from shutdown — FastAPI runs the app between these points
    yield
    # Shutdown: no cleanup needed yet (connection pool is handled by SQLAlchemy engine disposal)


# Instantiate the FastAPI app with metadata used in the auto-generated OpenAPI docs
app = FastAPI(
    # Title appears in /docs Swagger UI header — identifies this as the xLever backend
    title=settings.APP_NAME,
    # Version tracks the API iteration for frontend compatibility
    version="0.1.0",
    # Lifespan hook wires up our startup/shutdown logic defined above
    lifespan=lifespan,
)

# CORS middleware must be added before routes so preflight OPTIONS requests are handled
app.add_middleware(
    CORSMiddleware,
    # Only allow requests from known frontend dev server origins (configured in settings)
    allow_origins=settings.CORS_ORIGINS,
    # Allow credentials so cookies/auth headers can be sent from the frontend
    allow_credentials=True,
    # Wildcard methods because the API uses GET, POST, PATCH, DELETE across routes
    allow_methods=["*"],
    # Wildcard headers to accept Content-Type, Authorization, etc. without listing each
    allow_headers=["*"],
)

# Security headers middleware — sets protective headers on every response
app.add_middleware(SecurityHeadersMiddleware)

# Rate limiting middleware — 60 req/min general, 10 req/min admin endpoints
app.add_middleware(RateLimitMiddleware)

# Mount each route module under /api prefix to namespace API endpoints away from static files
# Users route handles wallet registration and preference management
app.include_router(users.router, prefix="/api")
# Positions route serves cached on-chain position data for the portfolio view
app.include_router(positions.router, prefix="/api")
# Agents route manages AI trading agent lifecycle (create, list, stop runs)
app.include_router(agents.router, prefix="/api")
# Prices route proxies Yahoo Finance with DB caching for the backtester
app.include_router(prices.router, prefix="/api")
# Alerts route lets users set price/health/PnL notifications
app.include_router(alerts.router, prefix="/api")
# OpenBB route provides rich market intelligence (quotes, historical, options, snapshots)
app.include_router(openbb.router, prefix="/api")
# News route aggregates and streams market news for the agent swarm pipeline
app.include_router(news.router, prefix="/api")
# Admin analytics dashboard — platform stats, user activity, session tracking
app.include_router(admin.router, prefix="/api")
# Lending route serves Euler V2 lending market data and user lending positions
app.include_router(lending.router, prefix="/api")


# Health check endpoint for Docker/k8s readiness probes and frontend connectivity tests
@app.get("/api/health")
async def health():
    # Return chain_id so the frontend can verify it's talking to the right network backend
    return {"status": "ok", "chain_id": settings.CHAIN_ID}
