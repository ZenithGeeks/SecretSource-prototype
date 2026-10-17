"""pdf_passages leaves a paper's reference list out of the index, and keeps the body before it
and the appendix after it (#476). The PDF is built with PyMuPDF, so the real pypdf text
extraction runs. Needs torch, like test_store.py: store.py loads the encoder module."""

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
    monkeypatch.setattr(store, "PASSAGES_VERSION", "3")
    index.add_pdf(pdf)  # same bytes, new version: indexed again
    monkeypatch.setattr(store, "DOC_LEN", store.DOC_LEN + 1)
    index.add_pdf(pdf)  # same bytes, new document length: indexed again

    assert len(calls) == 3
