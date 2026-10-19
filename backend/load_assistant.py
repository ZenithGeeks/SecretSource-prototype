"""Time several people chatting with the assistant at once, through the gateway's chat routes (#533).

    python load_assistant.py http://localhost:8081 ../docs/eval/assistant-*questions.csv --users 5

Each user starts a chat and asks its share of the questions one after another, so `--users`
questions are in flight at once. A question that names a paper is asked from that paper's
analysis, which GET /analyses must list; any other is asked from the library. For each answer
it records when the first statement and the last verdict arrived. It reads /metrics before and
after, for the LLM calls refused with HTTP 429 and the time calls waited for one of the
LLM_PARALLEL_REQUESTS slots.
"""

import argparse
import csv
import json
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import requests
from prometheus_client.parser import text_string_to_metric_families

TARGET_SECONDS = 20  # the one-pager's target for a checked answer
SLOW_SLOT_SECONDS = 5  # a slot wait this long is most of a judge call


@dataclass
class Question:
    text: str
    paper: str = ""  # an arXiv id from the CSV; empty for a library question
    answerable: bool = True


@dataclass
class Answer:
    question: Question
    first_statement: float | None = None  # seconds from sending the question
    last_verdict: float | None = None
    verdicts: list[str] = field(default_factory=list)
    error: str = ""


def load_questions(paths: list[Path]) -> list[Question]:
    """The rows of the eval CSVs: question, and optionally paper and answerable."""
    questions = []
    for path in paths:
        with path.open(newline="", encoding="utf-8") as file:
            for row in csv.DictReader(file):
                questions.append(
                    Question(row["question"], row.get("paper", ""), row.get("answerable", "yes") != "no")
                )
    return questions


def ask(session: requests.Session, chat_url: str, question: Question, analysis: str | None) -> Answer:
    """Ask one question and time the events of its answer."""
    answer = Answer(question)
    body = {"question": question.text, "context": {"analysis": analysis} if analysis else {}}
    started = time.perf_counter()
    with session.post(f"{chat_url}/messages", json=body, stream=True, timeout=600) as reply:
        if reply.status_code != 200:
            answer.error = f"HTTP {reply.status_code}"
            return answer
        for line in reply.iter_lines(decode_unicode=True):
            if not line.startswith("data: "):
                continue  # a keep-alive comment or a blank separator
            event = json.loads(line[6:])
            if event["type"] == "statement" and answer.first_statement is None:
                answer.first_statement = time.perf_counter() - started
            elif event["type"] == "verdict":
                answer.verdicts.append(event["verdict"])
            elif event["type"] == "error":
                answer.error = event["message"]
    answer.last_verdict = time.perf_counter() - started
    return answer


def user(url: str, headers: dict, questions: list[Question], analyses: dict[str, str]) -> list[Answer]:
    """One person: one chat, its questions asked one after another."""
    with requests.Session() as session:
        session.headers.update(headers)
        chat_id = session.post(f"{url}/assistant/chats", json={}, timeout=60).json()["id"]
        chat_url = f"{url}/assistant/chats/{chat_id}"
        return [ask(session, chat_url, question, analyses.get(question.paper)) for question in questions]


def analyses_by_paper(url: str, headers: dict) -> dict[str, str]:
    """The analysis id for each paper the caller has analysed, keyed by its paper reference."""
    rows = requests.get(f"{url}/analyses", headers=headers, timeout=60).json()
    return {row["paper"]: row["id"] for row in rows if row.get("status") == "done"}


def llm_metrics(url: str) -> dict[str, float]:
    """The 429 count and the slot-wait histogram from the gateway's /metrics."""
    found = {}
    for family in text_string_to_metric_families(requests.get(f"{url}/metrics", timeout=60).text):
        for sample in family.samples:
            if sample.name == "llm_rate_limited_total":
                found["429"] = sample.value
            elif sample.name == "llm_slot_wait_seconds_count":
                found["waits"] = sample.value
            elif sample.name == "llm_slot_wait_seconds_sum":
                found["wait_seconds"] = sample.value
            elif sample.name == "llm_slot_wait_seconds_bucket" and sample.labels["le"] == str(
                float(SLOW_SLOT_SECONDS)
            ):
                found["fast_waits"] = sample.value
    return found


def spread(values: list[float]) -> str:
    if not values:
        return "none"
    ordered = sorted(values)
    p90 = ordered[min(len(ordered) - 1, round(0.9 * (len(ordered) - 1)))]
    return f"median {statistics.median(ordered):.1f}s, p90 {p90:.1f}s, slowest {ordered[-1]:.1f}s"


def report(answers: list[Answer], before: dict, after: dict, seconds: float) -> None:
    done = [answer for answer in answers if not answer.error]
    answerable = [answer for answer in done if answer.question.answerable]
    verdicts = [verdict for answer in answerable for verdict in answer.verdicts]
    not_backed = sum(verdict != "supports" for verdict in verdicts)
    over = sum(answer.last_verdict > TARGET_SECONDS for answer in done)
    waits = after.get("waits", 0) - before.get("waits", 0)
    slow = waits - (after.get("fast_waits", 0) - before.get("fast_waits", 0))
    wait_seconds = after.get("wait_seconds", 0) - before.get("wait_seconds", 0)
    print(f"{len(answers)} answers in {seconds:.0f}s, {len(answers) - len(done)} failed")
    for answer in answers:
        if answer.error:
            print(f"    failed: {answer.error}  {answer.question.text}")
    print(f"first statement: {spread([a.first_statement for a in done if a.first_statement is not None])}")
    print(f"last verdict:    {spread([answer.last_verdict for answer in done])}")
    print(f"over {TARGET_SECONDS}s: {over}/{len(done)}")
    print(f"not backed: {not_backed}/{len(verdicts)} ({not_backed / max(len(verdicts), 1):.0%})")
    print(f"HTTP 429: {after.get('429', 0) - before.get('429', 0):.0f}")
    print(
        f"slot waits: {waits:.0f} calls, mean {wait_seconds / max(waits, 1):.1f}s,"
        f" {slow:.0f} over {SLOW_SLOT_SECONDS}s"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("url", help="the gateway, for example http://localhost:8081")
    parser.add_argument("questions", type=Path, nargs="+", help="docs/eval/assistant-*questions.csv")
    parser.add_argument("--users", type=int, default=5, help="how many people chat at once")
    parser.add_argument("--token", default="", help="a Supabase access token; leave empty with login off")
    args = parser.parse_args()

    headers = {"Authorization": f"Bearer {args.token}"} if args.token else {}
    questions = load_questions(args.questions)
    analyses = analyses_by_paper(args.url, headers)
    missing = {question.paper for question in questions if question.paper and question.paper not in analyses}
    if missing:
        raise SystemExit(f"no finished analysis for {sorted(missing)}: analyse them first, or seed them")
    shares = [questions[number :: args.users] for number in range(args.users)]
    before = llm_metrics(args.url)
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.users) as pool:
        futures = [pool.submit(user, args.url, headers, share, analyses) for share in shares]
        answers = [answer for future in futures for answer in future.result()]
    report(answers, before, llm_metrics(args.url), time.perf_counter() - started)


if __name__ == "__main__":
    main()
