# SecretSource backend

The backend reads a research paper, finds its claims, and checks each claim against the
paper it cites. It is a FastAPI gateway that the web app talks to. The same code also runs
as a chat agent (`cli.py`), an A2A server (`a2a_server.py`) and an ADK graph (`adk web`).

For how the pipeline works inside, read [ARCHITECTURE.md](../ARCHITECTURE.md). This page
covers how to run the backend, how it is organised, and the HTTP API.

## Contents

- [Run it](#run-it)
- [Settings](#settings)
- [Login](#login)
- [Folder layout](#folder-layout)
- [Tests](#tests)
- [HTTP API](#http-api)
  - [Analyses](#analyses)
  - [Progress events](#progress-events)
  - [Papers](#papers)
  - [Researcher](#researcher)
  - [Other routes](#other-routes)

## Run it

The usual way is Docker Compose from the repository root:

```bash
docker compose up -d gateway
curl http://localhost:8080/health
```

The gateway needs GROBID, ColBERT and an LLM endpoint. ColPali is optional. Their URLs come
from `.env` (see the root [README](../README.md)).

To run it on your own machine instead:

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8080
```

On the host, use `localhost` URLs in `.env`, not compose service names. The host also needs
`dspy` and `pymupdf`, which `requirements.txt` installs.

Other entry points:

| Command | What it does |
| --- | --- |
| `python cli.py` | chat with the coordinator agent in the terminal |
| `python cli.py "list the claims in data/papers/x.pdf"` | one turn, then exit |
| `python -m uvicorn a2a_server:app --port 8002` | serve the agents over A2A |
| `docker compose --profile dev up -d adk-web` | ADK's dev UI on http://localhost:8001 |

## Settings

Every setting is an environment variable, read in `app/config.py`. Empty means "use the
default".

| Variable | Default | What it does |
| --- | --- | --- |
| `VLLM_URL` | `http://localhost:8000/v1` | OpenAI-compatible LLM endpoint |
| `VLLM_MODEL` | `qwen` | model id, as listed by `{VLLM_URL}/models` |
| `VLLM_API_KEY` | `EMPTY` | key for that endpoint |
| `GROBID_URL` | `http://localhost:8070` | GROBID, reads references and body text |
| `COLBERT_URL` | `http://localhost:8893` | ColBERT text search service |
| `COLPALI_URL` | `http://localhost:8894` | ColPali figure and page search; skipped when down |
| `SERVICE_AUTH` | `none` | `google-id-token` adds an identity token for private Cloud Run services |
| `GOOGLE_APPLICATION_CREDENTIALS` | empty | credentials file used for those tokens |
| `PAPERS_DIR` | `data/papers` | downloaded PDFs and figure crops |
| `ANALYSES_DB` | `data/analyses.db` | SQLite file for analyses, when Supabase is not set |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | empty | both set: store analyses and projects in Supabase instead of SQLite, and turn on login (see Login) |
| `SESSION_DB_URL` | empty | Postgres URL where the chat agents keep their sessions (`app/sessions.py`); empty keeps them in memory, so a restart forgets them. ADK's tables go in the `adk` schema, never `public` |
| `MEMORY_OWNER` | empty | the Supabase user id whose analyses the chat agents' `load_memory` may read, besides analyses without an owner |
| `DIRECT_URL` | empty | used when `SESSION_DB_URL` is empty; it is the name Supabase's Connect dialog gives the session pooler URL |
| `A2A_HOST`, `A2A_PORT` | `localhost`, `8002` | the address the A2A agent card tells callers to use (`a2a_server.py`), not the address the server binds |
| `S2_API_KEY` | empty | Semantic Scholar key; without it most lookups are rate limited |
| `UNPAYWALL_EMAIL` | empty | contact email that lets Unpaywall answer lookups |
| `CLAIM_LIMIT` | `20` | most claims kept per paper; `0` keeps all |
| `PARALLEL_SOURCES` | `3` | cited papers downloaded and indexed at the same time |
| `PARALLEL_CHECKS` | `3` | claims judged at the same time |
| `PARALLEL_SOURCES_TOTAL` | `PARALLEL_SOURCES` | cited papers prepared at the same time across all running analyses |
| `PARALLEL_CHECKS_TOTAL` | `PARALLEL_CHECKS` | claims judged at the same time across all running analyses |
| `GATEWAY_PORT` | `8080` | port when started with `python -m app.main` |
| `PAGE_CACHE` | `/tmp/pages` | where rendered page images are cached |
| `DOCLING_FORMULAS` | empty | `1` also reads formulas as LaTeX (downloads another model) |
| `DOCLING_OCR` | `auto` | `auto` runs OCR only on a PDF without a text layer (a scan); `always` or `never` overrides that |
| `FIGURE_WAIT` | empty | empty: a cited paper's checks wait until its figures are indexed, so the judge can read their captions. A number of seconds is a fast mode: after that the check is judged on the text alone, and a later run of the paper gets the figures. `0` took 85 s instead of 264 s on 15 checks, with one verdict wrong |
| `TEACHER_GOOGLE_ENABLED` | `false` | validates and enables the optional Classroom OAuth connection |
| `TEACHER_GOOGLE_CLIENT_ID` | empty | Google OAuth web-client id |
| `TEACHER_GOOGLE_CLIENT_SECRET` | empty | Google OAuth web-client secret; server-only |
| `TEACHER_GOOGLE_REDIRECT_URI` | empty | exact allowlisted OAuth callback |
| `TEACHER_GOOGLE_ENCRYPTION_KEY` | empty | Fernet key used to encrypt stored refresh tokens; server-only |
| `TEACHER_GOOGLE_SCOPES` | built-in minimum | comma- or whitespace-separated OAuth scope override |
| `TEACHER_GOOGLE_STATE_TTL_SECONDS` | `600` | lifetime of one-time OAuth state/PKCE records |
| `TEACHER_GOOGLE_RETRY_ATTEMPTS` | `3` | bounded attempts for transient Google API failures |
| `TEACHER_GOOGLE_RETRY_BACKOFF_SECONDS` | `0.5` | initial retry backoff |
| `TEACHER_GOOGLE_REQUEST_TIMEOUT_SECONDS` | `30` | Google API request timeout |

The service role key can read and write all data. Keep it on the server and never put it in
the frontend or in git.

### Teacher Google Classroom

The Classroom integration is disabled by default, so local mock teacher development and tests
do not need Google credentials. To enable it for the backend, set `TEACHER_GOOGLE_ENABLED=true`
and all of the required OAuth/encryption variables above.

Set up Google Cloud before enabling the flag:

1. Enable the Google Classroom API and Google Drive API in the selected Cloud project.
2. Configure the OAuth consent screen and add teacher accounts as test users while the app is
   still in testing.
3. Create a Web application OAuth client and register the exact value of
   `TEACHER_GOOGLE_REDIRECT_URI`. The default local callback is
   `http://localhost:8080/api/teacher/google/callback`.
4. The built-in scopes cover Classroom courses, rosters, coursework/submissions, materials,
   announcements, topics, Drive read access, and the signed-in Google subject/email. Request
   only the scopes needed by the deployment if overriding `TEACHER_GOOGLE_SCOPES`.
5. Generate the encryption key from the backend environment with:

   ```sh
   py -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Keep the result in `TEACHER_GOOGLE_ENCRYPTION_KEY`; changing it makes existing encrypted
   refresh tokens unreadable.
6. Apply `supabase/migrations/20260917120000_teacher_classroom.sql` with the Supabase CLI or
   SQL editor. The tables have RLS enabled and no browser policies; only the service role is
   intended to access them.

The frontend remains on its local mock adapter unless `VITE_TEACHER_BACKEND=remote` is set at
frontend build time. `VITE_TEACHER_BACKEND=mock` is the safe default. Never expose the Google
client secret, encryption key, or Supabase service-role key through a `VITE_*` variable.

## Login

Login is on when the gateway has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and the web
image was built with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (build arguments of the
`web` service in `docker-compose.yml`).

- The web app sends the user's Supabase access token as `Authorization: Bearer <token>` on every
  request, including the event stream. A token in the URL is ignored, because access logs record
  URLs.
- The gateway asks Supabase who the token belongs to (`app/auth.py`) and remembers the answer
  for 5 minutes.
- A token Supabase rejects returns `401` with `the session has expired, sign in again`.
- With login on, a request with no token returns `401` with `sign in to use SecretSource`, on
  every route except `POST /verify` and `GET /health`. When the web app has no session to send,
  or gets a `401`, it signs out and shows the sign-in screen.
- Without Supabase settings, login is off: every request is nobody, and every analysis is
  shared, as before login existed.
- A new analysis gets `owner`, the user id of whoever started it (`null` when login is off).
  Each caller sees only analyses whose `owner` is them. Someone else's analysis returns `404`,
  not `403`, so an id does not tell anyone that it exists.
- A paper under `/papers/{name}` is served only when it is the analysed paper, or a cited paper
  a check read, in one of the caller's analyses. Anything else returns `404`.

## Folder layout

```
backend/
├── app/
│   ├── main.py          HTTP gateway: the routes below and the analysis run (_run)
│   ├── config.py        all settings
│   ├── store.py         saves analyses and source lookups (SQLite or Supabase)
│   ├── auth.py          who is asking: the Supabase user behind a request's token
│   ├── researcher.py    the researcher screens, built from one user's analyses
│   ├── sessions.py      where the chat agents keep sessions (Postgres or memory)
│   ├── backfill_titles.py  gives stored analyses the title a new run would give them
│   ├── llm.py           the LLM for ADK (adk_model) and for DSPy (dspy_lm)
│   ├── workflow.py      the same pipeline as an ADK Workflow graph
│   ├── agents/team.py   chat agents: coordinator, rag_agent, paper_agent, verify_agent
│   ├── clients/         HTTP clients for ColBERT, ColPali and GROBID, and identity tokens
│   └── pipeline/
│       ├── claims.py    reads a paper and extracts claims with their citations
│       ├── sources.py   finds and downloads a cited paper
│       ├── verify.py    indexes a cited paper and judges a claim against it
│       ├── figures.py   figure crops, tables and formulas (Docling)
│       ├── rag.py       question answering over indexed papers
│       └── audit.py     checks a finished analysis for problems
├── adk_agents/          entry points for `adk web` (chat and analysis)
├── cli.py               terminal chat with the coordinator
├── a2a_server.py        the agents over A2A
└── tests/
```

If you change what a user sees, change `app/main.py` or `app/pipeline/`. The gateway is the
only part the web app uses.

## Tests

The tests need `google-adk` and `pymupdf`, so run them inside the gateway image:

```bash
docker compose build gateway
docker run --rm -v "$PWD/backend:/app" -w /app secretsource-prototype-gateway \
  sh -c "pip install -q pytest && python -m pytest -q"
```

On Git Bash for Windows, put `MSYS_NO_PATHCONV=1` before `docker run` and use
`$(pwd -W)` instead of `$PWD`.

`tests/test_sources.py` also runs on the host with `pytest tests/test_sources.py`. Lint with
`ruff check backend` from the repository root.

## HTTP API

All routes return JSON unless noted. CORS allows every origin. The web app reaches these
routes under `/api`, for example `/api/analyses`.

Errors use FastAPI's shape: `{"detail": "<message>"}` with a `400` or `404` status.

### Analyses

#### `POST /analyses`

Starts an analysis. It returns at once; the work runs in the background.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `paper` | string | yes | a local path, DOI, arXiv ID or URL |
| `verify` | boolean | no | check each claim against its cited paper; default `true` |

```bash
curl -X POST http://localhost:8080/analyses \
  -H 'Content-Type: application/json' \
  -d '{"paper": "2112.01488"}'
```

Response: `{"id": "3f9c2a7b1d04"}`, a 12-character id.

#### `POST /analyses/upload`

Starts an analysis of an uploaded PDF. The file is saved in `PAPERS_DIR` under its own file
name.

| Parameter | In | Required | Meaning |
| --- | --- | --- | --- |
| `file` | multipart form | yes | the PDF |
| `verify` | query | no | default `true` |

Response: `{"id": "<analysis id>"}`.

#### `GET /analyses`

Every analysis the caller may see, newest first, without `stages`, `references`,
`markers` and `outline`.

#### `GET /analyses/{id}`

One analysis with its results.

| Field | Meaning |
| --- | --- |
| `id` | the analysis id |
| `paper` | what the analysis was started with |
| `status` | `running`, `done` or `error` |
| `message` | the error, when `status` is `error` |
| `file` | the local PDF path, once the paper is read |
| `claims` | the claims found, see below |
| `stages` | every progress event so far, see [Progress events](#progress-events) |
| `audit` | problems the audit found in the finished analysis; usually empty |
| `owner` | the user id of whoever started it, or `null` |
| `title`, `authors`, `year` | the analysed paper's own title, authors and year; missing on older analyses |
| `figures` | the analysed paper's figures whose caption gives their number: `label`, `page`, `caption`, `image` |
| `references` | the references the paper's citation markers point to, by GROBID id (like `b12`); each is a citation (see below) |
| `markers` | where the paper cites a reference: `ref`, `text` (the marker as printed, like `[13]`), `page`, `x0`, `y0`, `x1`, `y1`, `page_width`, `page_height` in PDF points |
| `outline` | the paper's numbered sections in order: `n` (like `3.1`), `title`, `page`, `y` (the top of the heading, in PDF points); missing on older analyses |

Each claim has:

| Field | Meaning |
| --- | --- |
| `claim` | the claim in short form |
| `sentence` | the sentence from the paper it came from |
| `source` | where that sentence is in the PDF: `page`, `boxes`, `page_width`, `page_height`; `null` if not found |
| `section` | the `n` of the outline section the sentence is in, like `3.1`; missing when the sentence was not found or comes before the first numbered heading |
| `citations` | the works the sentence cites: `title`, `authors`, `year`, `doi`, `arxiv`, `url`, `ref` (GROBID's id, like `b12`) and `label` (the number the paper prints, like `13`) |
| `verdicts` | one result per cited work that was checked (same shape as `POST /verify`), plus `cited` |
| `unchecked` | one entry per cited work that could not be checked: `source`, `reason`, `message` |

`reason` is one of `unresolvable`, `no-open-access`, `not-downloadable`,
`lookup-unavailable`, `web-source`, `indexing-failed` or `failed`.

Errors: `404` when the id is unknown.

#### `DELETE /analyses/{id}`

Deletes an analysis. Response: `{"deleted": "<analysis id>"}`. Errors: `404` when the id is
unknown.

A server restart keeps all analyses, because each change is saved. An analysis that was
still running at the restart is marked `error` with the message `interrupted by a restart`.

### Progress events

#### `GET /analyses/{id}/events`

A server-sent events stream (`text/event-stream`). It first sends every stage recorded so
far, then each new stage as it happens. It ends when the analysis is no longer running.

Each event is one `data:` line with a JSON object:

| `stage` | Extra fields | When |
| --- | --- | --- |
| `extracting` | `message` | reading the paper started |
| `extracted` | `claims`, `extracted`, `windows` | claims found; `extracted` is the count before repeats and the cap were removed |
| `planned` | `checks`, `sources` | how many checks will run, against how many cited works |
| `verifying` | `claim`, `source` | a check started |
| `verified` | `claim`, `source`, `verdict` | a check finished |
| `failed` | `claim`, `source`, `reason`, `message` | a cited work could not be checked |
| `figures` | `figures` | the analysed paper's numbered figures were read |
| `audited` | `findings` | the audit ran; `findings` is usually `0` |
| `done` | | the analysis finished |
| `error` | `message` | the analysis failed |

Every event also has `at`, the Unix time it was recorded. `claim` is the index of the claim in `claims`. Checks run in parallel, so events for
different claims arrive in any order. To show verdicts while a run is still going, read
`GET /analyses/{id}` again after `extracted`, `verified` and `failed`.

```bash
curl -N http://localhost:8080/analyses/3f9c2a7b1d04/events
```

With login on, add `-H "Authorization: Bearer <token>"`, as for every other route.

Errors: `404` when the id is unknown.

### Papers

`{name}` is a file name inside `PAPERS_DIR`, for example `2112.01488.pdf`. A name with a
path in it, or one that starts with `.`, returns `400`. A missing file returns `404`.
A paper that is not the analysed paper, or a cited paper a check read, in one of the
caller's analyses also returns `404` (see [Login](#login)).

#### `GET /papers/{name}`

The PDF itself, as `application/pdf`.

#### `GET /papers/{name}/pages/{page}.png`

One page rendered as a PNG. `page` starts at 1. Pages are rendered once and then served
from `PAGE_CACHE`.

| Query | Default | Meaning |
| --- | --- | --- |
| `dpi` | `110` | resolution; values above `300` are lowered to `300` |

Errors: `404` when the page number is out of range.

#### `GET /papers/{name}/figures/{figure}.png`

One cropped figure, the image that a verdict's `pages` entry names in its `image` field.
`figure` must look like `figure-3`; anything else returns `400`. A crop that was never made
returns `404`.

#### `GET /papers/{name}/find`

Finds a piece of text in the paper.

| Query | Required | Meaning |
| --- | --- | --- |
| `q` | yes | the text to find |
| `page` | no | only search this page |

Response: `page`, `boxes`, `page_width`, `page_height` and `coverage` (how much of the text
was matched). Boxes are in PDF points with the origin at the top left. To draw them on a
page image, divide by `page_width` and `page_height`. When nothing is found:
`{"page": null, "boxes": []}`.

### Researcher

These routes build the researcher screens from the caller's own finished analyses; they make
no LLM calls.

#### `GET /researcher/home`

| Field | Meaning |
| --- | --- |
| `alert` | one sentence for the top of the page, for example how many claims a source contradicts |
| `conflicts` | claims a cited work contradicts: `claim`, `for`, `against`, `analysis`, `claimIndex` |
| `queue` | works cited by more than one claim that are not analysed: `paper`, `note`, `identifier` |
| `library` | `papers`, `claims`, `verified`, `tally` |

`tally` counts claims as `backed`, `silent`, `contradicted` and `unchecked`.

#### `GET /researcher/projects`

The caller's projects, newest change first, then `unsorted` when some papers are in no project.
Each has: `id`, `name`, `papers`, `claims`, `clusters`, `tally`, `updated`, and `unsorted: true`
on the last one.

#### `POST /researcher/projects`

Body `{"name": "...", "description": "..."}`. Returns the new project in the same shape.
`400` when the name is empty.

#### `GET /researcher/projects/{id}/library`

One project's papers: `summary`, `clusters`, `papers` (each `id`, `title`, `cite`, `cluster`,
`claims`, `backed`, `contradicted`, `linked`). `backed` and `contradicted` are `null` for a
paper that was not verified. Use `unsorted` as the id for papers in no project. `404` for an
unknown project.

#### `POST /researcher/projects/{id}/papers`

Body `{"analysis_id": "..."}`. Puts one of the caller's analyses in the project and returns the
project. `404` when the analysis or project is not the caller's.

#### `POST /researcher/consensus`

Body `{"question": "..."}`. What the works cited in the caller's papers say about the question,
from verdicts already found: `question`, `supports`, `refutes`, `silent`, `span` (years),
`note`, `rows` (each `paper`, `cite`, `verdict`, `quote`, `claim`, `analysis`, `claimIndex`),
`unlisted` (rows past the first 20).

#### `GET /researcher/graph`

The knowledge graph: `stats`, `clusters`, `nodes`, `edges` (a paper to a claim: `relation` is
`asserts`, `backs`, `contradicts`, `silent` or `unchecked`) and `paperEdges` (paper to paper).
A paper node has `indexed`: `yes` when a public index knew the work, `no` when none did, empty
when the run does not say.

### Other routes

#### `POST /verify`

Checks one claim against one source, outside any analysis.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `claim` | string | yes | the claim to check |
| `source` | string | yes | the cited paper: a local path, DOI, arXiv ID or URL |

A successful check returns:

| Field | Meaning |
| --- | --- |
| `status` | `ok` |
| `verdict` | `supports`, `refutes` or `insufficient` |
| `quote` | the sentence from the cited paper the verdict rests on |
| `reasoning` | one sentence from the model |
| `evidence` | the passages it read: `text`, `page`, `start`, `end`, `score` |
| `pages` | figures or pages ColPali matched: `page`, `score`, `kind`, `label`, `caption`, `image` |
| `page_model` | the ColPali model that matched them; empty when ColPali is down |
| `indexed_in` | which public index found the cited paper, and the ids it gave |
| `claim`, `source` | what was checked |

A failed check returns `status: "error"` with `message` and `reason`.

#### `GET /health`

No login needed. `ok` means the gateway is up. The rest comes from `app/dependencies.py`, from a
check at most 30 s old:

```json
{
  "ok": true,
  "analyses": 12,
  "degraded": false,
  "service_auth": "none",
  "checked_at": 1789360000.0,
  "dependencies": [
    {"name": "llm", "url": "https://gateway.9arm.co/v1", "auth": "api key", "required": true, "ok": true, "detail": "HTTP 200"},
    {"name": "grobid", "url": "http://grobid:8070", "auth": "none", "required": true, "ok": true, "detail": "HTTP 200"},
    {"name": "colbert", "url": "http://colbert:8893", "auth": "none", "required": true, "ok": false, "detail": "ConnectionError: ..."},
    {"name": "colpali", "url": "http://colpali:8894", "auth": "none", "required": false, "ok": true, "detail": "HTTP 200"},
    {"name": "supabase", "url": "", "auth": "none", "required": false, "ok": null, "detail": "not set: analyses are stored in SQLite at ..."}
  ]
}
```

| Field | Meaning |
| --- | --- |
| `degraded` | a required dependency did not answer; analyses will fail until it does |
| `url` | what the gateway calls, without any password or query string |
| `auth` | `google-id-token` for a `*.run.app` URL with `SERVICE_AUTH=google-id-token`, `api key`, `service role key`, or `none` |
| `required` | ColPali is not: checks go on with text passages when it is down. Supabase is only when it is set |
| `ok` | answered with 2xx; for the LLM, also lists `VLLM_MODEL` in `/models`. `null` means not set |
| `detail` | the HTTP status, or the error |

The gateway logs the same list once at startup, and `python -m app.dependencies` prints it.
