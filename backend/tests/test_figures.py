"""A claim's "Figure 2" must point at the paper's own Figure 2, not a counted guess.

named_figures keeps only the figures whose caption names their number, and paper_figures
gives those to the gateway and the graph. When Docling fails, a paper still shows all its
results, only without figure crops, so paper_figures must come back empty instead of raising.
"""

from app.pipeline import figures


def test_a_figure_with_a_numbered_caption_is_kept_with_only_the_keys_a_link_needs():
    figure = {
        "kind": "figure",
        "label": "Figure 2",
        "page": 3,
        "caption": "Figure 2: Index size.",
        "image": "data/papers/figures/x/figure-2.png",
    }
    kept = figures.named_figures([figure])
    assert len(kept) == 1
    assert set(kept[0]) == {"label", "page", "caption", "image"}  # no "kind"
    assert kept[0]["label"] == "Figure 2"


def test_a_figure_without_a_numbered_caption_is_dropped():
    counted = {
        "kind": "figure",
        "label": "Figure 3",  # counted, not the paper's own name
        "page": 5,
        "caption": "Our model",
        "image": "data/papers/figures/x/figure-3.png",
    }
    empty = {
        "kind": "figure",
        "label": "Figure 1",
        "page": 1,
        "caption": "",
        "image": "data/papers/figures/x/figure-1.png",
    }
    none = {
        "kind": "figure",
        "label": "Figure 1",
        "page": 1,
        "caption": None,
        "image": "data/papers/figures/x/figure-1.png",
    }
    assert figures.named_figures([counted]) == []
    assert figures.named_figures([empty]) == []
    assert figures.named_figures([none]) == []


def test_a_caption_that_names_its_figure_is_accepted():
    figure = {
        "kind": "figure",
        "label": "Figure 4b",
        "page": 7,
        "caption": "Fig. 4b shows the ablation results.",
        "image": "data/papers/figures/x/figure-4b.png",
    }
    assert figures.named_figures([figure])[0]["label"] == "Figure 4b"


def test_paper_figures_is_empty_when_docling_fails(monkeypatch):
    monkeypatch.setattr(figures, "paper_media", lambda pdf_path: {"status": "error", "message": "boom"})
    assert figures.paper_figures("data/papers/x.pdf") == []


def test_paper_figures_returns_only_the_numbered_figures(monkeypatch):
    media = {
        "status": "ok",
        "figures": [
            {
                "kind": "figure",
                "label": "Figure 2",
                "page": 3,
                "caption": "Figure 2: Index size.",
                "image": "data/papers/figures/x/figure-2.png",
            },
            {
                "kind": "figure",
                "label": "Figure 3",  # counted, caption does not name it
                "page": 5,
                "caption": "Our model",
                "image": "data/papers/figures/x/figure-3.png",
            },
        ],
    }
    monkeypatch.setattr(figures, "paper_media", lambda pdf_path: media)
    kept = figures.paper_figures("data/papers/x.pdf")
    assert [figure["label"] for figure in kept] == ["Figure 2"]


def crop(page: int, caption: str, kind: str = "figure") -> dict:
    return {"kind": kind, "page": page, "caption": caption}


def test_a_picture_without_a_numbered_caption_is_named_by_its_page_not_a_count():
    # The shape of Going-deeper-with-convolutions' media.json, where counting gave "Figure 3" twice.
    named = figures._name(
        [
            crop(3, "(a) Siberian husky"),
            crop(3, "(b) Eskimo dog"),
            crop(5, ""),
            crop(7, "Figure 3: GoogLeNet network with all the bells and whistles"),
        ]
    )
    assert [item["label"] for item in named] == [
        "Picture on page 3 (1 of 2)",
        "Picture on page 3 (2 of 2)",
        "Picture on page 5",
        "Figure 3",
    ]
    assert [item["numbered"] for item in named] == [False, False, False, True]


def test_no_two_items_of_a_paper_share_a_label():
    named = figures._name(
        [crop(1, "", "table"), crop(6, "Table 1: Inception", "table"), crop(6, "Table 1: Inception", "table")]
    )
    labels = [item["label"] for item in named]
    assert labels == ["Table on page 1", "Table 1 (1 of 2)", "Table 1 (2 of 2)"]
    assert len(set(labels)) == len(labels)


def test_a_manifest_written_with_counted_labels_is_named_again_when_read(monkeypatch):
    old = {"figures": [dict(crop(5, ""), label="Figure 3", image="x.png")], "tables": [], "formulas": []}
    monkeypatch.setattr(figures, "_read_manifest", lambda pdf: old)
    media = figures.paper_media("data/papers/x.pdf")
    assert media["cached"] is True
    assert media["figures"][0]["label"] == "Picture on page 5"


def pdf_with_pages(path, texts: list[str]) -> str:
    import pymupdf

    document = pymupdf.open()
    for text in texts:
        page = document.new_page()
        if text:
            page.insert_textbox(pymupdf.Rect(50, 50, 550, 750), text, fontsize=9)
    document.save(path)
    return str(path)


BODY = "Late interaction keeps a vector per token and matches them at query time. " * 8


def test_a_paper_with_a_text_layer_is_read_without_ocr(tmp_path, monkeypatch):
    monkeypatch.setattr(figures, "OCR", "auto")
    # One page that is only a picture does not make a born-digital paper a scan.
    assert figures.needs_ocr(pdf_with_pages(tmp_path / "paper.pdf", [BODY, BODY, ""])) is False


def test_a_scan_without_a_text_layer_gets_ocr(tmp_path, monkeypatch):
    monkeypatch.setattr(figures, "OCR", "auto")
    assert figures.needs_ocr(pdf_with_pages(tmp_path / "scan.pdf", ["", "", BODY])) is True
    # A long scan is judged from pages spread over it, not from its first pages only.
    assert figures.needs_ocr(pdf_with_pages(tmp_path / "long-scan.pdf", [BODY] + [""] * 40)) is True
    assert figures.needs_ocr(str(tmp_path / "unreadable.pdf")) is True


def test_docling_ocr_overrides_the_check(tmp_path, monkeypatch):
    paper = pdf_with_pages(tmp_path / "paper.pdf", [BODY])
    monkeypatch.setattr(figures, "OCR", "always")
    assert figures.needs_ocr(paper) is True
    monkeypatch.setattr(figures, "OCR", "never")
    assert figures.needs_ocr(str(tmp_path / "missing.pdf")) is False


def test_paper_media_reads_with_the_ocr_setting_the_pdf_needs(monkeypatch, tmp_path):
    asked = []

    class Converter:
        def convert(self, pdf):
            raise RuntimeError("stop after choosing the converter")

    monkeypatch.setattr(figures, "_read_manifest", lambda pdf: None)
    monkeypatch.setattr(figures, "needs_ocr", lambda pdf_path: False)

    def converter(ocr, pictures=True):
        asked.append((ocr, pictures))
        return Converter()

    monkeypatch.setattr(figures, "docling_converter", converter)
    assert figures.paper_media(str(tmp_path / "x.pdf"), refresh=True)["status"] == "error"
    assert asked == [(False, True)]
