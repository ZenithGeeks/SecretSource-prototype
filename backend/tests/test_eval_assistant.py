"""eval_assistant.py's Phoenix runs: what each kind of question is scored on."""

import eval_assistant


def output(*statements: tuple[str, str]) -> dict:
    return {
        "question": "q",
        "statements": [{"text": "s", "source": source, "verdict": verdict} for source, verdict in statements],
        "seconds": 1.0,
    }


def test_an_answer_is_scored_on_the_share_of_backed_statements_and_the_expected_paper():
    row = {"question": "q", "expected": "colbert.pdf|bm25.pdf"}

    answer = output(("colbert.pdf", "supports"), ("x.pdf", "refutes"))

    run = eval_assistant.question_run(3, row, answer, "a", 1)

    assert {score.name: score.score for score in run.scores} == {"backed": 0.5, "cites_expected": 1.0}
    assert run.input == {"row": "3", "question": "q", "expected": "colbert.pdf|bm25.pdf"}


def test_an_out_of_library_question_is_scored_on_declining():
    row = {"question": "q", "answerable": "no"}

    declined = eval_assistant.question_run(1, row, output(), "a", 1)
    answered = eval_assistant.question_run(1, row, output(("x.pdf", "supports")), "a", 1)

    assert [(s.name, s.score) for s in declined.scores] == [("declined", 1.0)]
    assert [(s.name, s.score) for s in answered.scores] == [("declined", 0.0)]


def test_the_dataset_inputs_are_the_rows_the_runs_use():
    rows = [{"question": "q1"}, {"question": "q2", "answerable": "no"}]

    dataset = eval_assistant.questions_dataset("assistant-questions", rows)

    assert dataset.inputs[1] == eval_assistant.question_run(2, rows[1], output(), "a", 1).input
    assert dataset.outputs == [{"answerable": "yes", "expected": ""}, {"answerable": "no", "expected": ""}]
