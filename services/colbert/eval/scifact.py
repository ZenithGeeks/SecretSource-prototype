"""Download BEIR SciFact (test split) and write it as passages.jsonl and claims.jsonl for this eval.

    python eval/scifact.py out_dir

The whole corpus is one "paper", so rank_passages.py searches all 5,183 abstracts for each of the
300 claims. Gold is a list (some claims have several relevant abstracts). Needs pandas with
pyarrow to read the parquet files; any Python with those works, the colbert image is not needed.
Check: ColBERTv2 with 300-token passages should score nDCG@10 near the paper's 69.3 (0.692 here).
"""

import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

import pandas as pd

DATASET = "https://huggingface.co/datasets/BeIR"


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    corpus = pd.read_parquet(
        io.BytesIO(fetch(f"{DATASET}/scifact/resolve/main/corpus/corpus-00000-of-00001.parquet"))
    )
    queries = pd.read_parquet(
        io.BytesIO(fetch(f"{DATASET}/scifact/resolve/main/queries/queries-00000-of-00001.parquet"))
    )
    qrels = csv.DictReader(
        io.StringIO(fetch(f"{DATASET}/scifact-qrels/resolve/main/test.tsv").decode()), delimiter="\t"
    )

    index = {doc_id: i for i, doc_id in enumerate(corpus["_id"])}
    with (out / "scifact_passages.jsonl").open("w", encoding="utf-8") as file:
        for i, row in enumerate(corpus.itertuples()):
            text = f"{row.title} {row.text}".strip()
            file.write(
                json.dumps({"paper": "scifact", "index": i, "page": 0, "text": text}, ensure_ascii=False)
                + "\n"
            )

    gold: dict[str, list[int]] = {}
    for row in qrels:
        if int(row["score"]) > 0:
            gold.setdefault(row["query-id"], []).append(index[row["corpus-id"]])
    claim_text = queries.set_index("_id")["text"]
    with (out / "scifact_claims.jsonl").open("w", encoding="utf-8") as file:
        for query_id, docs in gold.items():
            row = {"id": query_id, "paper": "scifact", "gold": docs, "text": claim_text[query_id]}
            file.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"{len(corpus)} abstracts, {len(gold)} test claims")


if __name__ == "__main__":
    main()
