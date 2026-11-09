"""Starts the real server in demo mode, then drives the real page in jsdom (Node). Skipped without Node or jsdom."""
import io
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from docx import Document

ROOT = Path(__file__).resolve().parent.parent
E2E = ROOT / "tests" / "e2e"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not (E2E / "node_modules" / "jsdom").exists(),
    reason="needs Node and `npm install` in tests/e2e",
)


def make_docx(path: Path, n: int) -> None:
    d = Document()
    d.add_heading(f"WI-{n:03d} Pouch Seal Inspection", 1)
    d.add_heading("Purpose", 2)
    d.add_paragraph("This work instruction describes how to inspect the seal.")
    d.add_heading("Safety and PPE", 2)
    d.add_paragraph("WARNING: The jaws are hot. Wear gloves.")
    d.add_heading("Procedure", 2)
    for step in ("Place the cell on the fixture.", "Check the seal for wrinkles.", "Record the result on the traveler."):
        d.add_paragraph(step, style="List Number")
    t = d.add_table(rows=2, cols=2)
    t.style = "Table Grid"
    t.cell(0, 0).text, t.cell(0, 1).text = "Rev", "Change"
    t.cell(1, 0).text, t.cell(1, 1).text = "A", "First release"
    d.add_heading("Revision History", 2)
    d.save(path)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server():
    port = free_port()
    env = {**os.environ, "VERSIGHT_MOCK": "1", "VERSIGHT_PORT": str(port), "VERSIGHT_HOST": "127.0.0.1"}
    # the unit-test fixtures set these for TestClient; the real server must not inherit them
    for k in ("ANTHROPIC_API_KEY", "VERSIGHT_ALLOWED_HOSTS", "VERSIGHT_MAX_RETRIES"):
        env.pop(k, None)
    proc = subprocess.Popen([sys.executable, "-m", "app"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    url = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            urllib.request.urlopen(url + "/api/health", timeout=1).read()
            break
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError(proc.stderr.read().decode())
            time.sleep(0.25)
    yield url
    proc.terminate()
    proc.wait(timeout=10)


def test_browser_flows(server, tmp_path):
    fixtures, out = tmp_path / "fixtures", tmp_path / "out"
    fixtures.mkdir()
    out.mkdir()
    for i in range(1, 4):
        make_docx(fixtures / f"wi-{i}.docx", i)
    r = subprocess.run(["node", "e2e.cjs", server, str(fixtures), str(out)], cwd=E2E, capture_output=True, text=True, timeout=180)
    print(r.stdout)
    print(r.stderr)
    assert r.returncode == 0, r.stdout[-4000:] + r.stderr[-2000:]
    assert "FAIL" not in r.stdout

    # The page exported the sample document after (1) a hand edit to step 1 and (2) opening a .docx and undoing it.
    # Everything the user did in the browser must be in the Word file the server built.
    exported = Document(io.BytesIO((out / "exported.docx").read_bytes()))
    texts = [p.text for p in exported.paragraphs if p.text]
    assert "Purpose" in texts and "Procedure" in texts and "Revision History" in texts
    assert "Operator edits this by hand." in texts            # the hand edit
    assert not any("WI-001" in t for t in texts)               # the undone Open did not leak in
    assert any(p.style.name == "List Number" for p in exported.paragraphs)
    assert len(exported.tables) == 2
    assert exported.tables[0].cell(0, 0).text == "Document no."
    assert [c.text for c in exported.tables[1].rows[0].cells] == ["Rev", "Date", "Change"]
