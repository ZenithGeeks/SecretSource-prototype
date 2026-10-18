"""Does giving the judge the figure crop decide claims that only a figure can decide?

    python eval_figures.py figure-claims.jsonl --runs 3 --out figure-verdicts.jsonl

Each claim is judged twice per run with the same instructions (JudgeClaim's, from verify.py) and
the same 4 ColBERT passages (verify.evidence_from): once with the passages only, once with the
claim's figure crop added. The image is the only difference, so the gap is what the figure adds.
Run it in the worker container with COLBERT_URL pointing at a ColBERT that has the papers.
"""

import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import dspy
from app.llm import dspy_lm
from app.pipeline import verify
from dspy.utils.exceptions import AdapterParseError
from make_eval_claims import write_with_retry

FIGURES = Path("data/papers/figures")
PAPERS = Path("data/papers")
retries = Counter()  # replies per mode that were not JSON, retried or not
INSTRUCTIONS = """Decide whether the cited paper's passages support the claim made about it.
Answer "supports" only if a passage states it, "refutes" if a passage contradicts it,
and "insufficient" if the passages do not settle the question.
Before answering "supports", check each number, each comparison (more or less, higher
or lower, easy or hard), each direction (from A to B) and what each value belongs to:
the row and column of a table, or the item that "respectively" pairs it with. If any
of them differs from the passage, the passage contradicts the claim. A claim that
leaves out details the passage gives is not contradicted by that. The claim may use
different words than the passage; judge whether it means the same thing."""


class JudgeText(dspy.Signature):
    claim: str = dspy.InputField(desc="A claim that cites the source paper")
    evidence: list[str] = dspy.InputField(desc="Passages from the cited paper")
    verdict: str = dspy.OutputField(desc="supports, refutes, or insufficient")
    reasoning: str = dspy.OutputField(desc="One sentence explaining the verdict")


class JudgeTextAndFigure(dspy.Signature):
    claim: str = dspy.InputField(desc="A claim that cites the source paper")
    evidence: list[str] = dspy.InputField(desc="Passages from the cited paper")
    figure: dspy.Image = dspy.InputField(
        desc="A figure from the cited paper; values read from it count as evidence"
    )
    verdict: str = dspy.OutputField(desc="supports, refutes, or insufficient")
    reasoning: str = dspy.OutputField(desc="One sentence explaining the verdict")


def judge_both(claim: dict, judges: dict) -> dict[str, str]:
    """The text-only and the text-and-figure verdict for one claim."""
    evidence = [p["text"] for p in verify.evidence_from(claim["text"], claim["paper"])]
    figure = dspy.Image.from_file((FIGURES / claim["figure"]).as_posix())
    verdicts = {}
    for mode, inputs in (("text", {}), ("figure", {"figure": figure})):
        prediction = None
        # A reply that is not JSON gets one more try, as a retry in the pipeline would.
        for _ in range(2):
            try:
                ask = judges[mode]
                prediction = write_with_retry(
                    lambda passage, ask=ask, inputs=inputs: ask(
                        claim=claim["text"], evidence=evidence, **inputs
                    ),
                    None,
                )
                break
            except AdapterParseError:
                retries[mode] += 1
        if prediction is None:
            # Counted against the mode: an answer the pipeline cannot parse is no verdict.
            verdicts[mode] = "error"
            continue
        verdict = prediction.verdict.strip().lower()
        verdicts[mode] = verdict if verdict in verify.LABELS else "insufficient"
    return verdicts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("claims", type=Path)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    with args.claims.open(encoding="utf-8") as file:
        claims = [json.loads(line) for line in file]
    for paper in sorted({c["paper"] for c in claims}):
        verify.prepare_source((PAPERS / paper).as_posix())  # index the text once

    dspy.configure(lm=dspy_lm(temperature=0.0, max_tokens=1500), adapter=dspy.JSONAdapter())
    # Each run and each retry must ask the model again. rollout_id does not do that at
    # temperature 0 (dspy 3.4.1 ignores it there), so the cache goes off.
    dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)
    judges = {
        "text": dspy.ChainOfThought(JudgeText.with_instructions(INSTRUCTIONS)),
        "figure": dspy.ChainOfThought(JudgeTextAndFigure.with_instructions(INSTRUCTIONS)),
    }
    runs = []
    judge_both(claims[0], judges)  # the first call imports litellm before threads start
    with ThreadPoolExecutor(max_workers=2) as pool:  # the judge gateway allows 3 requests at once
        for run in range(1, args.runs + 1):
            runs.append(list(pool.map(lambda c: judge_both(c, judges), claims)))
            for mode in ("text", "figure"):
                right = sum(v[mode] == c["kind"] for c, v in zip(claims, runs[-1], strict=True))
                print(f"run {run} {mode:<6} {right}/{len(claims)}", flush=True)

    for mode in ("text", "figure"):
        for kind in ("supports", "refutes"):
            counts = Counter(r[i][mode] for r in runs for i, c in enumerate(claims) if c["kind"] == kind)
            summary = ", ".join(f"{v} {n}" for v, n in sorted(counts.items()))
            print(f"{mode:<6} expected {kind:<8} -> {summary}")
    print(f"replies that were not JSON: {dict(retries)}")
    if args.out:
        with args.out.open("w", encoding="utf-8") as file:
            for i, claim in enumerate(claims):
                file.write(json.dumps({**claim, "verdicts": [r[i] for r in runs]}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
