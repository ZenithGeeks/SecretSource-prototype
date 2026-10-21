"""What the assistant remembers about the signed-in user, and how they delete it (SPEC.md).

GET    /memories       -> the caller's facts, the most recently updated first
DELETE /memories/{id}  -> deletes one of the caller's facts; 404 if it is not theirs
DELETE /memories       -> deletes all of the caller's facts

The distill job writes the facts. With login off there is no user, so there are no facts.
"""

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app import store
from app.auth import current_user

router = APIRouter(prefix="/memories", tags=["memories"])


@router.get("")
async def list_memories(user: str | None = Depends(current_user)) -> list[dict]:
    """The caller's remembered facts."""
    if user is None:
        return []
    return await asyncio.to_thread(store.load_facts, user)


@router.delete("/{fact_id}")
async def delete_memory(fact_id: str, user: str | None = Depends(current_user)) -> dict:
    """Delete one of the caller's facts. Another user's id answers 404, the same as a missing one."""
    if user is None or not _is_uuid(fact_id):
        raise HTTPException(404, "no such memory")
    if not await asyncio.to_thread(store.delete_fact, user, fact_id):
        raise HTTPException(404, "no such memory")
    return {"deleted": 1}


@router.delete("")
async def delete_memories(user: str | None = Depends(current_user)) -> dict:
    """Delete all of the caller's facts."""
    if user is None:
        return {"deleted": 0}
    return {"deleted": await asyncio.to_thread(store.delete_facts, user)}


def _is_uuid(value: str) -> bool:
    # Postgres rejects a malformed uuid with an error, which would answer 500 instead of 404.
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True
