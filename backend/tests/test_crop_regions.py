"""A figure or table hit must say where it sits on its page, so the claim card can outline it.

figures.py records each crop's box in the page viewer's shape (PDF points, top-left origin)
and crops tables as it crops figures. verify.py gives each ColPali hit its kind and box from
the manifest, by the crop's file name. Page hits, and verdicts with no visual hit, are unchanged.
"""

import json
from types import SimpleNamespace

from app.pipeline import figures, verify
from docling_core.types.doc import BoundingBox, CoordOrigin


def docling_table(page_no, left, top, right, bottom, image=None):
    """A Docling table on a page, its box in Docling's usual bottom-left origin. `image` is its render."""
    box = BoundingBox(l=left, t=top, r=right, b=bottom, coord_origin=CoordOrigin.BOTTOMLEFT)
    return SimpleNamespace(
        prov=[SimpleNamespace(page_no=page_no, bbox=box)],
        caption_text=lambda document: "Table 1: Results.",
        export_to_markdown=lambda document: "| a | b |",
        get_image=lambda document: image,
    )


def document_with(*tables):
    """A one-page Docling document, US Letter size, holding these tables."""
    return SimpleNamespace(
        pages={1: SimpleNamespace(size=SimpleNamespace(width=612.0, height=792.0))}, tables=list(tables)
    )


class FakeImage:
    """A rendered crop: only save() is used."""

    def save(self, path):
        path.write_bytes(b"png")


def test_a_region_is_in_top_left_points_with_the_page_size():
    region = figures._region(docling_table(1, 100, 700, 300, 600), document_with())

    assert region == {
        "page": 1,
        "boxes": [{"x0": 100, "y0": 92, "x1": 300, "y1": 192}],
        "page_width": 612.0,
        "page_height": 792.0,
    }


def test_a_region_near_the_bottom_of_the_page_stays_low():
    # Bottom-left top=120, bottom=40 on a 792-pt page. After the flip the box is still
    # near the bottom, and y0 < y1 so the page viewer gives it a positive height.
    region = figures._region(docling_table(1, 80, 120, 400, 40), document_with())

    assert region["boxes"] == [{"x0": 80, "y0": 672, "x1": 400, "y1": 752}]


def test_a_box_that_is_already_top_left_is_not_flipped():
    box = BoundingBox(l=100, t=92, r=300, b=192, coord_origin=CoordOrigin.TOPLEFT)
    item = SimpleNamespace(prov=[SimpleNamespace(page_no=1, bbox=box)])

    region = figures._region(item, document_with())

    assert region["boxes"] == [{"x0": 100, "y0": 92, "x1": 300, "y1": 192}]


def test_an_item_without_a_page_has_no_region():
    no_prov = SimpleNamespace(prov=[])
    assert figures._region(no_prov, document_with()) is None


def test_a_table_is_cropped_and_keeps_its_markdown_and_region(monkeypatch, tmp_path):
    monkeypatch.setattr(figures, "PAPERS_DIR", tmp_path)
    pdf = tmp_path / "paper.pdf"

    [table] = figures._tables(document_with(docling_table(1, 100, 700, 300, 600, FakeImage())), pdf)

    assert table["kind"] == "table"
    assert table["text"] == "| a | b |"
    assert table["image"].endswith("figures/paper/table-1.png")
    assert table["region"]["boxes"] == [{"x0": 100, "y0": 92, "x1": 300, "y1": 192}]


def test_a_table_docling_could_not_render_keeps_only_its_markdown(monkeypatch, tmp_path):
    monkeypatch.setattr(figures, "PAPERS_DIR", tmp_path)

    [table] = figures._tables(document_with(docling_table(1, 100, 700, 300, 600)), tmp_path / "paper.pdf")

    assert "image" not in table
    assert table["text"] == "| a | b |"


def test_a_manifest_from_before_regions_is_read_again(monkeypatch, tmp_path):
    monkeypatch.setattr(figures, "PAPERS_DIR", tmp_path)
    pdf = tmp_path / "paper.pdf"
    directory = figures.figures_dir(pdf)
    directory.mkdir(parents=True)
    manifest = directory / figures.MANIFEST

    manifest.write_text(json.dumps({"figures": [], "tables": [], "formulas": []}))
    assert figures._read_manifest(pdf) is None

    manifest.write_text(json.dumps({"version": figures.MANIFEST_VERSION, "figures": [], "tables": []}))
    assert figures._read_manifest(pdf) is not None


def test_an_unreadable_manifest_is_read_again(monkeypatch, tmp_path):
    monkeypatch.setattr(figures, "PAPERS_DIR", tmp_path)
    pdf = tmp_path / "paper.pdf"
    directory = figures.figures_dir(pdf)
    directory.mkdir(parents=True)
    manifest = directory / figures.MANIFEST

    manifest.write_text("{", encoding="utf-8")
    assert figures._read_manifest(pdf) is None
    manifest.write_text("[]", encoding="utf-8")
    assert figures._read_manifest(pdf) is None

    calls = []

    def convert(converter, path):
        calls.append(path)
        raise RuntimeError("stop after the cache miss")

    monkeypatch.setattr(figures, "convert", convert)
    monkeypatch.setattr(figures, "docling_converter", lambda ocr, pictures=True: object())
    monkeypatch.setattr(figures, "needs_ocr", lambda path: False)
    manifest.write_text("{", encoding="utf-8")

    result = figures.paper_media(str(pdf))

    assert calls == [pdf]
    assert result["status"] == "error"


