"""The one place that talks to the Anthropic API."""
import json
import re
from typing import Any

import anthropic
import httpx2

from .config import Settings


class ApiError(Exception):
    """An error the page can show: HTTP status plus a stable code."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


_clients: dict[tuple, anthropic.AsyncAnthropic] = {}
_http_client: httpx2.AsyncClient | None = None  # tests inject a mock transport here


def set_http_client(client: httpx2.AsyncClient | None) -> None:
    global _http_client
    _http_client = client
    _clients.clear()


def _client(settings: Settings) -> anthropic.AsyncAnthropic:
    key = (settings.api_key, settings.timeout, settings.max_retries, id(_http_client))
    if key not in _clients:
        kwargs: dict[str, Any] = {
            "api_key": settings.api_key,
            "timeout": settings.timeout,
            "max_retries": settings.max_retries,
        }
        if _http_client is not None:
            kwargs["http_client"] = _http_client
        _clients[key] = anthropic.AsyncAnthropic(**kwargs)
    return _clients[key]


async def complete(prompt: str, settings: Settings) -> str:
    """Send one prompt, return the text of the answer."""
    if not settings.api_key:
        raise ApiError(
            503,
            "no_api_key",
            "The server has no Anthropic API key. Set ANTHROPIC_API_KEY and restart, "
            "or start with VERSIGHT_MOCK=1 for a demo that does not call a model.",
        )
    # Sampling parameters (temperature, top_p, top_k) are rejected by current models, so none are sent.
    kwargs: dict[str, Any] = {
        "model": settings.model,
        "max_tokens": settings.max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if settings.effort:
        kwargs["output_config"] = {"effort": settings.effort}
    try:
        resp = await _client(settings).messages.create(**kwargs)
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
        raise ApiError(502, "invalid_api_key", "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.")
    except anthropic.RateLimitError:
        raise ApiError(429, "rate_limited", "The Anthropic API rate limit was reached. Wait a moment and try again.")
    except (anthropic.APIConnectionError, anthropic.APITimeoutError):
        raise ApiError(502, "upstream_error", "Could not reach the Anthropic API. Check the network connection.")
    except anthropic.NotFoundError:
        raise ApiError(502, "model_not_found", f"The model '{settings.model}' was not found. Check VERSIGHT_MODEL.")
    except anthropic.APIStatusError as e:
        raise ApiError(502, "upstream_error", f"The Anthropic API returned an error ({e.status_code}).")

    # Thinking is on by default for current models, so the answer can hold non-text blocks.
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    if getattr(resp, "stop_reason", None) == "max_tokens":
        raise ApiError(
            502,
            "truncated",
            "The answer was cut off. Select a smaller part of the document, or raise VERSIGHT_MAX_TOKENS.",
        )
    if not text.strip():
        raise ApiError(502, "empty_completion", "The model returned no text. Try wording the request differently.")
    return text


def parse_json_object(text: str) -> dict:
    """Read the model's answer as one JSON object, tolerating a code fence or a sentence around it."""
    t = text.strip()
    candidates = [t]
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if fence:
        candidates.append(fence.group(1))
    a, b = t.find("{"), t.rfind("}")
    if a >= 0 and b > a:
        candidates.append(t[a : b + 1])
    for c in candidates:
        try:
            v = json.loads(c)
        except ValueError:
            continue
        if isinstance(v, dict):
            return v
    raise ApiError(502, "invalid_json", "The model's answer was not in the expected format. Try again.")
