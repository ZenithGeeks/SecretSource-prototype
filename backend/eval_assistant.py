"""Time a checked assistant answer and count the statements the judge cannot back (#504).

    python eval_assistant.py ../docs/eval/assistant-questions.csv --runs 3 --fresh

Each row is a question about one paper. The answer step reads the paper's most relevant
passages and writes short Who / What / When / Where / Why / How statements. Every statement is
then judged against the paper with check_prepared, the same check an analysis runs, up to
PARALLEL_CHECKS at once. A statement the judge does not call "supports" counts as not backed.
Nothing in the app calls this yet: it tests the idea in docs/ideas/secretsource-assistant.md.
"""

import argparse
import csv
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import dspy
from app import store
from app.config import PARALLEL_CHECKS
from app.llm import dspy_lm
from app.pipeline import verify

MAX_STATEMENTS = 6


class AnswerAsStatements(dspy.Signature):
    """Answer the question about one paper using only its passages. Write short statements that
    each say one fact the passages state, covering whichever of who, what, when, where, why and
    how the question asks about."""

    passages: list[str] = dspy.InputField()
    question: str = dspy.InputField()
    statements: list[str] = dspy.OutputField(desc=f"At most {MAX_STATEMENTS} statements, one fact each")


def judge(statements: list[str], paper: str, path: Path) -> list[str]:
    """The judge's verdict on each statement, checked in parallel as an analysis does."""
    with ThreadPoolExecutor(max_workers=PARALLEL_CHECKS) as pool:
        results = pool.map(lambda statement: verify.check_prepared(statement, paper, path), statements)
        return [result.get("verdict", "error") if result["status"] == "ok" else "error" for result in results]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("questions", type=Path, help="CSV with paper, question")
    parser.add_argument("--runs", type=int, default=3, help="how many times to answer every question")
    parser.add_argument(
        "--fresh", action="store_true",
        help="skip the answer cache, so each run asks the LLM again (needed to see run-to-run spread)",
    )
    args = parser.parse_args()

    with args.questions.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    if args.fresh:
        # Neither read nor write: a fresh answer must not replace the one the pipeline uses.
        store.recall_cache = lambda key: None
        store.remember_cache = lambda key, data: None
        dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)

    answer = dspy.Predict(AnswerAsStatements)
    language_model = dspy_lm(max_tokens=600)
    papers = {row["paper"]: verify.prepare_source(row["paper"]) for row in rows}
    for run in range(1, args.runs + 1):
        seconds, verdicts = [], []
        for number, row in enumerate(rows, 1):
            paper = papers[row["paper"]]
            if paper["status"] == "error":
                print(f"run {run} {number}/{len(rows)} skipped: {row['paper']} {paper.get('reason')}")
                continue
            path = Path(paper["path"])
            started = time.perf_counter()
            passages = [item["text"] for item in verify.evidence_from(row["question"], path.name)]
            with dspy.context(lm=language_model):
                statements = answer(passages=passages, question=row["question"]).statements[:MAX_STATEMENTS]
            answered = time.perf_counter()
            row_verdicts = judge(statements, row["paper"], path)
            finished = time.perf_counter()
            seconds.append(finished - started)
            verdicts += row_verdicts
            not_backed = sum(verdict != "supports" for verdict in row_verdicts)
            print(
                f"run {run} {number}/{len(rows)} answer {answered - started:4.1f}s"
                f" + check {finished - answered:4.1f}s = {finished - started:4.1f}s,"
                f" {not_backed}/{len(row_verdicts)} not backed  {row['question']}"
            )
            for statement, verdict in zip(statements, row_verdicts):
                print(f"    {verdict:<12} {statement}")
        not_backed = sum(verdict != "supports" for verdict in verdicts)
        print(
            f"run {run}: median {statistics.median(seconds):.1f}s, slowest {max(seconds):.1f}s,"
            f" not backed {not_backed}/{len(verdicts)} ({not_backed / len(verdicts):.0%})"
        )


if __name__ == "__main__":
    main()
