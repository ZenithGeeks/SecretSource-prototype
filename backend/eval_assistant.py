"""Time a checked assistant answer and count the statements the judge cannot back (#504, #506).

    python eval_assistant.py ../docs/eval/assistant-questions.csv --runs 3 --fresh
    python eval_assistant.py ../docs/eval/assistant-library-questions.csv --runs 3 --fresh
    python eval_assistant.py ../docs/eval/assistant-memory-questions.csv --runs 2 --fresh [--no-memory]
    python eval_assistant.py ../docs/eval/assistant-follow-up-questions.csv --runs 2 --fresh [--no-rewrite]

A row with a paper is answered from that paper's most relevant passages. A row without one is
answered from the whole ColBERT index, and each statement names the passage it rests on. Every
statement is then judged against its paper with check_prepared, the same check an analysis runs,
up to PARALLEL_CHECKS at once. A statement the judge does not call "supports" counts as not backed.
A row marked answerable=no asks about something outside the library: the right answer is no
statements. A row with `remembered` passes that fact to the answer step, as Ask does with the
user's matching facts; --no-memory leaves it out, so the same rows show what the fact changed.
A row with `earlier` is a follow-up to that question: it is rewritten to stand alone first, as
Ask does, unless --no-rewrite. `expected` lists the papers (separated by |) a good answer cites.
The answer and the checks are app/assistant.py's; this script only times them.
"""

import argparse
import csv
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import dspy
from app import assistant, store
from app.assistant import Cited
from app.config import PARALLEL_CHECKS
from app.pipeline import verify


def prepare_papers(cited: list[Cited]) -> list[Cited]:
    """The same statements, each pointing at its paper once downloaded and indexed.

    In the app a library paper is indexed when it is added, so main leaves this out of the
    answer time. A paper that cannot be prepared gets no path, and its statements go unchecked.
    """
    return [assistant.prepare(fetch(item)) for item in cited]


def fetch(item: Cited) -> Cited:
    """The same statement, with its PDF downloaded by name when this container has none.

    ColBERT can hold papers this container never downloaded. The app does not fetch them:
    there every library paper is on disk, and a name could fetch a different paper.
    """
    if item.path is None or item.path.is_file():
        return item
    fetched = verify.prepare_source(item.path.stem)
    return item._replace(path=Path(fetched["path"]) if fetched["status"] == "ok" else None)


def judge(cited: list[Cited]) -> list[str]:
    """The judge's verdict on each statement, checked in parallel as an analysis does."""
    with ThreadPoolExecutor(max_workers=PARALLEL_CHECKS) as pool:
        return [result["verdict"] for result in pool.map(assistant.check, cited)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "questions",
        type=Path,
        help="CSV with question, and optionally paper, answerable, remembered, earlier and expected",
    )
    parser.add_argument("--runs", type=int, default=3, help="how many times to answer every question")
    parser.add_argument(
        "--fresh", action="store_true",
        help="skip the answer cache, so each run asks the LLM again (needed to see run-to-run spread)",
    )
    parser.add_argument("--no-memory", action="store_true", help="ignore the remembered column")
    parser.add_argument("--no-rewrite", action="store_true", help="answer follow-ups as typed")
    args = parser.parse_args()

    with args.questions.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    if args.fresh:
        # Neither read nor write: a fresh answer must not replace the one the pipeline uses.
        store.recall_cache = lambda key: None
        store.remember_cache = lambda key, data: None
        dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)

    papers = {row["paper"]: verify.prepare_source(row["paper"]) for row in rows if row.get("paper")}
    for run in range(1, args.runs + 1):
        seconds, verdicts, declined, outside, on_paper, expected = [], [], 0, 0, 0, 0
        for number, row in enumerate(rows, 1):
            remembered = [row["remembered"]] if row.get("remembered") and not args.no_memory else None
            started = time.perf_counter()
            question = row["question"]
            if row.get("earlier") and not args.no_rewrite:
                question = assistant.standalone_question(question, [f"user asked: {row['earlier']}"])
            if row.get("paper"):
                paper = papers[row["paper"]]
                if paper["status"] == "error":
                    print(f"run {run} {number}/{len(rows)} skipped: {row['paper']} {paper.get('reason')}")
                    continue
                cited = assistant.answer_about_paper(question, row["paper"], Path(paper["path"]), remembered)
            else:
                cited = assistant.answer_from_library(question, remembered=remembered)
            answered = time.perf_counter()
            cited = prepare_papers(cited)
            checking = time.perf_counter()
            row_verdicts = judge(cited)
            finished = time.perf_counter()
            # Time without prepare_papers: in the app the library is indexed already.
            finished -= checking - answered
            seconds.append(finished - started)
            if row.get("answerable", "yes") == "no":
                outside += 1
                declined += not cited
            else:
                verdicts += row_verdicts
            if row.get("expected"):
                expected += 1
                on_paper += any(item.source in row["expected"].split("|") for item in cited)
            not_backed = sum(verdict != "supports" for verdict in row_verdicts)
            print(
                f"run {run} {number}/{len(rows)} answer {answered - started:4.1f}s"
                f" + check {finished - answered:4.1f}s = {finished - started:4.1f}s,"
                f" {not_backed}/{len(row_verdicts)} not backed  {row['question']}"
            )
            if question != row["question"]:
                print(f"    rewritten: {question}")
            for item, verdict in zip(cited, row_verdicts, strict=True):
                print(f"    {verdict:<12} {item.text}  [{item.source}]")
        not_backed = sum(verdict != "supports" for verdict in verdicts)
        summary = (
            f"run {run}: median {statistics.median(seconds):.1f}s, slowest {max(seconds):.1f}s,"
            f" not backed {not_backed}/{len(verdicts)} ({not_backed / max(len(verdicts), 1):.0%})"
        )
        if outside:
            summary += f", out-of-library questions with no statements {declined}/{outside}"
        if expected:
            summary += f", answers citing the expected paper {on_paper}/{expected}"
        print(summary)


if __name__ == "__main__":
    main()
