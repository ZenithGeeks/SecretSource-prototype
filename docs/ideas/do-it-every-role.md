# Do it in every role

One-pager from the idea-refine session on 2026-10-26 (SCRUM-444). It started as "make Ask AI's
Do it work in every role, let it move between roles to finish a task, and give each role its
important tools".

## Problem Statement

How might we let a user hand the Do it agent a task in any role, and have it finish the task
even when it lives in another role, without it ever changing data on its own?

## Today

- Do it is wired only in the Researcher role: `ResearcherApp.tsx` passes `actions` to Ask.
  Author and Teacher have Answer only. Labeler has its own `AskPanel` with no Do it.
- `open_screen` in `backend/app/agents/screen.py` lists only the Researcher screens.
- All 12 tools in `backend/app/agents/data_tools.py` are Researcher tools.
- Only `fill_field` changes anything, after the person presses Apply. The agent cannot change role.

## Recommended Direction

One ADK agent per role (Researcher, Labeler, Author), each built from the shared screen tools,
that role's own tools, and `switch_role`. The runner picks the agent from the role the request
comes from. Fewer tools per agent means fewer wrong-tool picks and a smaller prompt than one
agent with every tool.

Tools that change data, and `switch_role` itself, run in the browser after the user presses
Apply, through the app's own API. Writes then use the user's login and permissions, and nothing
new on the backend can write.

Role tools, first cut:

- Researcher: what exists today.
- Labeler: open the next claim, show its best passages, jump to a passage on the page, labeling
  progress. No verdict suggestions: labels are the gold set `eval_verdicts.py` scores the judge
  against, and a suggested label would bias them.
- Author: list and open drafts, start a draft check (after Apply), read its issues (missing keys,
  unsupported citations), find a source for a sentence (`find_support`), point at the line.

## Key Assumptions to Validate

- [ ] Every account can switch to Researcher, Labeler and Author: read the role gate in the app
      before building `switch_role`.
- [ ] ADK keeps one session's history when the root agent changes between requests (same
      `app_name` and session service): one spike test.
- [ ] Per-role agents with about 10-12 tools stay accurate: extend `eval_screen_agent.py` with
      about 6 tasks per role, switch tasks, and safety tasks (no write without Apply, no label
      suggestion), 2 runs each.

## MVP Scope

In: Do it wired in Labeler and Author; per-role agents; the Labeler and Author tools above;
`switch_role` with Apply; one general Apply step for writes in the browser; eval tasks per role.

Out: everything in Not Doing.

## Not Doing (and Why)

- The Teacher role: it needs the Google Classroom connection, and that path is untested with the agent.
- Agent-suggested labels: they would bias the gold labels the thesis is scored on.
- A roleless agent whose tools follow the user's data: a bigger rework, past the 2026-11-06 freeze.
- Multi-step workflows across a whole class or library: too many LLM calls for the 9arm key's 3 slots.
- Saving Do it chats like Answer chats: a separate ticket.

## Open Questions

- Which roles can each account switch to?
- Author: may the agent insert a `\cite{}` into the draft after Apply, or only point at the line?
- The prompt-injection review of #619 (`fill_field` types text taken from the screen) should come
  before more write tools ship.
