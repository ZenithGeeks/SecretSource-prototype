# Researcher load test

A k6 script that hits the researcher routes the way the frontend does on page load. It
exists to catch the event-loop block (#228) and the quadratic graph cost (#224), which only
show up under concurrent load or a large library.

Local only. Run it by hand; it is not in CI. Never point it at production: it sends
sustained traffic and POSTs to `/researcher/consensus`.

## What it measures

- 5 virtual users for 1 minute, each fetching `GET /researcher/home`, `/researcher/graph`,
  `/researcher/projects` and `/analyses` together.
- 1 `POST /researcher/consensus` per second with a fixed question (stored verdicts only,
  no LLM calls).

Routes are on the gateway root (port 8080), not under `/api`; that prefix exists only in
the web proxy.

## Before you run

1. Start the stack: `docker compose up`.
2. Put some analyses in the library first. With an empty library every route is fast and
   the test proves nothing. A few dozen is a useful size.
3. If login is on (`SUPABASE_URL` set), pass a Supabase access token as `TOKEN`. With login
   off no token is needed.

## Run

    k6 run loadtest/researcher.js
    k6 run -e BASE_URL=http://localhost:8080 -e TOKEN=<token> loadtest/researcher.js

Without k6 installed (on Linux use `--network host`; on Docker Desktop use
`host.docker.internal`):

    docker run --rm -i -e BASE_URL=http://host.docker.internal:8080 grafana/k6 run - < loadtest/researcher.js

## Reading the result

k6 prints one `http_req_duration{route:...}` line per route; read the `p(95)` value. The
run fails (non-zero exit) if a p95 is over its budget or more than 1% of requests fail:

| route     | p95 budget |
| --------- | ---------- |
| home      | 500 ms     |
| projects  | 500 ms     |
| analyses  | 500 ms     |
| graph     | 1500 ms    |
| consensus | 1500 ms    |

The budgets are a starting point. Run it before and after a performance fix and compare the
p95 lines. Edit the `thresholds` block in `researcher.js` if your library size needs it.
