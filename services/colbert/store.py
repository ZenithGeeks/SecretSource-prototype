"""Qdrant collection of ColBERTv2 token embeddings. Add PDFs, search with MaxSim.

    python -m store paper.pdf "papers/*.pdf" papers/   # files, globs or folders

Each PDF becomes ~120-word passages; each passage is stored as one point whose vector is
the passage's token matrix (Qdrant multivector, MAX_SIM comparator) with the page and
character span it came from, so a hit can be pointed at in the original.
Re-adding a PDF with the same file name replaces its old passages.
"""

import os
import sys
import uuid
from pathlib import Path

from encoder import Encoder
from pypdf import PdfReader
from qdrant_client import QdrantClient, models

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None  # only Qdrant Cloud checks it
COLLECTION = os.getenv("COLBERT_COLLECTION", "academic_text_claims")
VECTOR_NAME = "colbert"  # named vector, matching the team's cluster provisioning
DIM = 128
WORDS_PER_PASSAGE = 120


def _word_spans(text: str) -> list[tuple[int, int]]:
    """(start, end) of every whitespace-separated word, walking forward so repeats stay distinct."""
    spans, cursor = [], 0
    for word in text.split():
        start = text.index(word, cursor)
        cursor = start + len(word)
        spans.append((start, cursor))
    return spans


def pdf_passages(path: Path) -> list[dict]:
    """PDF -> ~120-word passages, each knowing its page and where on that page it sits.
    Chunked per page: a passage that straddled a page break could not name one."""
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
        self.client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
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
        # Idempotent; also covers a collection someone provisioned without the index.
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

    def add_pdf(self, path: str | Path) -> int:
        """Index one PDF. Returns the number of passages added."""
        path = Path(path)
        passages = pdf_passages(path)
        vectors = self.encoder.docs([passage["text"] for passage in passages])
        self._delete_source(path.name)  # replace if already indexed
        points = [
            models.PointStruct(
                id=uuid.uuid4().hex,
                vector={VECTOR_NAME: vector.tolist()},
                payload={**passage, "title": path.stem, "source": path.name},
            )
            for passage, vector in zip(passages, vectors, strict=True)
            if len(vector)  # skip passages with no tokens left
        ]
        if points:
            self.client.upsert(COLLECTION, points)
        return len(points)

    def search(self, query: str, k: int = 10) -> list[dict]:
        """Top-k passages by MaxSim: each query token takes its best-matching doc token,
        summed. Qdrant scores the multivector natively."""
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
        p = Path(arg)
        pdfs += sorted(p.glob("*.pdf")) if p.is_dir() else sorted(Path().glob(arg))
    if not pdfs:
        sys.exit("no PDFs found")
    store = Store()
    for pdf in pdfs:
        print(f"{pdf}: +{store.add_pdf(pdf)} passages ({len(store)} total)")
