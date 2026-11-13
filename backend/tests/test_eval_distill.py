"""eval_distill.py's Phoenix runs: one per chat and pass, scored on unbacked facts and recall."""

import eval_distill
from app.distill import Fact

CHAT = {"id": "c1", "messages": [], "expected": ["colbert", "bm25"], "forbidden": ["10x faster"]}


def fact(subject: str, summary: str) -> Fact:
    return Fact(kind="concept", subject=subject, summary=summary, lines=[1])


def test_a_chat_is_scored_on_its_unbacked_facts_and_its_recall():
    facts = [fact("ColBERT", "late interaction"), fact("Speed", "ColBERT is 10x faster")]

    run = eval_distill.chat_run(CHAT, facts, "a", 2)

    scores = {score.name: score for score in run.scores}
    assert scores["unbacked"].score == 1.0 and scores["unbacked"].label == "some"
    assert scores["recall"].score == 0.5
    assert run.output["unbacked"] == ["Speed"] and run.repetition == 2


def test_small_talk_gets_no_recall_score():
    small_talk = {**CHAT, "expected": [], "forbidden": []}

    run = eval_distill.chat_run(small_talk, [], "a", 1)

    assert [(score.name, score.label) for score in run.scores] == [("unbacked", "none")]


def test_main_logs_one_run_per_chat_and_pass(monkeypatch, tmp_path):
    import json
    import sys

    chats = [
        {**CHAT, "messages": [{"role": "user", "text": "How does ColBERT score?"}]},
        {"id": "hi", "messages": [], "expected": [], "forbidden": []},
    ]
    path = tmp_path / "sessions.jsonl"
    path.write_text("".join(json.dumps(chat) + "\n" for chat in chats), encoding="utf-8")
    logged = {}

    def log_experiment(dataset, runs, **options):
        logged.update(dataset=dataset, runs=runs, options=options)
        return "exp1"

    monkeypatch.setattr(eval_distill.distill, "distill", lambda lines: [fact("ColBERT", "late interaction")])
    monkeypatch.setattr(eval_distill, "setup_tracing", lambda: False)
    monkeypatch.setattr(eval_distill.dspy, "configure_cache", lambda **settings: None)  # global state
    monkeypatch.setattr(eval_distill, "PHOENIX_COLLECTOR_ENDPOINT", "http://phoenix:6006")
    monkeypatch.setattr(eval_distill, "log_experiment", log_experiment)
    monkeypatch.setattr(sys, "argv", ["eval_distill.py", str(path), "--runs", "2"])

    eval_distill.main()

    runs = logged["runs"]
    assert [(run.input["id"], run.repetition) for run in runs] == [("c1", 1), ("hi", 1), ("c1", 2), ("hi", 2)]
    assert runs[0].output["facts"] == ["ColBERT: late interaction"] and runs[1].output["facts"] == []
    assert {run.input["id"] for run in runs} == {example["id"] for example in logged["dataset"].inputs}
    assert logged["options"]["metadata"]["max_facts"] == eval_distill.distill.MAX_FACTS


def test_the_runs_match_the_chats_in_the_dataset():
    dataset = eval_distill.chats_dataset([CHAT])
    run = eval_distill.chat_run(CHAT, [], "a", 1)

    assert dataset.inputs == [run.input]
    assert dataset.outputs == [{"expected": ["colbert", "bm25"], "forbidden": ["10x faster"]}]
