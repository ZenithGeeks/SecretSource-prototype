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
| `get_analysis` | server, `data_agent` | One analysis: status, why it failed, claims per standing, each claim with its number | `analysis_id` | `{id, title, status, stage, message, standing, claims: [{number, claim, section, standing}]}` |
| `get_claim` | server, `data_agent` | The evidence behind one claim: verdict, quote and reasoning per cited paper, and citations that could not be checked | `analysis_id`, `claim_number` (from 1) | `{claim, sentence, standing, verdicts, unchecked}` |
| `search_claims` | server, `data_agent` | Claims in the person's papers that share words with the query, best first, at most 10 | `query` | `{claims: [{analysis_id, title, number, claim, standing}]}` |
| `find_in_paper` | server, `data_agent` | The page of a paper's PDF where some text sits | `analysis_id`, `text` | `{page}`, `page` is null when the text is not there |
| `find_support` | server, `data_agent` | Passages in the person's papers that bear on a claim (search only, no judge) | `claim` | `{passages: [{paper, page, text}]}` |
| `check_text` | server, `data_agent` | Judges each of the first 6 sentences of some writing against the paper whose passage fits it best | `text` | `{results: [{text, source, page, verdict, quote, reasoning}], not_checked}` |
| `ask_library` | server, `data_agent` | Answers a question from the person's papers, as the Ask panel does, each statement judged | `question` | `{statements: [{text, source, page, verdict, quote, reasoning}]}` |
| `get_gaps` | server, `data_agent` | Claims no cited work backs, claims one contradicts, works cited but not held; up to 10 of each | none | `{notBacked, contradicted, missing}` |
| `bibtex` | server, `data_agent` | BibTeX entries for a paper and the works its claims cite | `analysis_id` | `{bibtex}` |
| `submit_analysis` | server, `data_agent` | Starts an analysis of a DOI, arXiv ID or URL in the background | `paper` | `{id, status}`; poll `get_analysis` |
| `load_memory` | server, `data_agent` only | What the person studied or asked in earlier chats (SPEC.md), then findings from their own analyses, at most 5. Not on MCP or `/commands` | `query` | `{memories: [{content, timestamp}]}` |
| `labeling_progress` | server, `data_agent` | Where the person stands on one paper in the labeler: claims saved and reviewed, and the first unsaved claim with its passages. Reads only | `analysis_id` | `{claims, saved, reviewed, next_unsaved}` |

The agent cannot save labels, delete or upload anything. There is no tool for it, and the
instructions tell it to point at the button and let the person press it. It can start an
analysis with `submit_analysis`, which only queues a run the person sees in their list.

The screen agent is a coordinator. It keeps the browser tools and `list_papers`, and hands anything
that needs the contents of the person's papers to `data_agent`, a specialist with the server tools
below (`backend/app/agents/screen.py`). `data_agent` runs in one turn and gives its answer back to
the coordinator, which words the reply. A coding agent over MCP has no `data_agent`: it gets the
server tools directly. Each hand-over reaches the browser as an event (see How a turn runs) and
shows in the chat as a badge: working, then done or failed.

The server tools are in `backend/app/agents/data_tools.py`. They read only the caller's own
analyses; an id that is not theirs comes back as "no analysis ... among your papers", the same as
a missing one.

## Commands in the Ask input

The person can run the server tools by hand in the Ask panel (`frontend/src/components/AskInput.tsx`,
`frontend/src/lib/askCommands.ts`). Typing `/` lists the commands and `@` lists their papers, for
example `/get_claim @Lost in the Middle 2`. A command runs the tool through
`POST /agent/tools/{name}` (`backend/app/agent_runs.py`) with the caller's own data, and its result
shows as statements (`/check_text`, `/find_support`) or as a note. A command that takes a paper
uses the one that is open when none is named. Commands are not saved in the chat history.
`/ask_library` is not a command: a plain question does the same. The labeler's Ask AI question box takes the same commands, always on the open paper (no `@` list there). The labeler can also be connected to a coding agent over MCP: `?connect=agent` shows the connect screen, and `read_screen` lists its claims, passages and references.

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
   for a server tool, `{"type": "agent", "name", "state", "task"}` when it hands work to a specialist
   (`state` is `working`, then `done` or `failed`; `task` comes with `working`), `{"type": "say", "text"}`
   for its words.
3. A browser tool arrives as `{"type": "tool", "id", "name", "args"}` and the stream ends with
   `{"type": "done"}`. The browser runs it from the registry in `frontend/src/lib/agentTools.ts`
   with the cursor, then POSTs `{id, name, result}` to `/api/agent/runs/{session}/results`. That
   answer is a new stream, and the loop goes on until a `done` with no tool before it.

A request makes at most 8 model calls (`MAX_LLM_CALLS`); past that the agent says it stopped.
Conversations live in the gateway's memory for an hour.

## Adding a tool

