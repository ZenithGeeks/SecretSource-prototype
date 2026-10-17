"""pdf_passages leaves a paper's reference list out of the index, and keeps the body before it
and the appendix after it (#476). It starts a new passage at each figure or table caption (#491).
The PDF is built with PyMuPDF, so the real pypdf text extraction runs. Needs torch, like
test_store.py: store.py loads the encoder module."""

import pytest
import store

pymupdf = pytest.importorskip("pymupdf")

BODY = (
    "We train the model on web pages and show that the encoder is able to read the text in "
    "the image, which is what the retrieval step needs. This is the part a claim is checked "
    "against, so it has to stay in the index. "
) * 3
REFERENCES = (
    "[1] Junnan Li, Dongxu Li, Silvio Savarese, and Steven Hoi. BLIP-2: Bootstrapping "
    "language-image pre-training. arXiv preprint arXiv:2301.12597, 2023. [2] Haotian Liu, "
    "Chunyuan Li, Qingyang Wu, and Yong Jae Lee. Visual instruction tuning. In NeurIPS, 2023. "
) * 6
APPENDIX = (
    "A Training details. We use a learning rate of one in ten thousand and train for three "
    "epochs. The batch is large, and this is the setting that the main results are based on. "
) * 3


def _pdf(path, *pages):
    document = pymupdf.open()
    for text in pages:
        page = document.new_page()
        page.insert_textbox(pymupdf.Rect(40, 40, 560, 800), text, fontsize=7)
    document.save(path)
    return path


def test_reference_entries_read_as_bibliography_and_prose_does_not():
    assert store._is_bibliography(REFERENCES.split()[:120])
    assert not store._is_bibliography(BODY.split()[:120])
    assert not store._is_bibliography(("12.4 55.1 63.0 71.9 ColPali BM25 " * 20).split())  # a table


def test_the_reference_list_is_left_out_and_the_appendix_kept(tmp_path):
    pdf = _pdf(tmp_path / "paper.pdf", BODY, "References\n" + REFERENCES, APPENDIX)

    texts = [passage["text"] for passage in store.pdf_passages(pdf)]

    assert any("encoder is able to read" in text for text in texts)
    assert any("learning rate" in text for text in texts)
    assert not any("Bootstrapping" in text for text in texts)


def test_a_paper_without_a_references_heading_keeps_everything(tmp_path):
    pdf = _pdf(tmp_path / "paper.pdf", BODY, REFERENCES)

    texts = [passage["text"] for passage in store.pdf_passages(pdf)]

    assert any("Bootstrapping" in text for text in texts)


def test_a_caption_starts_its_own_passage_and_stays_whole(tmp_path):
    caption = "Table 2: MRR@10 and latency of each model on MS MARCO."
    pdf = _pdf(tmp_path / "paper.pdf", f"{BODY}\n{caption}\n{BODY}")

    texts = [passage["text"] for passage in store.pdf_passages(pdf)]

    assert [text for text in texts if "Table 2:" in text][0].startswith(caption)


def test_a_short_last_window_joins_the_one_before_it():
    assert store._windows(0, 150) == [(0, 150)]  # 30 words left over is under MIN_TAIL_WORDS
    assert store._windows(0, 170) == [(0, 120), (120, 170)]
    assert store._windows(0, 20) == [(0, 20)]  # a short piece on its own stays


def test_a_sentence_that_mentions_a_table_does_not_start_a_passage(tmp_path):
    pdf = _pdf(tmp_path / "paper.pdf", f"{BODY}\nTable 3 presents the results on BEIR.\n{BODY}")

    texts = [passage["text"] for passage in store.pdf_passages(pdf)]

    assert not any(text.startswith("Table 3") for text in texts)


def test_the_passage_version_and_doc_len_are_part_of_the_content_hash(tmp_path, monkeypatch):
    calls = []

    class Files:
        def stored_hash(self, source):
            return calls[-1] if calls else None, 1

        def write(self, source, rows, vectors, content_hash):
            calls.append(content_hash)

    monkeypatch.setattr(store, "PaperFiles", lambda *args: Files())
    class Encoder:
        def docs(self, texts):
            return [[1]] * len(texts)

    monkeypatch.setattr(store, "Encoder", lambda device=None: Encoder())
    monkeypatch.setattr(store, "pdf_passages", lambda path: [{"text": "x", "page": 1, "start": 0, "end": 1}])
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 same bytes")
    index = store.Store()

    index.add_pdf(pdf)
    index.add_pdf(pdf)  # same bytes, same version: skipped
    monkeypatch.setattr(store, "PASSAGES_VERSION", store.PASSAGES_VERSION + "-next")
    index.add_pdf(pdf)  # same bytes, new version: indexed again
    monkeypatch.setattr(store, "DOC_LEN", store.DOC_LEN + 1)
    index.add_pdf(pdf)  # same bytes, new document length: indexed again

    assert len(calls) == 3
