"""One-time migration: read every point out of the old Qdrant collections and write them
as safetensors vector files (services/colbert/vectorfiles.py or services/colpali/vectorfiles.py,
which are kept identical).

    QDRANT_URL=... QDRANT_API_KEY=... VECTOR_STORE=<gs://bucket/prefix or a folder> \\
        python migrate_from_qdrant.py [--only colbert|colpali] [--limit-sources N]

qdrant-client is no longer a dependency of either service, since production no longer
talks to Qdrant. It is only needed here, once, to read the old collections, and is
imported inside main() -- `pip install qdrant-client` first if it is missing.

Safe to re-run: a source whose stored content hash already matches what is already in
VECTOR_STORE is skipped, so an interrupted run can be resumed. It never deletes anything
in Qdrant -- migrate first, verify, then delete the collections by hand if you want to.
"""

import argparse
import os
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))  # for `import vectorfiles` from this folder
from vectorfiles import PaperFiles  # noqa: E402

SCROLL_PAGE = 64

COLLECTIONS = {
    "colbert": {
        "collection": "academic_text_claims",
        "vector": "colbert",
        "dim": 128,
        "order_by": lambda payload: (payload.get("page", 0), payload.get("start", 0)),
    },
    "colpali": {
        "collection": "academic_visual_pages",
        "vector": "colqwen",
        "dim": 128,
        "order_by": lambda payload: (payload.get("page", 0), payload.get("label", "")),
    },
}


def _scroll(client, collection: str, **kwargs):
    """Every point matching kwargs, one page at a time."""
    offset = None
    while True:
        batch, offset = client.scroll(collection, limit=SCROLL_PAGE, offset=offset, **kwargs)
        yield from batch
        if offset is None:
            break


def _sources(client, collection: str) -> dict[str, str]:
    """source -> content_hash, read from payloads only, so no vectors are held in memory."""
    found = {}
    for point in _scroll(client, collection, with_payload=["source", "content_hash"], with_vectors=False):
        source = point.payload.get("source")
        if source is not None:
            found.setdefault(source, point.payload.get("content_hash", ""))
    return found


def migrate_collection(client, kind: str, spec: dict, files: PaperFiles, limit_sources: int | None) -> int:
    from qdrant_client import models

    hashes = _sources(client, spec["collection"])
    sources = sorted(hashes)
    print(f"{kind}: {len(sources)} sources in {spec['collection']}")
    if limit_sources is not None:
        sources = sources[:limit_sources]

    total = 0
    for source in sources:
        stored_hash, stored_count = files.stored_hash(source)
        if stored_hash == hashes[source]:
            print(f"  {source}: already migrated ({stored_count} rows), skipping")
            continue
        # One paper's points at a time: holding every vector of the collection at once
        # (as Python floats) would take several GB.
        only_this = models.Filter(
            must=[models.FieldCondition(key="source", match=models.MatchValue(value=source))]
        )
        points = list(_scroll(
            client, spec["collection"], scroll_filter=only_this,
            with_payload=True, with_vectors=[spec["vector"]],
        ))
        points.sort(key=lambda point: spec["order_by"](point.payload))
        rows = [{k: v for k, v in point.payload.items() if k != "content_hash"} for point in points]
        vectors = [torch.tensor(point.vector[spec["vector"]], dtype=torch.float32) for point in points]
        files.write(source, rows, vectors, hashes[source])
        total += len(rows)
        print(f"  {source}: wrote {len(rows)} rows")

    return total


def main() -> None:
    try:
        from qdrant_client import QdrantClient
    except ImportError:
        sys.exit("qdrant-client is not installed here. Run: pip install qdrant-client")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["colbert", "colpali"], help="migrate only this collection")
    parser.add_argument(
        "--limit-sources", type=int, default=None, help="migrate at most N sources per collection"
    )
    args = parser.parse_args()

    qdrant_url = os.environ.get("QDRANT_URL", "http://localhost:6333")
    qdrant_api_key = os.environ.get("QDRANT_API_KEY") or None
    vector_store = os.environ.get("VECTOR_STORE", "./vectors")

    client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key, timeout=120)

    kinds = [args.only] if args.only else list(COLLECTIONS)
    grand_total = 0
    for kind in kinds:
        spec = COLLECTIONS[kind]
        files = PaperFiles(vector_store, kind)
        grand_total += migrate_collection(client, kind, spec, files, args.limit_sources)

    print(f"total rows written: {grand_total}")


if __name__ == "__main__":
    main()
