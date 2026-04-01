"""SQLAlchemy async base setup for database operations."""

from typing import AsyncGenerator
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import DateTime, func
from datetime import datetime
from loguru import logger


class Base(DeclarativeBase):
    """Base class for all database models."""

    pass


# Database engine and session factory
engine = None
async_session = None


def init_database(database_url: str):
    """Initialize database engine and session factory.

    Args:
        database_url: Async database connection URL
    """
    global engine, async_session

    logger.info(f"Initializing database connection: {database_url}")

    engine = create_async_engine(
        database_url,
        echo=False,  # Set to True for SQL query debugging
        pool_pre_ping=True,  # Verify connections before using them
        pool_size=5,
        max_overflow=10,
    )

    async_session = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    logger.success("Database engine initialized")


async def create_all():
    """Create all database tables.

    This should be called once during application startup.
    """
    if engine is None:
        raise RuntimeError("Database not initialized. Call init_database() first.")

    logger.info("Creating database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.success("Database tables created successfully")


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Get an async database session.

    Usage:
        async with get_session() as session:
            result = await session.execute(select(Model))

    Yields:
        AsyncSession: Database session
    """
    if async_session is None:
        raise RuntimeError("Database not initialized. Call init_database() first.")

    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


class TimestampMixin:
    """Mixin to add created_at and updated_at timestamps to models."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