def test_a_manifest_whose_table_crop_is_gone_is_read_again(monkeypatch, tmp_path):
    monkeypatch.setattr(figures, "PAPERS_DIR", tmp_path)
    pdf = tmp_path / "paper.pdf"
    directory = figures.figures_dir(pdf)
    directory.mkdir(parents=True)
    lost = {"kind": "table", "image": (directory / "table-1.png").as_posix()}
    (directory / figures.MANIFEST).write_text(
        json.dumps({"version": figures.MANIFEST_VERSION, "figures": [], "tables": [lost]})
    )

    assert figures._read_manifest(pdf) is None


REGION = {"page": 3, "boxes": [{"x0": 1, "y0": 2, "x1": 3, "y1": 4}], "page_width": 612, "page_height": 792}
CROPS = [
    {"kind": "figure", "image": "/worker/figures/paper/figure-1.png", "region": REGION},
    {"kind": "table", "image": "/worker/figures/paper/table-1.png", "region": REGION},
]


def test_crop_hits_get_their_kind_and_region_from_the_manifest(monkeypatch, tmp_path):
    monkeypatch.setattr(verify, "_crops", lambda source: CROPS)
    hits = [
        {"page": 3, "kind": "figure", "image": "/service/figures/paper/figure-1.png"},
        {"page": 3, "kind": "figure", "image": "/service/figures/paper/table-1.png"},
    ]

    found = verify._with_regions(hits, tmp_path / "paper.pdf")

    assert [(hit["kind"], hit["region"]) for hit in found] == [("figure", REGION), ("table", REGION)]


def test_page_hits_and_unknown_crops_are_left_as_they_are(monkeypatch, tmp_path):
    monkeypatch.setattr(verify, "_crops", lambda source: CROPS)
    hits = [
        {"page": 2, "kind": "page", "image": ""},
        {"page": 5, "kind": "figure", "image": "/service/figures/paper/figure-9.png"},
    ]

    assert verify._with_regions(hits, tmp_path / "paper.pdf") == hits


def test_without_visual_hits_nothing_is_read(monkeypatch, tmp_path):
    def unexpected(source):
        raise AssertionError("the manifest is read only for crop hits")

    monkeypatch.setattr(verify, "_crops", unexpected)

    assert verify._with_regions([], tmp_path / "paper.pdf") == []
    assert verify._with_regions([{"page": 1, "image": ""}], tmp_path / "paper.pdf") == [
        {"page": 1, "image": ""}
    ]


def test_a_colpali_table_hit_comes_out_of_visual_with_its_kind_and_region(monkeypatch, tmp_path):
    # Through _visual, the manifest on disk and paper_media's cache: _visual swallows errors,
    # so a break anywhere on this path would only show as no visual evidence.
    monkeypatch.setattr(figures, "PAPERS_DIR", tmp_path)
    pdf = tmp_path / "paper.pdf"
    directory = figures.figures_dir(pdf)
    directory.mkdir(parents=True)
    crop = directory / "table-1.png"
    crop.write_bytes(b"png")
    table = {
        "kind": "table",
        "page": 3,
        "caption": "Table 1: Results.",
        "image": crop.as_posix(),
        "region": REGION,
    }
    manifest = {"version": figures.MANIFEST_VERSION, "figures": [], "tables": [table], "formulas": []}
    (directory / figures.MANIFEST).write_text(json.dumps(manifest))
    service_hit = {
        "source": "paper.pdf",
        "page": 3,
        "score": 9.5,
        "kind": "figure",
        "label": "Table 1",
        "caption": "Table 1: Results.",
        "image": "/service/paper/table-1.png",
    }
    monkeypatch.setattr(verify.retrieval, "colpali_available", lambda: True)
    monkeypatch.setattr(
        verify.retrieval, "colpali_search", lambda claim, k, source: {"topk": [service_hit], "model": "m"}
    )

    hits, model = verify._visual("ColBERT reaches 31.3 MAP on TREC CAR.", pdf)

    assert model == "m"
    assert [(hit["kind"], hit["region"], hit["label"]) for hit in hits] == [("table", REGION, "Table 1")]


def test_tables_with_a_crop_go_into_the_vision_index_with_the_figures(monkeypatch, tmp_path):
    media = {
        "status": "ok",
        "figures": [{"kind": "figure", "image": "figure-1.png"}],
        "tables": [{"kind": "table", "image": "table-1.png"}, {"kind": "table", "text": "| a |"}],
    }
    monkeypatch.setattr(figures, "paper_media", lambda pdf_path: media)
    sent = []
    monkeypatch.setattr(
        verify.retrieval, "colpali_add_figures", lambda source, title, crops: sent.extend(crops)
    )

    verify._index_visually(tmp_path / "paper.pdf")

    assert [crop["image"] for crop in sent] == ["figure-1.png", "table-1.png"]
