"""DOCLING_PARALLEL bounds concurrent Docling conversions: each one holds about 2 GB of
models, and gateway instances could be OOM-killed from loading too much memory on uploaded
papers. figures.convert() must never let more than DOCLING_PARALLEL calls run at once, and
claims._pdf_to_text must ask for the same converter settings as figures.paper_media so only
one Docling model set per OCR setting stays loaded.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.pipeline import claims, figures


class FakeConverter:
    """Docling's .convert(), but slow enough that concurrent calls overlap, and it counts
    how many of its own calls were in flight at once."""

    def __init__(self):
        self.current = 0
        self.max_seen = 0
        self.lock = threading.Lock()

    def convert(self, pdf_path):
        with self.lock:
            self.current += 1
            self.max_seen = max(self.max_seen, self.current)
        time.sleep(0.05)
        with self.lock:
            self.current -= 1
        return type("Result", (), {"document": None})()


def test_convert_runs_at_most_one_at_a_time_by_default(monkeypatch):
    fake = FakeConverter()
    monkeypatch.setattr(figures, "_convert_semaphore", threading.BoundedSemaphore(1))
    with ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(lambda _: figures.convert(fake, "paper.pdf"), range(5)))
    assert fake.max_seen == 1


def test_convert_allows_more_with_a_larger_semaphore(monkeypatch):
    fake = FakeConverter()
    monkeypatch.setattr(figures, "_convert_semaphore", threading.BoundedSemaphore(2))
    with ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(lambda _: figures.convert(fake, "paper.pdf"), range(5)))
    assert fake.max_seen == 2


def test_pdf_to_text_asks_for_the_same_converter_settings_as_paper_media(monkeypatch, tmp_path):
    asked = []

    class Converter:
        def convert(self, pdf_path):
            raise RuntimeError("stop after choosing the converter")

    def converter(ocr, pictures=True):
        asked.append((ocr, pictures))
        return Converter()

    monkeypatch.setattr(figures, "docling_converter", converter)
    monkeypatch.setattr(figures, "needs_ocr", lambda pdf_path: False)
    monkeypatch.setattr(claims, "local_pdf", lambda pdf_path: pdf_path, raising=False)

    try:
        claims._pdf_to_text(str(tmp_path / "x.pdf"))
    except RuntimeError:
        pass

    assert asked == [(False, True)]
