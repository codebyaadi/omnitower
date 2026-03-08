from typing import Optional
from pydantic import AnyUrl, FilePath, PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    astra_db_api_endpoint: Optional[AnyUrl] = None
    astra_db_application_token: Optional[str] = None
    astra_db_id: Optional[str] = None
    astra_db_bundle_path: Optional[FilePath] = None
    astra_db_keyspace: Optional[str] = None

    postgres_dsn: Optional[PostgresDsn] = None

    redpanda_brokers: Optional[str] = None
    redpanda_consumer_group: Optional[str] = None
    redpanda_sasl_username: Optional[str] = None
    redpanda_sasl_password: Optional[str] = None
    redpanda_compression: str = "gzip"
    redpanda_request_timeout_ms: int = 10_000
    redpanda_retry_backoff_ms: int = 300
    redpanda_session_timeout_ms: int = 30_000
    redpanda_heartbeat_interval_ms: int = 10_000

    debug: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("astra_db_application_token")
    @classmethod
    def token_must_not_be_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("astra_db_application_token must not be blank.")
        return v

    @field_validator("astra_db_keyspace")
    @classmethod
    def keyspace_must_not_be_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("astra_db_keyspace must not be blank.")
        return v

    @field_validator("postgres_dsn", mode="before")
    @classmethod
    def postgres_dsn_must_not_be_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not str(v).strip():
            raise ValueError("postgres_dsn must not be blank.")
        return v

    @property
    def postgres_dsn_str(self) -> Optional[str]:
        """
        Returns postgres_dsn as a clean string safe for SQLAlchemy + asyncpg.

        Two transformations applied:
          - Strips libpq query params asyncpg doesn't understand:
               sslmode, channel_binding, connect_timeout, etc.
             These are psycopg2/libpq conventions — asyncpg rejects them.
             SSL is handled separately via postgres_ssl_required property.

          - Upgrades scheme to postgresql+asyncpg:// for async driver.
        """
        if self.postgres_dsn is None:
            return None

        from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

        _LIBPQ_PARAMS = {
            "sslmode",
            "channel_binding",
            "connect_timeout",
            "sslcert",
            "sslkey",
            "sslrootcert",
        }

        raw = str(self.postgres_dsn)
        parsed = urlparse(raw)

        filtered_params = {
            k: v for k, v in parse_qs(parsed.query).items() if k not in _LIBPQ_PARAMS
        }

        clean_query = urlencode(filtered_params, doseq=True)
        clean_url = urlunparse(parsed._replace(query=clean_query))

        return clean_url.replace("postgresql://", "postgresql+asyncpg://")

    @property
    def postgres_ssl_required(self) -> bool:
        """
        Returns True if the original DSN contained sslmode=require or sslmode=verify-full.
        Used by postgres_client.py to pass ssl=True to create_async_engine() instead.
        """
        if self.postgres_dsn is None:
            return False
        from urllib.parse import urlparse, parse_qs

        parsed = urlparse(str(self.postgres_dsn))
        params = parse_qs(parsed.query)
        sslmode = params.get("sslmode", ["disable"])[0]
        return sslmode in ("require", "verify-ca", "verify-full")


settings = Settings()
