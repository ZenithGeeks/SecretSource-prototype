"""What a paper shows instead of saying: figure crops, tables, and formulas.

Docling finds all of them. Each figure is cropped and saved beside the paper with its
caption, so a visual hit gives the judge something to quote. Tables stay markdown,
formulas LaTeX.

    python -m app.pipeline.figures data/papers/colbertv2.pdf
"""

import json
import os
import re
import threading
from collections import Counter
from pathlib import Path

from app.config import PAPERS_DIR

IMAGE_SCALE = 2.0  # crops rendered at twice the page's own resolution
MANIFEST = "media.json"  # cache: Docling runs once per paper
FORMULAS = os.getenv("DOCLING_FORMULAS", "") == "1"  # reading formulas as LaTeX costs its own model download
# auto: OCR only a PDF without a text layer (needs_ocr); always; never.
OCR = os.getenv("DOCLING_OCR", "auto").strip().lower() or "auto"
OCR_SAMPLE_PAGES = 10  # pages looked at, spread over the paper, to tell a scan from a born-digital PDF

_converters: dict[tuple[bool, bool], object] = {}  # by (ocr, pictures): loading the models takes seconds
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_converter_guard = threading.Lock()


def _lock_for(pdf: Path) -> threading.Lock:
    """One lock per paper. Two runs that read the same paper at once would write the same
    crop files and manifest."""
    with _locks_guard:
        return _locks.setdefault(pdf.as_posix(), threading.Lock())


def needs_ocr(pdf_path: str) -> bool:
    """Whether Docling should run OCR on this PDF.

    The papers we read are born-digital: their text layer already holds every caption and
    sentence. OCR over every page doubled Docling's time on ColBERT (36 s against 18 s on a CPU)
    and changed no caption and no character of the text (#161). A scanned page is an image with
    no fonts, so a PDF where fewer than half of up to OCR_SAMPLE_PAGES pages use a font still
    gets OCR. Reading a page's font list is cheap, where extracting its text took up to 11 s on a
    PDF full of vector drawings. DOCLING_OCR=always or never overrides the check.
    """
    if OCR in ("always", "never"):
        return OCR == "always"
    import pymupdf

    try:
        with pymupdf.open(pdf_path) as document:
            count = document.page_count
            sample = range(count)
            if count > OCR_SAMPLE_PAGES:
                step = (count - 1) / (OCR_SAMPLE_PAGES - 1)
                sample = sorted({round(i * step) for i in range(OCR_SAMPLE_PAGES)})
            with_fonts = sum(1 for number in sample if document[number].get_fonts())
            return with_fonts * 2 < len(sample)
    except Exception:
        return True  # pymupdf cannot read it: let Docling try, with everything on


def docling_converter(ocr: bool, pictures: bool = True):
    """A Docling converter, built once per setting and shared by every paper.

    `pictures` renders picture crops, and reads formulas as LaTeX when DOCLING_FORMULAS is on;
    both are off in Docling by default.
    """
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    with _converter_guard:
        if (ocr, pictures) not in _converters:
            options = PdfPipelineOptions(do_ocr=ocr)
            if pictures:
                options.generate_picture_images = True
                options.images_scale = IMAGE_SCALE
                options.do_formula_enrichment = FORMULAS
            _converters[ocr, pictures] = DocumentConverter(
                format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
            )
        return _converters[ocr, pictures]


NUMBERED = re.compile(r"^\s*(figure|fig\.?|table|equation|eq\.?)\s*([0-9]+[a-z]?)", re.I)
KINDS = {"fig": "Figure", "figure": "Figure", "table": "Table", "equation": "Equation", "eq": "Equation"}
UNNAMED = {"figure": "Picture", "table": "Table", "formula": "Equation"}


def _label(caption: str, kind: str, page: int) -> tuple[str, bool]:
    """The paper's own name for it, like "Figure 3", or where it is, like "Picture on page 7".

    The second value says whether the name came from the caption. A picture without a numbered
    caption used to be counted, and a counted "Figure 3" could not be told from the paper's
    own Figure 3 (#138).
    """
    found = NUMBERED.match(caption or "")
    if found:
        return f"{KINDS[found.group(1).lower().rstrip('.')]} {found.group(2)}", True
    return f"{UNNAMED[kind]} on page {page}", False


def _name(items: list[dict]) -> list[dict]:
    """Give each item its label, and make labels unique within the list: two pictures on one
    page, or one captioned figure Docling cut into parts, become "... (1 of 2)", "... (2 of 2)"."""
    for item in items:
        item["label"], item["numbered"] = _label(item.get("caption", ""), item["kind"], item["page"])
    totals = Counter(item["label"] for item in items)
    seen: Counter = Counter()
    for item in items:
        label = item["label"]
        if totals[label] > 1:
            seen[label] += 1
            item["label"] = f"{label} ({seen[label]} of {totals[label]})"
    return items


