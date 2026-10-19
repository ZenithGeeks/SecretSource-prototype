"""Write claims that only a figure can decide, from Docling's crops, for the figure eval.

    python make_figure_claims.py figure-claims.jsonl --max-figures 60

For every numbered figure in data/papers/figures/*/media.json the vision model writes one claim
the figure supports and one it contradicts, each stating a value read from the figure. A pair is
kept only if the supported claim's key numbers (decimals or two digits and more) appear in
neither the caption nor the passages ColBERT gives the judge for either claim, so the text the
judge sees cannot decide it. Kept figures are taken from each paper in turn up to --max-figures.
Run it in the worker container, where app.llm reaches the vision-capable judge model.

Check every pair against its figure before using it: the model misreads charts. Of 51 pairs it
wrote on 18 Oct 2026, readers kept 26 (docs/eval/generated/figure-claims.jsonl); the rest had a
wrong value, swapped labels, a series not in the figure, or a contradicted value too close to
the real one.
"""

import argparse
import json
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from itertools import zip_longest
from pathlib import Path

import dspy
from app.llm import dspy_lm
from app.pipeline import verify
from make_eval_claims import TRANSIENT, AdapterParseError, write_with_retry

FIGURES = Path("data/papers/figures")
PAPERS = Path("data/papers")
KEY_NUMBER = re.compile(r"(?<![\w.])\d+\.\d+|(?<![\w.])\d{2,}(?![\w.])")


class WriteFigureClaims(dspy.Signature):
    """Write two one-sentence claims that another paper could make about values shown in this
    figure, citing it.

    The supported claim states a specific number you read from the figure (a bar's value, a
    point on a curve, a table cell) and what it belongs to. Pick a number the caption does not
    give. The contradicted claim is the same claim with that number or what it belongs to
    changed, so the figure clearly contradicts it. Set checkable to false when the figure shows
    no numbers you can read exactly, such as a photo, a diagram or an example output.
    """

    passage: dspy.Image = dspy.InputField(desc="the figure")
    caption: str = dspy.InputField()
    checkable: bool = dspy.OutputField()
    supported_claim: str = dspy.OutputField()
    contradicted_claim: str = dspy.OutputField()


def numbered_figures() -> list[dict]:
    """Every figure Docling found that has a numbered caption, with its crop path."""
    figures = []
    for manifest in sorted(FIGURES.glob("*/media.json")):
        media = json.loads(manifest.read_text(encoding="utf-8"))
        paper = Path(media["file"]).name
        for i, figure in enumerate(media["figures"]):
            if figure.get("numbered") and figure.get("caption"):
                figures.append({"paper": paper, "index": i, "label": figure["label"],
                                "caption": figure["caption"], "image": Path(figure["image"]).name,
                                "folder": manifest.parent.name})
    return figures


def is_figure_only(claim: str, seen_text: str) -> bool:
    """Whether the claim has a key number and none of them is a whole number in seen_text."""
    # Whole tokens, not substrings: "45" must not match inside "0.45" or "2045".
    numbers = set(KEY_NUMBER.findall(claim))
    return bool(numbers) and not numbers & set(KEY_NUMBER.findall(seen_text))


def judge_sees(claims: list[str], figure: dict) -> str:
    """The caption and every passage the judge would get for these claims."""
    passages = [p["text"] for claim in claims for p in verify.evidence_from(claim, figure["paper"])]
    return " ".join([figure["caption"], *passages])


def claims_for(figure: dict, write: dspy.Predict) -> tuple[list[dict], str]:
    """-> (kept claims, outcome): ok, unchecked, same, in-text or error."""
    image = dspy.Image.from_file((FIGURES / figure["folder"] / figure["image"]).as_posix())
    try:
        result = write_with_retry(lambda passage: write(passage=passage, caption=figure["caption"]), image)
    except (AdapterParseError, *TRANSIENT):
        return [], "error"
    if not result.checkable:
        return [], "unchecked"
    if result.supported_claim.strip() == result.contradicted_claim.strip():
        return [], "same"
    seen = judge_sees([result.supported_claim, result.contradicted_claim], figure)
    if not is_figure_only(result.supported_claim, seen):
        return [], "in-text"
    base = f"{figure['paper']}#fig{figure['index']}"
    return [
        {"id": f"{base}:{kind}", "paper": figure["paper"], "kind": kind, "text": text.strip(),
         "figure": f"{figure['folder']}/{figure['image']}", "label": figure["label"],
         "caption": figure["caption"]}
        for kind, text in (("supports", result.supported_claim), ("refutes", result.contradicted_claim))
    ], "ok"


def take_round_robin(pairs: list[list[dict]], limit: int) -> list[list[dict]]:
    """Up to limit claim pairs, one paper at a time, so no paper fills the set."""
    by_paper: dict[str, list[list[dict]]] = {}
    for pair in pairs:
        by_paper.setdefault(pair[0]["paper"], []).append(pair)
    turns = zip_longest(*by_paper.values())
    return [pair for turn in turns for pair in turn if pair is not None][:limit]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--max-figures", type=int, default=60)
    args = parser.parse_args()

    figures = numbered_figures()
    for paper in sorted({f["paper"] for f in figures}):
        verify.prepare_source((PAPERS / paper).as_posix())  # index the text once

    dspy.configure(lm=dspy_lm(temperature=0.3, max_tokens=400))
    write = dspy.Predict(WriteFigureClaims)
    # The first call imports litellm; threads that start together race on a half-loaded module.
    results = [claims_for(figures[0], write)]
    with ThreadPoolExecutor(max_workers=2) as pool:  # the judge gateway allows 3 requests at once
        results += pool.map(lambda f: claims_for(f, write), figures[1:])

    kept = take_round_robin([claims for claims, _ in results if claims], args.max_figures)
    with args.out.open("w", encoding="utf-8") as file:
        for claims in kept:
            for claim in claims:
                file.write(json.dumps(claim, ensure_ascii=False) + "\n")
    outcomes = Counter(outcome for _, outcome in results)
    counts = ", ".join(f"{o} {n}" for o, n in sorted(outcomes.items()))
    papers = len({claims[0]["paper"] for claims in kept})
    print(f"{len(figures)} numbered figures ({counts}); kept {len(kept)} figures from {papers} papers")


if __name__ == "__main__":
    main()
