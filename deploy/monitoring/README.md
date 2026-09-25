# Container resource monitoring

cAdvisor + Prometheus + Grafana, for per-container CPU/memory visibility. Added after ss-core
(2 GB RAM, 1 vCPU) OOM-crashed with no warning — a container ate memory until the kernel started
killing processes and the box stopped answering SSH and the gateway alike (issue #230). A
dashboard showing memory climbing toward the container limit would have caught that before it
took the box down.

This is behind the `monitoring` profile, so it does not start on every box by default — a small
box like ss-core shouldn't be running three extra containers unless someone asked for them.

## Start it

    docker compose --profile monitoring up -d

## URLs

- cAdvisor UI: http://localhost:8085
- Prometheus UI: http://localhost:9090
- Grafana UI: http://localhost:3001

(Swap `localhost` for the host's Tailscale IP, or whatever `BIND_ADDRESS` was set to, if the
stack isn't running on the machine you're browsing from.)

## First-run setup in Grafana

Grafana starts empty and needs to be pointed at Prometheus once:

1. Open Grafana at http://localhost:3001 and log in with the default `admin` / `admin`
   (it prompts you to set a new password on first login).
2. Go to Connections -> Data sources -> Add data source -> Prometheus.
3. Set the URL to `http://prometheus:9090` — Grafana and Prometheus are on the same compose
   network, so the service name resolves; `localhost` will not work here.
4. Click Save & test.

From there, either:

- build a panel from a cAdvisor metric directly, e.g. `container_memory_usage_bytes`
  (filter by the `name` label to a specific container), or
- import a ready-made dashboard instead of building one: Dashboards -> New -> Import, and
  enter dashboard ID `14282` (a well-known public cAdvisor/Prometheus dashboard) to get
  per-container CPU and memory panels without building them by hand.
