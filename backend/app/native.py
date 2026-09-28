"""Checks that the pipeline's native libraries run on this machine's CPU, before a worker takes jobs.

A worker on a VM whose virtual CPU lacks SSE4.1/SSE4.2 (ss-core's "QEMU Virtual CPU version
2.5+") could not import NumPy 2.4+, and oneDNN (PyTorch's layers) failed with "could not create
a primitive". Nothing crashed: Docling's errors were caught, and analyses finished with checks and
figures silently missing. So the worker checks first, and refuses to start rather than do that.
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def cpu_flags(cpuinfo: str | None = None) -> set[str]:
    """The CPU's feature flags from /proc/cpuinfo, or an empty set where there is no such file."""
    if cpuinfo is None:
        path = Path("/proc/cpuinfo")
        cpuinfo = path.read_text() if path.exists() else ""
    for line in cpuinfo.splitlines():
        if line.startswith("flags"):
            return set(line.split(":", 1)[1].split())
    return set()


def prepare_and_check(cpuinfo: str | None = None) -> None:
    """Turn oneDNN off on CPUs without SSE4.1, then run each native library once. Raises
    RuntimeError naming what failed, so the caller can exit instead of taking jobs."""
    flags = cpu_flags(cpuinfo)
    problems = []

    try:
        import numpy

        numpy.linalg.inv(numpy.eye(4) * 2.0)
    except BaseException as error:  # NumPy's CPU check raises RuntimeError at import
        problems.append(f"numpy: {type(error).__name__}: {str(error)[:200]}")

    try:
        import torch

        # Known before any job runs: an empty flag set means "not Linux", where this never mattered.
        if flags and "sse4_1" not in flags:
            torch.backends.mkldnn.enabled = False
            logger.warning("CPU has no SSE4.1: oneDNN is off, so Docling's models run slower")
        layer = torch.nn.Conv2d(3, 4, kernel_size=3)
        layer(torch.zeros(1, 3, 16, 16))
    except BaseException as error:
        problems.append(f"torch: {type(error).__name__}: {str(error)[:200]}")

    try:
        import cv2
        import numpy

        cv2.resize(numpy.zeros((8, 8, 3), dtype="uint8"), (4, 4))
    except BaseException as error:
        problems.append(f"opencv: {type(error).__name__}: {str(error)[:200]}")

    if problems:
        missing = sorted({"sse4_1", "sse4_2", "popcnt"} - flags) if flags else []
        hint = f" CPU lacks {', '.join(missing)}." if missing else ""
        raise RuntimeError("native libraries do not run on this machine:" + hint + " " + "; ".join(problems))
