# Status bot (Discord `/status`)

A Discord bot with one slash command, `/status`. It answers with the system's health and one chart:

- overall: "All good", or "Needs attention" and why (worker down, Redis down, firing alerts)
- queue: queued, started and failed jobs, workers, the oldest queued wait, the longest running job
- jobs: done and failed in the last 24 hours and 7 days, the success rate, run time p50/p95
- Cloud Run: instances per service now
- cost estimate: $/h now, the same per day, and the last 24 hours. Instance counts times Cloud Run
  list prices for asia-southeast1 (`status_bot/rates.py`, the same table as the Operations
  dashboard). It is not the bill, and the credit balance is not visible to this project.
- chart: estimated $/h per service over 24 hours, and jobs per day over 7 days

It reads everything through Grafana's query API (`/api/ds/query`) with a read-only service account
token, so it has no Google key or database password of its own. It never shows analysis ids, error
messages, paper titles or owners. Answers are cached for 30 seconds.

## Run it on ss-core

Set these in `/var/lib/docker/secretsource-worker/.env`:

| Variable | What |
|---|---|
| `DISCORD_BOT_TOKEN` | Discord developer portal > your application > Bot > Reset Token |
| `DISCORD_GUILD_ID` | your server's ID (Developer Mode on, right-click the server > Copy Server ID) |
| `GRAFANA_STATUS_BOT_TOKEN` | Grafana > Administration > Service accounts > `status-bot` (Viewer) > token |

Invite the bot with the OAuth2 URL generator: scopes `bot` and `applications.commands`, permissions
Send Messages, Embed Links and Attach Files. No privileged intents.

Then start it. It has its own compose profile, so machines without the tokens never start it:

    docker compose --profile monitoring --profile status-bot up -d --build status-bot

`/status` appears in that one server right away. A missing variable stops the bot with a message
naming it: `docker compose logs status-bot`.

## Tests

    pip install -r requirements-dev.txt
    python -m pytest -q

No network: `tests/fixtures/request_*.json` are the exact queries the bot sends, and
`response_*.json` are what the production Grafana answered on 2026-10-05. A test checks that the
code still sends those exact queries. NumPy stays below 2.4 because ss-core's CPU has no SSE4.2.
