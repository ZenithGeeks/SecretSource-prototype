"""Run A1 with the offline deterministic coordinator."""

from __future__ import annotations

import asyncio
import json

from ...examples.sample_tasks import sample_task
from .architecture import MagenticTeamArchitecture


async def main() -> None:
    result = await MagenticTeamArchitecture().run(sample_task())
    print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
