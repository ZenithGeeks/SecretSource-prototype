# Using SecretSource over Tailscale

The whole stack runs in Docker on one machine (the host). Teammates reach it over Tailscale.
Nothing runs on Google Cloud any more.

Two https addresses are shared, tailnet only:

| Address | What | Who needs it |
|---|---|---|
| https://wttw-1.tailcf73b7.ts.net | the web app (it sends `/api` calls to the host's gateway itself) | everyone |
| https://wttw-1.tailcf73b7.ts.net:8443 | the team gateway ([gatehouse](https://github.com/EarthWittawat/gatehouse)) in front of ColBERT, ColPali, GROBID and the judge LLM | developers |

Every call through the team gateway needs a personal key. Grafana, Prometheus, the GPU
services themselves and the gateway's admin pages stay on the host's localhost.

## For teammates

1. Install Tailscale from https://tailscale.com/download and sign in.
2. Accept the invite the host sent you (an email, or a link to the shared machine).
3. Open https://wttw-1.tailcf73b7.ts.net in Chrome, Edge or Firefox. Use https: on plain
   http the browser blocks copy-to-clipboard.
4. Sign up with your own email or Google account. Your name is written on every label you
   save, so do not share an account.
5. Pick the role you want. For labeling, pick Labeler.

If the page does not load, check that Tailscale says "Connected" and that the host machine
is on. If you sign in with Google and land on a different site, tell the host: the address
is missing from the Supabase redirect list (step 4 below).

### Labeling

- Your queue lists the papers you can label. Open one, judge each passage 1 to 4, and press
  Save labels. Labels are saved in Supabase, so they are safe if the host restarts.
- "Add a missed claim" adds a claim the extraction missed. The app then searches the
  references for passages you can judge.
- The Labeler page has "Download labels CSV" for the evaluation scripts
  (`backend/eval_verdicts.py`).

### Developing

You run grobid, redis, the gateway, the worker and the web app yourself. They need no GPU.
ColBERT, ColPali and the judge LLM come from the host through the team gateway.

1. Ask the host for your personal key. It starts with `sk-`. One key is one person: do not
   share it, post it in a chat group or commit it. The host can turn off one key without
   touching anyone else's.
2. Copy `deploy/team-dev.env` to `.env` in the repo root and put your key in both
   `SERVICE_API_KEY` and `VLLM_API_KEY`. Add the source-lookup keys (`S2_API_KEY`,
   `OPENALEX_API_KEY`, `SCOPUS_API_KEY`) from the host or your own free accounts.
3. `docker compose up -d --build`, then open http://localhost:5173.

Check that your containers reach the team gateway with your key:
`docker compose exec gateway python -c "import os, urllib.request as u; print(u.urlopen(u.Request(os.environ['COLBERT_URL'] + '/health', headers={'apikey': os.environ['SERVICE_API_KEY']})).read())"`.
It should print `{"ok":true,...}`. An HTTP 401 means the key is wrong or turned off. This works
with Docker Desktop on Windows and macOS. On Linux, if the name does not resolve, add
`dns: [100.100.100.100]` to the gateway and worker services in a `docker-compose.override.yml`.

The judge LLM allows 3 calls at a time for the whole team, and your key allows 1. The
template sets `PARALLEL_CHECKS=1` and `LLM_PARALLEL_REQUESTS=1` to match: with more, your
extra calls are refused at once (HTTP 429). When the team's 3 slots are busy, your call waits
for a free one, up to about 30 s.

## For the host

Do these once.

1. Sign in to Tailscale on the host: run `tailscale up`, or use the tray icon.
2. In the Tailscale admin console, under DNS, turn on MagicDNS and HTTPS Certificates.
3. In the repo's `.env`, keep `BIND_ADDRESS=127.0.0.1`, then start the stack and share the
   web app:
   ```
   docker compose up -d --build
   tailscale serve --bg 5173
   tailscale serve status
   ```
   `tailscale serve status` prints the https address to send to teammates. The share stays
   on after a reboot. `tailscale serve reset` turns it off.
4. In Supabase, under Authentication, URL Configuration, add the https address to Redirect
   URLs. Google sign-in, email confirmation and password reset all return to it.
5. Invite teammates in the admin console (Users, Invite), or share only this machine
   (Machines, the host, Share). Sharing the machine does not count against the plan's user
   limit.
6. For developers: run the team gateway (https://github.com/EarthWittawat/gatehouse, see its
   README), share it with `tailscale serve --bg --https=8443 http://127.0.0.1:9080`, and make
   one key per developer there. Never share a GPU service's own port: the services check no key.
7. Optional: add an access rule so teammates can reach only ports 443 and 8443 on the host.

Keep the host awake while the team works: turn off sleep in Windows power settings, and set
Docker Desktop to start when you sign in.

### Settings that matter for a team

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be set before the web image is
  built. Without them, login is off and every label is saved under the name `local`.
- `VITE_GATEHOUSE_URL=https://wttw-1.tailcf73b7.ts.net:8443`, also set before the build, gives
  Settings -> Agents its MCP URL and the `/me/` page where people get their key.
- `SCOPUS_API_KEY` turns on the Labeler's paper search.
- `REDIS_URL` stays empty, so the queue is the local redis container.
- PDF uploads go directly through the gateway.
- `VLLM_URL=http://host.docker.internal:9080/llm/v1` with the host's own gatehouse key, so the
  host's analyses share the judge LLM's 3 slots with the developers instead of competing with
  them. The provider key itself lives only in gatehouse's `.env`.
- Analyses from the web app run one at a time on the host's worker (the RQ queue); a second
  one waits its turn.
