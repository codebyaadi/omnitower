from typing import Optional
from pydantic import AnyUrl, FilePath, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    astra_db_api_endpoint: Optional[AnyUrl] = None
    astra_db_application_token: Optional[str] = None
    astra_db_id: Optional[str] = None
    astra_db_bundle_path: Optional[FilePath] = None
    astra_db_keyspace: Optional[str] = None

    redpanda_brokers: Optional[str] = None
    redpanda_consumer_group: Optional[str] = None
    redpanda_sasl_username: Optional[str] = None
    redpanda_sasl_password: Optional[str] = None
    redpanda_compression: str = "gzip"
    redpanda_request_timeout_ms: int = 10_000
    redpanda_retry_backoff_ms: int = 300
    redpanda_session_timeout_ms: int = 30_000
    redpanda_heartbeat_interval_ms: int = 10_000

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


settings = Settings()
