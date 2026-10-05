# NOTE: this file is duplicated verbatim at services/colpali/vectorfiles.py (the two
# services build from separate Docker contexts, so a shared import is not possible).
# Keep both copies identical.
"""One safetensors file per paper, stored in a GCS bucket (VECTOR_STORE=gs://bucket/prefix)
or a local folder (VECTOR_STORE=/some/path, the default ./vectors). Replaces per-paper
Qdrant collections: a claim check only ever searches one cited paper's ~150 passages, which
plain torch scores in milliseconds, so there is no need for a vector database at all.

Each file holds every row (passage or figure/page) for one paper: the token vectors of every
row concatenated into one tensor, an offsets tensor marking where each row's tokens start and
end, and metadata carrying the row dicts themselves plus a content hash used for dedup.
"""

import json
import os
import struct
import urllib.parse
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import load as st_load
from safetensors.torch import save as st_save

VECTOR_CACHE_PAPERS = int(os.getenv("VECTOR_CACHE_PAPERS", "128"))  # ~5 MB each in fp16


@dataclass
class Paper:
    rows: list[dict]
    vectors: torch.Tensor  # [T, dim] float16, as stored; halves the cache
    row_index: torch.Tensor  # [T] int64 -- which row each token belongs to


def maxsim(query: torch.Tensor, paper: Paper) -> torch.Tensor:
    """query: [Q, dim] float32, unit-norm rows. -> [n_rows] MaxSim score per row.

    Equals Qdrant's MaxSim with Cosine distance because every stored vector is unit-norm
    (both encoders normalize), so a dot product is a cosine similarity.
    """
    n_rows = len(paper.rows)
    n_query = query.shape[0]
    sims = paper.vectors.float() @ query.T  # [T, Q]
    out = torch.full((n_rows, n_query), float("-inf"), dtype=sims.dtype)
    index = paper.row_index.unsqueeze(1).expand(-1, n_query)
    out.scatter_reduce_(0, index, sims, reduce="amax", include_self=True)
    return out.sum(dim=1)


def _read_metadata(data: bytes) -> dict:
    """The safetensors str->str metadata header, without touching the tensor bytes."""
    (header_len,) = struct.unpack("<Q", data[:8])
    header = json.loads(data[8 : 8 + header_len])
    return header.get("__metadata__") or {}


def _build_file(rows: list[dict], vectors: list[torch.Tensor], content_hash: str) -> bytes:
    fp16 = [v.to(torch.float16) for v in vectors]
    dim = next((v.shape[1] for v in fp16 if v.shape[1]), 0) if fp16 else 0
    cat = torch.cat(fp16, dim=0) if fp16 else torch.zeros((0, dim), dtype=torch.float16)
    lengths = torch.tensor([v.shape[0] for v in fp16], dtype=torch.int64)
    offsets = torch.zeros(len(fp16) + 1, dtype=torch.int64)
    if len(fp16):
        offsets[1:] = torch.cumsum(lengths, dim=0)
    metadata = {"content_hash": content_hash, "count": str(len(rows)), "rows": json.dumps(rows)}
    return st_save({"vectors": cat, "offsets": offsets}, metadata=metadata)


def _parse_file(data: bytes) -> Paper:
    tensors = st_load(data)
    rows = json.loads(_read_metadata(data).get("rows", "[]"))
    offsets = tensors["offsets"]
    lengths = offsets[1:] - offsets[:-1]
    row_index = torch.repeat_interleave(torch.arange(len(rows), dtype=torch.int64), lengths)
    return Paper(rows=rows, vectors=tensors["vectors"], row_index=row_index)


