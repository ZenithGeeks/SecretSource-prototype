"""The cutover from in-process execution to RQ workers: _start() now enqueues instead of
running the pipeline itself, restore() consults the queue instead of assuming every "running"
row was orphaned, delete refuses to drop a job still in flight, and a job that dies outside
run_analysis_job's own except (timeout, worker crash) is caught by an on-failure callback.
"""

import asyncio
import copy
import json
import time

import pytest
from app import main
from app.queue import _on_analysis_job_failure
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)  # login off: no token needed
    main.analyses.clear()
    main.streams.clear()
    main._deleted.clear()
    yield
    main.analyses.clear()
    main.streams.clear()
    main._deleted.clear()


# --- _start() enqueues, and holds the "queued" stage locally the same way it hands it to RQ ---


def test_start_records_one_queued_stage_enqueues_it_and_stores_it(monkeypatch):
    calls = []
    saved = []
    monkeypatch.setattr(
        main, "enqueue_analysis",
        lambda analysis_id, paper, verify, owner, stages, started=None: calls.append((analysis_id, stages)),
    )
    monkeypatch.setattr(main.store, "save", lambda analysis: saved.append(copy.deepcopy(analysis)))

    async def scenario():
        result = main._start("paper.pdf", True, None)
        await main._saved(result["id"])
        return result

    result = asyncio.run(scenario())

    analysis_id = result["id"]
    # Stored before any worker runs it, so a gateway restart while it is queued still finds it.
    assert [(row["id"], row["status"], len(row["stages"])) for row in saved] == [(analysis_id, "running", 1)]
    stages = main.analyses[analysis_id]["stages"]
    assert len(stages) == 1
    assert stages[0]["stage"] == "queued"
    queued_on_stream = main.streams[analysis_id].get_nowait()
    assert queued_on_stream == stages[0]
    assert calls == [(analysis_id, [stages[0]])]


def test_start_returns_503_and_leaves_nothing_behind_when_enqueue_fails(monkeypatch):
    def boom(analysis_id, paper, verify, owner, stages):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(main, "enqueue_analysis", boom)
    monkeypatch.setattr(main.dependencies, "report", lambda: {"degraded": False, "dependencies": []})
    client = TestClient(main.app)

    response = client.post("/analyses", json={"paper": "paper.pdf"})

    assert response.status_code == 503
    assert main.analyses == {}
    assert main.streams == {}


class _Channel:
    def __init__(self):
        self.published = []

    def publish(self, channel, message):
        self.published.append((channel, message))


def test_a_queued_analysis_is_visible_on_every_gateway_instance(monkeypatch):
    """Instance A takes the upload; instance B (its own memory) serves the next request. B only
    hears of runs through Redis snapshots, so A has to send one while the job is still queued,
    not leave it to the worker, which may not start the job for minutes (#259)."""
    channel = _Channel()
    monkeypatch.setattr(main, "redis_connection", lambda: channel)
    monkeypatch.setattr(main, "enqueue_analysis", lambda *args: None)
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    client = TestClient(main.app)

    analysis_id = client.post("/analyses", json={"paper": "paper.pdf"}).json()["id"]

    # Instance B: started before the upload, so nothing of this run in its memory.
    main.analyses.clear()
    main.streams.clear()
    assert client.get(f"/analyses/{analysis_id}").status_code == 404
    for name, message in channel.published:
        assert name == f"analysis:{analysis_id}"
        main._apply_snapshot(json.loads(message))

    response = client.get(f"/analyses/{analysis_id}")
    assert response.status_code == 200
    assert response.json()["status"] == "running"
    assert [stage["stage"] for stage in response.json()["stages"]] == ["queued"]
    assert analysis_id in [analysis["id"] for analysis in client.get("/analyses").json()]


def test_a_late_queued_snapshot_does_not_undo_the_workers_progress(monkeypatch):
    """Redis may deliver the worker's first snapshot before the gateway's queued one."""
    channel = _Channel()
    monkeypatch.setattr(main, "redis_connection", lambda: channel)
    monkeypatch.setattr(main, "enqueue_analysis", lambda *args: None)
    monkeypatch.setattr(main.store, "save", lambda analysis: None)

    async def scenario():
        return main._start("paper.pdf", True, None)["id"]

    analysis_id = asyncio.run(scenario())
    queued = json.loads(channel.published[0][1])
    main.analyses.clear()
    main.streams.clear()

    extracting = {"stage": "extracting", "message": "reading paper.pdf", "at": time.time()}
    main._apply_snapshot({**queued, "stages": queued["stages"] + [extracting]})
    main._apply_snapshot(queued)

    assert [stage["stage"] for stage in main.analyses[analysis_id]["stages"]] == ["queued", "extracting"]


