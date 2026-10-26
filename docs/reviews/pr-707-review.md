# Review of PR #707 (user-scoped retrieval)

Reviewed on `main` at `3ca6450` (PR #707 merge `b45073f`). Verdict: **holds** for the user-facing ColBERT paths #707 closed. No blocking leak remains through `rag_agent`, assistant chat, the app's MCP server, or a scoped retriever span.

Two smaller holes on `main` are fixed with this review: ColPali's MCP tool `search_media` still searched the whole index, and CI never ran `Store.search`.

## What holds

`answer_from_docs` and `search_passages` (`backend/app/pipeline/rag.py`) take the caller from `tool_context.state["user"]` and search only `papers_of` (`rag.py` lines 60-69, 87-94, 149-155). An empty set returns nothing and does not call ColBERT. Naming another person's file intersects to empty and does not search. `rag_agent` no longer attaches ColBERT's MCP toolset (`backend/app/agents/team.py` line 64).

ColBERT MCP `search_passages` reads `X-Paper-Scope` (`services/colbert/server.py` lines 128-133). A missing header, bad JSON, an empty list, or a `source` outside the list returns `{topk: []}` before `store.search`.

`POST /api/search` with `sources` limits `Store.search` (`services/colbert/server.py` lines 236-240, `services/colbert/store.py` lines 228-236). An empty list searches nothing. The gateway client sends that list and drops any hit whose `source` is outside it (`backend/app/clients/retrieval.py` lines 153-178), including from the span.

Assistant chat, `find_support`, `check_text`, and `ask_library` pass `papers_of(user)` into `library_passages` (`backend/app/main.py` around the chat reply, `backend/app/agents/data_tools.py`). An empty set does not search (`backend/app/assistant.py` lines 127-136). `library_passages(papers=None)` is only the eval scripts (`backend/eval_assistant.py`, `backend/eval_assistant_stream.py`). That span hashes the file name and omits passage text (`retrieval.py` `_record_hits`).

A scoped retriever span records passage text only for papers in the scope. An unscoped span stores `sha256:<16 hex> p<page>` and the score, and leaves `document.content` off.

`papers_of` is one user's analyses, the papers those checks cited, their Author PDFs, and papers an owner has shared with the labeling team (`backend/app/main.py` `papers_of`, `backend/app/labeling/pool.py`). Shared labeling papers are readable by other signed-in people on purpose.

## Fixed here

**ColPali MCP was unscoped.** `search_media` (`services/colpali/server.py`) searched every indexed paper when `source` was omitted, and nothing in the tool checked who was calling. `ARCHITECTURE.md` tells agents to use that MCP endpoint. Captions, file names, and crop paths from every paper came back. The analysis path did not use this tool: `verify._visual` calls HTTP with one file name and drops other hits (`backend/app/pipeline/verify.py` `_visual`). The gateway client now drops a hit whose file name is not the requested `source` before the answer and before the span (`retrieval.py` `colpali_search`), so a service that ignores `source` cannot put another user's caption on the trace. `search_media` now requires `X-Paper-Scope`, the same rule as ColBERT. HTTP `GET`/`POST /api/search` on ColPali is unchanged: with no `source` it still searches the whole index (`services/colpali/server.py` `search`). The pipeline always passes `source`.

**CI skipped the store tests.** `.github/workflows/ci.yml` ran `test_server*.py` only. Those tests replace `store.search` with a fake that repeats the filter, so a break in `Store.search` would stay green. CI now also runs `services/colbert/test_store.py` and `services/colpali/test_store.py`. ColBERT's store module imports `pypdf`, which the backend venv did not install, so the job installs it first.

## Follow-ups (not fixed)

These are real, and they are not a small change on top of the analysis pipeline.

1. **ColBERT `GET /api/search` and `POST` without `sources` still search the whole index** (`services/colbert/server.py` lines 231-240). No gateway route calls `GET`. The client always posts `source` or `sources` for a user. Anyone who can reach the service can still read every passage. Compose publishes ColBERT on `127.0.0.1`. `deploy/cloudrun.sh` still deploys it with `--allow-unauthenticated`. Cloud Run is scaled to 0 until the release (`CONSTRAINTS.md`). Closing `GET` means deciding the old dspy-shaped route is unused.

2. **ColPali HTTP with no `source` is the same hole** for captions, file names, and crop paths (`services/colpali/server.py` `search`). `verify._visual` always passes `source` and filters. The service itself does not know the user.

3. **`X-Paper-Scope` is not an authenticated user.** The header is a list of file names. A caller who can reach ColBERT or ColPali `/mcp` and can name files can read those files. The gateway does not forward a browser user to that header. `rag_agent` does not call the endpoint.

4. **`verify_claim` searches whatever PDF path it is given** (`backend/app/pipeline/verify.py` `verify_claim`, `evidence_from`). The analysis worker has to check a cited paper that is not in `papers_of` yet. Uploads are stored as `<stem>-<12 hex of sha256>.pdf` (`backend/app/main.py` `save_upload`), so a guess is not a file name. Scoping the agent tool without breaking fetch-then-check is a separate change.

5. **An unscoped span still stores a 16-hex SHA-256 prefix of the file name and the score.** Passage text is omitted. A short, known file name can be matched against that prefix by someone who can read the Phoenix project. That is the trade #707 chose.
