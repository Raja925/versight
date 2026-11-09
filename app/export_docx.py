"""Turn the editor's HTML into a real .docx (python-docx), not an HTML wrapper."""
import io
import re

from bs4 import BeautifulSoup, NavigableString, Tag
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

_XML_BAD = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")
_HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4}
_ALIGN = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}
_BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "ul", "ol", "table", "blockquote"}


def _clean(s: str) -> str:
    return _XML_BAD.sub("", s)


def _style_map(tag: Tag) -> dict[str, str]:
    out = {}
    for part in (tag.get("style") or "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            out[k.strip().lower()] = v.strip()
    return out


def _font_size_pt(v: str) -> float | None:
    m = re.fullmatch(r"([\d.]+)\s*(pt|px)", v.strip().lower())
    if not m:
        return None
    n = float(m.group(1))
    if m.group(2) == "px":
        n = n * 0.75
    return n if 4 <= n <= 96 else None


def _apply_align(par, tag: Tag) -> None:
    a = _style_map(tag).get("text-align", "").lower()
    if a in _ALIGN:
        par.alignment = _ALIGN[a]


def _add_runs(par, node, fmt: dict | None = None) -> None:
    """Walk inline content and add runs with bold/italic/underline/font carried down."""
    fmt = dict(fmt or {})
    for child in node.children:
        if isinstance(child, NavigableString):
            text = _clean(str(child))
            if not text:
                continue
            run = par.add_run(text)
            run.bold = fmt.get("b") or None
            run.italic = fmt.get("i") or None
            run.underline = fmt.get("u") or None
            if fmt.get("font"):
                run.font.name = fmt["font"]
            if fmt.get("size"):
                run.font.size = Pt(fmt["size"])
            continue
        if not isinstance(child, Tag):
            continue
        name = child.name.lower()
        if name == "br":
            par.add_run().add_break()
            continue
        sub = dict(fmt)
        if name in ("strong", "b"):
            sub["b"] = True
        elif name in ("em", "i"):
            sub["i"] = True
        elif name == "u":
            sub["u"] = True
        st = _style_map(child)
        if st.get("font-weight", "") in ("bold", "700", "800", "900"):
            sub["b"] = True
        if st.get("font-style") == "italic":
            sub["i"] = True
        if "underline" in st.get("text-decoration", ""):
            sub["u"] = True
        if st.get("font-family"):
            sub["font"] = st["font-family"].split(",")[0].strip().strip("'\"")
        if st.get("font-size"):
            sz = _font_size_pt(st["font-size"])
            if sz:
                sub["size"] = sz
        if name == "font":
            if child.get("face"):
                sub["font"] = child["face"].split(",")[0].strip()
        _add_runs(par, child, sub)


def _restart_numbering(doc, par) -> None:
    """Give this numbered paragraph its own list so each <ol> starts again at 1."""
    numbering = doc.part.numbering_part.numbering_definitions._numbering
    style_ppr = doc.styles["List Number"].element.pPr
    if style_ppr is None or style_ppr.numPr is None or style_ppr.numPr.numId is None:
        return
    abstract_of_style = None
    base_id = style_ppr.numPr.numId.val
    for num in numbering.findall(qn("w:num")):
        if int(num.get(qn("w:numId"))) == base_id:
            abstract_of_style = num.find(qn("w:abstractNumId")).get(qn("w:val"))
    if abstract_of_style is None:
        return
    new_id = max([int(n.get(qn("w:numId"))) for n in numbering.findall(qn("w:num"))] + [0]) + 1
    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(new_id))
    ab = OxmlElement("w:abstractNumId")
    ab.set(qn("w:val"), abstract_of_style)
    num.append(ab)
    ov = OxmlElement("w:lvlOverride")
    ov.set(qn("w:ilvl"), "0")
    so = OxmlElement("w:startOverride")
    so.set(qn("w:val"), "1")
    ov.append(so)
    num.append(ov)
    numbering.append(num)
    par._restart_num_id = new_id  # remembered by the caller


