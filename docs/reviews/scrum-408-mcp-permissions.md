# MCP tool permissions (SCRUM-408)

Reviewed 26 Oct 2026 on `main` at `3ca6450`, after [#705](https://github.com/ZenithGeeks/SecretSource-prototype/pull/705). This is the second pass on [#679](https://github.com/ZenithGeeks/SecretSource-prototype/pull/679) and [#680](https://github.com/ZenithGeeks/SecretSource-prototype/pull/680), for [issue #689](https://github.com/ZenithGeeks/SecretSource-prototype/issues/689).

The question was whether a connected agent (Claude Code or Codex, through Gatehouse, at `/mcp/`) can still run a tool the person did not allow. [#705](https://github.com/ZenithGeeks/SecretSource-prototype/pull/705) fixed the one fail-open from the first pass: a stored `agentAccess` of `false`, `0`, `""` or `[]` now counts as read only, the same as Settings. [Issue #739](https://github.com/ZenithGeeks/SecretSource-prototype/issues/739) already owns the two follow-ups. They are still open on this commit, and this pass did not change them.

No further permission bypass turned up. Nothing else in this area needs a code change.

## Still open, and already in #739

**Two access saves can finish out of order.** `useAgentAccess` in `frontend/src/lib/agentAccess.ts` sends the whole `agentAccess` object on each click and does not cancel the request. `PATCH /user/preferences` (`backend/app/main.py`, `_merge_preferences`) keeps a lock so two merges do not drop unrelated keys, then stores whichever `agentAccess` it applies last. The person's last click can lose, and the broader level can come back.

One more path belongs with that fix. `usePatchPreference` (`frontend/src/lib/useAccountSettings.ts`) writes the whole response into the preferences cache when any settings PATCH succeeds. A slower PATCH for another key, one that read the blob before the access click, can paint the older `agentAccess` back on screen after the click has already been stored. The next click in `agentAccess.ts` computes the new value from that cache. A revision that ignores an older `agentAccess`, which is what #739 asks for, has to apply to every preferences response, not only to two access clicks.

**`check_my_draft` is offered when `check_text` is off.** `list_prompts` and `get_prompt` in `backend/app/mcp_server.py` always return that prompt. The prompt tells the agent to call `check_text`. `call_tool` still refuses the call when the tool is not allowed, so this does not read or change data. A custom list that omits `check_text` still advertises the slash command.

## What holds

`tools/list` and `tools/call` both go through `allowed_tools`. A tool that was listed and later turned off is refused on the call, with a message that names Settings, Agents.

A missing preference and JSON `null` are full access. That is the default #679 shipped so existing agents kept working. Any other shape is read only: a non-object, an unknown `level`, `custom` whose `tools` is not a list, and the falsy values #705 closed. `readAccess` in `frontend/src/lib/agentAccess.ts` reads those the same way. An empty custom list allows nothing. A custom list keeps only strings, and `call_tool` runs a name only when it is a real tool.

Read only is the 12 names in `READ_ONLY`. The Settings card lists those 12 as Read and six as Acts (`open_screen`, `open_paper`, `point_at`, `fill_field`, `submit_analysis`, `review_claim`). That is the same 18 tools `/mcp/` serves: the screen tools, the data tools, and `review_claim`. `submit_analysis` and `review_claim` are outside `READ_ONLY`. `review_claim` writes a review row.

Tools added for the in-app role agents are not on `/mcp/`: `switch_role`, `labeling_papers`, `claim_passages`, `list_drafts`, `draft_issues`. Putting one of those names in a custom list does not run it. `load_memory` is not on `/mcp/` either.

The caller is the Gatehouse email, checked with `GATEHOUSE_SECRET` (`backend/app/auth.py`). A missing secret, a wrong secret, a key with no email, and an unconfirmed email are refused. Data tools take the person from the context `call_tool` sets. Passing `tool_context` in the arguments raises `TypeError` before the tool runs. `get_analysis`, `get_claim`, `find_in_paper` and `bibtex` go through `_owned`: someone else's analysis is a 404 with the same text as a missing one. `search_claims` and `get_gaps` read `visible_to`. `find_support`, `check_text` and `ask_library` search `papers_of`.

`papers_of` includes PDFs shared with the labeling team. That matches the labeler and the Ask panel. It is not a hole these two pull requests opened.

`find_support`, `check_text` and `ask_library` do not take a paper list from the client. ColBERT's own MCP tool is separate: it returns passages only for names in `X-Paper-Scope`, and with no header it returns nothing. The gateway's search uses `papers_of`. The connected agent does not set that header.

Screen-tool results are accepted only from the same user's tab (`backend/app/screen_bridge.py`). `fill_field` types into an `<input>` or `<textarea>` that has `data-ask-target`, and only after Apply. The access card's checkboxes and its search box are not those fields, and Settings has no `data-ask-target`, so a limited `fill_field` cannot tick itself more tools.

The agent has a Gatehouse key, not the Supabase session. `PATCH /user/preferences`, `POST /agent/tools/{name}` and `POST /agent/runs` use `current_user`. Those routes do not read `agentAccess`, and a Gatehouse key cannot call them. The in-app Do it agent and the Ask `/` commands are the person, on their own session. The setting limits the connected agent.

The preferences row is one JSON object (`jsonb`, and the only writer merges two objects). `allowed_tools` treats a missing row as full access. A falsy non-object in that column would take the same path, because of `or {}` in front of the non-object check. The app cannot store one.

## Verdict

The allow-list holds for the shapes Settings writes and for the unreadable shapes #705 closed. The two gaps that remain are the ones in #739.