1. Write the function in `backend/app/agents/screen.py`. A browser tool has only a docstring, goes
   into `tools=[...]` as `LongRunningFunctionTool(func=...)`, and its name goes in
   `SCREEN_TOOL_NAMES`. A server tool has a body, and goes straight into `tools=[...]`; `/mcp/`
   needs a branch for it in `call_tool` (`backend/app/mcp_server.py`), unless it belongs in
   `DATA_TOOLS` in `data_tools.py`, which the agent and `/mcp/` both pick up. A tool that
   changes nothing also goes in `READ_ONLY` in `mcp_server.py`, so MCP clients can run it
   without asking. The docstring is the
   model's documentation: say what it does, what it returns, and `Args:`.
2. For a browser tool, add its runner to `frontend/src/lib/agentTools.ts`. Animate with the cursor
   first, act second, and return a small JSON object the agent can read. Anything that changes
   data must go through the confirm step, as `fill_field` does.
3. Add a row to the table above. `backend/tests/test_agent_runs.py` checks that every tool the
   agent has is listed here.
4. Run the eval (`backend/eval_screen_agent.py`) before and after. A new tool changes what the
   model chooses for every task, not only the new ones.

## Using the tools from Claude Code or Codex (MCP)

The gateway serves the same tools over MCP at `/mcp/` (`backend/app/mcp_server.py`), for Claude
Code, Codex or any other MCP client. The client takes the screen agent's place: it plans the steps,
and the person's open tab runs each screen tool with the cursor. `list_papers` and the data tools run on the
gateway, with no tab needed. `fill_field` still waits for Apply in the tab, up to 120 s.

MCP also has one tool the screen agent does not: `review_claim(analysis_id, claim_number)`, the
labeler's Review from Ask AI. It runs on the gateway with the same rules as the button: only a
claim the caller has saved, it never changes a label, and what it found goes to the reviews tab
(`docs/labeling.md`). It needs no tab, and it can take over a minute.

The tools that only read are marked `readOnlyHint`, so a client can run them without asking each
time.

The person chooses which tools an agent gets: full access (the default), read only (the
`readOnlyHint` tools), or a list of tools. The choice is the `agentAccess` preference, and
`allowed_tools` in `mcp_server.py` applies it to both `tools/list` and `tools/call`. An unreadable
value counts as read only.

The server also offers one prompt, `check_my_draft`, which Claude Code lists as a slash
command: it asks the agent to run `check_text` on the writing you give it.

Settings, Agents in the web app shows steps 2 and 3 with a copy button, and links to step 1.

1. Open SecretSource with `?connect=agent` in the address (or press Connect this tab in Settings,
   Agents, or open Ask, choose Do it and press "Connect Claude Code or Codex"), check what the
   agent may do, and press Allow. The tab then
   holds `/api/agent/bridge` open (`backend/app/screen_bridge.py`) and shows an Agent pill
   beside Ask, with the recent steps, any change waiting for Apply, and Disconnect. The tab stays
   connected across reloads until you disconnect. One tab per account: allowing a second tab
   moves the bridge there.
2. Get a Gatehouse key whose email is the one you sign in to SecretSource with. Gatehouse sends
   that email and `GATEHOUSE_SECRET` with each call; the gateway matches the email to a
   confirmed SecretSource account.
3. Add the server to your agent. Claude Code takes one command, with the key in place of
   `YOUR_KEY`; it keeps the key in its own config, and it works in every project:

   ```sh
   claude mcp add --transport http --scope user secretsource https://wttw-1.tailcf73b7.ts.net:8443/secretsource/mcp/ --header "apikey: YOUR_KEY"
   ```

   Codex reads `~/.codex/config.toml`, with the key in the `GATEHOUSE_KEY` environment variable:

   ```toml
   [mcp_servers.secretsource]
   url = "https://wttw-1.tailcf73b7.ts.net:8443/secretsource/mcp/"
   env_http_headers = { "apikey" = "GATEHOUSE_KEY" }
   tool_timeout_sec = 300  # review_claim can run past Codex's 60 s default
   ```

   VS Code reads `.vscode/mcp.json` and fills in only its own variables (`${env:NAME}`,
   `${input:id}`); `${GATEHOUSE_KEY}` there fails with "Variable `GATEHOUSE_KEY` not found". This
   entry asks for the key the first time and keeps it in VS Code's secret storage:

   ```json
   {
     "inputs": [
       { "type": "promptString", "id": "gatehouse-key", "description": "Gatehouse key", "password": true }
     ],
     "servers": {
       "secretsource": {
         "type": "http",
         "url": "https://wttw-1.tailcf73b7.ts.net:8443/secretsource/mcp/",
         "headers": { "apikey": "${input:gatehouse-key}" }
       }
     }
   }
   ```

   Keep the trailing slash: `/mcp` answers with a redirect. With sign-in off (local stack with no
   Supabase), `http://localhost:8080/mcp/` works without a key.

A screen tool with no tab connected returns an error that says how to connect one. The MCP
server is stateless, but the bridge lives in one gateway process's memory, like the
conversations above.
