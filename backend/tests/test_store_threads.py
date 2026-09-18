"""The SQLite store used from many threads at once, as parallel checks and saves do (#184).

Before the lock, one shared connection failed with "bad parameter or other API misuse" or
crashed the process with a segmentation fault. The work runs in a child process, so a crash
fails this test instead of taking pytest down with it.
"""

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

HAMMER = """
import threading
from app import store

if {warm}:
    store.load_all()  # the gateway opens the connection at startup

errors = []

def worker(n):
    try:
        for i in range(200):
            store.remember_source(f"key-{{n}}-{{i % 20}}", {{"url": f"u{{i}}", "title": "t"}})
            store.recall_source(f"key-{{(n + 1) % 6}}-{{i % 20}}")
            if i % 25 == 0:
                store.save({{"id": f"a{{n}}", "status": "running", "stages": [], "claims": []}})
                store.load_all()
    except Exception as error:
        errors.append(f"{{type(error).__name__}}: {{error}}")

threads = [threading.Thread(target=worker, args=(n,)) for n in range(6)]
for thread in threads:
    thread.start()
for thread in threads:
    thread.join()
print("errors:", errors)
assert not errors
assert len(store.load_all()) == 6
"""


def hammer(tmp_path, warm: bool) -> subprocess.CompletedProcess:
    env = {**os.environ, "ANALYSES_DB": str(tmp_path / "analyses.db"), "PYTHONPATH": str(BACKEND)}
    env.pop("SUPABASE_URL", None)
    return subprocess.run(
        [sys.executable, "-c", HAMMER.format(warm=warm)],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_threads_sharing_an_open_connection_do_not_fail(tmp_path):
    result = hammer(tmp_path, warm=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_threads_opening_the_connection_together_do_not_crash(tmp_path):
    result = hammer(tmp_path, warm=False)
    assert result.returncode == 0, result.stdout + result.stderr  # -11 was a segmentation fault
