"""The screen agent: Ask's "Do it" mode, which works the app for the person while they watch.

It is a coordinator. Its screen tools run in the person's browser: each is an ADK long-running
tool that returns nothing here, so the run pauses at the call; the browser does it with the AI
cursor and sends the result back as a function response (app/agent_runs.py). list_papers runs on
the server. Anything that needs the contents of the person's papers goes to data_agent, a
specialist with the data tools (app/agents/data_tools.py), which answers in one turn. The
stream tells the browser about each hand-over (agent_runs.DELEGATES), and the chat shows it as a badge.
The docstrings are what the model reads; docs/agent-tools.md lists every tool for people.
"""

import asyncio

from google.adk.agents import LlmAgent
from google.adk.tools import LongRunningFunctionTool, ToolContext
from pydantic import BaseModel, Field

from app.agents.data_tools import DATA_TOOLS
from app.llm import adk_model

INSTRUCTION = """You work the SecretSource app for the person, on their screen, while they watch.
SecretSource checks whether the papers a paper cites back up its claims.

How to work:
- Use the tools to show and do; reply in at most two short sentences.
- Before pointing at or filling in something, call read_screen unless an earlier read_screen in
  this conversation already listed its target. Use targets exactly as read_screen gives them.
- To open a paper, call list_papers for its id, then open_paper. Open a screen with open_screen.
- You may only change something with fill_field, and the person must approve it. If the result
  says it was cancelled, say so and stop. Never say a change was made unless a result says so.
- To answer about what is inside their papers (claims, verdicts, evidence, gaps, citations,
  checking some text, starting an analysis), call data_agent with the request in plain words.
  Do not answer from memory, and do not call data_agent just to open or point at something.
- You cannot save labels, delete or upload anything. Point at the button and tell the person.
- If something is not on the screen or not in their papers, say that plainly. Do not guess ids.
"""


def read_screen() -> None:
    """List what is on the person's screen now: the screen's name, and each thing you can point
    at, open or fill in, with its target ("kind:id") and its label. Runs in the browser."""


def open_screen(screen: str) -> None:
    """Open one of the app's screens. Runs in the browser.

    Args:
        screen: "home", "analyses", "library" or "graph".
    """


def open_paper(analysis_id: str) -> None:
    """Open one of the person's analysed papers on the analyses screen. Runs in the browser.

    Args:
        analysis_id: the id list_papers gives for the paper.
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
- Answer in a few short sentences. Give claim numbers, verdicts and quotes when you have them.
- Start an analysis with submit_analysis only if the request asks for one, then give its id.
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
        "checking some text against their papers, and starting an analysis. Give it one request."
    ),
    model=adk_model(),
    instruction=DATA_INSTRUCTION,
    tools=DATA_TOOLS,
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

screen_agent = LlmAgent(
    name="screen_agent",
    model=adk_model(),
    instruction=INSTRUCTION,
    tools=list(SCREEN_TOOLS),
    sub_agents=[data_agent],
)

# The long-running tools above: the only results agent_runs.py takes from the browser.
SCREEN_TOOL_NAMES = frozenset({"read_screen", "open_screen", "open_paper", "point_at", "fill_field"})
