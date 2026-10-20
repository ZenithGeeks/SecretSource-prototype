# Using SecretSource over Tailscale

The whole stack runs in Docker on one machine (the host). Teammates reach it over Tailscale.
Nothing runs on Google Cloud any more.

Only the web app is shared, at one https address. The gateway, Grafana, Prometheus and the
GPU services stay on the host's localhost. The web app sends every `/api` call to the gateway
for you, so teammates never need another port.

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
ColBERT runs on the host and you reach it over Tailscale.

1. Copy `deploy/team-dev.env` to `.env` in the repo root.
2. Fill in the keys the host sends you privately (`VLLM_API_KEY`, `S2_API_KEY`,
   `OPENALEX_API_KEY`, `SCOPUS_API_KEY`). Do not post them in chat groups or commit them.
3. `docker compose up -d --build`, then open http://localhost:5173.

Check that your containers can reach the host:
`docker compose exec gateway python -c "import urllib.request; print(urllib.request.urlopen('https://wttw-1.tailcf73b7.ts.net:8893/health').read())"`.
It should print `{"ok":true,...}`. This works with Docker Desktop on Windows and macOS. On
Linux, if the name does not resolve, add `dns: [100.100.100.100]` to the gateway and worker
services in a `docker-compose.override.yml`.

The judge LLM key is shared by the whole team and allows 3 requests at a time. The template
sets `PARALLEL_CHECKS=1` so your test runs leave room for the labelers.

## For the host

Do these once.

1. Sign in to Tailscale on the host: run `tailscale up`, or use the tray icon.
2. In the Tailscale admin console, under DNS, turn on MagicDNS and HTTPS Certificates.
3. In the repo's `.env`, keep `BIND_ADDRESS=127.0.0.1`, then start the stack and share the
   web app:
   ```
   docker compose up -d --build
   tailscale serve --bg 5173
   tailscale serve --bg --https=8893 http://127.0.0.1:8893
   tailscale serve status
   ```
   `tailscale serve status` prints the https address to send to teammates. The share stays
   on after a reboot. `tailscale serve reset` turns it off.
4. In Supabase, under Authentication, URL Configuration, add the https address to Redirect
   URLs. Google sign-in, email confirmation and password reset all return to it.
5. Invite teammates in the admin console (Users, Invite), or share only this machine
   (Machines, the host, Share). Sharing the machine does not count against the plan's user
   limit.
6. Optional: add an access rule so teammates can reach only port 443 on the host.

Keep the host awake while the team works: turn off sleep in Windows power settings, and set
Docker Desktop to start when you sign in.

### Settings that matter for a team

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be set before the web image is
  built. Without them, login is off and every label is saved under the name `local`.
- `SCOPUS_API_KEY` turns on the Labeler's paper search.
- `REDIS_URL` stays empty, so the queue is the local redis container.
- `PAPERS_BUCKET` and `UPLOAD_ORIGINS` stay empty, so PDF uploads go through the gateway.
- The judge LLM key accepts 3 requests at a time (`PARALLEL_CHECKS=3`). If two people run
  analyses at once, the second waits in the queue, or gets 429 errors if more than one
  worker runs.
