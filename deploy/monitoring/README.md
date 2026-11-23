# Monitoring: containers and the application

cAdvisor + Prometheus + Grafana. Two layers:

- **Container resources** (cAdvisor) — per-container CPU/memory visibility. Added after ss-core
  (2 GB RAM, 1 vCPU) OOM-crashed with no warning — a container ate memory until the kernel started
  killing processes and the box stopped answering SSH and the gateway alike (issue #230).
- **The application itself** (`GET /metrics` on the gateway, `backend/app/metrics.py`) — analysis
  success rate, queue wait and duration, claim verdicts, audit findings, and LLM token usage.
  Neither cAdvisor nor a process being "up" says anything about whether analyses are actually
  succeeding or how much of the LLM budget they're costing; this is what answers that.

This is behind the `monitoring` profile, so it does not start on every box by default — a small
box like ss-core shouldn't be running three extra containers unless someone asked for them. Run
it on whichever box runs the `gateway` container (ss-core in production) — Grafana here is for
evaluating the running system, not something to point at a local dev gateway.

## Start it

    docker compose --profile monitoring up -d

## URLs

- cAdvisor UI: http://localhost:8085
- Prometheus UI: http://localhost:9090
- Grafana UI: http://localhost:3001

(Swap `localhost` for the host's Tailscale IP, or whatever `BIND_ADDRESS` was set to, if the
stack isn't running on the machine you're browsing from.)

## Grafana: provisioned automatically

Grafana no longer starts empty. On boot it reads `deploy/monitoring/grafana/provisioning/` and:

- adds Prometheus (`http://prometheus:9090`) as a datasource, and
- loads the **"System evaluation"** dashboard from `deploy/monitoring/grafana/dashboards/`.

Log in at http://localhost:3001 with the default `admin` / `admin` (it prompts for a new password
on first login) and the dashboard is already there — nothing to add by hand, even after a reset
`grafana-data` volume.

**System evaluation** panels: success rate (15m), analyses running/started/errored, throughput,
queue wait (p50/p95 — time a job waited in the RQ queue before a worker started it), analysis
duration (p50/p95/p99), LLM token usage and call rate by phase (`extract`/`judge`), claim
verdict distribution, failed-check reasons, and audit findings per finished analysis. Analyses
started comes from `GET /metrics` on the gateway, scraped by the `gateway` job. Everything else
is counted in the RQ worker processes and served on `WORKER_METRICS_PORT` (default `9101`,
`backend/worker.py`), scraped by the `worker` job, which finds every replica by DNS
(`backend/app/metrics.py`, `deploy/monitoring/prometheus.yml`).

Container-level panels (cAdvisor) are not part of this dashboard — build one from a metric
directly, e.g. `container_memory_usage_bytes` (filter by the `name` label), or import a
ready-made one: Dashboards -> New -> Import, dashboard ID `14282`.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:e0af30de93245a24002ab853f273c17679b914c507df9f919f36440f4c3de997 -->

If Prometheus cannot scrape the gateway, check that the gateway container is running. The
worker panels can still report metrics while the gateway scrape is down.

## Operations dashboard

One page for running the system (`grafana/dashboards/operations.json`):

- Queue (Redis / RQ): jobs per state, workers, the oldest queued job's age and the longest running
  job. These come from `backend/app/rq_metrics.py` on the worker's `/metrics`, read from Redis Cloud
  on each scrape.
- Jobs: succeeded vs failed, success rate, run time p50/p95, and a table of each run's duration
  (from the `analyses` table; no owners or titles).

## Alerts (Discord)

`grafana/provisioning/alerting/ops.yml` sends every alert, including the disk alert below, to a
Discord webhook. Put the webhook in ss-core's `.env` as `GRAFANA_DISCORD_WEBHOOK_URL`, then
recreate Grafana. Without it the alerts still show under Alerting in Grafana, but nothing is sent.

| Alert | Fires when |
|---|---|
| RQ worker is down | Prometheus cannot scrape the worker for 5 minutes |
| Redis is unreachable | `rq_up` is 0 for 5 minutes |
| A queued analysis has waited over 45 minutes | the oldest queued job is older than 45 minutes |
| An analysis has run over 40 minutes | longer than `JOB_TIMEOUT` (30 minutes) plus a margin |
| An analysis failed | any pipeline error or RQ failed job in 15 minutes |

Each alert's description says what to check first.

## Disk alert

`node-exporter` reports the host's own disk, memory and load, which cAdvisor does not.
Grafana loads one alert rule from `grafana/provisioning/alerting/disk.yml`: "Disk over 80% full"
fires when `/` or `/var/lib/docker` stays over 80% for 10 minutes. It goes to Discord with the
alerts above.
On ss-core a weekly job, `/etc/cron.weekly/docker-prune`, removes stopped containers, untagged
images and old build cache.

## Analyses dashboard

The **"Analyses"** dashboard reads the `analyses` table directly (Supabase Postgres) instead of
`/metrics`, so it works whether or not the RQ worker is running: analyses per day by outcome,
success rate, top error messages, run duration (p50/p95), an approximate time split per run
(reading / source prep + judging / finishing), verdict mix, checks per analysis, failed-source
reasons, uploads vs. identifiers, active users per day, and a "Running now" table.

It connects through `grafana_ro`, a role created by
`supabase/migrations/20260928090000_grafana_readonly.sql` that can only `SELECT` from
`public.analyses` and `public.sources` — nothing else in the database. The dashboard itself never
shows an owner id or an analysis title; "active users" and "running now" are counts and stage
names only.

Three env vars point the datasource at it (see `.env.example`): `GRAFANA_DB_HOST` (host:port of
the Supabase session pooler), `GRAFANA_DB_USER` (the whole `grafana_ro.<project-ref>` username),
and `GRAFANA_DB_PASSWORD` (set by hand on the role — see the migration file's comment; never
committed).


<!-- /coderabbit-ai-generated:v1 -->
