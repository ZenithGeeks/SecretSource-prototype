"""Limits of the services that run on Cloud Run, and how a request stays under them."""

import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

# Cloud Run refuses a request body over 32 MiB with HTTP 413. Images make up most of a large
# PDF: DiffiT's 43.4 MiB arXiv PDF is 0.7 MiB without them, with the same text on all 31 pages.
UPLOAD_LIMIT_BYTES = 32 * 2**20
# GROBID treats an image area as a figure. With the images deleted it reads the text drawn over
# them as body text and references, so it gets the images resampled to about this resolution.
# For arXiv 2409.12191 (34.3 MiB) that copy is 2.25 MiB and GROBID's TEI matches the original's.
GROBID_IMAGE_DPI = 72


@contextmanager
def uploadable(pdf: Path, keep_images: bool = False) -> Iterator[Path]:
    """The PDF itself, or a smaller copy when it is over UPLOAD_LIMIT_BYTES.

    The copy drops the images, or with `keep_images` resamples them to about GROBID_IMAGE_DPI.
    It keeps the original file name, so a service that files results under the name files them
    under the same source. The copy is deleted when the `with` block ends.
    """
    if pdf.stat().st_size <= UPLOAD_LIMIT_BYTES:
        yield pdf
        return
    import pymupdf

    with tempfile.TemporaryDirectory() as folder, pymupdf.open(pdf) as document:
        if keep_images:
            # JPEG quality 50 is enough: GROBID only uses where an image is, not what it shows
            document.rewrite_images(
                dpi_threshold=GROBID_IMAGE_DPI + 1, dpi_target=GROBID_IMAGE_DPI, quality=50
            )
        else:
            for page in document:
                for image in page.get_images(full=True):
                    page.delete_image(image[0])
        copy = Path(folder) / pdf.name
        document.save(copy, garbage=4, deflate=True)
        yield copy
