"""Run the Author draft check on a folder of LaTeX projects and save each result (#425).

    python eval_draft_checks.py <projects> <results> [gateway]

Each subfolder of <projects> with a `latex/` folder is one paper; its .tex and .bib files
are uploaded as one zip, as an Overleaf export would be. The check's JSON is written to
<results>/<paper>.json. A paper that already has a result file is skipped, so a stopped run
can be started again. Point it at a gateway with login off and its own ANALYSES_DB:
docs/eval/ai-scientist.md says how.
"""

import argparse
import io
import json
import sys
import time
import zipfile
from pathlib import Path

import requests

POLL_SECONDS = 20


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("projects", type=Path, help="one subfolder per paper, each with latex/")
    parser.add_argument("results", type=Path, help="where to write <paper>.json")
    parser.add_argument("gateway", nargs="?", default="http://127.0.0.1:8082")
    args = parser.parse_args()
    args.results.mkdir(parents=True, exist_ok=True)

    for paper in sorted(p for p in args.projects.iterdir() if (p / "latex").is_dir()):
        out = args.results / f"{paper.name}.json"
        if out.exists():
            print(f"{paper.name}: has a result, skipped", file=sys.stderr)
            continue
        started = time.monotonic()
        run = check_paper(args.gateway, paper.name, project_zip(paper / "latex"))
        out.write_text(json.dumps(run, indent=2), encoding="utf-8")
        print(f"{paper.name}: {run['status']} in {time.monotonic() - started:.0f} s", file=sys.stderr)


def project_zip(latex: Path) -> bytes:
    """The folder's .tex and .bib files as a zip."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path in sorted(latex.iterdir()):
            if path.suffix in (".tex", ".bib"):
                archive.write(path, path.name)
    return buffer.getvalue()


def check_paper(gateway: str, name: str, content: bytes) -> dict:
    """Upload one project, check it, and return the finished check."""
    files = {"file": (f"{name}.zip", content, "application/zip")}
    draft = requests.post(f"{gateway}/author/drafts/upload", files=files, timeout=60)
    draft.raise_for_status()
    check = requests.post(f"{gateway}/author/drafts/{draft.json()['id']}/check", timeout=60)
    check.raise_for_status()
    while True:
        time.sleep(POLL_SECONDS)
        run = requests.get(f"{gateway}/author/checks/{check.json()['id']}", timeout=60)
        run.raise_for_status()
        if run.json()["status"] != "running":
            return run.json()


if __name__ == "__main__":
    main()