# --- run_analysis_job carries the queued stage through, and owns ANALYSES_RUNNING ---


def test_run_analysis_job_keeps_the_queued_stage_and_tracks_analyses_running(monkeypatch):
    from app.metrics import ANALYSES_RUNNING
    from app.queue import run_analysis_job

    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "redis_connection", lambda: _NullRedis())
    monkeypatch.setattr(
        main, "extract_claims_with_citations",
        lambda paper: {"status": "ok", "file": f"{paper}.pdf", "title": "T", "claims": []},
    )
    monkeypatch.setattr(main, "paper_figures", lambda file: [])
    monkeypatch.setattr(main, "add_paper", lambda file: {"status": "ok"})
    monkeypatch.setattr(main, "audit", lambda analysis: [])
    monkeypatch.setattr(main, "index_paper", lambda title: f"indexed:{title}")

    def running_value():
        return next(s.value for s in ANALYSES_RUNNING.collect()[0].samples)

    before = running_value()
    queued = {"stage": "queued", "message": "waiting for a free worker", "at": round(time.time(), 1)}

    result = run_analysis_job("job-cutover", "paper.pdf", True, None, [queued])

    assert result["status"] == "done"
    assert running_value() == before
    assert "job-cutover" not in main.analyses


class _NullRedis:
    def publish(self, channel, message):
        pass


# --- restore(): a "running" row may still belong to a live RQ job ---


def _stored_running(analysis_id: str) -> dict:
    return {
        "id": analysis_id, "paper": "p.pdf", "status": "running", "owner": None,
        "stages": [{"stage": "queued", "at": 1.0}, {"stage": "extracting", "at": 2.0}],
        "claims": [],
    }


def test_restore_marks_interrupted_only_when_the_job_is_confirmed_gone(monkeypatch):
    stored = {
        "dead": _stored_running("dead"),
        "alive": _stored_running("alive"),
        "unknown": _stored_running("unknown"),
    }
    monkeypatch.setattr(main.store, "load_startup", lambda recent: copy.deepcopy(stored))
    saved = []
    monkeypatch.setattr(main.store, "save", lambda analysis: saved.append(analysis))
    monkeypatch.setattr(
        main, "job_is_alive",
        lambda analysis_id: {"dead": False, "alive": True, "unknown": None}[analysis_id],
    )

    main.restore()

    assert main.analyses["dead"]["status"] == "error"
    assert main.analyses["dead"]["message"] == "interrupted by a restart"
    assert main.analyses["dead"]["stages"][-1]["stage"] == "error"
    assert any(a["id"] == "dead" for a in saved)

    assert main.analyses["alive"]["status"] == "running"
    assert main.analyses["unknown"]["status"] == "running"
    assert not any(a["id"] in ("alive", "unknown") for a in saved)


def test_restore_gives_a_left_running_analysis_a_stream_with_its_stages(monkeypatch):
    stored = {"alive": _stored_running("alive")}
    monkeypatch.setattr(main.store, "load_startup", lambda recent: copy.deepcopy(stored))
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "job_is_alive", lambda analysis_id: True)

    main.restore()

    assert "alive" in main.streams
    drained = []
    while not main.streams["alive"].empty():
        drained.append(main.streams["alive"].get_nowait())
    assert drained == stored["alive"]["stages"]


# --- delete: a running analysis is only deletable if its job was still queued ---


def test_delete_succeeds_when_the_queued_job_is_cancelled(monkeypatch):
    main.analyses["r1"] = {"id": "r1", "paper": "p.pdf", "status": "running", "owner": None,
                            "stages": [], "claims": []}
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: True)
    monkeypatch.setattr(main.store, "delete", lambda analysis_id: True)
    client = TestClient(main.app)

    response = client.delete("/analyses/r1")

    assert response.status_code == 200
    assert "r1" not in main.analyses


