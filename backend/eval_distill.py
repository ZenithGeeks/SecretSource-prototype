"""Score the chat distill step (app/distill.py) on hand-written chats (SPEC.md "Testing strategy").

    python eval_distill.py ../docs/eval/distill/sessions.jsonl --runs 3

Each chat lists `expected` keywords, the subjects a person would want remembered, and
`forbidden` phrases taken from its statements the judge did not back. Per run this prints:
- unbacked facts: kept facts whose subject or summary contains a forbidden phrase. Must be 0.
- recall: expected keywords found in some kept fact of their chat. SPEC.md wants at least 0.7.
- the most facts kept for one chat. Must be at most distill.MAX_FACTS.
- facts kept for chats that expect none (small talk), and prompt and completion tokens per call.

dspy's cache is off, so every run asks the model again and the spread between runs is real.
With PHOENIX_COLLECTOR_ENDPOINT set, the runs are saved as one Phoenix experiment.
"""

import argparse
import json
import statistics
from datetime import UTC, datetime
from pathlib import Path

import dspy
from app import distill
from app.chats import distill_lines
from app.config import PHOENIX_COLLECTOR_ENDPOINT, VLLM_MODEL
from app.experiments import Dataset, Run, Score, dataset_name, log_experiment, source_sha
from app.tracing import setup_tracing
from dspy.clients.base_lm import GLOBAL_HISTORY


def load_chats(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as file:
        return [json.loads(line) for line in file]


def fact_text(fact: distill.Fact) -> str:
    return f"{fact.subject} {fact.summary}".lower()


def unbacked_subjects(chat: dict, facts: list[distill.Fact]) -> list[str]:
    """Subjects of the kept facts that contain one of the chat's forbidden phrases."""
    return [fact.subject for fact in facts if any(phrase in fact_text(fact) for phrase in chat["forbidden"])]


def found_keywords(chat: dict, facts: list[distill.Fact]) -> list[str]:
    """The chat's expected keywords that appear in some kept fact."""
    return [keyword for keyword in chat["expected"] if any(keyword in fact_text(fact) for fact in facts)]


def score(chats: list[dict], kept: dict[str, list[distill.Fact]]) -> dict:
    """One run's numbers over all chats."""
    unbacked = [
        (chat["id"], subject) for chat in chats for subject in unbacked_subjects(chat, kept[chat["id"]])
    ]
    expected = [(chat["id"], keyword) for chat in chats for keyword in chat["expected"]]
    found = [(chat["id"], keyword) for chat in chats for keyword in found_keywords(chat, kept[chat["id"]])]
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
    runs, results = [], []
    for run in range(1, args.runs + 1):
        kept = {}
        for chat in chats:
            started = datetime.now(UTC).isoformat()
            lines = distill_lines(chat["messages"])
            kept[chat["id"]] = distill.distill(lines) if lines else []
            results.append(chat_run(chat, kept[chat["id"]], started, run))
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
    if PHOENIX_COLLECTOR_ENDPOINT:
        sha = source_sha(distill)
        experiment_id = log_experiment(
            chats_dataset(chats),
            results,
            name=f"{VLLM_MODEL} distill {sha}",
            description=f"eval_distill.py {args.chats.name}, {args.runs} runs",
            metadata={"model": VLLM_MODEL, "distill_py_sha256": sha, "max_facts": distill.MAX_FACTS},
        )
        print(f"Phoenix experiment {experiment_id}")


def chat_input(chat: dict) -> dict:
    """A chat's dataset input."""
    return {"id": chat["id"], "messages": chat["messages"]}


def chats_dataset(chats: list[dict]) -> Dataset:
    """The chats as a Phoenix dataset, with the keywords to keep and the phrases to drop."""
    inputs = [chat_input(chat) for chat in chats]
    outputs = [{"expected": chat["expected"], "forbidden": chat["forbidden"]} for chat in chats]
    return Dataset(
        name=dataset_name("distill-chats", inputs + outputs),
        description="Hand-written chats: expected keywords should be kept, forbidden phrases never.",
        inputs=inputs,
        outputs=outputs,
        metadata=[{} for _ in chats],
        splits=[None] * len(chats),
    )


def chat_run(chat: dict, facts: list[distill.Fact], started: str, repetition: int) -> Run:
    """One chat's kept facts in one run, scored on `unbacked` facts and, if it expects any, `recall`."""
    unbacked = unbacked_subjects(chat, facts)
    scores = [Score(name="unbacked", score=float(len(unbacked)), label="some" if unbacked else "none")]
    if chat["expected"]:
        scores.append(Score(name="recall", score=len(found_keywords(chat, facts)) / len(chat["expected"])))
    output = {"facts": [f"{fact.subject}: {fact.summary}" for fact in facts], "unbacked": unbacked}
    ended = datetime.now(UTC).isoformat()
    return Run(chat_input(chat), output, started, ended, scores=scores, repetition=repetition)


if __name__ == "__main__":
    main()
