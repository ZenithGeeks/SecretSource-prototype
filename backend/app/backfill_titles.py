"""Give stored analyses the title a new run would give them (#140).

Analyses saved before titles were read have none, so the library shows their file name, and
GROBID can drop the first line of a title. This reads each stored analysis's PDF again, without
GROBID or the LLM, and saves the title `paper_title` gives. Restart the gateway afterwards: it
keeps analyses in memory.

    python -m app.backfill_titles            print what would change
    python -m app.backfill_titles --apply    save it
"""

import sys
from pathlib import Path

from app import store
from app.pipeline.claims import paper_title


def backfill(apply: bool) -> int:
    changed = 0
    for analysis in store.load_all().values():
        file = analysis.get("file") or ""
        if analysis.get("status") != "done" or not Path(file).is_file():
            continue
        old = analysis.get("title") or ""
        new = paper_title(file, old, analysis.get("paper", ""))
        if new and new != old:
            changed += 1
            print(f"{analysis['id']}: {old or '(no title)'!r} -> {new!r}")
            if apply:
                analysis["title"] = new
                store.save(analysis)
    print(f"{changed} {'changed' if apply else 'would change'}")
    return changed


if __name__ == "__main__":
    backfill(apply="--apply" in sys.argv[1:])
