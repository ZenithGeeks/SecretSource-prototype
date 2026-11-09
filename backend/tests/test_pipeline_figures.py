"""figures.py with a fake Docling: crops on disk, formulas, the manifest cache and the command line.

Docling and its models never load here. A fake document carries the few attributes figures.py
reads, and a fake image writes a file when saved.
"""

import json
import runpy
import sys
from types import SimpleNamespace

import pytest
from app.pipeline import figures
from docling_core.types.doc import BoundingBox, CoordOrigin, DocItemLabel


class FakeImage:
    def save(self, path):
        path.write_bytes(b"png")


def prov(page_no=1):
    box = BoundingBox(l=10, t=700, r=200, b=600, coord_origin=CoordOrigin.BOTTOMLEFT)
    return [SimpleNamespace(page_no=page_no, bbox=box)]


def picture(caption="Figure 1: Index size.", image=None, page_no=1):
    return SimpleNamespace(
        prov=prov(page_no) if page_no else [],
        caption_text=lambda document: caption,
        get_image=lambda document: image,
    )


def table(image=None):
    return SimpleNamespace(
        prov=prov(),
        caption_text=lambda document: None,
        export_to_markdown=lambda document: "| a |",
        get_image=lambda document: image,
    )


def text(label, content, page_no=2):
    return SimpleNamespace(label=label, text=content, prov=prov(page_no) if page_no else [])


def document(pictures=(), tables=(), texts=()):
    return SimpleNamespace(
        pages={1: SimpleNamespace(size=SimpleNamespace(width=612.0, height=792.0))},
        pictures=list(pictures),
        tables=list(tables),
        texts=list(texts),
    )


@pytest.fixture
def papers(monkeypatch, tmp_path):
    monkeypatch.setattr(figures, "PAPERS_DIR", tmp_path)
    return tmp_path


def test_a_picture_is_saved_with_its_caption_page_and_region(papers):
    [found] = figures._figures(document(pictures=[picture(image=FakeImage())]), papers / "paper.pdf")

    assert (found["kind"], found["page"], found["caption"]) == ("figure", 1, "Figure 1: Index size.")
    assert found["image"].endswith("figures/paper/figure-1.png")
    assert (papers / "figures" / "paper" / "figure-1.png").read_bytes() == b"png"
    assert found["region"]["page"] == 1


def test_a_picture_docling_could_not_render_is_left_out(papers):
    assert figures._figures(document(pictures=[picture(image=None)]), papers / "paper.pdf") == []


def test_a_picture_without_a_caption_or_a_page_gets_an_empty_caption_and_page_zero(papers):
    [found] = figures._figures(
        document(pictures=[picture(caption=None, image=FakeImage(), page_no=0)]), papers / "paper.pdf"
    )

    assert (found["page"], found["caption"], found["region"]) == (0, "", None)


def test_only_non_empty_formulas_are_kept_stripped(papers):
    texts = [
        text(DocItemLabel.FORMULA, "  E = mc^2  "),
        text(DocItemLabel.FORMULA, "   "),
        text(DocItemLabel.FORMULA, None),
        text(DocItemLabel.PARAGRAPH, "Late interaction."),
        text(DocItemLabel.FORMULA, "x = 1", page_no=0),
    ]

    assert figures._formulas(document(texts=texts)) == [
        {"kind": "formula", "page": 2, "caption": "", "text": "E = mc^2"},
        {"kind": "formula", "page": 0, "caption": "", "text": "x = 1"},
    ]


def make_docling(monkeypatch, doc):
    calls = []

    def convert(converter, pdf):
        calls.append(pdf)
        return SimpleNamespace(document=doc)

    monkeypatch.setattr(figures, "convert", convert)
    monkeypatch.setattr(figures, "docling_converter", lambda ocr, pictures=True: object())
    monkeypatch.setattr(figures, "needs_ocr", lambda path: False)
    return calls


def test_paper_media_runs_docling_then_reads_the_manifest_back(papers, monkeypatch):
    doc = document(pictures=[picture(image=FakeImage())], tables=[table(FakeImage())])
    calls = make_docling(monkeypatch, doc)
    pdf = papers / "paper.pdf"

    first = figures.paper_media(str(pdf))
    second = figures.paper_media(str(pdf))

    assert first["status"] == "ok" and first["cached"] is False
    assert [item["label"] for item in first["figures"]] == ["Figure 1"]
    assert [item["label"] for item in first["tables"]] == ["Table on page 1"]
    assert second["cached"] is True and second["figures"] == first["figures"]
    assert calls == [pdf]
    assert json.loads((papers / "figures" / "paper" / figures.MANIFEST).read_text())["version"] == (
        figures.MANIFEST_VERSION
    )


