"""vectorfiles.py: local PaperFiles and the maxsim scoring function."""

import os
import time

import torch
import vectorfiles
from vectorfiles import Paper, PaperFiles, maxsim


def _unit(n: int, dim: int = 8) -> torch.Tensor:
    vectors = torch.randn(n, dim)
    return torch.nn.functional.normalize(vectors, dim=-1)


def _rows(n: int) -> list[dict]:
    return [{"text": f"passage {i}", "page": 1, "start": i, "end": i + 1} for i in range(n)]


# --- round trip, local mode --------------------------------------------------


def test_write_then_load_round_trips_rows_and_vectors(tmp_path):
    files = PaperFiles(str(tmp_path), "colbert")
    rows = _rows(3)
    vectors = [_unit(2), _unit(1), _unit(3)]

    files.write("paper.pdf", rows, vectors, "hash-1")
    paper = files.load("paper.pdf")

    assert paper is not None
    assert paper.rows == rows
    expected = torch.cat(vectors, dim=0)
    # fp16 storage: compare with the tolerance that round trip costs.
    assert torch.allclose(paper.vectors.float(), expected, atol=1e-3)
    assert paper.row_index.tolist() == [0, 0, 1, 2, 2, 2]


def test_stored_hash_without_loading_vectors(tmp_path):
    files = PaperFiles(str(tmp_path), "colbert")
    assert files.stored_hash("nope.pdf") == (None, 0)

    files.write("paper.pdf", _rows(2), [_unit(1), _unit(1)], "hash-1")
    assert files.stored_hash("paper.pdf") == ("hash-1", 2)


def test_sources_lists_every_stored_paper(tmp_path):
    files = PaperFiles(str(tmp_path), "colbert")
    files.write("a b.pdf", _rows(1), [_unit(1)], "h1")
    files.write("c.pdf", _rows(1), [_unit(1)], "h2")

    assert sorted(files.sources()) == ["a b.pdf", "c.pdf"]


def test_delete_removes_the_file_and_cache_entry(tmp_path):
    files = PaperFiles(str(tmp_path), "colbert")
    files.write("paper.pdf", _rows(1), [_unit(1)], "h1")
    files.load("paper.pdf")

    files.delete("paper.pdf")

    assert files.load("paper.pdf") is None
    assert files.sources() == []


# --- maxsim ------------------------------------------------------------------


def _naive_maxsim(query: torch.Tensor, paper: Paper) -> list[float]:
    """Double loop reference: for each row, for each query token, the best matching
    document token in that row; scores summed over query tokens."""
    scores = []
    for row_id in range(len(paper.rows)):
        row_vectors = paper.vectors.float()[paper.row_index == row_id]
        total = 0.0
        for q in range(query.shape[0]):
            best = max((row_vectors[t] @ query[q]).item() for t in range(row_vectors.shape[0]))
            total += best
        scores.append(total)
    return scores


def test_maxsim_matches_naive_reference(tmp_path):
    torch.manual_seed(0)
    files = PaperFiles(str(tmp_path), "colbert")
    rows = _rows(4)
    vectors = [_unit(3), _unit(1), _unit(5), _unit(2)]
    files.write("paper.pdf", rows, vectors, "hash-1")
    paper = files.load("paper.pdf")

    query = _unit(6)
    got = maxsim(query, paper)
    want = _naive_maxsim(query, paper)

    assert torch.allclose(got, torch.tensor(want, dtype=got.dtype), atol=1e-3)


# --- cache invalidation on replace --------------------------------------------


def test_replacing_a_paper_invalidates_the_cache(tmp_path):
    files = PaperFiles(str(tmp_path), "colbert")
    files.write("paper.pdf", _rows(1), [_unit(1)], "hash-1")
    first = files.load("paper.pdf")
    assert first.rows[0]["text"] == "passage 0"

    # Bump the mtime explicitly: Windows' filesystem timestamp resolution can be too coarse
    # for two writes within the same test to land on different st_mtime_ns values otherwise.
    files.write("paper.pdf", _rows(2), [_unit(1), _unit(1)], "hash-2")
    path = files._local_path("paper.pdf")
    os.utime(path, ns=(time.time_ns(), time.time_ns() + 10_000_000))

    second = files.load("paper.pdf")
    assert second.rows != first.rows
    assert len(second.rows) == 2


# --- atomic write --------------------------------------------------------------


def test_write_is_atomic_via_os_replace(tmp_path, monkeypatch):
    files = PaperFiles(str(tmp_path), "colbert")
    calls = []
    real_replace = os.replace

    def spy_replace(src, dst):
        calls.append((str(src), str(dst)))
        return real_replace(src, dst)

    monkeypatch.setattr(vectorfiles.os, "replace", spy_replace)

    files.write("paper.pdf", _rows(1), [_unit(1)], "hash-1")

    final_path = files._local_path("paper.pdf")
    assert len(calls) == 1
    src, dst = calls[0]
    assert dst == str(final_path)
    # the source of the replace is a temp file in the same folder as the final path
    assert os.path.dirname(src) == os.path.dirname(str(final_path))
    assert src != dst
    assert ".tmp-" in os.path.basename(src)
