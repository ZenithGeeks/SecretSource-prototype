"""Per-paper vector files of ColPali embeddings. Add figures or pages, search with MaxSim.

    python -m store paper.pdf "papers/*.pdf" papers/   # files, globs or folders

A row is one image's patch vectors: a cropped figure if the caller extracted them, or a
whole rendered page if it could not. A crop has a caption and a name. So a hit is
"Figure 3", not "page 7". Rows and vectors are written to one safetensors file per paper
(services/colpali/vectorfiles.py), stored under VECTOR_STORE (a GCS bucket in production,
a local folder in compose/tests).

Re-adding a paper replaces every row it already had. A checkpoint with a different vector
width just writes a wider file; nothing needs to be provisioned ahead of time.
"""

import hashlib
import os
import sys
from pathlib import Path

import torch
import torch.nn.functional as F
from encoder import Encoder
from vectorfiles import PaperFiles, maxsim

RENDER_DPI = int(os.getenv("COLPALI_DPI", "150"))


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
        self.files = PaperFiles(os.getenv("VECTOR_STORE", "./vectors"), "colpali")

    def __len__(self) -> int:
        return len(self.files.sources())

    def _normalized(self, vectors: list[torch.Tensor]) -> list[torch.Tensor]:
        # maxsim (vectorfiles.py) assumes unit-norm rows, matching Cosine-distance scoring.
        # colpali-engine's own checkpoints already return unit vectors, but normalizing here
        # too is idempotent and keeps this store correct even against a checkpoint that doesn't.
        return [F.normalize(vector, dim=-1) for vector in vectors]

    def add_pdf(self, pdf_path: str | Path) -> int:
        """Whole rendered pages. This is the fallback for a paper with no croppable figures.

        Skips rendering and encoding (the expensive parts) when the store already has this
        exact file under this source name -- see add_pdf in services/colbert/store.py for
        why this checks the store itself rather than trusting the caller not to ask twice.
        """
        path = Path(pdf_path)
        content_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        stored_hash, stored_count = self.files.stored_hash(path.name)
        if stored_hash == content_hash:
            return stored_count

        images = pdf_pages(path)
        vectors = self._normalized(self.encoder.pages(images))
        rows = [
            {"page": number, "title": path.stem, "source": path.name, "kind": "page",
             "label": f"Page {number}", "caption": "", "image": ""}
            for number in range(1, len(vectors) + 1)
        ]
        self.files.write(path.name, rows, vectors, content_hash)
        return len(rows)

    def add_figures(self, source: str, title: str, figures: list[dict]) -> int:
        """One row per cropped figure, matched by the name the paper gives it.

        Hashes each figure's own image bytes plus its page/label/caption, in order, so a
        changed crop or caption is a genuinely different hash -- not just whether the same
        file names were passed. Skips re-encoding when the store already has this exact set
        for this source.
        """
        hasher = hashlib.sha256()
        for figure in figures:
            hasher.update(Path(figure["image"]).read_bytes())
            meta = (figure.get("page", 0), figure.get("label", ""), figure.get("caption", ""))
            hasher.update(("\x00" + "\x01".join(str(part) for part in meta) + "\x00").encode())
        content_hash = hasher.hexdigest()
        stored_hash, stored_count = self.files.stored_hash(source)
        if stored_hash == content_hash:
            return stored_count

        from PIL import Image

        images = [Image.open(figure["image"]).convert("RGB") for figure in figures]
        vectors = self._normalized(self.encoder.pages(images))
        rows = [
            {"page": figure.get("page", 0), "title": title, "source": source,
             "kind": "figure", "label": figure.get("label", ""),
             "caption": figure.get("caption", ""), "image": figure["image"]}
            for figure in figures
        ]
        self.files.write(source, rows, vectors, content_hash)
        return len(rows)

    def search(
        self,
        query: str,
        k: int = 5,
        source: str | None = None,
        sources: list[str] | None = None,
    ) -> list[dict]:
        """Top-k figures or pages by MaxSim, optionally restricted to one paper or a list.

        `sources` empty, or a `source` that is not in `sources`, searches nothing: the caller
        named a scope that contains no paper, and the alternative would be the whole index.
        """
        if sources is not None and source is not None:
            names = [source] if source in sources else []
        elif sources is not None:
            names = list(sources)
        elif source is not None:
            names = [source]
        else:
            names = self.files.sources()
        if not names:
            return []

        vector = F.normalize(self.encoder.query(query), dim=-1)

        scored = []
        for name in names:
            paper = self.files.load(name)
            if paper is None or not paper.rows:
                continue
            scores = maxsim(vector, paper)
            for row, score in zip(paper.rows, scores.tolist(), strict=True):
                scored.append((score, row))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [{"rank": i + 1, "score": round(score, 4), **row} for i, (score, row) in enumerate(scored[:k])]


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