def test_refresh_runs_docling_again_even_with_a_manifest(papers, monkeypatch):
    calls = make_docling(monkeypatch, document())
    pdf = papers / "paper.pdf"

    figures.paper_media(str(pdf))
    figures.paper_media(str(pdf), refresh=True)

    assert calls == [pdf, pdf]


def test_paper_media_reports_a_docling_failure_instead_of_raising(papers, monkeypatch):
    def broken(converter, pdf):
        raise RuntimeError("out of memory")

    monkeypatch.setattr(figures, "convert", broken)
    monkeypatch.setattr(figures, "docling_converter", lambda ocr, pictures=True: object())
    monkeypatch.setattr(figures, "needs_ocr", lambda path: False)

    found = figures.paper_media(str(papers / "paper.pdf"))

    assert found == {"status": "error", "message": "out of memory", "file": (papers / "paper.pdf").as_posix()}


def write_manifest(papers, content):
    directory = papers / "figures" / "paper"
    directory.mkdir(parents=True)
    (directory / figures.MANIFEST).write_text(json.dumps(content), encoding="utf-8")
    return directory


@pytest.mark.parametrize(
    "content",
    [
        {"version": figures.MANIFEST_VERSION, "figures": "nope"},
        {"version": figures.MANIFEST_VERSION, "tables": ["not a dict"]},
        {"version": figures.MANIFEST_VERSION, "formulas": [1]},
        {"version": figures.MANIFEST_VERSION, "figures": [{"image": 7}]},
    ],
)
def test_a_manifest_in_a_shape_we_did_not_write_is_a_miss(papers, content):
    write_manifest(papers, content)

    assert figures._read_manifest(papers / "paper.pdf") is None


def test_a_manifest_keeps_items_without_a_crop_and_formulas(papers):
    write_manifest(
        papers,
        {
            "version": figures.MANIFEST_VERSION,
            "figures": [{"image": ""}],
            "tables": [{"text": "| a |"}],
            "formulas": [{"text": "x"}],
        },
    )

    assert figures._read_manifest(papers / "paper.pdf") is not None


def test_a_picture_converter_is_built_with_crops_on_and_a_plain_one_without(monkeypatch):
    built = []

    class FakeConverter:
        def __init__(self, format_options):
            built.append(next(iter(format_options.values())).pipeline_options)

    monkeypatch.setattr("docling.document_converter.DocumentConverter", FakeConverter)
    monkeypatch.setattr(figures, "_converters", {})

    with_pictures = figures.docling_converter(True, True)
    without = figures.docling_converter(False, False)

    assert figures.docling_converter(True, True) is with_pictures
    assert (built[0].do_ocr, built[0].generate_picture_images) == (True, True)
    assert (built[1].do_ocr, built[1].generate_picture_images) == (False, False)
    assert without is not with_pictures


def run_main(monkeypatch, capsys, *arguments):
    """Run `python -m app.pipeline.figures` with a fake Docling reading each argument."""
    monkeypatch.setattr(sys, "argv", ["figures", *arguments])
    sys.modules.pop("app.pipeline.figures", None)
    try:
        runpy.run_module("app.pipeline.figures", run_name="__main__")
    finally:
        sys.modules["app.pipeline.figures"] = figures
    return capsys.readouterr().out


def test_the_command_line_prints_a_line_per_paper_and_a_line_per_figure(papers, monkeypatch, capsys):
    pdf = papers / "paper.pdf"
    directory = papers / "figures" / "paper"
    directory.mkdir(parents=True)
    crop = directory / "figure-1.png"
    crop.write_bytes(b"png")
    figure = {"kind": "figure", "page": 4, "caption": "Figure 1: Index size.", "image": crop.as_posix()}
    media = {"version": figures.MANIFEST_VERSION, "figures": [figure], "tables": [], "formulas": []}
    (directory / figures.MANIFEST).write_text(json.dumps(media), encoding="utf-8")
    monkeypatch.setattr("app.config.PAPERS_DIR", papers)

    lines = run_main(monkeypatch, capsys, str(pdf)).splitlines()

    assert lines[0] == f"{pdf}: 1 figures, 0 tables, 0 formulas"
    assert lines[1].split() == ["Figure", "1", "p4", crop.as_posix()]


def test_the_command_line_prints_the_error_of_a_paper_it_could_not_read(papers, monkeypatch, capsys):
    def refuse(**options):
        raise RuntimeError("no models")

    monkeypatch.setattr("app.config.PAPERS_DIR", papers)
    monkeypatch.setattr("docling.document_converter.DocumentConverter", refuse)
    monkeypatch.setenv("DOCLING_OCR", "never")

    assert run_main(monkeypatch, capsys, "missing.pdf").strip() == "missing.pdf: no models"
