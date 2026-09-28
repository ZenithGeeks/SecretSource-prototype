"""Per-paper vector files of ColBERTv2 token embeddings.

    python -m store paper.pdf "papers/*.pdf" papers/   # files, globs or folders

Each PDF becomes ~120-word passages, encoded and written to one safetensors file per
paper (services/colbert/vectorfiles.py), stored under VECTOR_STORE (a GCS bucket in
production, a local folder in compose/tests). Each passage keeps the page and character
span, so a hit can be pointed at in the original. Re-adding a PDF with the same file
name replaces its old passages.
"""

import hashlib
import os
import sys
from pathlib import Path

from encoder import Encoder
from pypdf import PdfReader
from vectorfiles import PaperFiles, maxsim

WORDS_PER_PASSAGE = 120


def _word_spans(text: str) -> list[tuple[int, int]]:
    """(start, end) of every whitespace-separated word. It walks forward, so repeated
    words keep their own positions."""
    spans, cursor = [], 0
    for word in text.split():
        start = text.index(word, cursor)
        cursor = start + len(word)
        spans.append((start, cursor))
    return spans


def pdf_passages(path: Path) -> list[dict]:
    """PDF -> ~120-word passages. Each one knows its page and where on that page it sits.
    We chunk per page: a passage that crossed a page break could not name one page."""
    passages = []
    for number, page in enumerate(PdfReader(path).pages, start=1):
        text = page.extract_text() or ""
        words, spans = text.split(), _word_spans(text)
        for i in range(0, len(words), WORDS_PER_PASSAGE):
            chunk = words[i : i + WORDS_PER_PASSAGE]
            passages.append(
                {
                    "text": " ".join(chunk),
                    "page": number,
                    "start": spans[i][0],
                    "end": spans[i + len(chunk) - 1][1],
                }
            )
    return passages


class Store:
    def __init__(self, device: str | None = None):
        self.encoder = Encoder(device)
        self.files = PaperFiles(os.getenv("VECTOR_STORE", "./vectors"), "colbert")

    def add_pdf(self, path: str | Path) -> int:
        """Index one PDF. Returns the number of passages added.

        Skips the encode-and-write (the expensive part) when the store already has this
        exact content under this source name — a restart, or a second gateway process,
        re-asking to index a paper it (or another process) already put here. The
        gateway's own dedup (app/pipeline/verify.py's `_indexed` set) only holds for one
        process's lifetime; this check is against the store itself, so it holds
        regardless of which process asks.
        """
        path = Path(path)
        content_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        stored_hash, stored_count = self.files.stored_hash(path.name)
        if stored_hash == content_hash:
            return stored_count

        passages = pdf_passages(path)
        vectors = self.encoder.docs([passage["text"] for passage in passages])
        rows, kept_vectors = [], []
        for passage, vector in zip(passages, vectors, strict=True):
            if len(vector):  # skip passages with no tokens left
                rows.append({**passage, "title": path.stem, "source": path.name})
                kept_vectors.append(vector)
        self.files.write(path.name, rows, kept_vectors, content_hash)
        return len(rows)

    def search(self, query: str, k: int = 10, source: str | None = None) -> list[dict]:
        """Top-k passages by MaxSim, optionally restricted to one source paper. Each query
        token finds its best-matching doc token, and the scores are added up."""
        vector = self.encoder.query(query)
        sources = [source] if source is not None else self.files.sources()

        scored = []
        for name in sources:
            paper = self.files.load(name)
            if paper is None or not paper.rows:
                continue
            scores = maxsim(vector, paper)
            for row, score in zip(paper.rows, scores.tolist(), strict=True):
                scored.append((score, row))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [
            {
                "rank": i + 1, "score": round(score, 4),
                "text": row["text"], "title": row["title"],
                "source": row["source"], "page": row["page"],
                "start": row["start"], "end": row["end"],
            }
            for i, (score, row) in enumerate(scored[:k])
        ]

    def __len__(self) -> int:
        return len(self.files.sources())


if __name__ == "__main__":
    # Accept files, globs ("papers/*.pdf") and folders; PowerShell does not expand globs itself.
    pdfs = []
    for arg in sys.argv[1:]:
        pdf_path = Path(arg)
        pdfs += sorted(pdf_path.glob("*.pdf")) if pdf_path.is_dir() else sorted(Path().glob(arg))
    if not pdfs:
        sys.exit("no PDFs found")
    store = Store()
    for pdf in pdfs:
        print(f"{pdf}: +{store.add_pdf(pdf)} passages ({len(store)} total)")
