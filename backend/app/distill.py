"""Distill a finished assistant chat into a few facts to remember (SPEC.md "Distilling").

The gateway picks the chats to distill (chats.due_for_distill), turns each into lines
(chats.distill_lines) and queues run_distill_job with them. The chats can live in the gateway's
memory, so the worker gets the lines and never reads a chat. The job asks the LLM for at most
MAX_FACTS facts, keeps the ones the guard allows, and saves them with store.save_fact.

The lines hold only the user's questions and the statements the judge backed. A statement that
was not backed never reaches the prompt, and keepable() checks every fact against the lines it
names. A fact built from an unbacked statement would come back as truth in later chats.
"""

import logging
from typing import Literal

import dspy
from pydantic import BaseModel, Field

from app import store
from app.llm import dspy_lm

log = logging.getLogger(__name__)

MAX_FACTS = 5
SUMMARY_CHARS = 300  # the learned_facts check constraint


class Fact(BaseModel):
    kind: Literal["paper", "concept", "question"]
    subject: str = Field(description='The paper or concept, short, e.g. "ColBERT \'20"')
    summary: str = Field(description=f"What the user studied or asked, at most {SUMMARY_CHARS} characters")
    lines: list[int] = Field(description="The numbers of the lines this fact comes from")


class DistillFacts(dspy.Signature):
    """From a researcher's chat, pick the facts worth remembering in their later chats: papers
    they studied, concepts they worked through, and questions they left open. Use only the
    numbered lines. Each fact names the lines it comes from. Return no facts for small talk."""

    lines: list[str] = dspy.InputField()
    facts: list[Fact] = dspy.OutputField(desc=f"At most {MAX_FACTS} facts")


def keepable(fact: Fact, line_count: int) -> bool:
    """A fact needs at least one real line behind it. Every line shown is a question or a backed
    statement, so a fact that names none, or only numbers past the end, rests on nothing."""
    return any(1 <= number <= line_count for number in fact.lines)


def distill(lines: list[str]) -> list[Fact]:
    """The facts worth keeping from these lines. DSPy's cache key holds the prompt and the model,
    so a reworded signature or a new model never reads an old answer."""
    numbered = [f"[{number}] {line}" for number, line in enumerate(lines, 1)]
    with dspy.context(lm=dspy_lm(temperature=0.0, max_tokens=800)):
        facts = dspy.Predict(DistillFacts)(lines=numbered).facts
    return [fact for fact in facts if keepable(fact, len(lines))][:MAX_FACTS]


def run_distill_job(owner: str, chat_id: str, lines: list[str]) -> int:
    """The RQ job: save the facts in one chat's lines. Returns how many were saved."""
    facts = distill(lines)
    for fact in facts:
        store.save_fact(
            owner,
            {
                "kind": fact.kind,
                "subject": fact.subject,
                "summary": fact.summary[:SUMMARY_CHARS],
                "session_id": chat_id,
            },
        )
    log.info("distilled chat %s: %d lines, %d facts", chat_id, len(lines), len(facts))
    return len(facts)
