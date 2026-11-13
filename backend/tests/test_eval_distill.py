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


def test_the_runs_match_the_chats_in_the_dataset():
    dataset = eval_distill.chats_dataset([CHAT])
    run = eval_distill.chat_run(CHAT, [], "a", 1)

    assert dataset.inputs == [run.input]
    assert dataset.outputs == [{"expected": ["colbert", "bm25"], "forbidden": ["10x faster"]}]
