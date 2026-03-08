from typing import AsyncGenerator, Optional
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class Base(DeclarativeBase):
    """
    Base class for all SQLAlchemy ORM models.

    Usage:
        from app.db.database import Base

        class Finding(Base):
            __tablename__ = "findings"
            ...
    """

    pass


class PostgresClient:
    """
    Manages async SQLAlchemy engine and session lifecycle.

    This client:
    - Creates a single AsyncEngine  (replaces asyncpg Pool)
    - Creates a single async_sessionmaker  (replaces pool.acquire())
    - Provides per-request sessions via FastAPI dependency injection
    - Provides graceful shutdown

    Intended to be used as a singleton.
    """

    def __init__(self) -> None:
        self._engine: Optional[AsyncEngine] = None
        self._session_factory: Optional[async_sessionmaker[AsyncSession]] = None

    async def connect(self) -> None:
        """
        Initialize the async engine and session factory.
        Called once at application startup via lifespan.

        Raises:
            ValueError: If postgres_dsn is not configured.
            Exception: If the connection attempt fails.
        """
        if self._engine is not None:
            return

        # guard + explicit str annotation narrows str | None → str
        # so create_async_engine receives a guaranteed str, not str | None
        dsn: Optional[str] = settings.postgres_dsn_str
        if not dsn:
            raise ValueError("postgres_dsn is not configured.")

        try:
            self._engine = create_async_engine(
                dsn,
                echo=settings.debug,
                pool_size=5,
                max_overflow=10,
                pool_pre_ping=True,
                pool_timeout=60,
                connect_args={"ssl": "require"}
                if settings.postgres_ssl_required
                else {},
            )

            self._session_factory = async_sessionmaker(
                bind=self._engine,
                class_=AsyncSession,
                expire_on_commit=False,
                autoflush=False,
            )

            # Verify the connection is actually reachable on startup
            async with self._engine.connect() as conn:
                await conn.execute(text("SELECT 1"))

            logger.info("Successfully connected to PostgreSQL.")

        except Exception as e:
            logger.error(f"Failed to connect to PostgreSQL: {str(e)}")
            raise

    async def get_pool(self) -> async_sessionmaker[AsyncSession]:
        """
        Retrieve the active session factory, creating one if necessary.

        Returns:
            async_sessionmaker: Active SQLAlchemy session factory.
        """
        if self._session_factory is None:
            await self.connect()

        # assert narrows Optional[async_sessionmaker] → async_sessionmaker
        # connect() always populates _session_factory, so None is unreachable here
        assert self._session_factory is not None
        return self._session_factory

    def acquire(self) -> "_SessionContext":
        """
        Acquire a managed session as an async context manager.
        Direct replacement for `async with postgres_db.acquire() as conn`.

        Automatically commits on success, rolls back on exception,
        and always closes the session.

        Usage:
            async with postgres_db.acquire() as session:
                result = await session.execute(select(Finding))
                return result.scalars().all()

        Returns:
            _SessionContext: Async context manager yielding AsyncSession.
        """
        if self._session_factory is None:
            raise RuntimeError(
                "PostgreSQL pool is not initialized. Call connect() first."
            )
        return _SessionContext(self._session_factory)

    async def check_connection(self) -> bool:
        """
        Verify the database connection is healthy.
        Useful for /health endpoints.

        Returns:
            bool: True if healthy, False otherwise.
        """
        if self._engine is None:
            return False
        try:
            async with self._engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception as e:
            logger.error(f"Database health check failed: {e}")
            return False

    async def shutdown(self) -> None:
        """
        Gracefully dispose of all engine connections.
        Direct replacement for pool.close().

        Should be called during application shutdown to properly
        release all connection pool resources.
        """
        try:
            if self._engine:
                await self._engine.dispose()
                logger.info("PostgreSQL connection pool closed.")
        except Exception as e:
            logger.warning(f"Error during PostgreSQL shutdown: {e}")
        finally:
            self._engine = None
            self._session_factory = None


class _SessionContext:
    """
    Async context manager for a single SQLAlchemy session.

    Handles:
      - commit   on clean exit
      - rollback on exception
      - close    always
    """

    def __init__(self, factory: async_sessionmaker[AsyncSession]) -> None:
        self._factory = factory
        self._session: Optional[AsyncSession] = None

    async def __aenter__(self) -> AsyncSession:
        self._session = self._factory()
        return self._session

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        assert self._session is not None

        if exc_type is not None:
            await self._session.rollback()
            logger.warning(f"Session rolled back due to: {exc_val}")
        else:
            await self._session.commit()
        await self._session.close()


postgres_db = PostgresClient()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency — provides a scoped AsyncSession per request.

    Automatically:
      - Opens a session at request start
      - Commits on success
      - Rolls back on exception
      - Closes session when the request completes

    Usage in routes:
        from sqlalchemy.ext.asyncio import AsyncSession
        from fastapi import Depends
        from app.db.database import get_db

        @router.get("/findings")
        async def list_findings(session: AsyncSession = Depends(get_db)):
            result = await session.execute(select(Finding))
            return result.scalars().all()

    Usage outside requests (e.g. Kafka consumers):
        async with postgres_db.acquire() as session:
            session.add(finding)
    """
    async with postgres_db.acquire() as session:
        yield session
