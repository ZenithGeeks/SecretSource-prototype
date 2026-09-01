"""Chat with the coordinator agent.

    python cli.py                                        # REPL
    python cli.py "list the citations of data/papers/x.pdf"   # one turn
"""

import asyncio
import logging
import sys
import warnings

warnings.filterwarnings("ignore")
logging.getLogger("google_adk").setLevel(logging.ERROR)
logging.getLogger("LiteLLM").setLevel(logging.CRITICAL)
logging.getLogger("opentelemetry").setLevel(logging.CRITICAL)

from app.agents.team import root_agent  # noqa: E402
from google.adk.runners import InMemoryRunner  # noqa: E402
from google.genai import types  # noqa: E402


async def ask(runner, session_id, text):
    message = types.Content(role="user", parts=[types.Part(text=text)])
    async for event in runner.run_async(user_id="user", session_id=session_id, new_message=message):
        for call in event.get_function_calls():
            print(f"  [{event.author}] -> {call.name}({call.args})")
        for response in event.get_function_responses():
            print(f"  [{event.author}] <- {str(response.response)[:200]}")
        if event.is_final_response() and event.content:
            reply = "".join(part.text or "" for part in event.content.parts or [])
            if reply:
                print(f"bot [{event.author}] > {reply}\n")


async def main(prompts):
    async with InMemoryRunner(agent=root_agent, app_name="secretsource") as runner:
        session = await runner.session_service.create_session(app_name="secretsource", user_id="user")
        for text in prompts:
            await ask(runner, session.id, text)


def repl():
    while True:
        try:
            text = input("you > ").strip()
        except (EOFError, KeyboardInterrupt):
            return
        if text in ("exit", "quit"):
            return
        if text:
            yield text


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main(sys.argv[1:] or repl()))
