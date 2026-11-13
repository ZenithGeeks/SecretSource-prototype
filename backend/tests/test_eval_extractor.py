"""eval_extractor.py's Phoenix runs: one per paper, variant and pass, with the shares as scores."""

import eval_extractor
from eval_extractor import Paper

PAPER = Paper("data/papers/2112.01488.pdf", {}, "", ["a [b1].", "b [b2]."])
COUNTS = {
    "windows": 2, "sentences": 4, "covered": 3, "claims": 0, "citing": 0,
    "located": 0, "repeats": 0, "kept": 0, "failed": 1, "seconds": 12.345,
}  # fmt: skip


def test_each_share_with_a_nonzero_whole_becomes_a_score():
    run = eval_extractor.paper_run(PAPER, COUNTS, "a", 2)

    assert {score.name: score.score for score in run.scores} == {"covered": 0.75, "failed": 0.5}
    assert run.input == {"paper": "2112.01488.pdf"} and run.output["seconds"] == 12.3


def test_the_dataset_holds_each_papers_citing_sentences():
    dataset = eval_extractor.papers_dataset([PAPER])

    assert dataset.inputs == [{"paper": "2112.01488.pdf"}]
    assert dataset.outputs == [{"citing_sentences": 2}]
