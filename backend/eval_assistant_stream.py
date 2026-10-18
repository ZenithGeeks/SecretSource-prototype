"""Time a streamed assistant answer whose statements are checked as soon as each one is written.

    python eval_assistant_stream.py ../docs/eval/assistant-library-questions.csv --runs 3 --fresh

eval_assistant.py waits for the whole answer, then checks every statement. Here the answer is
streamed from the LLM, each statement goes to the judge the moment its JSON object closes, and the
script records when the reader would see each step: the first token, the first statement, the
first checked statement and the last one. Questions with no paper only (#506's library set).

The 9arm gateway sends the whole reply at once, so there the first statement arrives just after
the first token, and only the per-statement checking saves time.
"""

import argparse
import ast
import csv
import json
import re
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import dspy
import litellm
from app import store
from app.clients.retrieval import colbert_search
from app.config import PAPERS_DIR, PARALLEL_CHECKS
from app.llm import dspy_lm
from eval_assistant import (
    LIBRARY_PASSAGES,
    MAX_STATEMENTS,
    AnswerFromLibrary,
    Cited,
    Statement,
    check,
    cite,
    prepare_papers,
)

# One finished statement object in the streamed list, e.g. {"text": "...", "passage": 3}.
STATEMENT_OBJECT = re.compile(r"\{[^{}]*\}")
STEPS = ("first token", "first statement", "first checked", "all checked")


def parse_statement(raw: str) -> Statement | None:
    """One streamed statement; DSPy asks for a Python list, so it can come back in either syntax."""
    for load in (json.loads, ast.literal_eval):
        try:
            return Statement.model_validate(load(raw))
        except (ValueError, SyntaxError):
            continue
    return None


def stream_and_check(question: str, language_model: dspy.LM) -> tuple[list[Cited], list[str], dict]:
    """Stream one answer and judge each statement as it arrives.

    Returns the statements, their verdicts, and the seconds from the start to each of STEPS.
    """
    started = time.perf_counter()
    hits = colbert_search(question, k=LIBRARY_PASSAGES)
    numbered = [f"[{number}] {hit['text']}" for number, hit in enumerate(hits, 1)]
    messages = dspy.ChatAdapter().format(
        AnswerFromLibrary, demos=[], inputs={"passages": numbered, "question": question}
    )
    reached, cited, checks, written = {}, [], [], ""
    with ThreadPoolExecutor(max_workers=PARALLEL_CHECKS) as pool:
        stream = litellm.completion(
            model=language_model.model, messages=messages, stream=True, **language_model.kwargs
        )
        for chunk in stream:
            written += chunk.choices[0].delta.content or ""
            if written:
                reached.setdefault("first token", time.perf_counter() - started)
            body = written.partition("[[ ## statements ## ]]")[2]
            for raw in STATEMENT_OBJECT.findall(body)[len(cited):MAX_STATEMENTS]:
                statement = parse_statement(raw) or Statement(text=raw, passage=0)
                # The papers were indexed before timing, so this only looks up the path.
                item = prepare_papers([cite(statement, hits)])[0]
                cited.append(item)
                checks.append(pool.submit(check, item))
                reached.setdefault("first statement", time.perf_counter() - started)
        for _ in as_completed(checks):
            reached.setdefault("first checked", time.perf_counter() - started)
        reached["all checked"] = time.perf_counter() - started
    return cited, [future.result() for future in checks], reached


def index_library_papers(rows: list[dict]) -> None:
    """Download and index every paper the questions can reach, so no answer waits for it."""
    for row in rows:
        hits = colbert_search(row["question"], k=LIBRARY_PASSAGES)
        prepare_papers([(hit["text"], hit["source"], PAPERS_DIR / hit["source"]) for hit in hits])


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
    language_model = dspy_lm(max_tokens=600)
    index_library_papers(rows)
    for run in range(1, args.runs + 1):
        times, verdicts = {step: [] for step in STEPS}, []
        for number, row in enumerate(rows, 1):
            cited, row_verdicts, reached = stream_and_check(row["question"], language_model)
            answerable = row.get("answerable", "yes") != "no"
            if answerable:
                verdicts += row_verdicts
                for step in STEPS:
                    if step in reached:
                        times[step].append(reached[step])
            steps = ", ".join(f"{step} {reached[step]:4.1f}s" for step in STEPS if step in reached)
            print(f"run {run} {number}/{len(rows)} {steps}, {len(cited)} statements  {row['question']}")
            for (text, source, _), verdict in zip(cited, row_verdicts, strict=True):
                print(f"    {verdict:<12} {text}  [{source}]")
        not_backed = sum(verdict != "supports" for verdict in verdicts)
        medians = ", ".join(f"{step} {statistics.median(times[step]):.1f}s" for step in STEPS if times[step])
        print(
            f"run {run}, answerable questions: median {medians}; slowest all checked"
            f" {max(times['all checked']):.1f}s; not backed {not_backed}/{len(verdicts)}"
        )


if __name__ == "__main__":
    main()
