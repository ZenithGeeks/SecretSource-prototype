"""AnalysisWorker runs only the analysis job and the draft-check job. Anyone who can write to
Redis could otherwise queue a job naming any importable function (or callback), and RQ would call it."""

import inspect
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


def test_the_draft_check_job_runs(worker):
    w, ran, refused = worker
    assert (
        w.perform_job(_job(func_name=q.DRAFT_CHECK_JOB, failure=q.DRAFT_FAILURE_CALLBACK), queue=None) is True
    )
    assert (ran, refused) == (["j1"], [])


def test_the_draft_check_job_without_a_failure_callback_runs(worker):
    w, ran, refused = worker
    job = _job(func_name=q.DRAFT_CHECK_JOB, failure=None)
    assert w.perform_job(job, queue=None) is True
    assert ran == ["j1"]


@pytest.mark.parametrize(
    "job",
    [
        _job(func_name="os.system"),
        _job(success="os.system"),
        _job(stopped="os.system"),
        _job(failure="os.system"),
        _job(func_name=q.DRAFT_CHECK_JOB, failure=q.FAILURE_CALLBACK),
        _job(failure=q.DRAFT_FAILURE_CALLBACK),
    ],
    ids=[
        "other function",
        "success callback",
        "stopped callback",
        "other failure callback",
        "draft check with the analysis callback",
        "analysis with the draft-check callback",
    ],
)
def test_anything_else_is_refused_before_it_runs(worker, job):
    w, ran, refused = worker
    assert w.perform_job(job, queue=None) is False
    assert ran == []
    assert refused == [("j1", "refused: not an allowed job")]


def test_the_allowed_names_match_the_real_functions():
    assert q.ANALYSIS_JOB == f"{q.run_analysis_job.__module__}.{q.run_analysis_job.__name__}"
    failure = q._on_analysis_job_failure
    assert q.FAILURE_CALLBACK == f"{failure.__module__}.{failure.__name__}"
    assert q.DRAFT_CHECK_JOB == f"{q.run_draft_check_job.__module__}.{q.run_draft_check_job.__name__}"
    draft_failure = q._on_draft_check_job_failure
    assert q.DRAFT_FAILURE_CALLBACK == f"{draft_failure.__module__}.{draft_failure.__name__}"

def test_perform_job_takes_what_rq_passes():
    """RQ 3.0 passes perform_job a third argument, and an override without it stopped the worker
    on its first job (#738). The fixture above replaces RQ's own perform_job, so only this
    compares the two."""
    ours = list(inspect.signature(q.AnalysisWorker.perform_job).parameters)
    theirs = list(inspect.signature(SimpleWorker.perform_job).parameters)
    assert ours == theirs
