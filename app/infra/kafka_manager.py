import json
from typing import Any, Optional
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class KafkaManager:
    """
    Manages Kafka producer and consumer lifecycles for the AI Agent platform.

    This manager provides:
    - A shared, thread-safe AIOKafkaProducer for all ingestor modules.
    - Idempotent message delivery to prevent duplicates during recon scans.
    - Factory methods for creating independent agent consumers.
    - Graceful cleanup of broker connections.

    Intended to be used as a singleton via the module-level `kafka_manager`.
    """

    def __init__(self) -> None:
        self._producer: Optional[AIOKafkaProducer] = None

    async def start_producer(self) -> None:
        """
        Initialize and start the shared producer instance.

        This method configures the producer with:
        - Gzip compression to handle large AI-generated payloads.
        - Idempotence to ensure data integrity during network retries.
        - Automatic JSON serialization.

        Safe to call multiple times; subsequent calls are ignored if the
        producer is already active.

        Raises:
            ValueError: If the Kafka broker addresses are missing from configuration.
            Exception: If the producer fails to establish a connection to the cluster.
        """
        if self._producer is not None:
            return

        if not settings.redpanda_brokers:
            logger.error("Kafka configuration missing: redpanda_brokers is not set.")
            raise ValueError("redpanda_brokers is not configured.")

        try:
            self._producer = AIOKafkaProducer(
                bootstrap_servers=settings.redpanda_brokers,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                compression_type="gzip",
                enable_idempotence=True,
                request_timeout_ms=10_000,
                retry_backoff_ms=300,
            )
            await self._producer.start()
            logger.info(
                f"Kafka Producer started. bootstrap_servers={settings.redpanda_brokers}"
            )
        except Exception as e:
            logger.error(f"Critical failure starting Kafka Producer: {e}")
            raise

    async def stop_producer(self) -> None:
        """
        Flush all pending messages and shut down the producer.

        This should be called during the application's shutdown sequence to
        ensure that any buffered reconnaissance results or agent events
        are successfully transmitted to the broker before the process exits.
        """
        if self._producer is not None:
            try:
                await self._producer.stop()
                logger.info("Kafka Producer stopped and connections closed.")
            except Exception as e:
                logger.error(f"Error during Kafka Producer shutdown: {e}")
            finally:
                self._producer = None

    async def send_event(self, topic: str, data: dict[str, Any]) -> None:
        """
        Publish a JSON-serializable event to a specific Kafka topic.

        This method is the primary interface for ingestors (e.g., SubfinderIngestor)
        to broadcast findings. It uses 'send_and_wait' to ensure the broker
        acknowledges the data before continuing.

        Args:
            topic: The target Kafka/Redpanda topic (e.g., 'pulse.infrastructure').
            data: The event payload as a dictionary.

        Raises:
            Exception: Re-raises broker errors so the caller can handle retries.
        """
        if self._producer is None:
            await self.start_producer()

        try:
            await self._producer.send_and_wait(topic, data)  # type: ignore[union-attr] - Checked via start_producer logic
            logger.debug(f"Event successfully published to topic: {topic}")
        except Exception as e:
            logger.error(f"Failed to publish event to {topic}: {e}")
            raise

    def get_consumer(
        self,
        topics: list[str],
        group_id: str,
        auto_offset_reset: str = "earliest",
    ) -> AIOKafkaConsumer:
        """
        Create a new asynchronous consumer for a specific agent group.

        Each agent (Triage, Research, etc.) should use a unique group_id to
        ensure they maintain their own progress tracking (offsets) within
        the event stream.

        Args:
            topics: A list of topics to subscribe to.
            group_id: A unique identifier for the consumer group.
            auto_offset_reset: Where to start reading if no offset exists ('earliest' or 'latest').

        Returns:
            AIOKafkaConsumer: An unstarted consumer instance.

        Raises:
            ValueError: If broker settings are missing.
        """
        if not settings.redpanda_brokers:
            raise ValueError("redpanda_brokers is not configured.")

        logger.info(f"Initializing Consumer: group_id={group_id}, topics={topics}")

        return AIOKafkaConsumer(
            *topics,
            bootstrap_servers=settings.redpanda_brokers,
            group_id=group_id,
            auto_offset_reset=auto_offset_reset,
            value_deserializer=lambda m: json.loads(m.decode("utf-8")),
            enable_auto_commit=True,
            session_timeout_ms=30_000,
            heartbeat_interval_ms=10_000,
        )

    async def shutdown(self) -> None:
        """
        Orchestrate a graceful shutdown of all Kafka-related resources.

        Designed to be hooked into the FastAPI lifespan shutdown event to
        prevent data loss or zombie connections.
        """
        logger.info("Starting KafkaManager graceful shutdown...")
        await self.stop_producer()


kafka_manager = KafkaManager()
