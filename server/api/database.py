# Async engine and session maker are required because FastAPI runs on asyncio —
# synchronous DB calls would block the entire event loop
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
# DeclarativeBase is the modern SQLAlchemy 2.0 base class that all ORM models inherit from
from sqlalchemy.orm import DeclarativeBase

# Import settings to get the DATABASE_URL for engine creation
from .config import get_settings

# Resolve settings once at module level so the engine is created immediately on import
settings = get_settings()

# Create the async engine — this manages the connection pool to PostgreSQL
# echo=DEBUG logs all SQL statements, helpful for debugging queries during development
# Pool settings tuned for Neon serverless pooler (PgBouncer in transaction mode)
_engine_kwargs = dict(echo=settings.DEBUG)
# pool_size/max_overflow/pool_pre_ping are PostgreSQL-specific; skip for SQLite (tests)
if "sqlite" not in settings.DATABASE_URL:
    _engine_kwargs.update(pool_size=5, max_overflow=10, pool_pre_ping=True)
engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)
# Session factory configured with expire_on_commit=False so ORM objects remain usable
# after commit without triggering lazy loads (which would fail outside an async context)
async_session = async_sessionmaker(engine, expire_on_commit=False)


# Base class for all ORM models — provides metadata registry and table creation capabilities
class Base(DeclarativeBase):
    pass


# FastAPI dependency that provides a scoped DB session per request and auto-closes it
async def get_db() -> AsyncSession:
    # async with ensures the session is properly closed even if the request handler raises
    async with async_session() as session:
        # yield turns this into an async generator — FastAPI injects the session then cleans up
        yield session


# Called once at startup to auto-create any missing tables from ORM model definitions
async def init_db():
    # begin() starts a transaction — DDL statements need a connection context
    async with engine.begin() as conn:
        # run_sync bridges async engine to sync create_all — metadata.create_all is not async-native
        # This is safe for dev; production should use Alembic migrations instead
        await conn.run_sync(Base.metadata.create_all)
