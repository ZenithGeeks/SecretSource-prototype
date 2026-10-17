"""Rank every claim against the passages of its own paper, the way verify.evidence_from searches.

    python eval/rank_passages.py passages.jsonl claims.jsonl ranks.jsonl

Uses the encoder.py next to store.py. To test another encoder, mount its file over
/app/encoder.py in a throwaway container; a single-vector encoder returns [1, d] tensors, so
MaxSim becomes cosine. Writes the top 100 passage indices per claim for score_retrieval.py and
prints how long encoding took, which is what indexing costs.
"""

import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # encoder.py sits one folder up
from encoder import Encoder  # noqa: E402

TOP = 100


def pad(vectors: list[torch.Tensor]) -> tuple[torch.Tensor, torch.Tensor]:
    """-> (docs [N, L, d], mask [N, L]) on the GPU, so MaxSim over a paper is one product."""
    longest = max(v.shape[0] for v in vectors)
    # fp16 halves the padded paper: a large encoder with a long corpus (SciFact) runs out of memory in fp32
    docs = torch.zeros(len(vectors), longest, vectors[0].shape[1], device="cuda", dtype=torch.float16)
    mask = torch.zeros(len(vectors), longest, dtype=torch.bool, device="cuda")
    for i, v in enumerate(vectors):
        docs[i, : v.shape[0]] = v
        mask[i, : v.shape[0]] = True
    return docs, mask


def maxsim(query: torch.Tensor, docs: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """query [q, d] against docs [N, L, d] -> [N]: per query token the best doc token, summed."""
    sims = torch.einsum("qd,nld->nql", query, docs).masked_fill(~mask[:, None, :], float("-inf"))
    return sims.max(dim=2).values.sum(dim=1)


def main() -> None:
    passages_path, claims_path, out_path = sys.argv[1:4]
    passages = defaultdict(list)  # paper -> passage texts, in index order
    with open(passages_path, encoding="utf-8") as file:
        for row in map(json.loads, file):
            passages[row["paper"]].append(row["text"])
    claims = defaultdict(list)
    with open(claims_path, encoding="utf-8") as file:
        for row in map(json.loads, file):
            claims[row["paper"]].append(row)

    encoder = Encoder("cuda")
    encoder.docs(["warm up"])  # the first call is slow (kernel setup); keep it out of the timing
    encode_seconds, results = 0.0, []
    for paper, paper_claims in claims.items():
        start = time.perf_counter()
        vectors = encoder.docs(passages[paper])
        torch.cuda.synchronize()
        encode_seconds += time.perf_counter() - start
        torch.cuda.empty_cache()  # give encoding's cached blocks back before the padded paper lands
        docs, mask = pad([v.to("cuda") for v in vectors])
        for claim in paper_claims:
            scores = maxsim(encoder.query(claim["text"]).to("cuda", torch.float16), docs, mask).float()
            results.append({"id": claim["id"], "top": scores.topk(min(TOP, len(scores))).indices.tolist()})
        del docs, mask

    with open(out_path, "w", encoding="utf-8") as file:
        for row in results:
            file.write(json.dumps(row) + "\n")
    count = sum(len(passages[p]) for p in claims)
    print(
        f"{len(results)} claims ranked; encoded {count} passages in {encode_seconds:.1f} s; "
        f"peak GPU {torch.cuda.max_memory_allocated() / 2**30:.2f} GiB"
    )


if __name__ == "__main__":
    main()
