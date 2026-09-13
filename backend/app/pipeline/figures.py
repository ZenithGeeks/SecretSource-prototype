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
from pathlib import Path

from app.config import PAPERS_DIR

IMAGE_SCALE = 2.0  # crops rendered at twice the page's own resolution
MANIFEST = "media.json"  # cache: Docling runs once per paper
FORMULAS = os.getenv("DOCLING_FORMULAS", "") == "1"  # reading formulas as LaTeX costs its own model download

_converter = None
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_converter_guard = threading.Lock()


def _lock_for(pdf: Path) -> threading.Lock:
    """One lock per paper. Two runs that read the same paper at once would write the same
    crop files and manifest."""
    with _locks_guard:
        return _locks.setdefault(pdf.as_posix(), threading.Lock())


def _enriched_converter():
    """Docling with picture crops and formula reading turned on (both off by default)."""
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions(
        generate_picture_images=True, images_scale=IMAGE_SCALE, do_formula_enrichment=FORMULAS
    )
    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )


NUMBERED = re.compile(r"^\s*(figure|fig\.?|table|equation|eq\.?)\s*([0-9]+[a-z]?)", re.I)
KINDS = {"fig": "Figure", "figure": "Figure", "table": "Table", "equation": "Equation", "eq": "Equation"}


def _label(caption: str, kind: str, index: int) -> str:
    """"Figure 3". The paper's own name for it, or a count if it has none."""
    found = NUMBERED.match(caption or "")
    if found:
        return f"{KINDS[found.group(1).lower().rstrip('.')]} {found.group(2)}"
    return f"{kind.title()} {index}"


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
                "label": _label(caption, "figure", index),
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
            "label": _label(table.caption_text(document) or "", "table", index),
            "page": _page_of(table),
            "caption": table.caption_text(document) or "",
            "text": table.export_to_markdown(document),
        }
        for index, table in enumerate(document.tables, start=1)
    ]


def _formulas(document) -> list[dict]:
    from docling_core.types.doc import DocItemLabel

    formulas = []
    for item in document.texts:
        if item.label == DocItemLabel.FORMULA and (item.text or "").strip():
            formulas.append(
                {
                    "kind": "formula",
                    "label": f"Equation {len(formulas) + 1}",
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
    global _converter
    pdf = Path(pdf_path)
    try:
        with _lock_for(pdf):
            if not refresh and (cached := _read_manifest(pdf)):
                return {"status": "ok", "cached": True, **cached}

            with _converter_guard:
                if _converter is None:
                    _converter = _enriched_converter()
            document = _converter.convert(pdf).document

            media = {
                "file": pdf.as_posix(),
                "figures": _figures(document, pdf),
                "tables": _tables(document),
                "formulas": _formulas(document),
            }
            (figures_dir(pdf) / MANIFEST).write_text(json.dumps(media, ensure_ascii=False), encoding="utf-8")
            return {"status": "ok", "cached": False, **media}
    except Exception as error:
        return {"status": "error", "message": str(error), "file": pdf.as_posix()}


def named_figures(figures: list[dict]) -> list[dict]:
    """The figures whose caption gives their number, like "Figure 2: ...".

    A figure without one gets a counted label, and "Figure 2" by count may not be the
    paper's own Figure 2. A link from the text must never point at the wrong figure.
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
