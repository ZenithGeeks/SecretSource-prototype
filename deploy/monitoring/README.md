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
queue wait (p50/p95 — see `PARALLEL_ANALYSES` in `backend/app/config.py`), analysis duration
(p50/p95/p99), LLM token usage and call rate by phase (`extract`/`judge`), claim verdict
distribution, failed-check reasons, and audit findings per finished analysis. All from
`GET /metrics` on the gateway (`backend/app/metrics.py`), scraped by the `gateway` job in
`deploy/monitoring/prometheus.yml`.

Container-level panels (cAdvisor) are not part of this dashboard — build one from a metric
directly, e.g. `container_memory_usage_bytes` (filter by the `name` label), or import a
ready-made one: Dashboards -> New -> Import, dashboard ID `14282`.

**System evaluation** is disabled for now — it stays empty until analyses actually run on the
RQ worker — so its file lives under `deploy/monitoring/grafana/dashboards-disabled/` instead of
`dashboards/`, where the dashboard provider won't load it; move it back with `git mv` to turn it
back on.

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
