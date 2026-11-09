import json

from .conftest import DOC


def assist_body(**kw):
    body = {"request": "Fix the style", "blocks": DOC, "rules": [
        {"id": "r1", "cat": "Language", "text": "Start each step with an imperative verb.", "strength": "hard"}]}
    body.update(kw)
    return body


# ---- health ---------------------------------------------------------------------------------
def test_health_without_key(client):
    r = client.get("/api/health").json()
    assert r["ok"] and r["ai"] is False and r["mock"] is False and r["model"] == "claude-sonnet-5-5"


def test_health_with_key_and_mock(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    assert client.get("/api/health").json()["ai"] is True
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    monkeypatch.setenv("VERSIGHT_MOCK", "1")
    h = client.get("/api/health").json()
    assert h["ai"] and h["mock"] and h["model"] == "demo"


# ---- demo mode ------------------------------------------------------------------------------
def test_mock_assist_rewrites_and_cleans(client, monkeypatch):
    monkeypatch.setenv("VERSIGHT_MOCK", "1")
    r = client.post("/api/assist", json=assist_body(request="Fix the style and remove empty paragraphs")).json()
    by = {e["id"]: e for e in r["edits"]}
    assert by["b3"]["html"] == "<p>Check the seal.</p>"
    assert "<li>Clean the jaws.</li>" in by["b4"]["html"] and by["b3"]["rule"] == "r1"
    assert by["b5"]["op"] == "delete"
    assert r["reply"].startswith("[Demo mode")


def test_mock_assist_respects_scope_and_questions(client, monkeypatch):
    monkeypatch.setenv("VERSIGHT_MOCK", "1")
    r = client.post("/api/assist", json=assist_body(scope_ids=["b3"])).json()
    assert [e["id"] for e in r["edits"]] == ["b3"]
    q = client.post("/api/assist", json=assist_body(request="How many blocks are there?")).json()
    assert q["edits"] == []


def test_mock_learn(client, monkeypatch):
    monkeypatch.setenv("VERSIGHT_MOCK", "1")
    docs = [{"name": f"d{i}.docx", "words": 300, "tables": 1, "ol": 4, "ul": 0, "callouts": 2, "avg_sent": 14,
             "heads": [{"lvl": 2, "text": "Purpose"}, {"lvl": 2, "text": "Procedure"}],
             "steps": ["Press the start button", "Check the gauge"], "excerpt": "x"} for i in range(3)]
    r = client.post("/api/learn", json={"docs": docs}).json()
    assert [t["section"] for t in r["template"]] == ["Purpose", "Procedure"]
    assert r["rules"] and all(x["followedBy"] == [1, 2, 3] for x in r["rules"])


# ---- real path, with api.anthropic.com faked -------------------------------------------------
def test_assist_calls_model_correctly(client, monkeypatch, fake):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    answer = {"reply": "Done.", "edits": [{"op": "replace", "id": "b3", "html": "<p>Check the seal.</p>", "why": "imperative", "rule": "r1"}]}
    f = fake(json.dumps(answer)).install()
    r = client.post("/api/assist", json=assist_body(source="ECO-12: seal time is 2 s")).json()
    assert r["reply"] == "Done." and r["edits"][0]["id"] == "b3" and r["dropped"] == 0
    sent = f.requests[0]
    assert sent["url"].endswith("/v1/messages")
    # SDK 2.x sends the key as a Bearer token; older SDKs used x-api-key. Either way it must arrive.
    h = sent["headers"]
    assert "sk-ant-test" in (h.get("authorization", "") + h.get("x-api-key", ""))
    j = sent["json"]
    assert j["model"] == "claude-sonnet-5-5" and j["max_tokens"] == 16000
    assert j["output_config"] == {"effort": "medium"}
    for banned in ("temperature", "top_p", "top_k"):
        assert banned not in j
    prompt = j["messages"][0]["content"]
    assert "[b3] <p>You should check the seal.</p>" in prompt
    assert "Start each step with an imperative verb." in prompt
    assert "ECO-12: seal time is 2 s" in prompt
    assert "Fix the style" in prompt


def test_assist_uses_env_model_and_effort(client, monkeypatch, fake):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setenv("VERSIGHT_MODEL", "claude-opus-5-5")
    monkeypatch.setenv("VERSIGHT_EFFORT", "high")
    f = fake('{"reply":"ok","edits":[]}').install()
    client.post("/api/assist", json=assist_body())
    assert f.requests[0]["json"]["model"] == "claude-opus-5-5"
    assert f.requests[0]["json"]["output_config"] == {"effort": "high"}


def test_assist_drops_bad_edits_and_enforces_scope(client, monkeypatch, fake):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    edits = [
        {"op": "replace", "id": "b3", "html": "<p>ok</p>", "why": "a"},        # allowed
        {"op": "replace", "id": "b4", "html": "<p>out of scope</p>", "why": "b"},  # outside scope
        {"op": "replace", "id": "b999", "html": "<p>x</p>", "why": "c"},         # unknown id
        {"op": "explode", "id": "b3", "why": "d"},                                 # unknown op
        {"op": "replace", "id": "b3", "why": "e"},                                 # no html
        {"op": "insert_after", "id": "start", "html": "<p>top</p>", "why": "f"},   # start + scope -> dropped
        "junk",
    ]
    fake(json.dumps({"reply": "r", "edits": edits})).install()
    r = client.post("/api/assist", json=assist_body(scope_ids=["b3"])).json()
    assert [e["id"] for e in r["edits"]] == ["b3"] and r["dropped"] == 6


def test_assist_allows_insert_at_start_without_scope(client, monkeypatch, fake):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    fake(json.dumps({"reply": "r", "edits": [{"op": "insert_after", "id": "start", "html": "<p>top</p>", "why": "f"}]})).install()
    assert len(client.post("/api/assist", json=assist_body()).json()["edits"]) == 1


def test_model_answer_in_code_fence_and_prose(client, monkeypatch, fake):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    fake('Sure!\n```json\n{"reply":"fenced","edits":[]}\n```').install()
    assert client.post("/api/assist", json=assist_body()).json()["reply"] == "fenced"
    fake('Here you go: {"reply":"inline","edits":[]} Hope that helps').install()
    assert client.post("/api/assist", json=assist_body()).json()["reply"] == "inline"


def test_non_json_answer_is_a_clear_error(client, monkeypatch, fake):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    fake("I cannot do that.").install()
    r = client.post("/api/assist", json=assist_body())
    assert r.status_code == 502 and r.json()["error"]["code"] == "invalid_json"


def test_thinking_only_and_truncated_answers(client, monkeypatch, fake):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    fake(content=[{"type": "thinking", "thinking": "hmm", "signature": "s"}]).install()
    assert client.post("/api/assist", json=assist_body()).json()["error"]["code"] == "empty_completion"
    fake('{"reply":"cut', stop_reason="max_tokens").install()
    assert client.post("/api/assist", json=assist_body()).json()["error"]["code"] == "truncated"


def test_no_key_gives_actionable_error(client):
    r = client.post("/api/assist", json=assist_body())
    assert r.status_code == 503 and r.json()["error"]["code"] == "no_api_key"
    assert "ANTHROPIC_API_KEY" in r.json()["error"]["message"]


def test_upstream_errors_are_mapped(client, monkeypatch, fake):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    for status, code, http in [(401, "invalid_api_key", 502), (429, "rate_limited", 429),
                               (404, "model_not_found", 502), (500, "upstream_error", 502)]:
        fake(status=status).install()
        r = client.post("/api/assist", json=assist_body())
        assert (r.status_code, r.json()["error"]["code"]) == (http, code), status


def test_learn_calls_model_and_normalizes(client, monkeypatch, fake):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    answer = {"voice": "Direct.", "template": [{"section": "Purpose", "followedBy": [1, 2, 9, "x", 2]}, {"nope": 1}],
              "rules": [{"category": "Language", "text": "Start steps with a verb.", "followedBy": [1, 2], "example": "Press start"},
                        {"text": "short"}, "junk"]}
    f = fake(json.dumps(answer)).install()
    docs = [{"name": "a.docx", "words": 10, "heads": [{"lvl": 2, "text": "Purpose"}], "steps": ["Press"], "excerpt": "e"},
            {"name": "b.docx"}]
    r = client.post("/api/learn", json={"docs": docs}).json()
    assert r["template"] == [{"section": "Purpose", "followedBy": [1, 2]}]
    assert len(r["rules"]) == 1 and r["rules"][0]["followedBy"] == [1, 2]
    prompt = f.requests[0]["json"]["messages"][0]["content"]
    assert "DOCUMENT 1: a.docx" in prompt and "DOCUMENT 2: b.docx" in prompt


# ---- guards ---------------------------------------------------------------------------------
def test_validation_errors(client):
    r = client.post("/api/assist", json={"request": "", "blocks": []})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    r = client.post("/api/assist", json=assist_body(blocks=[{"id": "bad id!", "html": ""}]))
    assert r.status_code == 422
    assert client.post("/api/learn", json={"docs": []}).status_code == 422


def test_oversize_body_is_rejected(client, monkeypatch):
    monkeypatch.setenv("VERSIGHT_MAX_BODY_BYTES", "500")
    r = client.post("/api/assist", json=assist_body(source="x" * 2000))
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"


def test_foreign_host_header_is_refused(client):
    assert client.get("/api/health", headers={"host": "evil.example.com"}).status_code == 400


def test_security_headers_and_unknown_api_route(client):
    r = client.get("/api/health")
    assert "script-src 'self'" in r.headers["content-security-policy"] and r.headers["cache-control"] == "no-store"
    assert client.get("/api/nope").status_code == 404


def test_key_is_never_returned(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-SECRET")
    assert "SECRET" not in client.get("/api/health").text
