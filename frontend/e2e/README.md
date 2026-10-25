# End-to-end tests

Playwright tests that drive the app in Chromium against a real gateway and worker.

| Spec | What it covers |
| --- | --- |
| `author-smoke.spec.ts` | Author: import a .bib → open a draft → edit → Re-check → Replace with `\cite` → Compare, plus one test per bug it found on main |

## Run

```bash
# 1. The e2e stack, from the repo root: its own containers, Redis and SQLite, login off.
docker compose -p secretsource-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build gateway worker redis grobid

# 2. Once, the browser
cd frontend && npx playwright install chromium

# 3. The tests. Playwright starts Vite on 5179 with login off and /api proxied to the stack on 8090.
npm run test:e2e
```

`E2E_GATEWAY_URL` and `E2E_PORT` change those two ports. `npx playwright show-report` opens the last run, and a failed step keeps its trace in `test-results/`.

Stop the stack with `docker compose -p secretsource-e2e down` (add `-v` to drop its data too).

## Why its own stack

- **Redis:** `docker-compose.e2e.yml` gives the gateway and worker the stack's own Redis. The everyday stack may read `REDIS_URL` from `.env`, which can name a shared queue, and a worker on that queue would take these jobs and not find the drafts.
- **Login and data:** login is off (blank Supabase settings), so the browser needs no account and every row belongs to the same anonymous owner.
- **Volumes:** analyses and papers live in the stack's own volumes, not the everyday database or `./data/papers`.
- **Shared services left blank:** the session database, Phoenix traces and the Gatehouse secret.
- **Still shared:** other `.env` settings, such as the LLM and ColBERT URLs. The smoke fixture never calls those services.

The smoke fixture's .bib entries have no title, DOI, URL or eprint. With no title there is no title search or index lookup, so a Re-check needs no GROBID, ColBERT, LLM or network and runs in a few seconds.

## Bugs found on main

Each bug the smoke test found on `main` has its own test under "Known bugs on main", marked `test.fail()` with a link to its issue. The test checks its preconditions first, so a broken precondition still fails the run. While the bug is there the test passes as an expected failure. Once the bug is fixed the test fails, so the fix's pull request should drop the `test.fail()`.

Nothing enforces that: these tests are not in CI, because the shared runner has no Docker stack for them (the same reason `eval_decisive.py` runs by hand, see CONSTRAINTS.md). A pull request that fixes one of these bugs should run `npm run test:e2e` by hand and say so.

The Replace step in "Author flow" is marked the same way against #721, which brings the control back. Its pull request updates that step.
