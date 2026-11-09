import json

import httpx2
import pytest
from fastapi.testclient import TestClient

from app import llm
from app.main import create_app

ENV = ["ANTHROPIC_API_KEY", "VERSIGHT_MOCK", "VERSIGHT_MODEL", "VERSIGHT_EFFORT", "VERSIGHT_MAX_TOKENS",
       "VERSIGHT_MAX_BODY_BYTES", "VERSIGHT_MAX_RETRIES"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ENV:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("VERSIGHT_ALLOWED_HOSTS", "testserver,localhost")
    monkeypatch.setenv("VERSIGHT_MAX_RETRIES", "0")
    yield
    llm.set_http_client(None)


@pytest.fixture
def client():
    return TestClient(create_app())


class FakeAnthropic:
    """Stands in for api.anthropic.com. Records every request the SDK sends."""

    def __init__(self, text=None, status=200, content=None, stop_reason="end_turn"):
        self.requests = []
        self.text, self.status, self.content, self.stop_reason = text, status, content, stop_reason

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append({"url": str(request.url), "headers": dict(request.headers), "json": json.loads(request.content)})
        if self.status != 200:
            return httpx2.Response(self.status, json={"type": "error", "error": {"type": "api_error", "message": "boom"}})
        content = self.content or [
            {"type": "thinking", "thinking": "let me think", "signature": "sig"},
            {"type": "text", "text": self.text},
        ]
        return httpx2.Response(200, json={
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
            "content": content, "stop_reason": self.stop_reason, "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 10},
        })

    def install(self):
        llm.set_http_client(httpx2.AsyncClient(transport=httpx2.MockTransport(self.handler)))
        return self


@pytest.fixture
def fake():
    return FakeAnthropic


DOC = [
    {"id": "b1", "html": "<h1>WI-1 Seal</h1>"},
    {"id": "b2", "html": "<h2>Purpose</h2>"},
    {"id": "b3", "html": "<p>You should check the seal.</p>"},
    {"id": "b4", "html": "<ol><li>You must clean the jaws.</li><li>Press start.</li></ol>"},
    {"id": "b5", "html": "<p><br></p>"},
]
