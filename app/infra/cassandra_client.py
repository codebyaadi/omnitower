from typing import Optional
from cassandra.cluster import Cluster, Session
from cassandra.auth import PlainTextAuthProvider
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class CassandraClient:
    """
    Manages connection lifecycle to DataStax Astra DB (Apache Cassandra).

    This client:
    - Creates a single Cluster instance
    - Creates a single Session
    - Reuses the session (Cassandra driver is thread-safe)
    - Provides graceful shutdown

    Intended to be used as a singleton.
    """

    def __init__(self) -> None:
        self.session: Optional[Session] = None
        self.cluster: Optional[Cluster] = None

    def connect(self) -> Session:
        """
        Establish a connection to Astra DB if not already connected.

        Returns:
            Session: Active Cassandra session bound to the configured keyspace.

        Raises:
            ValueError: If required settings are missing.
            Exception: If the connection attempt fails.
        """
        if self.session is not None:
            return self.session

        if not settings.astra_db_bundle_path:
            raise ValueError("astra_db_bundle_path is not configured.")
        if not settings.astra_db_application_token:
            raise ValueError("astra_db_application_token is not configured.")
        if not settings.astra_db_keyspace:
            raise ValueError("astra_db_keyspace is not configured.")

        cloud_config = {"secure_connect_bundle": settings.astra_db_bundle_path}

        auth_provider = PlainTextAuthProvider(
            username="token",
            password=settings.astra_db_application_token,
        )

        try:
            self.cluster = Cluster(
                cloud=cloud_config,
                auth_provider=auth_provider,
            )

            self.session = self.cluster.connect(settings.astra_db_keyspace)
            logger.info("Successfully connected to Astra DB.")
            return self.session
        except Exception as e:
            logger.error(f"Failed to connect to Astra DB: {str(e)}")
            raise

    def get_session(self) -> Session:
        """
        Retrieve the active session, creating one if necessary.

        Returns:
            Session: Active Cassandra session.
        """
        if self.session is None or self.session.is_shutdown:
            return self.connect()
        return self.session

    def shutdown(self) -> None:
        """
        Gracefully close cluster connections.

        Should be called during application shutdown to properly
        release connection pool resources.
        """
        try:
            if self.cluster:
                self.cluster.shutdown()
                logger.info("Cassandra cluster connection closed.")
        except Exception as e:
            logger.warning(f"Error during Cassandra shutdown: {e}")
        finally:
            self.cluster = None
            self.session = None


cassandra_db = CassandraClient()
