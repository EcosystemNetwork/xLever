"""FastAPI server for xLever AI Trading Agent."""

from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from agent.api.routes import agent, positions, decisions


# Global agent instance (to be injected)
_agent_instance: Optional[object] = None


def set_agent_instance(agent: object):
    """Set the global agent instance for API access.

    Args:
        agent: TradingAgent instance
    """
    global _agent_instance
    _agent_instance = agent
    logger.info("Agent instance registered with API server")


def get_agent_instance() -> object:
    """Get the global agent instance.

    Returns:
        TradingAgent instance

    Raises:
        RuntimeError: If agent instance not set
    """
    if _agent_instance is None:
        raise RuntimeError("Agent instance not set. Call set_agent_instance() first.")
    return _agent_instance


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    logger.info("Starting xLever API server")

    yield

    # Shutdown
    logger.info("Shutting down xLever API server")


def create_app() -> FastAPI:
    """Create and configure FastAPI application.

    Returns:
        Configured FastAPI app
    """
    app = FastAPI(
        title="xLever AI Trading Agent API",
        description="REST API for xLever autonomous trading agent with Human-in-the-Loop control",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS middleware - allows frontend to call API
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["https://xlever.markets", "http://localhost:3000", "http://localhost:5173", "http://localhost:8080"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
    app.include_router(positions.router, prefix="/api/positions", tags=["positions"])
    app.include_router(decisions.router, prefix="/api/decisions", tags=["decisions"])

    # Health check endpoint
    @app.get("/", tags=["health"])
    async def root():
        """Root endpoint - API health check."""
        return {
            "status": "ok",
            "service": "xLever AI Trading Agent",
            "version": "1.0.0",
        }

    @app.get("/health", tags=["health"])
    async def health_check():
        """Detailed health check endpoint."""
        try:
            agent = get_agent_instance()
            return {
                "status": "healthy",
                "agent_initialized": True,
                "timestamp": logger.opt(ansi=False).info("Health check"),
            }
        except RuntimeError:
            return {
                "status": "unhealthy",
                "agent_initialized": False,
                "error": "Agent instance not initialized",
            }

    return app


# Create app instance
app = create_app()


def run_server(host: str = "0.0.0.0", port: int = 8080):
    """Run the API server.

    Args:
        host: Host to bind to
        port: Port to listen on
    """
    import uvicorn

    logger.info(f"Starting xLever API server on {host}:{port}")
    uvicorn.run(
        "agent.api.server:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    run_server()
