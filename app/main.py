"""Versight Editor backend: static front end plus three JSON endpoints and a .docx export."""
import os
import re
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import llm, mock
from .config import get_settings
from .export_docx import html_to_docx
from .llm import ApiError
from .prompts import build_assist_prompt, build_learn_prompt
from .schemas import AssistRequest, ExportRequest, LearnRequest

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
OPS = {"replace", "insert_after", "delete"}

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def _normalize_assist(data: dict, req: AssistRequest) -> dict:
    """Keep only edits that are well formed, point at real blocks and respect the selected scope."""
    ids = {b.id for b in req.blocks}
    scope = set(req.scope_ids) if req.scope_ids else None
    reply = data.get("reply")
    reply = reply.strip() if isinstance(reply, str) else ""
    edits, dropped = [], 0
    for e in data.get("edits") if isinstance(data.get("edits"), list) else []:
        if not isinstance(e, dict):
            dropped += 1
            continue
        op, bid = e.get("op"), e.get("id")
        if op not in OPS or not isinstance(bid, str):
            dropped += 1
            continue
        if not (bid in ids or (op == "insert_after" and bid == "start" and scope is None)):
            dropped += 1
            continue
        if scope is not None and bid not in scope:
            dropped += 1
            continue
        html = e.get("html")
        if op != "delete" and not (isinstance(html, str) and html.strip()):
            dropped += 1
            continue
        item = {"op": op, "id": bid, "why": str(e.get("why") or "")[:200]}
        if op != "delete":
            item["html"] = html[:60000]
        if isinstance(e.get("rule"), str) and e["rule"]:
            item["rule"] = e["rule"][:16]
        edits.append(item)
        if len(edits) >= 30:
            break
    if not reply:
        reply = f"{len(edits)} change(s) proposed." if edits else "Nothing to change."
    return {"reply": reply[:2000], "edits": edits, "dropped": dropped}


def _ints(v, n: int) -> list[int]:
    out = []
    for x in v if isinstance(v, list) else []:
        if isinstance(x, int) and not isinstance(x, bool) and 1 <= x <= n and x not in out:
            out.append(x)
    return out


def _normalize_learn(data: dict, n: int) -> dict:
    template = []
    for t in data.get("template") if isinstance(data.get("template"), list) else []:
        if isinstance(t, dict) and isinstance(t.get("section"), str) and t["section"].strip():
            template.append({"section": t["section"].strip()[:80], "followedBy": _ints(t.get("followedBy"), n)})
    rules = []
    for r in data.get("rules") if isinstance(data.get("rules"), list) else []:
        if not (isinstance(r, dict) and isinstance(r.get("text"), str) and len(r["text"].strip()) >= 8):
            continue
        cat = r.get("category") if isinstance(r.get("category"), str) else "Language"
        rules.append(
            {
                "category": cat.strip()[:40] or "Language",
                "text": r["text"].strip()[:400],
                "followedBy": _ints(r.get("followedBy"), n),
                "example": (r.get("example") if isinstance(r.get("example"), str) else "")[:300],
            }
        )
    voice = data.get("voice") if isinstance(data.get("voice"), str) else ""
    return {"voice": voice.strip()[:500], "template": template[:20], "rules": rules[:25]}


def create_app() -> FastAPI:
    hosts = [h.strip() for h in os.getenv("VERSIGHT_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]").split(",") if h.strip()]
    app = FastAPI(title="Versight Editor", docs_url=None, redoc_url=None, openapi_url=None)
    # Refuses requests whose Host header is not local, which blocks DNS-rebinding attacks on a local server.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            cl = request.headers.get("content-length")
            if cl is None:
                return _err(411, "length_required", "Content-Length is required.")
            try:
                too_big = int(cl) > get_settings().max_body_bytes
            except ValueError:
                return _err(400, "bad_request", "Invalid Content-Length.")
            if too_big:
                return _err(413, "too_large", "The request is too large. Try fewer or smaller documents.")
        resp = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            resp.headers.setdefault(k, v)
        if request.url.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.exception_handler(ApiError)
    async def api_error(_: Request, e: ApiError):
        return _err(e.status, e.code, e.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        first = e.errors()[0] if e.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", [])[1:])
        return _err(422, "invalid_request", f"Invalid request ({where or 'body'}): {first.get('msg', 'bad value')}.")

    @app.get("/api/health")
    async def health():
        s = get_settings()
        return {"ok": True, "ai": bool(s.api_key) or s.mock, "mock": s.mock, "model": "demo" if s.mock else s.model}

    @app.post("/api/assist")
    async def assist(req: AssistRequest):
        s = get_settings()
        raw = mock.mock_assist(req) if s.mock else await llm.complete(build_assist_prompt(req), s)
        return _normalize_assist(llm.parse_json_object(raw), req)

    @app.post("/api/learn")
    async def learn(req: LearnRequest):
        s = get_settings()
        raw = mock.mock_learn(req) if s.mock else await llm.complete(build_learn_prompt(req), s)
        return _normalize_learn(llm.parse_json_object(raw), len(req.docs))

    @app.post("/api/export/docx")
    async def export_docx(req: ExportRequest):
        data = html_to_docx(req.title, req.html)
        base = re.sub(r"[^\w\- ]+", "", req.title).strip().replace(" ", "-") or "document"
        cd = f"attachment; filename=\"{base[:80]}.docx\"; filename*=UTF-8''{quote(base[:80])}.docx"
        return Response(content=data, media_type=DOCX_MIME, headers={"Content-Disposition": cd})

    @app.get("/api/{rest:path}")
    async def api_404(rest: str):
        return _err(404, "not_found", "Unknown API route.")

    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app


app = create_app()
