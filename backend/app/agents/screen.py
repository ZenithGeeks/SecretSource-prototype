"""The screen agents: Ask's "Do it" mode, which works the app for the person while they watch.

There is one agent per role: screen_agent for the Researcher, labeler_agent and author_agent
(ROLE_AGENTS). Their screen tools run in the person's browser: each is an ADK long-running tool
that returns nothing here, so the run pauses at the call; the browser does it with the AI cursor
and sends the result back as a function response (app/agent_runs.py). switch_role is one of them,
so moving to another role waits for the person's approval. list_papers and the role tools
(app/agents/role_tools.py) run on the server. The Researcher's questions about the contents of
the person's papers go to data_agent, a specialist with the data tools (app/agents/data_tools.py),
which answers in one turn. The stream tells the browser about each hand-over
(agent_runs.DELEGATES), and the chat shows it as a badge.
The docstrings are what the model reads; docs/agent-tools.md lists every tool for people.
"""

import asyncio

from google.adk.agents import LlmAgent
from google.adk.tools import LongRunningFunctionTool, ToolContext, load_memory
from pydantic import BaseModel, Field

from app.agents.data_tools import DATA_TOOLS, find_support, labeling_progress
from app.agents.role_tools import AUTHOR_TOOLS, LABELER_TOOLS
from app.llm import adk_model

# What every role's agent is told first; each role adds its own part below.
WORK = """You work the SecretSource app for the person, on their screen, while they watch.
SecretSource checks whether the papers a paper cites back up its claims.

How to work:
- Use the tools to show and do; reply in at most two short sentences.
- Before pointing at or filling in something, call read_screen unless an earlier read_screen in
  this conversation already listed its target. Use targets exactly as read_screen gives them.
- If something is not on the screen or not in their papers, say that plainly. Do not guess ids.
- The app has three roles: Researcher (analysed papers, the library, the graph), Labeler (papers
  shared for labeling) and Author (drafts and their citation checks). If the request belongs to
  another role, call switch_role; the person must approve it. When the result says "switched",
  say so in one sentence and stop: the agent of that role goes on. If it says "cancelled", stop.
"""

RESEARCHER_ROLE = """
You are in the Researcher role. Its screens: home, analyses, library, graph.
- To open a paper, call list_papers for its id, then open_paper. Open a screen with open_screen.
- You may only change something with fill_field, and the person must approve it. If the result
  says it was cancelled, say so and stop. Never say a change was made unless a result says so.
- To answer about what is inside their papers (claims, verdicts, evidence, gaps, citations,
  checking some text, starting an analysis), call data_agent with the request in plain words.
  Do not answer from memory, and do not call data_agent just to open or point at something.
- You cannot save labels, delete or upload anything. Point at the button and tell the person.
"""

LABELER_ROLE = """
You are in the Labeler role. Its screens: papers, workspace.
- labeling_papers lists the papers shared for labeling and how far the person is on each.
  labeling_progress gives a paper's next claim to label with its passages; claim_passages gives
  any claim's passages; find_support searches the person's papers. Open a paper with open_paper.
- Never say whether a passage supports, refutes or does not back a claim, and never suggest a
  label or a rationale. The person's labels are the answer key the checker is scored against.
  If asked, say the person decides, and point at the passage.
- You cannot save labels or change anything. Point at the button and tell the person.
"""

AUTHOR_ROLE = """
You are in the Author role. Its screens: home, library, graph, history, editor.
- Analyses (analysed papers, their claims and verdicts) are in the Researcher role, not here: to
  open one, call switch_role with "researcher".
- list_drafts lists the person's drafts. draft_issues gives what needs work in one: citations
  its last check did not back, and problems in its .bib file and cite commands. find_support
  finds passages in the person's papers for a sentence.
- You may only change something with fill_field, and the person must approve it. If the result
  says it was cancelled, say so and stop. Never say a change was made unless a result says so.
- You cannot start a check, save, delete or upload. Point at the button and tell the person.
"""

INSTRUCTION = WORK + RESEARCHER_ROLE


def read_screen() -> None:
    """List what is on the person's screen now: the screen's name, and each thing you can point
    at, open or fill in, with its target ("kind:id") and its label. Runs in the browser."""


def open_screen(screen: str) -> None:
    """Open one of the app's screens. Runs in the browser.

    Args:
        screen: one of your role's screens, as your instructions list them, such as "library".
    """


def open_paper(analysis_id: str) -> None:
    """Open one of the person's papers: its analysis for a Researcher, its labeling workspace for
    a Labeler. Runs in the browser.

    Args:
        analysis_id: the paper's id, from list_papers or labeling_papers.
    """


def point_at(target: str, note: str) -> None:
    """Move the AI cursor to something on the screen, ring it, and show a short note there.
    Runs in the browser.

    Args:
        target: the thing, as "kind:id" from read_screen.
        note: a few words shown beside the cursor, such as "Your weakest claim".
    """


def fill_field(target: str, text: str) -> None:
    """Type text into a field, after the person approves it. The person sees the text and presses
    Apply or Cancel; the result says "applied" or "cancelled". Runs in the browser.

    Args:
        target: a field, as "field:id" from read_screen.
        text: what to type into it.
    """


