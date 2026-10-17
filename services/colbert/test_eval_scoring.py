"""The retrieval eval's scoring (services/colbert/eval/): MaxSim over a padded paper and the metrics.
Needs torch, like test_store.py: rank_passages.py loads the encoder module."""

import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).parent / "eval"))
import rank_passages  # noqa: E402
import score_retrieval  # noqa: E402


def test_maxsim_ignores_padding_rows():
    query = torch.tensor([[1.0, 0.0], [0.0, 1.0]])
    docs = torch.tensor([[[1.0, 0.0], [0.0, 1.0]], [[1.0, 0.0], [0.0, 0.0]]])
    mask = torch.tensor([[True, True], [True, False]])  # the second doc has one real token

    scores = rank_passages.maxsim(query, docs, mask)

    # doc 0 matches both query tokens (1 + 1); doc 1 only the first, its padding row cannot score
    assert scores.tolist() == [2.0, 1.0]


def test_metrics_for_a_gold_passage_at_rank_three():
    row = score_retrieval.metrics([7, 2, 5, 9], {5})

    assert (row["R@1"], row["R@4"], row["R@10"]) == (0.0, 1.0, 1.0)
    assert row["MRR"] == pytest.approx(1 / 3)
    assert row["nDCG@10"] == pytest.approx(0.5)  # 1 / log2(3 + 1)


def test_metrics_when_the_gold_passage_is_missing():
    row = score_retrieval.metrics([1, 2, 3], {9})

    assert row["R@10"] == 0.0 and row["MRR"] == 0.0 and row["nDCG@10"] == 0.0
