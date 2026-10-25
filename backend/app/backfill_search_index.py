"""Put the PDF of every stored analysis into ColBERT, so a search of a person's papers finds
the papers they analysed and not only the works those papers cite.

Analyses run before this was added only indexed their cited works. ColBERT skips a PDF whose
content it already has, so running this again only adds what is missing.

    python -m app.backfill_search_index            list the PDFs it would index
    python -m app.backfill_search_index --apply    index them
"""

import sys
from pathlib import Path

from app import store
from app.pipeline.rag import add_paper


def backfill(apply: bool) -> int:
    """Index each done analysis's PDF that is on this disk; return how many it found."""
    files = sorted(
        {
            analysis["file"]
            for analysis in store.load_all().values()
            if analysis.get("status") == "done" and Path(analysis.get("file") or "").is_file()
        }
    )
    for file in files:
        if not apply:
            print(file)
            continue
        result = add_paper(file)
        print(f"{file}: {result['status']} {result.get('message', '')}".rstrip())
    print(f"{len(files)} {'indexed' if apply else 'would be indexed'}")
    return len(files)


if __name__ == "__main__":
    backfill(apply="--apply" in sys.argv[1:])