def test_delete_publishes_a_tombstone_for_the_other_instances(monkeypatch):
    main.analyses["r3"] = {"id": "r3", "paper": "p.pdf", "status": "running", "owner": None,
                            "stages": [], "claims": []}
    channel = _Channel()
    monkeypatch.setattr(main, "redis_connection", lambda: channel)
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: True)
    monkeypatch.setattr(main.store, "delete", lambda analysis_id: True)

    assert TestClient(main.app).delete("/analyses/r3").status_code == 200

    assert [(name, json.loads(message)) for name, message in channel.published] == [
        ("analysis:r3", {"id": "r3", "deleted": True})
    ]


def test_a_tombstone_removes_the_row_and_a_late_snapshot_does_not_bring_it_back():
    """Instance B deleted the queued analysis; instance A, which took the upload, must drop it."""
    row = {"id": "t1", "paper": "p.pdf", "status": "running", "owner": None,
           "stages": [{"stage": "queued", "at": 1.0}], "claims": []}
    main._apply_snapshot(row)
    stream = main.streams["t1"]

    main._apply_snapshot({"id": "t1", "deleted": True})

    assert "t1" not in main.analyses
    assert "t1" in main._deleted
    assert "t1" not in main.streams
    assert [stream.get_nowait(), stream.get_nowait()] == [{"stage": "queued", "at": 1.0}, None]
    main._apply_snapshot({**row, "stages": row["stages"] + [{"stage": "extracting", "at": 2.0}]})
    assert "t1" not in main.analyses


def test_delete_refuses_when_the_job_already_started(monkeypatch):
    main.analyses["r2"] = {"id": "r2", "paper": "p.pdf", "status": "running", "owner": None,
                            "stages": [], "claims": []}
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: False)
    client = TestClient(main.app)

    response = client.delete("/analyses/r2")

    assert response.status_code == 409
    assert "r2" in main.analyses


# --- the on-failure callback: whatever escapes run_analysis_job's own except ---


class _FakeJob:
    def __init__(self, id, args, kwargs=None):
        self.id = id
        self.args = args
        self.kwargs = kwargs or {}


def test_failure_callback_marks_a_stored_running_row_as_error(monkeypatch):
    stored = {"job-f1": {
        "id": "job-f1", "paper": "p.pdf", "status": "running", "owner": None,
        "stages": [{"stage": "extracting", "at": 1.0}], "claims": [],
    }}
    row = stored["job-f1"]
    monkeypatch.setattr(
        main.store, "load", lambda analysis_id: copy.deepcopy(row) if analysis_id == "job-f1" else None
    )
    saved = []
    monkeypatch.setattr(main.store, "save", lambda analysis: saved.append(analysis))
    published = []
    monkeypatch.setattr(
        "app.queue.redis_connection",
        lambda: type("R", (), {"publish": staticmethod(lambda ch, msg: published.append((ch, msg)))})(),
    )
    job = _FakeJob("job-f1", ["job-f1", "p.pdf", True, None, []])

    _on_analysis_job_failure(job, None, RuntimeError, RuntimeError("boom"), None)

    assert len(saved) == 1
    assert saved[0]["status"] == "error"
    assert saved[0]["message"] == "boom"
    assert saved[0]["stages"][-1]["stage"] == "error"
    assert published  # best-effort publish was attempted


def test_failure_callback_names_the_cause_when_the_worker_died(monkeypatch):
    from rq.exceptions import AbandonedJobError

    row = {"id": "job-f3", "paper": "p.pdf", "status": "running", "owner": None, "stages": [], "claims": []}
    monkeypatch.setattr(main.store, "load", lambda analysis_id: copy.deepcopy(row))
    saved = []
    monkeypatch.setattr(main.store, "save", lambda analysis: saved.append(analysis))
    monkeypatch.setattr("app.queue.redis_connection", lambda: _NullRedis())
    job = _FakeJob("job-f3", ["job-f3", "p.pdf", True, None, []])

    # RQ's cleanup passes an AbandonedJobError with no text when the job's worker is gone.
    _on_analysis_job_failure(job, None, AbandonedJobError, AbandonedJobError(), None)

    assert saved[0]["message"] == "the worker stopped before this analysis finished"
    assert saved[0]["stages"][-1]["message"] == "the worker stopped before this analysis finished"


