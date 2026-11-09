import io

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

from app.export_docx import html_to_docx


def load(html, title="T"):
    return Document(io.BytesIO(html_to_docx(title, html)))


def test_headings_paragraphs_and_inline_formatting():
    d = load('<h1>Title</h1><h2>Purpose</h2><p>Plain <strong>bold</strong> <em>it</em> <u>un</u></p>'
             '<p style="text-align:center">mid</p>')
    styles = [(p.style.name, p.text) for p in d.paragraphs]
    assert ("Heading 1", "Title") in styles and ("Heading 2", "Purpose") in styles
    p = next(p for p in d.paragraphs if p.text.startswith("Plain"))
    flags = {r.text.strip(): (r.bold, r.italic, r.underline) for r in p.runs if r.text.strip()}
    assert flags["bold"][0] and flags["it"][1] and flags["un"][2] and not flags["Plain"][0]
    assert next(p for p in d.paragraphs if p.text == "mid").alignment == WD_ALIGN_PARAGRAPH.CENTER


def test_lists_and_numbering_restarts():
    d = load("<ol><li>One</li><li>Two</li></ol><p>between</p><ol><li>Again</li></ol><ul><li>Dot<ul><li>Sub</li></ul></li></ul>")
    items = [(p.style.name, p.text) for p in d.paragraphs if p.text]
    assert ("List Number", "One") in items and ("List Number", "Again") in items
    assert ("List Bullet", "Dot") in items and ("List Bullet 2", "Sub") in items
    num_ids = [p._p.pPr.numPr.numId.val for p in d.paragraphs if p.text in ("One", "Two", "Again")]
    assert num_ids[0] == num_ids[1] != num_ids[2]  # second list is a separate list, so it restarts at 1


def test_table():
    d = load("<table><tr><th>Param</th><th>Value</th></tr><tr><td>Time</td><td>2 s</td></tr></table>")
    t = d.tables[0]
    assert [[c.text for c in r.cells] for r in t.rows] == [["Param", "Value"], ["Time", "2 s"]]
    assert t.cell(0, 0).paragraphs[0].runs[0].bold


def test_fonts_and_sizes_from_style():
    d = load('<p><span style="font-family: Arial, sans-serif; font-size: 16px">Hi</span></p>')
    run = next(p for p in d.paragraphs if p.text == "Hi").runs[0]
    assert run.font.name == "Arial" and run.font.size.pt == 12


def test_hostile_and_odd_input_does_not_crash():
    out = html_to_docx("a\x00b" * 3, "<script>alert(1)</script><p>ok\x00\x01 text</p>loose text<div><p>in div</p></div><table></table>")
    d = Document(io.BytesIO(out))
    text = "\n".join(p.text for p in d.paragraphs)
    assert "alert" not in text and "ok text" in text and "loose text" in text and "in div" in text


def test_empty_document_is_valid():
    assert len(Document(io.BytesIO(html_to_docx("", ""))).paragraphs) >= 0


def test_export_endpoint(client):
    r = client.post("/api/export/docx", json={"title": "WI-1: Seal / Test", "html": "<h1>Hi</h1><p>there</p>"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert "attachment" in r.headers["content-disposition"] and ".docx" in r.headers["content-disposition"]
    assert r.content[:2] == b"PK"
    assert [p.text for p in Document(io.BytesIO(r.content)).paragraphs if p.text] == ["Hi", "there"]
