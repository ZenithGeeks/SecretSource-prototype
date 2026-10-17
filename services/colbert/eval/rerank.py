"""Re-order each claim's first-stage top-k with a cross-encoder; write ranks in rank_passages' format.

    python eval/rerank.py passages.jsonl claims.jsonl ranks_in.jsonl ranks_out.jsonl
        --model BAAI/bge-reranker-v2-m3 --k 20

The reranked top-k comes first, the rest of the first-stage ranking keeps its order after it.
Prints the time spent scoring, since that is what a reranker would add to every check.
"""

import argparse
import json
import time
from collections import defaultdict

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("passages")
    parser.add_argument("claims")
    parser.add_argument("ranks_in")
    parser.add_argument("ranks_out")
    parser.add_argument("--model", default="BAAI/bge-reranker-v2-m3")
    parser.add_argument("--k", type=int, default=20)
    args = parser.parse_args()

    passages = defaultdict(list)
    with open(args.passages, encoding="utf-8") as file:
        for row in map(json.loads, file):
            passages[row["paper"]].append(row["text"])
    with open(args.claims, encoding="utf-8") as file:
        claims = {row["id"]: row for row in map(json.loads, file)}
    with open(args.ranks_in, encoding="utf-8") as file:
        ranks = [json.loads(line) for line in file]

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSequenceClassification.from_pretrained(args.model, dtype=torch.float16).cuda().eval()

    seconds, out = 0.0, []
    for row in ranks:
        claim = claims[row["id"]]
        head, tail = row["top"][: args.k], row["top"][args.k :]
        texts = [passages[claim["paper"]][i] for i in head]
        start = time.perf_counter()
        with torch.no_grad():
            batch = tokenizer(
                [claim["text"]] * len(texts),
                texts,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            ).to("cuda")
            scores = model(**batch).logits.view(-1).float().cpu()
        seconds += time.perf_counter() - start
        reordered = [head[i] for i in scores.argsort(descending=True).tolist()]
        out.append({"id": row["id"], "top": reordered + tail})

    with open(args.ranks_out, "w", encoding="utf-8") as file:
        for row in out:
            file.write(json.dumps(row) + "\n")
    print(f"{len(out)} claims reranked (top {args.k}); {seconds / len(out) * 1000:.0f} ms per claim")


if __name__ == "__main__":
    main()