def switch_role(role: str, reason: str) -> None:
    """Move the person to another role of the app, after they approve it. The person sees the
    reason and presses Switch or Cancel; the result says "switched" or "cancelled". Runs in the
    browser.

    Args:
        role: "researcher", "labeler" or "author".
        reason: a few words shown to the person, such as "Your drafts are in the Author role".
    """


async def list_papers(tool_context: ToolContext) -> list[dict]:
    """The person's analysed papers, newest first: id, title and status ("done", "running" or
    "error"). Use the id with open_paper."""
    # The session keeps "" for a signed-out person; visible_to takes None for that.
    return await papers_for(tool_context.state.get("user") or None)


async def papers_for(user: str | None) -> list[dict]:
    """The last 50 analyses `user` may read, newest first, as list_papers gives them."""
    from app import main  # main imports the agent routes, so not at the top

    rows = await asyncio.to_thread(main.visible_to, user)
    return [
        {"id": row["id"], "title": row.get("title") or row.get("paper", ""), "status": row.get("status", "")}
        for row in reversed(rows[-50:])  # visible_to is oldest first
    ]


DATA_INSTRUCTION = """You read the person's SecretSource papers with your tools and answer the request
you were given.

- Use the tools to get facts. Do not answer from memory.
- For what the person studied or asked in earlier chats, call load_memory with the paper or topic.
- Answer in a few short sentences. Give claim numbers, verdicts and quotes when you have them.
- Start an analysis with submit_analysis only if the request asks for one, then give its id.
- To find what a paper says about something, use find_support for passages or ask_library for an
  answer. find_in_paper only gives the page of words you already have from the paper. If it finds
  no page, do not call it again with other words.
- find_support and ask_library give the page of each passage. Answer from them; do not look the
  page up again or ask the same thing twice.
- If a tool returns an error, say what it said. Do not guess ids: list_papers is not yours, so ask
  for the paper's id in your answer if you were not given one.
"""


class DataTask(BaseModel):
    request: str = Field(description="What to find out or do with the person's papers, in plain words")


# single_turn: the coordinator gets the answer back instead of handing the conversation over (the
# same mode as check_claim in app/agents/team.py).
data_agent = LlmAgent(
    name="data_agent",
    description=(
        "Reads the person's analysed papers: their claims, verdicts and evidence, search, gaps, BibTeX, "
        "checking some text against their papers, starting an analysis, and what they studied in "
        "earlier chats. Give it one request."
    ),
    model=adk_model(),
    instruction=DATA_INSTRUCTION,
    # load_memory is the agent's own: DATA_TOOLS are plain functions that the MCP server and the
    # /commands route also list, and load_memory is an ADK tool that needs the runner's memory.
    tools=[*DATA_TOOLS, load_memory],
    mode="single_turn",
    input_schema=DataTask,
)

# The agent's own tools, for the MCP server to list; ADK adds data_agent to the agent's tools itself.
SCREEN_TOOLS = [
    LongRunningFunctionTool(func=read_screen),
    LongRunningFunctionTool(func=open_screen),
    LongRunningFunctionTool(func=open_paper),
    LongRunningFunctionTool(func=point_at),
    LongRunningFunctionTool(func=fill_field),
    list_papers,
]

read_screen_tool, open_screen_tool, open_paper_tool, point_at_tool, fill_field_tool = SCREEN_TOOLS[:5]
# Not in SCREEN_TOOLS: the MCP server lists those, and a coding agent has no role to switch.
switch_role_tool = LongRunningFunctionTool(func=switch_role)

screen_agent = LlmAgent(
    name="screen_agent",
    model=adk_model(),
    instruction=INSTRUCTION,
    tools=[*SCREEN_TOOLS, switch_role_tool],
    sub_agents=[data_agent],
)

# No fill_field and no tool that gives a verdict (get_claim, get_analysis, check_text, ask_library):
# the agent must not write or hint at the labels the checker is scored against.
labeler_agent = LlmAgent(
    name="labeler_agent",
    model=adk_model(),
    instruction=WORK + LABELER_ROLE,
    tools=[
        read_screen_tool,
        open_screen_tool,
        open_paper_tool,
        point_at_tool,
        switch_role_tool,
        labeling_progress,
        find_support,
        *LABELER_TOOLS,
    ],
)

author_agent = LlmAgent(
    name="author_agent",
    model=adk_model(),
    instruction=WORK + AUTHOR_ROLE,
    tools=[
        read_screen_tool,
        open_screen_tool,
        point_at_tool,
        fill_field_tool,
        switch_role_tool,
        find_support,
        *AUTHOR_TOOLS,
    ],
)

# The web app's role ids (frontend/src/lib/roles.ts; the Author role is "writer" there).
ROLE_AGENTS = {"researcher": screen_agent, "labeler": labeler_agent, "writer": author_agent}

# The long-running tools above: the only results agent_runs.py takes from the browser.
SCREEN_TOOL_NAMES = frozenset({"read_screen", "open_screen", "open_paper", "point_at", "fill_field"})
BROWSER_TOOL_NAMES = SCREEN_TOOL_NAMES | {"switch_role"}  # SCREEN_TOOL_NAMES is the MCP server's
