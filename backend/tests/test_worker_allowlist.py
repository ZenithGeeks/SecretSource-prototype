"""AnalysisWorker runs only the analysis job. Anyone who can write to Redis could otherwise queue
a job naming any importable function (or callback), and RQ would call it."""

import logging
from types import SimpleNamespace

import pytest
from app import queue as q
from rq import SimpleWorker


def _job(func_name=q.ANALYSIS_JOB, success=None, stopped=None, failure=q.FAILURE_CALLBACK):
    return SimpleNamespace(
        id="j1",
        func_name=func_name,
        _success_callback_name=success,
        _stopped_callback_name=stopped,
        _failure_callback_name=failure,
    )


@pytest.fixture
def worker(monkeypatch):
    ran, refused = [], []
    monkeypatch.setattr(SimpleWorker, "perform_job", lambda self, job, queue: ran.append(job.id) or True)
    w = q.AnalysisWorker.__new__(q.AnalysisWorker)
    w.log = logging.getLogger("test-worker")
    w.handle_job_failure = lambda job, queue, exc_string="": refused.append((job.id, exc_string))
    return w, ran, refused


def test_the_analysis_job_runs(worker):
    w, ran, refused = worker
    assert w.perform_job(_job(), queue=None) is True
    assert (ran, refused) == (["j1"], [])


def test_the_analysis_job_without_a_failure_callback_runs(worker):
    w, ran, refused = worker
    assert w.perform_job(_job(failure=None), queue=None) is True
    assert ran == ["j1"]


@pytest.mark.parametrize(
    "job",
    [
        _job(func_name="os.system"),
        _job(success="os.system"),
        _job(stopped="os.system"),
        _job(failure="os.system"),
    ],
    ids=["other function", "success callback", "stopped callback", "other failure callback"],
)
def test_anything_else_is_refused_before_it_runs(worker, job):
    w, ran, refused = worker
    assert w.perform_job(job, queue=None) is False
    assert ran == []
    assert refused == [("j1", "refused: not an analysis job")]


def test_the_allowed_names_match_the_real_functions():
    assert q.ANALYSIS_JOB == f"{q.run_analysis_job.__module__}.{q.run_analysis_job.__name__}"
    failure = q._on_analysis_job_failure
    assert q.FAILURE_CALLBACK == f"{failure.__module__}.{failure.__name__}"
