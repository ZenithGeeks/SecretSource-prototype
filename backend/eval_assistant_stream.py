"""Time a streamed assistant answer whose statements are checked as soon as the answer is written.

    python eval_assistant_stream.py ../docs/eval/assistant-library-questions.csv --runs 3 --fresh

eval_assistant.py waits for every check, then reports. Here the events of app/assistant.py's
answer() are timed as a reader would see them: the first statement, the first checked statement
and the last one. Questions with no paper only (#506's library set).

The 9arm gateway sends the whole reply at once, so the first statement arrives with the whole
answer, and only checking each statement as its own task saves time. #506 also timed the first
token of a streamed reply; answer() does not stream tokens, since 9arm buffers them anyway.
"""

import argparse
import asyncio
import csv
import statistics
import time
from pathlib import Path

import dspy
from app import assistant, store
from app.assistant import Cited
from app.config import PAPERS_DIR
from eval_assistant import prepare_papers

STEPS = ("first statement", "first checked", "all checked")


async def answer_and_time(question: str) -> tuple[list[str], list[str], dict]:
    """One answer through assistant.answer().

    Returns the statements, their verdicts, and the seconds from the start to each of STEPS.
    """
    started = time.perf_counter()
    reached, statements, verdicts = {}, [], {}
    async for event in assistant.answer(question):
        if event["type"] == "statement":
            reached.setdefault("first statement", time.perf_counter() - started)
            statements.append(f"{event['text']}  [{event['source']}]")
        elif event["type"] == "verdict":
            reached.setdefault("first checked", time.perf_counter() - started)
            verdicts[event["index"]] = event["verdict"]
    reached["all checked"] = time.perf_counter() - started
    return statements, [verdicts[index] for index in range(len(statements))], reached


def index_library_papers(rows: list[dict]) -> None:
    """Download and index every paper the questions can reach, so no answer waits for it."""
    for row in rows:
        hits = assistant.library_passages(row["question"])
        prepare_papers([Cited(hit["text"], hit["source"], PAPERS_DIR / hit["source"]) for hit in hits])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("questions", type=Path, help="CSV with question and answerable")
    parser.add_argument("--runs", type=int, default=3, help="how many times to answer every question")
    parser.add_argument(
        "--fresh", action="store_true",
        help="skip the answer cache, so each run asks the LLM again (needed to see run-to-run spread)",
    )
    args = parser.parse_args()

    with args.questions.open(newline="", encoding="utf-8") as file:
        rows = [row for row in csv.DictReader(file) if not row.get("paper")]
    if args.fresh:
        # Neither read nor write: a fresh answer must not replace the one the pipeline uses.
        store.recall_cache = lambda key: None
        store.remember_cache = lambda key, data: None
        dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)
    index_library_papers(rows)
    for run in range(1, args.runs + 1):
        times, verdicts = {step: [] for step in STEPS}, []
        for number, row in enumerate(rows, 1):
            statements, row_verdicts, reached = asyncio.run(answer_and_time(row["question"]))
            answerable = row.get("answerable", "yes") != "no"
            if answerable:
                verdicts += row_verdicts
                for step in STEPS:
                    if step in reached:
                        times[step].append(reached[step])
            steps = ", ".join(f"{step} {reached[step]:4.1f}s" for step in STEPS if step in reached)
            print(f"run {run} {number}/{len(rows)} {steps}, {len(statements)} statements  {row['question']}")
            for statement, verdict in zip(statements, row_verdicts, strict=True):
                print(f"    {verdict:<12} {statement}")
        not_backed = sum(verdict != "supports" for verdict in verdicts)
        medians = ", ".join(f"{step} {statistics.median(times[step]):.1f}s" for step in STEPS if times[step])
        print(
            f"run {run}, answerable questions: median {medians}; slowest all checked"
            f" {max(times['all checked']):.1f}s; not backed {not_backed}/{len(verdicts)}"
        )


if __name__ == "__main__":
    main()
