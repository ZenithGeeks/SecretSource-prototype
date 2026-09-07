"""Qdrant collection of ColPali embeddings. Add figures or pages, search with MaxSim.

    python -m store paper.pdf "papers/*.pdf" papers/   # files, globs or folders

A point is one image with its patch vectors (Qdrant multivector, MAX_SIM comparator): a
cropped figure where the caller extracted them, or a whole rendered page where it could
not. A crop is all signal, and it carries a caption and a name, so a hit is "Figure 3" —
quotable and showable — rather than "look at page 7".

Re-adding a paper replaces every point it already had. The collection name carries the
vector width; swapping checkpoints with a different width needs a fresh collection.
"""

import os
import sys
import uuid
from pathlib import Path

from encoder import Encoder
from qdrant_client import QdrantClient, models

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None  # only Qdrant Cloud checks it
QDRANT_TIMEOUT = 60  # qdrant-client's short default times out on a long paper's whole batch
COLLECTION = os.getenv("COLPALI_COLLECTION", "academic_visual_pages")
VECTOR_NAME = "colqwen"  # named vector, matching the team's cluster provisioning
RENDER_DPI = int(os.getenv("COLPALI_DPI", "150"))
UPSERT_BATCH = 16  # points per write; page/figure patch multivectors are large, so fewer per batch


def pdf_pages(path: Path, dpi: int = RENDER_DPI) -> list:
    """PDF -> one PIL image per page. PyMuPDF renders without needing poppler installed."""
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
                        hnsw_config=models.HnswConfigDiff(m=0),  # multivectors: exact rescoring
                    )
                },
            )
        # Idempotent; also covers a collection someone provisioned without the index.
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

    def _upsert(self, rows: list[dict], vectors: list) -> int:
        points = [
            models.PointStruct(id=uuid.uuid4().hex, vector={VECTOR_NAME: vector.tolist()}, payload=row)
            for row, vector in zip(rows, vectors, strict=True)
        ]
        # In batches: one request for a whole paper's pages or crops was the write that timed
        # out, even with a generous client timeout — many small requests survive a slow
        # moment on the Qdrant VM that one large one does not.
        for start in range(0, len(points), UPSERT_BATCH):
            self.client.upsert(COLLECTION, points[start : start + UPSERT_BATCH])
        return len(points)

    def add_pdf(self, pdf_path: str | Path) -> int:
        """Whole rendered pages: the fallback for a paper no figures could be cropped from."""
        path = Path(pdf_path)
        images = pdf_pages(path)
        vectors = self.encoder.pages(images)
        self._delete_source(path.name)
        rows = [
            {"page": number, "title": path.stem, "source": path.name, "kind": "page",
             "label": f"Page {number}", "caption": "", "image": ""}
            for number in range(1, len(vectors) + 1)
        ]
        return self._upsert(rows, vectors)

    def add_figures(self, source: str, title: str, figures: list[dict]) -> int:
        """One point per cropped figure, keyed by the name the paper gives it."""
        from PIL import Image

        images = [Image.open(figure["image"]).convert("RGB") for figure in figures]
        vectors = self.encoder.pages(images)
        self._delete_source(source)  # figures replace whatever this paper had
        rows = [
            {"page": figure.get("page", 0), "title": title, "source": source,
             "kind": "figure", "label": figure.get("label", ""),
             "caption": figure.get("caption", ""), "image": figure["image"]}
            for figure in figures
        ]
        return self._upsert(rows, vectors)

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
