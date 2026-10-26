# Spec: Assistant memory

Status: draft for review, 2026-10-17. Part of the SecretSource Assistant
(`docs/ideas/secretsource-assistant.md`, PR #485). Sources: ADK memory docs
(https://adk.dev/sessions/memory/) and Google's post on ADK state and memory
(https://cloud.google.com/blog/topics/developers-practitioners/remember-this-agent-state-and-memory-with-adk).

## Objective

The assistant should remember what a researcher has already studied, across chats, so they
don't have to explain it again. Example: "Last week you read ColBERT ’20 and asked why BEIR
disagrees with it. BEIR ’21 is in your library now."

Who it's for: a signed-in researcher using the assistant panel (Graph, Library, Analysis
screens).

Decisions made on 2026-10-17:

| Question | Decision |
| --- | --- |
| Where memory lives | Our own `BaseMemoryService`, backed by a Supabase table. No Vertex Memory Bank |
| What counts as learned | A few facts distilled by the LLM at the end of each chat. The user can see and delete them |
| How a chat reads memory | `load_memory`, called by the agent when past context helps. No `preload_memory` |
| Chats | Each chat is its own ADK session. Only distilled memory and `user:` state carry over between chats |

ADK terms, as this spec uses them:

- **Session state** holds what one chat is doing right now: the screen context and the
  current paper. It's lost with the session.
- **`user:` state** holds small settings that follow the user into every chat, for example
  `user:answer_length`. This spec reserves the prefix but adds no setting yet.
- **Memory** holds distilled facts that the agent reads with `load_memory`. This spec is
  about memory.

### User stories

1. When I start a new chat and ask about a paper I discussed before, the assistant knows
   what I already asked and builds on it.
2. I can see everything the assistant remembers about me, and I can delete any item.
3. Another user's memory never shows up in my chats, and mine never shows up in theirs.
4. The assistant remembers only statements that were backed by a source. It never
   remembers its own unbacked statements as facts.

## How it works

```
chat turn ──> runner (user_id from login) ──> agent may call load_memory
                                               └─> AssistantMemory.search_memory
                                                     ├─ learned facts (owner = user)
                                                     └─ past analyses (owner = user)

chat ends ──> enqueue distill job (RQ) ──> worker: 9arm reads the session events
                                            └─> upsert 0..5 facts into public.learned_facts
```

### Facts table: `public.learned_facts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk | `gen_random_uuid()` |
| `owner` | uuid, not null | references `auth.users(id)` on delete cascade |
| `kind` | text, not null | `paper`, `concept` or `question` (a question left open) |
| `subject` | text, not null | e.g. `ColBERT ’20` or `late interaction` |
| `summary` | text, not null | at most 300 characters, in the user's words where possible |
| `analysis_id` | text, null | set when the fact is about a paper in the library |
| `session_id` | text, not null | the ADK session the fact came from |
| `created_at`, `updated_at` | timestamptz | |

- Unique on `(owner, kind, lower(subject))`. When a chat produces a fact that already
  exists, the summary is replaced, so a subject never gets a second row.
- RLS is on. Policies: `select` and `delete` where `owner = auth.uid()`. There's no
  insert or update policy, because only the worker writes, with the service key.
- It lives in `public`, not `adk`, because the web app has to list and delete facts
  through Supabase with the user's own token. The ADK tables stay in `adk`.

### When a chat ends

ADK has no end-of-session event, so the gateway decides:

1. The user clicks New chat or closes the panel: the gateway enqueues `distill(session_id)`
   for the chat they left.
2. On the user's next request, every one of their sessions idle for more than 30 minutes
   and not yet distilled is enqueued. This needs no scheduler and nothing that bills with
   no traffic (CONSTRAINTS.md).

The marker is session state `distilled_at`. The gateway sets it when it queues the job, so a
chat is not queued again on every request while the job waits. The worker may not be able to
reach the chat, so the job cannot set it. A failed job is tried again after 1, 5 and 15
minutes (`DISTILL_RETRY` in `app/queue.py`); one that fails all four times stays in RQ's failed
jobs, and its chat is distilled again only after it changes. A session that changes after it
was distilled is distilled again on the same rules, and its facts are upserted, not duplicated.

### Distilling

One DSPy step on 9arm reads a session's events and returns 0 to 5 facts.

- It sees the user's messages and the assistant's statements, each with its judge
  verdict.
- A fact may only come from a user question or from a statement marked backed. A
  statement marked "not backed" is never a source for a fact. Code enforces this (see
  the next point); the prompt alone isn't trusted to.
- Guard: every fact must point to the event ids it came from. Code drops any fact whose
  events include no user message and no backed statement.
- Prompt and model go into the cache key, as with the judge.

### Search

`AssistantMemory(BaseMemoryService)` replaces `AnalysisMemory` in the assistant's runner.

- `search_memory(app_name, user_id, query)` returns up to 5 entries: learned facts first,
  then verdicts from past analyses. All of them are filtered to `owner = user_id`.
- Matching uses the same word overlap as `app/memory.py` today (shared `_words`). Vector
  search waits until the eval shows word matching misses facts.
- With login off (`user_id` empty), it returns only analyses without an owner, as today.
- `add_session_to_memory` does nothing. ADK calls it only from an agent callback or the ADK
  web server's memory route, and the assistant uses neither, so the chat routes queue
  the distill job themselves (`_queue_distills` in `app/main.py`, on New chat and on listing
  chats), with no LLM work in the request.
- The A2A server and `cli.py` keep `AnalysisMemory`. They have no login, so they read only
  analyses without an owner.

### Gateway API

| Route | What it does |
| --- | --- |
| `GET /memories` | the caller's facts, newest first (also readable straight from Supabase under RLS) |
| `DELETE /memories/{id}` | deletes one of the caller's facts; 404 if it belongs to someone else |
| `DELETE /memories` | deletes all of the caller's facts |

All three use `Depends(current_user)`. The assistant chat route that runs the runner
belongs to the assistant panel's spec, not this one. This spec only requires that the
route passes `current_user`'s id as `user_id`.

## Tech stack

- Python 3.12, FastAPI gateway, `google-adk[extensions,a2a,mcp]>=2.8,<3` (pinned in
  `backend/requirements.txt`).
- Supabase Postgres (migration in `supabase/migrations/`), `supabase-py` with the service
  key for the worker.
- RQ worker (`backend/worker.py`) for distilling, so no LLM call runs inside a request.
- DSPy on the 9arm OpenAI-compatible endpoint, like the other LLM steps.

## Commands

Tests run in the gateway image with `backend` mounted, because host Python can't import
the pipeline (memory `local-dev-environment`):

```
docker run --rm -v D:/senior-project/SecretSource-prototype-wt/memory-spec/backend:/app -w /app ss-gateway:direct-upload python -m pytest tests/test_memory.py tests/test_learned_facts.py tests/test_distill.py -q
docker run --rm -v D:/senior-project/SecretSource-prototype-wt/memory-spec/backend:/app -w /app ss-gateway:direct-upload python -m pytest -q
ruff check backend && ruff format --check backend/app/memory.py backend/app/learned_facts.py backend/app/distill.py
python backend/eval_distill.py --runs 3   # distill eval, see Testing
```

Apply the migration on a Supabase branch first (`mcp__supabase__create_branch`), never
straight to production.

## Project structure

```
backend/app/memory.py          AssistantMemory next to AnalysisMemory; shared _words, search
backend/app/learned_facts.py   table access: list, delete, upsert, search (owner always passed in)
backend/app/distill.py         DSPy signature, the guard, enqueue helpers, the RQ job
backend/app/main.py            /memories routes
backend/eval_distill.py        repeated-run eval over docs/eval/distill-sessions.jsonl
backend/tests/test_learned_facts.py, test_distill.py, test_memory.py (extended)
supabase/migrations/2026MMDDhhmmss_learned_facts.sql
docs/eval/distill-sessions.jsonl  real chat transcripts with the facts a person expects
```

## Code style

Follow `human-code` and the existing `app/memory.py`: short single-job functions, the
owner passed explicitly, comments that say why.

```python
def keepable(fact: Fact, events: dict[str, Event]) -> bool:
    """A fact needs a user question or a backed statement behind it. The prompt says the
    same, but an unbacked statement saved as memory would come back as truth in later chats,
    so code checks it too."""
    sources = [events[event_id] for event_id in fact.event_ids if event_id in events]
    return any(event.author == "user" or event.verdict == "backed" for event in sources)
```

Commit and PR titles: `<type>(SCRUM-n): ...`, no AI attribution.

## Testing strategy

- **Unit (pytest, no network):**
  - `search_memory` returns only the caller's facts and analyses. A fixture has two users
    sharing a subject, and the test asserts each user's results exclude the other's.
  - The guard drops facts that rest only on "not backed" statements.
  - The upsert keeps one row per subject.
  - Idle-session selection picks exactly the sessions idle for more than 30 minutes and
    not yet distilled.
- **RLS (on a Supabase branch):** with user B's token, user A's facts can't be selected or
  deleted; insert fails for every non-service role. Check `has_table_privilege` as well as
  the policies.
- **Distill eval (ADLC):**
  - Eval set: 20 real assistant transcripts, with the facts a person expects written next
    to each.
  - Each eval run repeats the set 3 times without the cache.
  - Thresholds:
    - Unbacked facts stored: 0 in every run. This is the costly error.
    - Expected facts recalled: at least 70%.
    - Facts per session: at most 5.
- **Cost:** log tokens per distill call next to `llm_tokens`. Priced at Gemini 2.5 Flash
  list prices (as CONSTRAINTS.md does), one distill should stay under $0.005.

## Boundaries

- **Always:**
  - Pass the owner into every read and write.
  - Run the RLS test on a branch before the migration goes to production.
  - Keep LLM work in the worker.
  - Run the distill eval when the prompt or model changes.
- **Ask first:**
  - Applying the migration to production Supabase.
  - Adding vector search or embeddings.
  - Any read of facts or analyses across users (owner-only decision, 2026-09-27).
  - Adding `preload_memory`.
  - Adding a `user:` setting.
  - Changing CONSTRAINTS.md.
- **Never:**
  - Put ADK or fact tables in `public` without RLS.
  - Point a dev worker at the production `REDIS_URL`.
  - Store a fact built from a "not backed" statement.
  - Send chat content to a third-party memory service.

## Success criteria

1. A fact distilled from chat 1 comes back through `load_memory` in a new chat for the same
   user, and never for another user. Covered by unit tests and one manual check on the
   local stack.
2. `GET` and `DELETE /memories` work for the owner. Deleting another user's id returns 404.
3. RLS test passes on a Supabase branch.
4. Distill eval:
   - 0 unbacked facts in 3 of 3 runs.
   - At least 70% recall.
   - At most 5 facts per session.
5. The assistant's request path makes no LLM call for memory. Distilling only happens in
   RQ jobs.
6. Nothing new bills with no traffic.

## Open questions

1. Where do the 20 eval transcripts come from before the assistant exists? Proposal:
   write them from real questions on the three eval papers, using the existing chat agents
   through `cli.py`.
2. Should a fact link to the paper node so the graph can show "you studied this"? That's
   UI, so it belongs to the panel spec. The `analysis_id` column keeps that option open.
3. How long do facts last? There's no expiry for now; users delete them by hand.