class PaperFiles:
    """Per-paper safetensors files under `<root>/<kind>/`, one object per source paper.

    `root` is either `gs://<bucket>/<prefix>` or a local directory path.
    """

    def __init__(self, root: str, kind: str):
        self.kind = kind
        self.is_gcs = root.startswith("gs://")
        self._cache: OrderedDict[str, tuple[object, Paper]] = OrderedDict()
        if self.is_gcs:
            rest = root[len("gs://") :]
            bucket_name, _, prefix = rest.partition("/")
            self._bucket_name = bucket_name
            self._prefix = prefix.strip("/")
            self._bucket = None  # lazy: google-cloud-storage is only imported when needed
        else:
            self._local_root = Path(root) / kind
            self._local_root.mkdir(parents=True, exist_ok=True)

    # -- GCS plumbing, lazily imported so local mode needs no GCP libraries --

    def _bucket_client(self):
        if self._bucket is None:
            from google.cloud import storage

            self._bucket = storage.Client().bucket(self._bucket_name)
        return self._bucket

    def _object_name(self, source: str) -> str:
        name = f"{self.kind}/{urllib.parse.quote(source, safe='')}.safetensors"
        return f"{self._prefix}/{name}" if self._prefix else name

    def _local_path(self, source: str) -> Path:
        return self._local_root / f"{urllib.parse.quote(source, safe='')}.safetensors"

    # -- public API --

    def write(self, source: str, rows: list[dict], vectors: list[torch.Tensor], content_hash: str) -> None:
        data = _build_file(rows, vectors, content_hash)
        if self.is_gcs:
            blob = self._bucket_client().blob(self._object_name(source))
            blob.metadata = {"content_hash": content_hash, "count": str(len(rows))}
            blob.upload_from_string(data, content_type="application/octet-stream")
        else:
            path = self._local_path(source)
            tmp = path.parent / f"{path.name}.tmp-{uuid.uuid4().hex}"
            tmp.write_bytes(data)
            os.replace(tmp, path)  # atomic: a concurrent reader sees the old or the new file, never partial
        self._cache.pop(source, None)  # next load() re-fetches under the new version token

    def stored_hash(self, source: str) -> tuple[str | None, int]:
        """(content_hash, count) without downloading the vectors."""
        if self.is_gcs:
            blob = self._bucket_client().get_blob(self._object_name(source))
            if blob is None:
                return None, 0
            metadata = blob.metadata or {}
        else:
            path = self._local_path(source)
            if not path.exists():
                return None, 0
            with safe_open(str(path), framework="pt") as handle:
                metadata = handle.metadata() or {}
        return metadata.get("content_hash"), int(metadata.get("count", 0))

    def load(self, source: str) -> Paper | None:
        if self.is_gcs:
            blob = self._bucket_client().get_blob(self._object_name(source))
            if blob is None:
                self._cache.pop(source, None)
                return None
            version = blob.generation
        else:
            path = self._local_path(source)
            try:
                version = os.stat(path).st_mtime_ns
            except FileNotFoundError:
                self._cache.pop(source, None)
                return None

        cached = self._cache.get(source)
        if cached is not None and cached[0] == version:
            self._cache.move_to_end(source)
            return cached[1]

        data = blob.download_as_bytes() if self.is_gcs else path.read_bytes()
        paper = _parse_file(data)
        self._cache[source] = (version, paper)
        self._cache.move_to_end(source)
        while len(self._cache) > VECTOR_CACHE_PAPERS:
            self._cache.popitem(last=False)
        return paper

    def sources(self) -> list[str]:
        if self.is_gcs:
            prefix = f"{self._prefix}/{self.kind}/" if self._prefix else f"{self.kind}/"
            names = [blob.name for blob in self._bucket_client().list_blobs(prefix=prefix)]
        else:
            names = [path.name for path in self._local_root.glob("*.safetensors")]
        result = []
        for name in names:
            stem = name.rsplit("/", 1)[-1]
            if stem.endswith(".safetensors"):
                stem = stem[: -len(".safetensors")]
            result.append(urllib.parse.unquote(stem))
        return result

    def delete(self, source: str) -> None:
        self._cache.pop(source, None)
        if self.is_gcs:
            self._bucket_client().blob(self._object_name(source)).delete()
        else:
            self._local_path(source).unlink(missing_ok=True)
