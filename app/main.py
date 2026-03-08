import asyncio
from contextlib import asynccontextmanager
from typing import Any
from fastapi import FastAPI

from app.infra.cassandra_client import cassandra_db
from app.infra.postgres_client import postgres_db
from app.infra.kafka_manager import kafka_manager
from app.core.logging import get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Omnitower: Initializing core services...")

    # These methods handle their own internal logging for success/failure
    cassandra_db.connect()
    await postgres_db.connect()
    await kafka_manager.start_producer()

    yield

    logger.info("Omnitower: Executing graceful shutdown...")
    cassandra_db.shutdown()
    await postgres_db.shutdown()
    await kafka_manager.shutdown()


app = FastAPI(title="Omnitower AI Agent", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    """
    Unified health check. Detailed error logging is handled
    within the infra modules themselves.
    """

    async def check_cassandra():
        try:
            loop = asyncio.get_event_loop()
            session = cassandra_db.get_session()
            await loop.run_in_executor(
                None,
                lambda: session.execute("SELECT release_version FROM system.local"),
            )
            return "ok"
        except Exception:
            return "error"

    async def check_postgres():
        try:
            healthy = await postgres_db.check_connection()
            return "ok" if healthy else "error"
        except Exception:
            return "error"

    async def check_producer():
        try:
            await kafka_manager.send_event("pulse.health", {"status": "ping"})
            return "ok"
        except Exception:
            return "error"

    results = await asyncio.gather(
        check_cassandra(), check_producer(), check_postgres()
    )

    status_map = {"cassandra": results[0], "kafka": results[1], "postgres": results[2]}

    overall = "ok" if all(s == "ok" for s in status_map.values()) else "degraded"

    if overall != "ok":
        logger.warning(f"System health check degraded: {status_map}")

    return {"status": overall, "infras": status_map}