def _named(media: dict) -> dict:
    """The media with every label worked out again. Manifests written before #138 carry counted
    labels, and the labels cost nothing to recompute from the captions and pages."""
    for kind in ("figures", "tables", "formulas"):
        media[kind] = _name(media.get(kind, []))
    return media


def _page_of(item) -> int:
    return item.prov[0].page_no if item.prov else 0


def figures_dir(pdf: Path) -> Path:
    """Where this paper's crops live: papers/figures/<paper>/."""
    return PAPERS_DIR / "figures" / pdf.stem


def _figures(document, pdf: Path) -> list[dict]:
    directory = figures_dir(pdf)
    directory.mkdir(parents=True, exist_ok=True)

    figures = []
    for index, picture in enumerate(document.pictures, start=1):
        image = picture.get_image(document)
        if image is None:  # a picture Docling located but could not render
            continue
        caption = picture.caption_text(document) or ""
        path = directory / f"figure-{index}.png"
        image.save(path)
        figures.append(
            {
                "kind": "figure",
                "page": _page_of(picture),
                "caption": caption,
                "image": path.as_posix(),
            }
        )
    return figures


def _tables(document) -> list[dict]:
    """Tables as markdown: exact numbers a judge can quote, not a picture of them."""
    return [
        {
            "kind": "table",
            "page": _page_of(table),
            "caption": table.caption_text(document) or "",
            "text": table.export_to_markdown(document),
        }
        for table in document.tables
    ]


def _formulas(document) -> list[dict]:
    from docling_core.types.doc import DocItemLabel

    formulas = []
    for item in document.texts:
        if item.label == DocItemLabel.FORMULA and (item.text or "").strip():
            formulas.append(
                {
                    "kind": "formula",
                    "page": _page_of(item),
                    "caption": "",
                    "text": item.text.strip(),
                }
            )
    return formulas


def _read_manifest(pdf: Path) -> dict | None:
    manifest = figures_dir(pdf) / MANIFEST
    if not manifest.is_file():
        return None
    found = json.loads(manifest.read_text(encoding="utf-8"))
    return found if all(Path(figure["image"]).is_file() for figure in found.get("figures", [])) else None


def paper_media(pdf_path: str, refresh: bool = False) -> dict:
    """Every figure, table and formula in a paper: crops on disk, tables and formulas as text.

    Args:
        pdf_path: a local PDF path.
        refresh: run Docling again even when this paper was read before.
    """
    pdf = Path(pdf_path)
    try:
        with _lock_for(pdf):
            if not refresh and (cached := _read_manifest(pdf)):
                return {"status": "ok", "cached": True, **_named(cached)}

            document = docling_converter(needs_ocr(pdf_path)).convert(pdf).document

            media = _named(
                {
                    "file": pdf.as_posix(),
                    "figures": _figures(document, pdf),
                    "tables": _tables(document),
                    "formulas": _formulas(document),
                }
            )
            (figures_dir(pdf) / MANIFEST).write_text(json.dumps(media, ensure_ascii=False), encoding="utf-8")
            return {"status": "ok", "cached": False, **media}
    except Exception as error:
        return {"status": "error", "message": str(error), "file": pdf.as_posix()}


def named_figures(figures: list[dict]) -> list[dict]:
    """The figures whose caption gives their number, like "Figure 2: ...".

    Only those can be the target of "Figure 2" in the text. A link from the text must never
    point at the wrong figure.
    """
    return [
        {key: figure[key] for key in ("label", "page", "caption", "image")}
        for figure in figures
        if NUMBERED.match(figure.get("caption") or "")
    ]


def paper_figures(pdf_path: str) -> list[dict]:
    """The analysed paper's own numbered figures, so a claim's "Figure 2" can show its crop.

    Empty when Docling fails: a paper without figure links still has all its results.
    """
    media = paper_media(pdf_path)
    return named_figures(media["figures"]) if media["status"] == "ok" else []


if __name__ == "__main__":
    import sys

    for argument in sys.argv[1:]:
        found = paper_media(argument)
        if found["status"] == "error":
            print(f"{argument}: {found['message']}")
            continue
        print(f"{argument}: {len(found['figures'])} figures, {len(found['tables'])} tables, "
              f"{len(found['formulas'])} formulas")
        for figure in found["figures"]:
            print(f"  {figure['label']:12s} p{figure['page']}  {figure['image']}")
