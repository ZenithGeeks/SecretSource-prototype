"""Score simple baselines on the same labeled pairs as the judge, to compare it with them.

    python eval_baselines.py labels.csv --baseline always
    python eval_baselines.py labels.csv --baseline nli --out nli.csv
    python eval_baselines.py labels.csv --baseline plain --out plain.csv

- always: "supports" for every pair, the score of a judge that never objects.
- nli: an NLI model reads each passage retrieval gives the judge, with the claim as hypothesis.
  "supports" when a passage entails the claim, "refutes" when one contradicts it and none
  entails it, else "insufficient".
- plain: the judge's model with a one-paragraph prompt instead of the DSPy signature, on the same
  passages, at temperature 0 with thinking off. Not cached, so each run is a fresh run.

The passages are verify.evidence_from's, the text the judge reads; the judge can also read
figures, these baselines cannot. Scores are app.evaluation's, as in eval_verdicts.py, so the
numbers sit side by side. Run it where the worker runs: retrieval needs ColBERT.
"""

import argparse
import csv
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from app.config import VLLM_API_KEY, VLLM_MODEL, VLLM_URL
from app.evaluation import Pair, judge_scores, pairs_from_labels
from app.llm import NO_THINKING
from app.pipeline import verify

NLI_MODEL = "MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli"
PLAIN_PROMPT = """Claim: {claim}

Passages from the cited paper:
{passages}

Do the passages support the claim? Answer with one word: supports, refutes or insufficient."""
PLAIN_WORKERS = 2  # the LLM key allows 3 requests at once and production shares it
MODELS = {"always": None, "nli": NLI_MODEL, "plain": VLLM_MODEL}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("labels", type=Path, help="labels CSV: the Labeler export or the HF split as CSV")
    parser.add_argument("--baseline", choices=["always", "nli", "plain"], required=True)
    parser.add_argument("--split", default="test", help='which split to score ("" for all rows)')
    parser.add_argument("--out", type=Path, help="per-pair verdicts as CSV")
    args = parser.parse_args()

    with args.labels.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    topics = {(row["claim_id"], row["reference_id"]): row.get("topic", "") for row in rows}
    pairs = [
        p
        for p in pairs_from_labels(rows)
        if (not args.split or p.split == args.split) and p.gold() is not None
    ]
    print(f"{len(pairs)} pairs, baseline {args.baseline}", file=sys.stderr)

    verdicts = judge(args.baseline, pairs)
    results = [
        {
            "claim_id": p.claim_id,
            "reference_id": p.reference_id,
            "topic": topics[p.claim_id, p.reference_id],
            "gold": p.gold(),
            "verdict": verdict,
        }
        for p, verdict in zip(pairs, verdicts, strict=True)
    ]
    if args.out:
        with args.out.open("w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=list(results[0]))
            writer.writeheader()
            writer.writerows(results)
    print(json.dumps(report(args.baseline, results), indent=2))


def judge(baseline: str, pairs: list[Pair]) -> list[str]:
    """One verdict per pair: one of verify.LABELS, or "error" when the baseline gave no answer."""
    if baseline == "always":
        return ["supports"] * len(pairs)
    passages = [retrieved_passages(pair) for pair in pairs]
    if baseline == "nli":
        classify = nli_classifier()
        return [nli_verdict(classify, pair.claim, texts) for pair, texts in zip(pairs, passages, strict=True)]
    with ThreadPoolExecutor(max_workers=PLAIN_WORKERS) as pool:
        return list(pool.map(plain_verdict, [pair.claim for pair in pairs], passages))


def retrieved_passages(pair: Pair) -> list[str]:
    """The passages retrieval gives the judge for this pair, text only."""
    return [hit["text"] for hit in verify.evidence_from(pair.claim, f"{pair.reference_id}.pdf")]


def nli_classifier():
    """A function from (premise, hypothesis) pairs to their NLI labels, on the GPU when there is one."""
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(NLI_MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(NLI_MODEL).to(device).eval()

    def classify(premises: list[str], hypothesis: str) -> list[str]:
        inputs = tokenizer(
            premises,
            [hypothesis] * len(premises),
            truncation="only_first",
            max_length=512,
            padding=True,
            return_tensors="pt",
        ).to(device)
        with torch.no_grad():
            predicted = model(**inputs).logits.argmax(dim=-1).tolist()
        return [model.config.id2label[index].lower() for index in predicted]

    return classify


def nli_verdict(classify, claim: str, passages: list[str]) -> str:
    """Return supports if a passage entails the claim, refutes if one contradicts it and none entails it."""
    if not passages:
        return "insufficient"
    labels = classify(passages, claim)
    if "entailment" in labels:
        return "supports"
    return "refutes" if "contradiction" in labels else "insufficient"


def plain_verdict(claim: str, passages: list[str]) -> str:
    """The model's one-word answer to the plain prompt, or "error"."""
    listing = "\n\n".join(f"[{number}] {text}" for number, text in enumerate(passages, 1))
    try:
        response = requests.post(
            f"{VLLM_URL}/chat/completions",
            headers={"Authorization": f"Bearer {VLLM_API_KEY}"},
            json={
                "model": VLLM_MODEL,
                "messages": [{"role": "user", "content": PLAIN_PROMPT.format(claim=claim, passages=listing)}],
                "temperature": 0.0,
                "max_tokens": 10,
                **NO_THINKING,
            },
            timeout=120,
        )
        response.raise_for_status()
    except requests.RequestException as error:
        print(f"plain prompt failed: {error!r}", file=sys.stderr)
        return "error"
    return parsed_label(response.json()["choices"][0]["message"]["content"] or "")


def parsed_label(answer: str) -> str:
    """The first of verify.LABELS in the answer, or "error" when it names none."""
    words = answer.lower().replace(".", " ").split()
    return next((word for word in words if word in verify.LABELS), "error")


def report(baseline: str, results: list[dict]) -> dict:
    """judge_scores overall and per topic, as eval_verdicts.py prints them."""
    answered = [r for r in results if r["verdict"] != "error"]

    def scores(rows: list[dict]) -> dict:
        return judge_scores([r["gold"] for r in rows], [r["verdict"] == "supports" for r in rows])

    return {
        "baseline": baseline,
        "settings": {"model": MODELS[baseline], "evidence_count": verify.EVIDENCE_COUNT},
        "errors": len(results) - len(answered),
        "verdicts": {
            label: sum(r["verdict"] == label for r in results) for label in (*verify.LABELS, "error")
        },
        "judge": scores(answered),
        "judge_by_topic": {
            topic or "(none)": scores([r for r in answered if r["topic"] == topic])
            for topic in sorted({r["topic"] for r in answered})
        },
    }


if __name__ == "__main__":
    main()
