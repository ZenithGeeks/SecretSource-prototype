# Implementation Plan: RQ + Redis job queue

## Overview

Replace `asyncio.create_task(_run(...))` (in-process, one gateway, no restart survivability) with RQ (Redis Queue): `POST /analyses` enqueues a job, and one or more separate `worker` processes pull jobs and run the pipeline. Delivers durable queueing, real horizontal scaling of the actual bottleneck (worker count), and a proper replacement for the `PARALLEL_ANALYSES` semaphore added earlier this session (PR #270).

**Scope**: one gateway process (unchanged), N horizontally-scalable worker processes (new). Multi-gateway-replica support is explicitly out of scope — a separate, larger follow-up (needs Supabase as the store, not SQLite, plus cross-gateway state sharing).

## Architecture Decisions

- **Worker owns execution and publishing; gateway owns the live cache and SSE, fed by Redis Pub/Sub.** Confirmed via `frontend/src/lib/api.ts`/`useAnalysis.ts` that `GET /analyses/{id}/events` is the primary live-update path (must replay all recorded stages on connect, then live-tail) and `GET /analyses/{id}` is read for the full payload at stage boundaries — both must keep working unchanged from the frontend's view.
- **Publish full snapshots, not diffs.** `_publish()`'s callers mutate the whole analysis dict directly (`analysis["claims"] = ...`, `analysis["status"] = "done"`, etc.), not just small stage events — so the cross-process message has to carry the full current dict each time.
- **Build the new path additively, cut over last.** The gateway's planned subscriber already diffs incoming snapshots against what it has locally before pushing anything to `streams[id]` — so it's safe to add the Redis publish *alongside* the existing direct `streams[id].put(event)` call and let both run at once during development; the subscriber naturally no-ops on a stage it's already seen. Only the final cutover task removes the old path.
- **`PARALLEL_ANALYSES`/`all_analyses` go away.** RQ's queue is the real version of what that semaphore approximated. Worker replica count (`docker compose up -d --scale worker=N`) becomes the new admission-control knob.
- **Known limitation, not solved here:** `PARALLEL_SOURCES_TOTAL`/`PARALLEL_CHECKS_TOTAL` stay per-process. Multiple worker replicas each get an independent budget (same class of issue flagged for multi-replica gateways in the original architecture review). A distributed (Redis-backed) semaphore is real additional work, left for later.

## Task List

### Phase 1: Foundation

- [x] Task 1: Redis + worker scaffolding (deps, config, compose services, skeleton files)

### Checkpoint: Foundation
- [x] `docker compose config` resolves the new `redis`/`worker` services cleanly
- [x] `python -m compileall` clean on the new skeleton files

### Phase 2: Build the new path alongside the old one

- [x] Task 2: `_publish()` also publishes the full snapshot to Redis (additive)
- [x] Task 3: Gateway-side subscriber task (diff-based, idempotent)

### Checkpoint: New path proven, old path still live
- [x] Full backend suite passes — existing SSE/`_start`/`_run_queued` behavior is untouched
- [x] New tests confirm the subscriber correctly updates `analyses`/`streams` from fake snapshots, including an id the gateway has never seen (the restart-survivability case)

### Phase 3: Worker execution path (not yet wired into `_start`)

- [x] Task 4: `run_analysis_job()` + `worker.py` entrypoint

### Checkpoint: Worker path proven in isolation
- [x] `run_analysis_job` tested directly (no real Redis/RQ needed) — correct final analysis state, correct sequence of "published" snapshots against a fake Redis client
- [x] Live app still uses `asyncio.create_task` — nothing user-facing has changed yet

### Phase 4: Cutover

- [ ] Task 5: `_start()` enqueues via RQ; remove `_run`'s wrapper, `all_analyses`, `PARALLEL_ANALYSES`, and the now-dead direct `streams[id].put()` line in `_publish`

### Checkpoint: Cutover verified
- [ ] Full backend suite passes
- [ ] `docker compose up -d --build` (or equivalent) with `redis`+`worker` running: start a real analysis, confirm `GET /analyses/{id}/events` still streams progress end-to-end and `GET /analyses/{id}` returns the full payload
- [ ] Highest-risk task in this plan despite its small file count — it's the actual behavior flip. Do not skip the live check here even though earlier tasks were test-only.

### Phase 5: Docs

- [ ] Task 6: Update `backend/README.md`, `ARCHITECTURE.md`, `.env.example`

### Checkpoint: Complete
- [ ] All acceptance criteria met across tasks 1-6
- [ ] `ruff check backend services` clean
- [ ] Ready for review / PR

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cutover task (5) silently breaks SSE for real users | High | Phases 2-3 prove the new delivery path works *before* the old path is removed; task 5's checkpoint requires a live end-to-end check, not just unit tests |
| RQ job timeout too short for a real analysis (default 180s) | High (jobs killed mid-run) | Set `job_timeout` generously in task 4 (minutes, not the default) |
| Multiple worker replicas each get their own `PARALLEL_*_TOTAL` budget | Medium, documented | Explicitly called out as a known follow-up, not solved in this plan |
| Redis has no persistence configured, queue lost on container recreate | Medium | Task 1 adds a named volume for Redis's AOF/RDB persistence |

## Open Questions

None outstanding — design was worked through in an earlier plan-mode pass (docker-compose conventions, frontend SSE contract, and the full-snapshot-vs-diff question were all confirmed via direct code reads before this breakdown was written).
