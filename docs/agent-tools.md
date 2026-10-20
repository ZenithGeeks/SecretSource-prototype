# Screen agent tools

The screen agent is Ask's **Do it** mode: an ADK agent on the same Qwen model as the rest of the
app, which works the app for the person while they watch the AI cursor move. This page lists
every tool it has, where each runs, and how to add one. The model itself reads the docstrings
in `backend/app/agents/screen.py`; keep this page and those docstrings saying the same thing.

## The tools

| Tool | Runs in | Does | Arguments | Result the agent gets |
|---|---|---|---|---|
| `read_screen` | browser | Lists the screen's name and everything the agent can point at, open or fill in | none | `{screen, targets: [{target, label}]}` |
| `open_screen` | browser | Opens a screen through the app's own navigation | `screen`: `home`, `analyses`, `library` or `graph` | `{status: "done", screen}` or `{status: "error", message}` |
| `open_paper` | browser | Opens an analysed paper on the analyses screen | `analysis_id` from `list_papers` | `{status: "done"}` or `{status: "error", message}` |
| `point_at` | browser | Moves the AI cursor to a target, rings it, shows a note | `target` (`kind:id`), `note` | `{status: "done"}`, or `{status: "error", message: "not on the screen"}` |
| `fill_field` | browser, after the person approves | Shows the text, waits for Apply or Cancel, then types it into the field | `target` (`field:id`), `text` | `{status: "applied"}` or `{status: "cancelled"}` |
| `list_papers` | server | The person's analysed papers, newest first, at most 50 | none | `[{id, title, status}]` |

The agent cannot save, delete, upload or start an analysis. There is no tool for it, and the
instructions tell it to point at the button and let the person press it.

## Targets

A target is `kind:id`, the value of a `data-ask-target` attribute on the page (`lib/askCursor.ts`,
`askTarget()`). `read_screen` lists the ones visible now, each with a label taken from its
`aria-label`, its text, or its `title`. Kinds in use:

| Kind | On | Id |
|---|---|---|
| `screen` | the sidebar's screen buttons | the screen's key, such as `library` |
| `field` | a text field the agent may fill | a fixed name, such as `library-search` |
| `paper` | a paper in a list | its analysis id |
| `claim`, `passage`, `reference` | the labeler workspace (PR #611) | claim id, passage id, reference id |
| `statement`, `question` | the Ask panel | the answer's turn and statement |

To make something reachable, give it `data-ask-target={askTarget({ kind, id })}`. A field also
needs to be a real `<input>` or `<textarea>`: `fill_field` types into it the way a person would,
so React sees the change.

## How a turn runs

1. The browser POSTs the person's message to `/api/agent/runs` with the screen they are on.
2. The stream sends `{"type": "session", "id"}`, then the agent's steps: `{"type": "step", "name"}`
   for a server tool, `{"type": "say", "text"}` for its words.
3. A browser tool arrives as `{"type": "tool", "id", "name", "args"}` and the stream ends with
   `{"type": "done"}`. The browser runs it from the registry in `frontend/src/lib/agentTools.ts`
   with the cursor, then POSTs `{id, name, result}` to `/api/agent/runs/{session}/results`. That
   answer is a new stream, and the loop goes on until a `done` with no tool before it.

A request makes at most 8 model calls (`MAX_LLM_CALLS`); past that the agent says it stopped.
Conversations live in the gateway's memory for an hour.

## Adding a tool

1. Write the function in `backend/app/agents/screen.py`. A browser tool has only a docstring and
   goes in `SCREEN_TOOLS`. A server tool has a body, and goes straight into `tools=[...]`. The
   docstring is the model's documentation: say what it does, what it returns, and `Args:`.
2. For a browser tool, add its runner to `frontend/src/lib/agentTools.ts`. Animate with the cursor
   first, act second, and return a small JSON object the agent can read. Anything that changes
   data must go through the confirm step, as `fill_field` does.
3. Add a row to the table above. `backend/tests/test_agent_runs.py` checks that every tool the
   agent has is listed here.
4. Run the eval (`backend/eval_screen_agent.py`) before and after. A new tool changes what the
   model chooses for every task, not only the new ones.
