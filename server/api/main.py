"""
xLever API — FastAPI backend
Run: uvicorn api.main:app --reload --port 8000
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import init_db
from .routes import users, positions, agents, prices, alerts, openbb

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables (use Alembic migrations in production)
    await init_db()
    yield
    # Shutdown: nothing to clean up


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(users.router, prefix="/api")
app.include_router(positions.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(prices.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(openbb.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "chain_id": settings.CHAIN_ID}
