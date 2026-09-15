"""Chat with the coordinator agent.

    python cli.py                                        # REPL
    python cli.py "list the citations of data/papers/x.pdf"   # one turn
    python cli.py --session <id> "and the second one?"   # continue an earlier session

Sessions are kept in Postgres when SESSION_DB_URL is set (app/sessions.py), so --session
works after a restart. Otherwise they live in memory and end with the process.
"""

import argparse
import asyncio
import logging
import sys
import warnings

warnings.filterwarnings("ignore")
logging.getLogger("google_adk").setLevel(logging.ERROR)
logging.getLogger("LiteLLM").setLevel(logging.CRITICAL)
logging.getLogger("opentelemetry").setLevel(logging.CRITICAL)

from app.agents.team import root_agent  # noqa: E402
from app.sessions import session_service  # noqa: E402
from google.adk.runners import Runner  # noqa: E402
from google.genai import types  # noqa: E402

APP_NAME = "secretsource"
USER_ID = "user"


async def ask(runner, session_id, text):
    message = types.Content(role="user", parts=[types.Part(text=text)])
    async for event in runner.run_async(user_id=USER_ID, session_id=session_id, new_message=message):
        for call in event.get_function_calls():
            print(f"  [{event.author}] -> {call.name}({call.args})")
        for response in event.get_function_responses():
            print(f"  [{event.author}] <- {str(response.response)[:200]}")
        if event.is_final_response() and event.content:
            reply = "".join(part.text or "" for part in event.content.parts or [])
            if reply:
                print(f"bot [{event.author}] > {reply}\n")


async def main(prompts, session_id=None):
    sessions = session_service()
    async with Runner(agent=root_agent, app_name=APP_NAME, session_service=sessions) as runner:
        session = None
        if session_id:
            session = await sessions.get_session(app_name=APP_NAME, user_id=USER_ID, session_id=session_id)
            if session is None:
                print(f"no session {session_id}, starting a new one")
        if session is None:
            session = await sessions.create_session(app_name=APP_NAME, user_id=USER_ID)
        print(f"session {session.id}")
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
    parser = argparse.ArgumentParser(description="Chat with the coordinator agent.")
    parser.add_argument("--session", help="continue this session id")
    parser.add_argument("prompts", nargs="*", help="one turn each; none starts a REPL")
    args = parser.parse_args()
    asyncio.run(main(args.prompts or repl(), args.session))
