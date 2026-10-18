from app.pipeline import figures
from app.pipeline.verify import _figure_crop


def _paper(monkeypatch, tmp_path):
    monkeypatch.setattr(figures, "PAPERS_DIR", tmp_path)
    return tmp_path / "paper.pdf"


def _save_crop(source, name):
    crop = figures.figures_dir(source) / name
    crop.parent.mkdir(parents=True)
    crop.write_bytes(b"png")
    return crop


def test_a_figure_hit_returns_the_local_crop_with_the_same_file_name(monkeypatch, tmp_path):
    source = _paper(monkeypatch, tmp_path)
    crop = _save_crop(source, "figure-1.png")

    hits = [{"image": "/service/papers/figures/paper/figure-1.png"}]

    assert _figure_crop(hits, source) == crop


def test_a_page_hit_is_skipped_for_the_next_figure_hit(monkeypatch, tmp_path):
    source = _paper(monkeypatch, tmp_path)
    crop = _save_crop(source, "figure-2.png")

    hits = [{"image": ""}, {"image": "/elsewhere/figure-2.png"}]

    assert _figure_crop(hits, source) == crop


def test_a_figure_hit_without_a_local_crop_returns_none(monkeypatch, tmp_path):
    source = _paper(monkeypatch, tmp_path)

    assert _figure_crop([{"image": "/service/figure-3.png"}], source) is None


def test_no_hits_returns_none(monkeypatch, tmp_path):
    source = _paper(monkeypatch, tmp_path)

    assert _figure_crop([], source) is None
