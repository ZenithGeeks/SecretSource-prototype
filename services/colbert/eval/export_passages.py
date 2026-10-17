"""Cut every PDF in a folder into the passages this service indexes, one JSON line each.

    python eval/export_passages.py data/papers ../../docs/eval/generated/passages.jsonl

Uses store.pdf_passages, so every retriever in the eval ranks exactly the passages production
would. Run it in the colbert image (it has pypdf), from services/colbert.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # store.py sits one folder up
from store import pdf_passages  # noqa: E402


def main() -> None:
    papers, out = Path(sys.argv[1]), Path(sys.argv[2])
    with out.open("w", encoding="utf-8") as file:
        for pdf in sorted(papers.glob("*.pdf")):
            passages = pdf_passages(pdf)
            for index, passage in enumerate(passages):
                row = {"paper": pdf.name, "index": index, "page": passage["page"], "text": passage["text"]}
                file.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(pdf.name, len(passages))


if __name__ == "__main__":
    main()