class _Builder:
    def __init__(self, doc):
        self.doc = doc

    # --- lists -----------------------------------------------------------------------------
    def _list(self, tag: Tag, ordered: bool, level: int) -> None:
        base = "List Number" if ordered else "List Bullet"
        style = base if level == 0 else f"{base} {min(level + 1, 3)}"
        new_num_id = None
        for li in tag.find_all("li", recursive=False):
            par = self.doc.add_paragraph(style=style)
            _apply_align(par, li)
            # inline content of the item, leaving nested lists for below
            holder = BeautifulSoup("<x></x>", "html.parser").x
            nested = []
            for c in list(li.children):
                if isinstance(c, Tag) and c.name in ("ul", "ol"):
                    nested.append(c)
                else:
                    holder.append(c.extract() if hasattr(c, "extract") else c)
            _add_runs(par, holder)
            if ordered and level == 0:
                if new_num_id is None:
                    _restart_numbering(self.doc, par)
                    new_num_id = getattr(par, "_restart_num_id", None)
                if new_num_id is not None:
                    ppr = par._p.get_or_add_pPr()
                    numpr = ppr.get_or_add_numPr()
                    numpr.get_or_add_numId().val = new_num_id
                    numpr.get_or_add_ilvl().val = 0
            for n in nested:
                self._list(n, n.name == "ol", level + 1)

    # --- tables ----------------------------------------------------------------------------
    def _table(self, tag: Tag) -> None:
        rows = tag.find_all("tr")
        if not rows:
            return
        width = max(len(r.find_all(["td", "th"], recursive=False)) for r in rows) or 1
        table = self.doc.add_table(rows=len(rows), cols=width)
        table.style = "Table Grid"
        for ri, tr in enumerate(rows):
            for ci, cell in enumerate(tr.find_all(["td", "th"], recursive=False)):
                target = table.cell(ri, ci)
                par = target.paragraphs[0]
                _add_runs(par, cell)
                if cell.name == "th":
                    for run in par.runs:
                        run.bold = True
        self.doc.add_paragraph()

    # --- blocks ----------------------------------------------------------------------------
    def block(self, tag: Tag) -> None:
        name = tag.name.lower()
        if name in _HEADINGS:
            par = self.doc.add_heading(level=_HEADINGS[name])
            _add_runs(par, tag)
            _apply_align(par, tag)
        elif name in ("ul", "ol"):
            self._list(tag, name == "ol", 0)
        elif name == "table":
            self._table(tag)
        elif name == "blockquote":
            par = self.doc.add_paragraph(style="Quote")
            _add_runs(par, tag)
        elif name in ("p", "div"):
            if any(isinstance(c, Tag) and c.name in _BLOCK_TAGS for c in tag.children):
                # a div that wraps blocks: treat its children as blocks
                self.children(tag)
                return
            par = self.doc.add_paragraph()
            _add_runs(par, tag)
            _apply_align(par, tag)
        else:
            par = self.doc.add_paragraph()
            _add_runs(par, tag)

    def children(self, root) -> None:
        loose = None
        for c in root.children:
            if isinstance(c, NavigableString):
                if str(c).strip():
                    if loose is None:
                        loose = self.doc.add_paragraph()
                    loose.add_run(_clean(str(c)))
                continue
            loose = None
            if isinstance(c, Tag) and c.name not in ("script", "style"):
                self.block(c)


def html_to_docx(title: str, html: str) -> bytes:
    doc = Document()
    doc.core_properties.title = _clean(title)[:200]
    soup = BeautifulSoup(html or "", "html.parser")
    for t in soup(["script", "style"]):
        t.decompose()
    root = soup.body or soup
    _Builder(doc).children(root)
    # python-docx always starts with one empty paragraph in some templates; drop it if unused
    first = doc.paragraphs[0] if doc.paragraphs else None
    if first is not None and not first.text.strip() and len(doc.paragraphs) > 1 and not first.runs:
        first._element.getparent().remove(first._element)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
