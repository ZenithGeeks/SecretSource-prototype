"""Qdrant collection of ColPali embeddings. Add figures or pages, search with MaxSim.

    python -m store paper.pdf "papers/*.pdf" papers/   # files, globs or folders

A point is one image with its patch vectors (Qdrant multivector, MAX_SIM comparator).
It is a cropped figure if the caller extracted them, or a whole rendered page if it
could not. A crop has a caption and a name. So a hit is "Figure 3", not "page 7".

Re-adding a paper replaces every point it already had. The collection name holds the
vector width. A checkpoint with a different width needs a fresh collection.
"""

import hashlib
import os
import sys
import uuid
from pathlib import Path

from encoder import Encoder
from qdrant_client import QdrantClient, models

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None  # only Qdrant Cloud uses it
QDRANT_TIMEOUT = 60  # qdrant-client's short default is too short for a long paper's whole batch
COLLECTION = os.getenv("COLPALI_COLLECTION", "academic_visual_pages")
VECTOR_NAME = "colqwen"  # named vector, to match the team's cluster setup
RENDER_DPI = int(os.getenv("COLPALI_DPI", "150"))
UPSERT_BATCH = 16  # points per write. Page and figure patch multivectors are large, so fewer per batch


def pdf_pages(path: Path, dpi: int = RENDER_DPI) -> list:
    """PDF -> one PIL image per page. PyMuPDF renders the pages, so poppler is not needed."""
    import pymupdf
    from PIL import Image

    images = []
    with pymupdf.open(path) as document:
        for page in document:
            pixmap = page.get_pixmap(dpi=dpi)
            images.append(Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples))
    return images


class Store:
    def __init__(self, device: str | None = None):
        self.encoder = Encoder(device)
        self.client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=QDRANT_TIMEOUT)
        if not self.client.collection_exists(COLLECTION):
            self.client.create_collection(
                COLLECTION,
                vectors_config={
                    VECTOR_NAME: models.VectorParams(
                        size=self.encoder.dim,
                        distance=models.Distance.COSINE,
                        multivector_config=models.MultiVectorConfig(
                            comparator=models.MultiVectorComparator.MAX_SIM
                        ),
                        hnsw_config=models.HnswConfigDiff(m=0),  # multivectors: use exact rescoring
                    )
                },
            )
        # Safe to run again. Also adds the index to a collection made without it.
        self.client.create_payload_index(COLLECTION, "source", models.PayloadSchemaType.KEYWORD)

    def __len__(self) -> int:
        return self.client.count(COLLECTION).count

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

    def _upsert(self, rows: list[dict], vectors: list, content_hash: str) -> int:
        points = [
            models.PointStruct(
                id=uuid.uuid4().hex, vector={VECTOR_NAME: vector.tolist()},
                payload={**row, "content_hash": content_hash},
            )
            for row, vector in zip(rows, vectors, strict=True)
        ]
        # In batches. One big request for a whole paper timed out before, even with a
        # long client timeout. Many small requests get through a slow moment on the Qdrant VM.
        for start in range(0, len(points), UPSERT_BATCH):
            self.client.upsert(COLLECTION, points[start : start + UPSERT_BATCH])
        return len(points)

    def add_pdf(self, pdf_path: str | Path) -> int:
        """Whole rendered pages. This is the fallback for a paper with no croppable figures.

        Skips rendering and encoding (the expensive parts) when Qdrant already has this exact
        file under this source name — see add_pdf in services/colbert/store.py for why this
        checks Qdrant itself rather than trusting the caller not to ask twice.
        """
        path = Path(pdf_path)
        content_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if self._current_hash(path.name) == content_hash:
            return self._count_source(path.name)

        images = pdf_pages(path)
        vectors = self.encoder.pages(images)
        self._delete_source(path.name)
        rows = [
            {"page": number, "title": path.stem, "source": path.name, "kind": "page",
             "label": f"Page {number}", "caption": "", "image": ""}
            for number in range(1, len(vectors) + 1)
        ]
        return self._upsert(rows, vectors, content_hash)

    def add_figures(self, source: str, title: str, figures: list[dict]) -> int:
        """One point per cropped figure, matched by the name the paper gives it.

        Hashes each figure's own image bytes plus its page/label/caption, in order, so a changed
        crop or caption is a genuinely different hash — not just whether the same file names were
        passed. Skips re-encoding when Qdrant already has this exact set for this source.
        """
        hasher = hashlib.sha256()
        for figure in figures:
            hasher.update(Path(figure["image"]).read_bytes())
            meta = (figure.get("page", 0), figure.get("label", ""), figure.get("caption", ""))
            hasher.update(("\x00" + "\x01".join(str(part) for part in meta) + "\x00").encode())
        content_hash = hasher.hexdigest()
        if self._current_hash(source) == content_hash:
            return self._count_source(source)

        from PIL import Image

        images = [Image.open(figure["image"]).convert("RGB") for figure in figures]
        vectors = self.encoder.pages(images)
        self._delete_source(source)  # the new figures replace what this paper had before
        rows = [
            {"page": figure.get("page", 0), "title": title, "source": source,
             "kind": "figure", "label": figure.get("label", ""),
             "caption": figure.get("caption", ""), "image": figure["image"]}
            for figure in figures
        ]
        return self._upsert(rows, vectors, content_hash)

    def search(self, query: str, k: int = 5) -> list[dict]:
        """Top-k figures or pages by MaxSim."""
        vector = self.encoder.query(query).tolist()
        hits = self.client.query_points(
            COLLECTION, query=vector, using=VECTOR_NAME, limit=k, with_payload=True
        ).points
        return [
            {"rank": i + 1, "score": round(hit.score, 4), **hit.payload}
            for i, hit in enumerate(hits)
        ]


def _expand(arguments: list[str]) -> list[Path]:
    paths = []
    for argument in arguments:
        path = Path(argument)
        if path.is_dir():
            paths += sorted(path.glob("*.pdf"))
        elif any(character in argument for character in "*?["):
            paths += sorted(Path().glob(argument))
        else:
            paths.append(path)
    return paths


if __name__ == "__main__":
    store = Store()
    for pdf in _expand(sys.argv[1:]):
        print(f"{pdf}: {store.add_pdf(pdf)} pages ({len(store)} total)")
