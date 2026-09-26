"""Qdrant collection of ColBERTv2 token embeddings.

    python -m store paper.pdf "papers/*.pdf" papers/   # files, globs or folders

Each PDF becomes ~120-word passages, stored as one multivector point each. Each point
keeps the page and character span, so a hit can be pointed at in the original. Re-adding
a PDF with the same file name replaces its old passages.
"""

import hashlib
import os
import sys
import uuid
from pathlib import Path

from encoder import Encoder
from pypdf import PdfReader
from qdrant_client import QdrantClient, models

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None  # only Qdrant Cloud checks it
QDRANT_TIMEOUT = 60  # qdrant-client's short default times out on a long paper's whole batch
COLLECTION = os.getenv("COLBERT_COLLECTION", "academic_text_claims")
VECTOR_NAME = "colbert"  # named vector, matching the team's cluster provisioning
DIM = 128
WORDS_PER_PASSAGE = 120
UPSERT_BATCH = 64  # points per write. One request per paper timed out on longer ones


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
        self.client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=QDRANT_TIMEOUT)
        if not self.client.collection_exists(COLLECTION):
            self.client.create_collection(
                COLLECTION,
                vectors_config={
                    VECTOR_NAME: models.VectorParams(
                        size=DIM,
                        distance=models.Distance.COSINE,  # vectors are unit-norm, so cosine == dot
                        multivector_config=models.MultiVectorConfig(
                            comparator=models.MultiVectorComparator.MAX_SIM
                        ),
                        hnsw_config=models.HnswConfigDiff(m=0),  # multivectors: exact rescoring
                    )
                },
            )
        # Safe to run again. Also covers a collection made without the index.
        self.client.create_payload_index(COLLECTION, "source", models.PayloadSchemaType.KEYWORD)

    def _delete_source(self, name: str) -> None:
        self.client.delete(
            COLLECTION,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[models.FieldCondition(key="source", match=models.MatchValue(value=name))]
                )
            ),
        )

    def _source_filter(self, name: str) -> models.Filter:
        return models.Filter(must=[models.FieldCondition(key="source", match=models.MatchValue(value=name))])

    def _current_hash(self, name: str) -> str | None:
        """The content hash already stored for this source, or None if it has no points yet.
        A single point is enough to answer: every point for one source shares the same hash."""
        hits, _ = self.client.scroll(
            COLLECTION, scroll_filter=self._source_filter(name), limit=1, with_payload=["content_hash"]
        )
        return hits[0].payload.get("content_hash") if hits else None

    def _count_source(self, name: str) -> int:
        return self.client.count(COLLECTION, count_filter=self._source_filter(name)).count

    def add_pdf(self, path: str | Path) -> int:
        """Index one PDF. Returns the number of passages added.

        Skips the encode-and-upsert (the expensive part) when Qdrant already has this exact
        content under this source name — a restart, or a second gateway process, re-asking to
        index a paper it (or another process) already put here. The gateway's own dedup
        (app/pipeline/verify.py's `_indexed` set) only holds for one process's lifetime; this
        check is against Qdrant itself, so it holds regardless of which process asks.
        """
        path = Path(path)
        content_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if self._current_hash(path.name) == content_hash:
            return self._count_source(path.name)

        passages = pdf_passages(path)
        vectors = self.encoder.docs([passage["text"] for passage in passages])
        self._delete_source(path.name)  # replace if already indexed
        points = [
            models.PointStruct(
                id=uuid.uuid4().hex,
                vector={VECTOR_NAME: vector.tolist()},
                payload={**passage, "title": path.stem, "source": path.name, "content_hash": content_hash},
            )
            for passage, vector in zip(passages, vectors, strict=True)
            if len(vector)  # skip passages with no tokens left
        ]
        # In batches: one request for a whole long paper timed out, even with a long
        # client timeout. Many small requests survive a slow moment on the Qdrant VM.
        for start in range(0, len(points), UPSERT_BATCH):
            self.client.upsert(COLLECTION, points[start : start + UPSERT_BATCH])
        return len(points)

    def search(self, query: str, k: int = 10) -> list[dict]:
        """Top-k passages by MaxSim. Each query token finds its best-matching doc token,
        and the scores are added up. Qdrant does this scoring for multivectors itself."""
        vector = self.encoder.query(query).tolist()
        hits = self.client.query_points(
            COLLECTION, query=vector, using=VECTOR_NAME, limit=k, with_payload=True
        ).points
        return [
            {
                "rank": i + 1, "score": round(hit.score, 4),
                "text": hit.payload["text"], "title": hit.payload["title"],
                "source": hit.payload["source"], "page": hit.payload["page"],
                "start": hit.payload["start"], "end": hit.payload["end"],
            }
            for i, hit in enumerate(hits)
        ]

    def __len__(self) -> int:
        return self.client.count(COLLECTION).count


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
