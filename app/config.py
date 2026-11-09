"""Settings, read from environment variables (and a .env file if present)."""
import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

DEFAULT_MODEL = "claude-sonnet-5-5"
EFFORTS = {"low", "medium", "high", "xhigh", "max"}


@dataclass(frozen=True)
class Settings:
    api_key: str | None
    model: str
    effort: str | None
    max_tokens: int
    timeout: float
    max_retries: int
    mock: bool
    max_body_bytes: int


def _truthy(v: str | None) -> bool:
    return (v or "").strip().lower() in {"1", "true", "yes", "on"}


def get_settings() -> Settings:
    """Read on every call so tests and restarts pick up changes."""
    effort = (os.getenv("VERSIGHT_EFFORT", "medium") or "").strip().lower() or None
    if effort and effort not in EFFORTS:
        effort = "medium"
    return Settings(
        api_key=(os.getenv("ANTHROPIC_API_KEY") or "").strip() or None,
        model=(os.getenv("VERSIGHT_MODEL") or DEFAULT_MODEL).strip(),
        effort=effort,
        max_tokens=int(os.getenv("VERSIGHT_MAX_TOKENS", "16000")),
        timeout=float(os.getenv("VERSIGHT_TIMEOUT", "240")),
        max_retries=int(os.getenv("VERSIGHT_MAX_RETRIES", "2")),
        mock=_truthy(os.getenv("VERSIGHT_MOCK")),
        max_body_bytes=int(os.getenv("VERSIGHT_MAX_BODY_BYTES", str(4 * 1024 * 1024))),
    )
