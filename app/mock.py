"""Demo mode (VERSIGHT_MOCK=1): deterministic answers with no model call.

It exists so the whole app can be exercised without an API key. It is plain pattern matching,
not AI, and every reply says so.
"""
import json
import re

from .schemas import AssistRequest, LearnRequest

TAG = "[Demo mode, no AI model is running] "

_LEAD = re.compile(
    r"(<(?:p|li)[^>]*>)\s*(?:You\s+(?:should|must|need\s+to|have\s+to)|Please|Make\s+sure\s+to|Be\s+sure\s+to)\s+(\w)",
    re.I,
)
_ROLE = re.compile(
    r"(<(?:p|li)[^>]*>)\s*The\s+(?:operators?|technicians?|line\s+leads?)\s+(?:should|must|shall|will)\s+(\w)", re.I
)
_UNIT = re.compile(r"(\d)(mm|cm|kg|psi|bar|ms|°C|N·m|Nm)\b")
_EMPTY = re.compile(r"^\s*<p[^>]*>\s*(?:<br\s*/?>)?\s*</p>\s*$", re.I)
_QUESTION = re.compile(r"^\s*(what|why|how|which|is|are|does|do|can|where|when|who)\b", re.I)


def _imperative(html: str) -> str:
    html = _LEAD.sub(lambda m: m.group(1) + m.group(2).upper(), html)
    return _ROLE.sub(lambda m: m.group(1) + m.group(2).upper(), html)


def _units(html: str) -> str:
    # only touch text between tags, never attributes
    return re.sub(r">([^<]+)<", lambda m: ">" + _UNIT.sub(r"\1 \2", m.group(1)) + "<", html)


def mock_assist(req: AssistRequest) -> str:
    text = req.request.strip()
    in_scope = set(req.scope_ids) if req.scope_ids else None
    edits = []
    if _QUESTION.match(text) or text.endswith("?"):
        reply = (
            TAG
            + f"Your document has {len(req.blocks)} blocks and the style guide has {len(req.rules)} rules. "
            "Connect an API key to get a real answer."
        )
        return json.dumps({"reply": reply, "edits": []})

    wants_clean = re.search(r"\b(empty|blank|clean)", text, re.I)
    verb_rule = next((r.id for r in req.rules if "imperative" in r.text.lower()), "")
    unit_rule = next((r.id for r in req.rules if "unit" in r.text.lower()), "")
    for b in req.blocks:
        if in_scope is not None and b.id not in in_scope:
            continue
        if wants_clean and _EMPTY.match(b.html or "<p></p>"):
            edits.append({"op": "delete", "id": b.id, "why": "Empty paragraph."})
            continue
        step = _imperative(b.html)
        new = _units(step)
        if new != b.html:
            why = []
            if step != b.html:
                why.append("Start the step with a verb.")
            if new != step:
                why.append("Put a space between the number and its unit.")
            e = {"op": "replace", "id": b.id, "html": new, "why": " ".join(why)}
            rule = verb_rule if step != b.html else unit_rule
            if rule:
                e["rule"] = rule
            edits.append(e)
        if len(edits) >= 30:
            break

    if edits:
        reply = TAG + f"Proposed {len(edits)} change(s): steps that start with a verb, a space before units, and removal of empty paragraphs. Review each one."
    else:
        reply = TAG + "Found nothing to change with the built-in demo patterns."
    return json.dumps({"reply": reply, "edits": edits})


def _starts_with_verb(step: str) -> bool:
    first = re.sub(r"[^a-z]", "", (step.split() or [""])[0].lower())
    return bool(first) and first not in {"you", "the", "please", "it", "this", "there", "we", "a", "an", "operators", "operator"}


def mock_learn(req: LearnRequest) -> str:
    n = len(req.docs)
    idx = range(1, n + 1)

    def who(pred):
        return [i for i, d in zip(idx, req.docs) if pred(d)]

    # template: H1/H2 headings that recur, in first-seen order
    seen: dict[str, list[int]] = {}
    for i, d in zip(idx, req.docs):
        for h in d.heads:
            if h.lvl <= 2:
                key = re.sub(r"^\d+[.)]?\s*", "", h.text).strip()
                if key and i not in seen.setdefault(key, []):
                    seen[key].append(i)
    template = [{"section": k, "followedBy": v} for k, v in seen.items() if len(v) >= (n + 1) // 2][:12]

    rules = [
        ("Structure", "Number the steps of a procedure and keep one action per step.", who(lambda d: d.ol > 0), ""),
        ("Language", "Start each step with a verb in the imperative.", who(lambda d: d.steps and sum(_starts_with_verb(s) for s in d.steps) >= len(d.steps) / 2), ""),
        ("Language", "Keep sentences at 20 words or fewer.", who(lambda d: 0 < d.avg_sent <= 20), ""),
        ("Safety", "Label hazards with WARNING or CAUTION before the step they apply to.", who(lambda d: d.callouts > 0), ""),
        ("Formatting", "Put parameters, limits and checks in a table instead of running text.", who(lambda d: d.tables > 0), ""),
        ("Structure", "Use short headings for each section, with Purpose first.", who(lambda d: any(h.text.lower().strip(" .:0123456789").startswith("purpose") for h in d.heads)), ""),
    ]
    out = [
        {"category": c, "text": t, "followedBy": f, "example": e}
        for c, t, f, e in rules
        if f
    ]
    return json.dumps(
        {
            "voice": TAG + "Direct and instructional; second person is implied through imperative verbs.",
            "template": template,
            "rules": out,
        }
    )
