"""Unified entrypoint: starts both the FastAPI server and the trading agent loop."""

import asyncio
import uvicorn
from loguru import logger

from agent.config import get_settings
from agent.main import TradingAgent
from agent.api.server import create_app, set_agent_instance
from agent.api.routes.agent import set_agent


async def start_agent_and_server():
    """Start the API server and trading agent concurrently."""
    settings = get_settings()

    # Create agent
    agent = TradingAgent(
        settings=settings,
        paper_mode=(settings.agent.mode == "simulation"),
    )
    agent.setup_signal_handlers()

    # Initialize agent (connects to blockchain, sets up components)
    await agent.initialize()

    # Register agent with API server
    set_agent_instance(agent)
    set_agent(agent)

    # Create FastAPI app
    app = create_app()

    # Configure uvicorn
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=8080,
        log_level="info",
    )
    server = uvicorn.Server(config)

    logger.success("Starting API server on :8080 and agent loop concurrently")

    # Run API server and agent loop concurrently
    await asyncio.gather(
        server.serve(),
        agent.run(),
    )


def main():
    """CLI entrypoint."""
    try:
        asyncio.run(start_agent_and_server())
    except KeyboardInterrupt:
        logger.warning("Interrupted by user")
    except Exception as e:
        logger.critical(f"Fatal error: {e}", exc_info=True)


if __name__ == "__main__":
    main()
