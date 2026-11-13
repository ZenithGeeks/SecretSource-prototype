"""Score the chat distill step (app/distill.py) on hand-written chats (SPEC.md "Testing strategy").

    python eval_distill.py ../docs/eval/distill/sessions.jsonl --runs 3

Each chat lists `expected` keywords, the subjects a person would want remembered, and
`forbidden` phrases taken from its statements the judge did not back. Per run this prints:
- unbacked facts: kept facts whose subject or summary contains a forbidden phrase. Must be 0.
- recall: expected keywords found in some kept fact of their chat. SPEC.md wants at least 0.7.
- the most facts kept for one chat. Must be at most distill.MAX_FACTS.
- facts kept for chats that expect none (small talk), and prompt and completion tokens per call.

dspy's cache is off, so every run asks the model again and the spread between runs is real.
"""

import argparse
import json
import statistics
from pathlib import Path

import dspy
from app import distill
from app.chats import distill_lines
from app.tracing import setup_tracing
from dspy.clients.base_lm import GLOBAL_HISTORY


def load_chats(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as file:
        return [json.loads(line) for line in file]


def fact_text(fact: distill.Fact) -> str:
    return f"{fact.subject} {fact.summary}".lower()


def score(chats: list[dict], kept: dict[str, list[distill.Fact]]) -> dict:
    """One run's numbers over all chats."""
    unbacked = [
        (chat["id"], fact.subject)
        for chat in chats
        for fact in kept[chat["id"]]
        if any(phrase in fact_text(fact) for phrase in chat["forbidden"])
    ]
    expected = [(chat["id"], keyword) for chat in chats for keyword in chat["expected"]]
    found = [
        (chat_id, keyword)
        for chat_id, keyword in expected
        if any(keyword in fact_text(fact) for fact in kept[chat_id])
    ]
    return {
        "unbacked": unbacked,
        "recall": len(found) / len(expected),
        "missed": sorted(set(expected) - set(found)),
        "most_facts": max(len(facts) for facts in kept.values()),
        "small_talk_facts": sum(len(kept[chat["id"]]) for chat in chats if not chat["expected"]),
    }


def tokens_per_call() -> tuple[float, float]:
    """Mean prompt and completion tokens over the LM calls this process made."""
    usages = [entry["usage"] for entry in GLOBAL_HISTORY if entry.get("usage")]
    if not usages:
        return 0.0, 0.0
    prompt = statistics.mean(usage.get("prompt_tokens", 0) for usage in usages)
    completion = statistics.mean(usage.get("completion_tokens", 0) for usage in usages)
    return prompt, completion


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("chats", type=Path, help="JSON lines with id, messages, expected, forbidden")
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    setup_tracing()

    dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)
    chats = load_chats(args.chats)
    runs = []
    for run in range(1, args.runs + 1):
        kept = {}
        for chat in chats:
            lines = distill_lines(chat["messages"])
            kept[chat["id"]] = distill.distill(lines) if lines else []
        runs.append(score(chats, kept))
        result = runs[-1]
        print(
            f"run {run}: unbacked {len(result['unbacked'])} {result['unbacked']}, "
            f"recall {result['recall']:.3f}, most facts {result['most_facts']}, "
            f"small-talk facts {result['small_talk_facts']}, missed {result['missed']}",
            flush=True,
        )

    recalls = [run["recall"] for run in runs]
    prompt, completion = tokens_per_call()
    print(
        f"\n{len(chats)} chats, {args.runs} runs: unbacked {[len(run['unbacked']) for run in runs]}, "
        f"recall mean {statistics.mean(recalls):.3f} (spread {max(recalls) - min(recalls):.3f}), "
        f"most facts {max(run['most_facts'] for run in runs)}, "
        f"tokens per call {prompt:.0f} prompt / {completion:.0f} completion"
    )


if __name__ == "__main__":
    main()
