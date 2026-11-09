# Versight Editor

A Word-style editor for controlled manufacturing documents (work instructions, SOPs) with an AI assistant in a right-hand panel.
You add your own documents, it writes down the style rules they follow, and then it edits to those rules while you keep typing.
Every AI change is a suggestion you accept or reject. Nothing is applied without you.

- **Editor**: type and format freely (headings, bold/italic/underline, fonts, sizes, alignment, lists, tables, undo/redo). Open `.docx`, `.html`, `.md`, `.txt` files.
- **Assistant panel**: ask for changes or ask questions. Select text first to limit the change to that part. Paste an ECO or ticket as source material and it updates the document from it.
- **Style guide**: add 10 to 20 of your documents. It finds the recurring structure, wording and warning conventions, writes them as rules (HARD if nearly all your documents follow it, SOFT otherwise), and checks the document against a learned section template. Edit, switch or delete any rule, or add your own.
- **Suggestions**: shown as word-level diffs in the panel and as ghost blocks in the document. Accept, reject, accept all, undo. A suggestion goes stale, and cannot be applied, if you edit that text yourself.
- **Export**: a real `.docx` (built on the server, opens in Word, LibreOffice and Google Docs) or a plain `.html` page.

## Run it

You need Python 3.11+ and an Anthropic API key.

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env                 # then put your key after ANTHROPIC_API_KEY=
python -m app
```

Open <http://127.0.0.1:8000>.

To try the editor with no key and no model, run `VERSIGHT_MOCK=1 python -m app`. The page then says **Demo mode**: replies come from a few
built-in text patterns (steps that start with a verb, a space before units, empty paragraphs), not from AI.

If the key is missing the page says so, and editing, formatting, Open and Export still work.

## Settings

Environment variables or a `.env` file. See `.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required for the assistant and style learning |
| `VERSIGHT_MODEL` | `claude-sonnet-5-5` | Any current Claude model id |
| `VERSIGHT_EFFORT` | `medium` | Thinking effort: `low`, `medium`, `high`, `xhigh`, `max` |
| `VERSIGHT_MAX_TOKENS` | `16000` | Output budget, which includes the model's thinking |
| `VERSIGHT_TIMEOUT` | `240` | Seconds per model call |
| `VERSIGHT_HOST` / `VERSIGHT_PORT` | `127.0.0.1` / `8000` | Where it listens |
| `VERSIGHT_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | Accepted `Host` headers |
| `VERSIGHT_MOCK` | off | Demo mode, no model |

The server sends no `temperature`, `top_p` or `top_k`: current Claude models reject them.

## What leaves your computer

- Your API key stays on the server and is never sent to the page.
- **Assistant requests** send the document's text (as blocks), your active rules, any pasted source material, and the last few chat turns to the Anthropic API.
- **Learning** sends, per document you added, only a summary: file name, counts, headings, up to 8 sample numbered steps (140 characters each) and a 450-character excerpt. Full documents are not sent. Files are read in your browser.
- Nothing is stored on the server. The draft, the style guide and 3 short excerpts used as tone examples live in your browser's local storage.

**Before you use real controlled documents, check that your organization allows sending their text to a third-party API.** The sample document in the editor is made up.

## Safety notes

- The server has no login. It listens on `127.0.0.1` and refuses requests whose `Host` header is not local (this blocks DNS-rebinding attacks from other websites). Anyone who can reach the port can spend your API credit, so do not expose it to a network without putting authentication in front of it.
- The assistant is told never to invent values, part numbers, tolerances or safety limits, and to leave bracketed placeholders such as `[TBD: torque value]` instead. It is a model, so **read every suggestion**, especially numbers, units and warnings. The server also drops any proposed edit that targets text outside your selection or a block that does not exist.
- Text the model proposes is sanitized in the page (only basic formatting tags survive) before it can reach the document.

## How it works

```
browser (static/)  ──JSON──▶  FastAPI (app/)  ──▶  Anthropic Messages API
  editor, rules UI              /api/assist          prompts built on the server
  diff + accept/reject          /api/learn           answer parsed, edits validated
  .docx/.md reading (mammoth)   /api/export/docx     HTML ▶ .docx with python-docx
```

```
app/main.py         routes, host check, size limits, security headers, edit validation
app/prompts.py      the two prompts (edit the assistant's behaviour here)
app/llm.py          the only code that calls the Anthropic API; error mapping
app/export_docx.py  editor HTML to a real .docx
app/mock.py         demo mode
static/             index.html, app.css, app.js, vendor/mammoth.browser.min.js (no CDN, no external requests)
tests/              pytest suite, plus a browser-level test in tests/e2e
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest                               # backend tests; the Anthropic API is faked, so no key is needed

cd tests/e2e && npm install && cd ../..
pytest                               # now also runs the browser test: starts the server in demo mode and drives the real page in jsdom
```

The tests check the exact request sent to the Anthropic API (model, no sampling parameters, thinking blocks ignored, errors mapped), edit validation, `.docx` output, and the page's flows against a running server: assist, accept/undo/stale, delete, learning from real `.docx` files, Open, export, error and stop handling.

## Known limits

- It is a focused editor, not all of Word. No headers/footers, page layout, comments, tracked changes, images, or style definitions pane.
- `.docx` import (mammoth) keeps structure (headings, lists, tables, bold/italic) but not fonts, colors, alignment or images. `.docx` export uses python-docx's default styles, not your company template.
- Rules and the template come from structure and wording summaries, not from page layout or formatting inside your files.
- One document at a time. The learning set is held in the page, so re-add files to learn again; the learned rules are kept.
- The whole document is sent with each assistant request, up to about 110,000 characters. For long documents select the part you want changed.
- The app was tested end to end against a faked Anthropic API and a demo mode. It has not been run against the live API in the environment where it was built, so the first real call is the one to watch: if the answer looks wrong or an error appears, the server log shows why.
