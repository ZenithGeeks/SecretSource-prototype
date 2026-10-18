"""Time a checked assistant answer and count the statements the judge cannot back (#504, #506).

    python eval_assistant.py ../docs/eval/assistant-questions.csv --runs 3 --fresh
    python eval_assistant.py ../docs/eval/assistant-library-questions.csv --runs 3 --fresh

A row with a paper is answered from that paper's most relevant passages. A row without one is
answered from the whole ColBERT index, and each statement names the passage it rests on. Every
statement is then judged against its paper with check_prepared, the same check an analysis runs,
up to PARALLEL_CHECKS at once. A statement the judge does not call "supports" counts as not backed.
A row marked answerable=no asks about something outside the library: the right answer is no
statements. Nothing in the app calls this yet: it tests docs/ideas/secretsource-assistant.md.
"""

import argparse
import csv
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import dspy
from app import store
from app.clients.retrieval import colbert_search
from app.config import PAPERS_DIR, PARALLEL_CHECKS
from app.llm import dspy_lm
from app.pipeline import verify
from pydantic import BaseModel, Field

MAX_STATEMENTS = 6
LIBRARY_PASSAGES = 8  # several papers can share the answer, so more than one paper's EVIDENCE_COUNT


class AnswerAsStatements(dspy.Signature):
    """Answer the question about one paper using only its passages. Write short statements that
    each say one fact the passages state, covering whichever of who, what, when, where, why and
    how the question asks about."""

    passages: list[str] = dspy.InputField()
    question: str = dspy.InputField()
    statements: list[str] = dspy.OutputField(desc=f"At most {MAX_STATEMENTS} statements, one fact each")


class Statement(BaseModel):
    text: str
    passage: int = Field(description="The number of the passage this statement rests on")


class AnswerFromLibrary(dspy.Signature):
    """Answer the question using only the numbered passages, which can come from several papers.
    Write short statements that each say one fact a passage states, and give that passage's
    number. Return no statements when the passages do not answer the question."""

    passages: list[str] = dspy.InputField()
    question: str = dspy.InputField()
    statements: list[Statement] = dspy.OutputField(desc=f"At most {MAX_STATEMENTS}, one fact each")


# One statement and the paper it is judged against: (text, source label, PDF path or None).
Cited = tuple[str, str, Path | None]


def answer_about_paper(question: str, paper: str, path: Path) -> list[Cited]:
    """Statements from one paper's passages, each judged against that paper."""
    passages = [item["text"] for item in verify.evidence_from(question, path.name)]
    statements = dspy.Predict(AnswerAsStatements)(passages=passages, question=question).statements
    return [(text, paper, path) for text in statements[:MAX_STATEMENTS]]


def answer_from_library(question: str) -> list[Cited]:
    """Statements from the whole index, each judged against the paper of the passage it names."""
    hits = colbert_search(question, k=LIBRARY_PASSAGES)
    numbered = [f"[{number}] {hit['text']}" for number, hit in enumerate(hits, 1)]
    statements = dspy.Predict(AnswerFromLibrary)(passages=numbered, question=question).statements
    cited = []
    for statement in statements[:MAX_STATEMENTS]:
        if 1 <= statement.passage <= len(hits):
            source = hits[statement.passage - 1]["source"]
            cited.append((statement.text, source, PAPERS_DIR / source))
        else:
            cited.append((statement.text, f"passage {statement.passage}", None))
    return cited


_prepared: dict[str, Path | None] = {}


def prepare_papers(cited: list[Cited]) -> list[Cited]:
    """The same statements, each pointing at its paper once downloaded and indexed.

    In the app a library paper is indexed when it is added, so main leaves this out of the
    answer time. A paper that cannot be prepared gets no path, and its statements go unchecked.
    """
    ready = []
    for text, source, path in cited:
        if path is not None and source not in _prepared:
            # ColBERT can hold a paper this container has no PDF of; then fetch it by its name.
            prepared = verify.prepare_source(path.as_posix() if path.exists() else path.stem)
            _prepared[source] = Path(prepared["path"]) if prepared["status"] == "ok" else None
        ready.append((text, source, _prepared[source] if path is not None else None))
    return ready


def judge(cited: list[Cited]) -> list[str]:
    """The judge's verdict on each statement, checked in parallel as an analysis does."""

    def check(item: Cited) -> str:
        text, source, path = item
        if path is None:
            return "unchecked"
        result = verify.check_prepared(text, source, path)
        return result.get("verdict", "error") if result["status"] == "ok" else "error"

    with ThreadPoolExecutor(max_workers=PARALLEL_CHECKS) as pool:
        return list(pool.map(check, cited))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("questions", type=Path, help="CSV with question, and optionally paper and answerable")
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

    language_model = dspy_lm(max_tokens=600)
    papers = {row["paper"]: verify.prepare_source(row["paper"]) for row in rows if row.get("paper")}
    for run in range(1, args.runs + 1):
        seconds, verdicts, declined, outside = [], [], 0, 0
        for number, row in enumerate(rows, 1):
            started = time.perf_counter()
            with dspy.context(lm=language_model):
                if row.get("paper"):
                    paper = papers[row["paper"]]
                    if paper["status"] == "error":
                        print(f"run {run} {number}/{len(rows)} skipped: {row['paper']} {paper.get('reason')}")
                        continue
                    cited = answer_about_paper(row["question"], row["paper"], Path(paper["path"]))
                else:
                    cited = answer_from_library(row["question"])
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
            not_backed = sum(verdict != "supports" for verdict in row_verdicts)
            print(
                f"run {run} {number}/{len(rows)} answer {answered - started:4.1f}s"
                f" + check {finished - answered:4.1f}s = {finished - started:4.1f}s,"
                f" {not_backed}/{len(row_verdicts)} not backed  {row['question']}"
            )
            for (text, source, _), verdict in zip(cited, row_verdicts, strict=True):
                print(f"    {verdict:<12} {text}  [{source}]")
        not_backed = sum(verdict != "supports" for verdict in verdicts)
        summary = (
            f"run {run}: median {statistics.median(seconds):.1f}s, slowest {max(seconds):.1f}s,"
            f" not backed {not_backed}/{len(verdicts)} ({not_backed / max(len(verdicts), 1):.0%})"
        )
        if outside:
            summary += f", out-of-library questions with no statements {declined}/{outside}"
        print(summary)


if __name__ == "__main__":
    main()
