"""Share of caption claims whose top-k passages hold the whole caption text, per passage set.

    python eval/score_captions.py caption-claims.jsonl passages_a.jsonl ranks_a.jsonl
        passages_b.jsonl ranks_b.jsonl

Each ranks file comes from rank_passages.py run on the passage file before it. A split caption
counts as a miss: the judge would see only part of it.
"""

import json
import sys
from collections import defaultdict

KS = (1, 4, 10)


def normalise(text: str) -> str:
    """Lower case with single spaces, so line breaks from PDF extraction do not block a match."""
    return " ".join(text.split()).lower()


def load_passages(path: str) -> dict[str, list[str]]:
    by_paper = defaultdict(list)
    with open(path, encoding="utf-8") as file:
        rows = [json.loads(line) for line in file]
    for row in rows:
        by_paper[row["paper"]].append(normalise(row["text"]))
    return by_paper


def main() -> None:
    with open(sys.argv[1], encoding="utf-8") as file:
        claims = [json.loads(line) for line in file]
    rows = {}
    for passages_path, ranks_path in zip(sys.argv[2::2], sys.argv[3::2], strict=True):
        passages = load_passages(passages_path)
        with open(ranks_path, encoding="utf-8") as file:
            ranks = {r["id"]: r["top"] for r in map(json.loads, file)}
        hits = {}
        for claim in claims:
            caption = normalise(claim["caption"])
            holds = [caption in passages[claim["paper"]][i] for i in ranks[claim["id"]][: max(KS)]]
            hits[claim["id"]] = {k: any(holds[:k]) for k in KS}
        rows[passages_path] = hits
    names = list(rows)
    print(f"{len(claims)} caption claims")
    for name in names:
        print(
            f"{name:<26}"
            + "".join(f"  hit@{k} {sum(h[k] for h in rows[name].values()) / len(claims):.3f}" for k in KS)
        )
    if len(names) == 2:
        a, b = (rows[n] for n in names)
        print(
            f"top 4, {names[1]} vs {names[0]}: +{sum(b[c][4] and not a[c][4] for c in a)} / "
            f"-{sum(a[c][4] and not b[c][4] for c in a)}"
        )


if __name__ == "__main__":
    main()
