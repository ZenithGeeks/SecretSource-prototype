# RQ + Redis job queue — task list

See `tasks/plan.md` for architecture decisions and rationale. Verification commands assume the established pattern this session: run against the cached `secretsource-prototype-gateway` docker image, e.g.
```
docker run --rm -v "$(pwd -W):/repo" -w /repo secretsource-prototype-gateway sh -c "cd backend && pip install -q pytest prometheus-client && python -m pytest -q"
```

## Task 1: Redis + worker scaffolding

**Description:** Add the `redis`/`rq` dependencies, `REDIS_URL` config, the new `redis` and `worker` compose services, and skeleton `backend/app/queue.py` (connection + `Queue` object, no job logic yet) and `backend/worker.py` (entrypoint that starts an RQ `Worker`). No existing behavior changes — purely additive.

**Acceptance criteria:**
- [x] `redis`/`rq` in `backend/requirements.txt`
- [x] `REDIS_URL` in `backend/app/config.py`, defaulting to `redis://localhost:6379/0`
- [x] `redis` service in `docker-compose.yml`: `redis:7-alpine`, a named volume for persistence, no `profiles:` (runs by default), no published host port (internal only)
- [x] `worker` service in `docker-compose.yml`, following the existing `a2a`/`adk-web` pattern exactly (`build: ./backend`, `environment: <<: *gateway-env`, same volumes as `gateway`), `command: python worker.py`, `depends_on: [redis, grobid]`, no `profiles:`
- [x] `gateway` service gets `depends_on: redis` added and `REDIS_URL` added to the `&gateway-env` anchor
- [x] `backend/app/queue.py`: a lazily-constructed Redis connection and an RQ `Queue("analyses", ...)`
- [x] `backend/worker.py`: builds an RQ `Worker` on that queue and calls `.work()`

**Verification:**
- [x] `docker compose config` resolves cleanly (new services, env wiring)
- [x] `python -m compileall -q backend/app backend/cli.py backend/worker.py services` clean
- [x] `ruff check backend services` clean

**Dependencies:** None

**Files likely touched:**
- `backend/requirements.txt`
- `backend/app/config.py`
- `docker-compose.yml`
- `backend/app/queue.py` (new)
- `backend/worker.py` (new)

**Estimated scope:** Medium (5 files, but mechanical/low-risk — no existing code changes)

---

## Task 2: `_publish()` also publishes the full snapshot to Redis

**Description:** In `backend/app/main.py`, `_publish()` keeps its existing behavior (append to `analysis["stages"]`, `_save_soon`, push to the local `streams[analysis_id]` queue) and *additionally* publishes the full current `analysis` dict as JSON to a Redis Pub/Sub channel `f"analysis:{analysis_id}"`. Purely additive — nothing currently reading `streams` changes.