def test_failure_callback_builds_from_job_args_with_no_stored_row(monkeypatch):
    monkeypatch.setattr(main.store, "load", lambda analysis_id: None)
    saved = []
    monkeypatch.setattr(main.store, "save", lambda analysis: saved.append(analysis))
    monkeypatch.setattr("app.queue.redis_connection", lambda: _NullRedis())
    queued = {"stage": "queued", "at": 1.0}
    job = _FakeJob("job-f2", ["job-f2", "p.pdf", True, "owner-1", [queued]])

    _on_analysis_job_failure(job, None, RuntimeError, RuntimeError("worker died"), None)

    assert len(saved) == 1
    analysis = saved[0]
    assert analysis["id"] == "job-f2"
    assert analysis["owner"] == "owner-1"
    assert analysis["status"] == "error"
    assert analysis["stages"][0] == queued
    assert analysis["stages"][-1]["stage"] == "error"


# --- stop: a queued or lost job ends at once, a running one is asked to stop ---


def _running(analysis_id):
    main.analyses[analysis_id] = {"id": analysis_id, "paper": "p.pdf", "status": "running", "owner": None,
                                  "stages": [{"stage": "queued", "at": 1.0}], "claims": []}


def test_stop_cancels_a_queued_job_and_keeps_the_row_as_stopped(monkeypatch):
    _running("s1")
    saved, channel = [], _Channel()
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: True)
    monkeypatch.setattr(main.store, "save", lambda analysis: saved.append(copy.deepcopy(analysis)))
    monkeypatch.setattr(main, "redis_connection", lambda: channel)

    response = TestClient(main.app).post("/analyses/s1/stop")

    assert response.json() == {"id": "s1", "status": "error"}
    assert saved[-1]["status"] == "error"
    assert saved[-1]["stages"][-1]["stage"] == "error"
    assert json.loads(channel.published[-1][1])["status"] == "error"


def test_stop_ends_a_row_whose_job_is_gone(monkeypatch):
    _running("s2")
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: False)
    monkeypatch.setattr(main, "job_is_alive", lambda analysis_id: False)
    monkeypatch.setattr(main.store, "load", lambda analysis_id: None)
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "redis_connection", lambda: _Channel())

    assert TestClient(main.app).post("/analyses/s2/stop").json()["status"] == "error"
    assert main.analyses["s2"]["status"] == "error"


def test_stop_asks_a_running_job_to_stop(monkeypatch):
    _running("s3")
    asked = []
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: False)
    monkeypatch.setattr(main, "job_is_alive", lambda analysis_id: True)
    monkeypatch.setattr(main, "request_stop", asked.append)

    assert TestClient(main.app).post("/analyses/s3/stop").json() == {"id": "s3", "status": "stopping"}
    assert asked == ["s3"]
    assert main.analyses["s3"]["status"] == "running"  # the worker writes the end


def test_stop_refuses_a_finished_analysis():
    main.analyses["s4"] = {"id": "s4", "paper": "p.pdf", "status": "done", "owner": None,
                           "stages": [], "claims": []}

    assert TestClient(main.app).post("/analyses/s4/stop").status_code == 409


def test_a_stop_flag_cancels_the_pipeline_and_the_run_ends_as_stopped(monkeypatch):
    from app import queue

    class _Flag:
        def exists(self, key):
            return key == "analysis-stop:w1"

        def delete(self, key):
            pass

    monkeypatch.setattr(queue, "redis_connection", lambda: _Flag())
    monkeypatch.setattr(main, "redis_connection", lambda: _Channel())
    monkeypatch.setattr(main.store, "save", lambda analysis: None)

    async def forever(*args):
        await asyncio.sleep(3600)

    monkeypatch.setattr(main, "_in_step", forever)

    async def scenario():
        analysis = main._new_analysis("w1", "p.pdf", None)
        main.analyses["w1"] = analysis
        main.streams["w1"] = asyncio.Queue()
        pipeline = asyncio.create_task(main._run_queued("w1", analysis, "p.pdf", True))
        await asyncio.wait_for(queue._cancel_when_stopped("w1", pipeline), 5)
        await asyncio.wait_for(pipeline, 5)
        return analysis

    analysis = asyncio.run(scenario())
    assert analysis["status"] == "error"
    assert analysis["message"] == main.STOPPED_MESSAGE
    assert analysis["stages"][-1]["stage"] == "error"
