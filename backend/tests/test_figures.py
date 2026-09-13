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