**Acceptance criteria:**
- [x] `_publish()` calls `redis_client().publish(f"analysis:{analysis_id}", json.dumps(analysis, default=str))` after its existing work
- [x] Existing SSE/`_start`/`_run_queued` behavior is completely unchanged (no test should need to change)
- [x] Publish is best-effort: a Redis failure is logged, never raised (a raise from `_run`'s first publish left the analysis stuck at `running` and hung the test suite)

**Verification:**
- [x] Full backend suite passes, including existing `test_shared_limits.py` and `test_metrics.py`
- [x] New test: monkeypatch the Redis client, run an analysis through `_start`/`_run_queued` (same stub-the-pipeline pattern as `test_shared_limits.py`), assert the fake client received one `publish` call per stage with the correct channel and a JSON body matching the analysis dict at that point

**Dependencies:** Task 1 (needs `queue.py`'s Redis connection helper)

**Files likely touched:**
- `backend/app/main.py`
- `backend/tests/test_queue_publish.py` (new)

**Estimated scope:** Small (1-2 files)

---

## Task 3: Gateway-side Redis subscriber

**Description:** A new background task, started in `lifespan()` alongside the existing `dependency_check` task: subscribes to `analysis:*` on Redis. For each incoming snapshot: update `analyses[analysis_id]` from it (`setdefault` if this gateway has never seen the id — the restart-survivability case), diff `stages` against what's already recorded locally, and push only the genuinely new stage entries onto `streams[analysis_id]` (creating the queue if needed). On a terminal snapshot (`status` is `done`/`error`), also push `None` to close any open SSE connection.

**Acceptance criteria:**
- [x] Subscriber task started in `lifespan()`, runs for the gateway's lifetime
- [x] Correctly no-ops on a stage it already has locally (idempotent — this is what makes it safe to run alongside Task 2's still-active direct `streams.put()` call)
- [x] Correctly initializes `analyses[id]`/`streams[id]` for an id this gateway process has never seen
- [x] Pushes `None` on a terminal snapshot

**Verification:**
- [x] Full backend suite passes
- [x] New test: feed the subscriber's message-handling logic a sequence of fake snapshots directly (no real Redis needed — extract the per-message handling into a plain function the test can call), assert `analyses`/`streams` end up correct for: (a) a fresh id, (b) a stage already seen (no duplicate push), (c) a terminal snapshot closing the stream

**Dependencies:** Task 2 (needs the snapshot message format)

**Files likely touched:**
- `backend/app/main.py`
- `backend/tests/test_queue_subscriber.py` (new)

**Estimated scope:** Small-Medium (1 file + tests)

---

## Task 4: `run_analysis_job()` + worker execution

**Description:** In `backend/app/queue.py`, add `run_analysis_job(analysis_id, paper, verify, owner)` — a plain sync function (RQ jobs are sync) that constructs the analysis dict skeleton (same shape `_start()` builds today) and runs the existing async pipeline (`_run_queued` from `main.py`, unchanged) via `asyncio.run(...)`. Set a generous `job_timeout` when enqueuing (later, in Task 5) — analyses can run several minutes; RQ's 180s default is too short. Not yet wired into `_start()` — reachable only by calling it directly (tests) or via a manually-enqueued job.

**Acceptance criteria:**
- [x] `run_analysis_job` builds the same skeleton dict `_start()` currently builds
- [x] Runs `_run_queued` to completion via `asyncio.run`
- [x] Final analysis state (status, claims, figures, audit) matches what today's in-process path produces for the same stubbed pipeline
- [x] `backend/worker.py` correctly picks up and runs a job when a real RQ worker is pointed at it (checked via Task 4's live verification, not just the unit test)

**Verification:**
- [x] New test: call `run_analysis_job` directly with the pipeline functions stubbed (same pattern as `test_shared_limits.py`), assert the final dict and the sequence of fake-Redis-client publishes are correct
- [x] Full backend suite passes

**Dependencies:** Task 1 (queue.py/worker.py skeleton), Task 2 (the `_publish` behavior `_run_queued` relies on)

**Files likely touched:**
- `backend/app/queue.py`
- `backend/worker.py`
- `backend/tests/test_run_analysis_job.py` (new)

**Estimated scope:** Small-Medium (2 files + tests)

---

## Task 5: Cutover — `_start()` enqueues via RQ

**Description:** The actual behavior flip. In `backend/app/main.py`: `_start()` calls `queue.enqueue(run_analysis_job, analysis_id, paper, verify, owner, job_timeout=...)` instead of `asyncio.create_task(_run(...))`. Remove `_run`'s outer wrapper (the `PARALLEL_ANALYSES`-waiting layer added in PR #270), `all_analyses`, and `PARALLEL_ANALYSES` itself from `backend/app/config.py`. Remove the now-dead direct `streams[analysis_id].put(event)` line from `_publish()` — `_publish` now only ever runs in the worker process, where the gateway's `streams` dict doesn't exist/matter.

**Acceptance criteria:**
- [x] `_start()` enqueues instead of spawning an `asyncio.Task`
- [x] `_run`/`all_analyses`/`PARALLEL_ANALYSES` removed (not just unused — actually deleted)
- [x] ~~`_publish()` no longer references the gateway's `streams` dict at all~~ Kept on purpose: in the worker, `streams[id]` is the job's own queue and is popped when the job ends, so removing it only adds churn in `_run_queued`
- [x] `GET /analyses/{id}/events` still streams correctly end-to-end (via the Task 2/3 path, now the *only* path)
- [x] `restore()` stops marking `running` analyses as "interrupted by a restart" on gateway startup: a worker may still be running them, and the Task 3 subscriber catches them up
- [x] Deleting a queued analysis cancels its RQ job; deleting a started one returns 409, because a started job keeps saving and the row would come back after the next restart
- [x] `_start` also stores the queued analysis, so a gateway restart before a worker starts the job still finds it (found in the live check: it returned 404 and the web app's event stream stopped retrying)

**Verification:**
- [x] Full backend suite passes (on a freshly built image, `test_service_auth.py::test_mcp_client_signs_every_request` also fails on main: mcp 2.2 moved to httpx2, a separate follow-up)
- [x] **Live check, not just unit tests**: `docker compose up -d --build` with `redis`+`worker` running, start a real analysis through the actual app, confirm `GET /analyses/{id}/events` streams progress and `GET /analyses/{id}` returns the full payload once done
- [x] `ruff check backend services` clean

**Dependencies:** Tasks 2, 3, 4 all proven first

**Files likely touched:**
- `backend/app/main.py`
- `backend/app/config.py`
- `backend/tests/test_shared_limits.py` (update for removed semaphore)

**Estimated scope:** Small (2-3 files) — small in size, highest risk in the plan; do not skip the live verification step.

---

## Task 6: Docs

**Description:** Update `backend/README.md`, `ARCHITECTURE.md`, and `.env.example` to describe the new `redis`/`worker` services, the new `REDIS_URL` var, and that `PARALLEL_ANALYSES` is gone (replaced by `docker compose up -d --scale worker=N`).

**Acceptance criteria:**
- [x] `backend/README.md` describes the queue/worker model
- [x] `ARCHITECTURE.md` updated to reflect the new execution model
- [x] `.env.example` has `REDIS_URL`

**Verification:**
- [x] Docs read correctly, no stale references to `PARALLEL_ANALYSES` or the old in-process execution model remain

**Dependencies:** Task 5 (describes the final, cut-over state)

**Files likely touched:**
- `backend/README.md`
- `ARCHITECTURE.md`
- `.env.example`

**Estimated scope:** XS (3 files, docs only)
