"""eval_decisive.py's Phoenix runs: a row is `kept` only when its verdict is the expected one."""

import eval_decisive

CASE = {"claim": "a claim", "source": "ref.pdf", "expected": "supports"}


def test_a_row_is_kept_only_when_its_verdict_is_the_expected_one():
    kept = eval_decisive.row_run(1, CASE, "supports", "t0", repetition=2)
    changed = eval_decisive.row_run(1, CASE, "insufficient", "t0", repetition=2)
    failed = eval_decisive.row_run(1, CASE, "error: no_pdf ", "t0", repetition=2)

    assert kept.scores[0].label == "kept" and kept.repetition == 2
    assert changed.scores[0].label == "changed"
    assert failed.scores == [] and failed.error == "error: no_pdf "


def test_two_rows_with_the_same_claim_and_source_stay_apart():
    dataset = eval_decisive.cases_dataset([CASE, CASE])

    assert [example["row"] for example in dataset.inputs] == ["1", "2"]
    assert dataset.outputs == [{"expected": "supports"}, {"expected": "supports"}]
