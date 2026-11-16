"""Opt-in live comparison of ACL Anthology and OpenAlex on a fixed reference corpus.

Run from ``backend`` with ``python bench_source_resolution_live.py``. This makes
public metadata and PDF requests, writes downloaded PDFs only to a temporary
directory, and emits safe attempt outcomes rather than URLs or response bodies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from unittest.mock import patch

import requests

from app import store
from app.pipeline import sources


DEFAULT_MANIFEST = Path(__file__).parent / "fixtures" / "source_resolution_live_manifest.json"
PROVIDERS: dict[str, Callable[[str, dict], list[sources.Resolution]]] = {
    "acl_anthology": sources._acl_anthology_candidates,
    "openalex": sources._openalex_candidates,
}


def _surname(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name.casefold())
    plain = "".join(character for character in decomposed if not unicodedata.combining(character))
    parts = re.findall(r"[a-z0-9]+", plain)
    return parts[-1] if parts else ""


def _revision() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent, text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unavailable"


def _is_expected_work(candidate: sources.Resolution, expected: dict) -> bool:
    wanted = sources.doi_in(str(expected.get("doi") or ""))
    found = sources.doi_in(str(candidate.ids.get("DOI") or candidate.ids.get("doi") or ""))
    expected_title = " ".join(str(expected.get("title") or "").split())
    if wanted:
        if not found or wanted.casefold() != found.casefold():
            return False
    else:
        wanted_arxiv = sources.ARXIV_PATTERN.search(str(expected.get("arxiv") or ""))
        found_arxiv = sources.ARXIV_PATTERN.search(
            str(candidate.ids.get("ArXiv") or candidate.ids.get("arxiv") or "")
        )
        if wanted_arxiv and found_arxiv:
            wanted_id = sources.ARXIV_VERSION.sub("", wanted_arxiv.group(1))
            found_id = sources.ARXIV_VERSION.sub("", found_arxiv.group(1))
            if wanted_id != found_id:
                return False
        elif not expected_title or not sources.titles_match(expected_title, candidate.title):
            return False

    if expected_title and candidate.title and not sources.titles_match(expected_title, candidate.title):
        return False
    expected_year = sources._as_year(expected.get("year"))
    if expected_year is not None and candidate.year != expected_year:
        return False
    authors = expected.get("authors") or expected.get("author") or []
    wanted_author = authors[0] if isinstance(authors, list) and authors else authors
    if wanted_author:
        if not candidate.first_author or _surname(str(wanted_author)) != _surname(candidate.first_author):
            return False
    return True


def _outcome(error: BaseException) -> tuple[str, bool]:
    try:
        result = sources._source_outcome(error)["outcome"]
    except Exception:
        result = sources._outcome_code(error)
    return result, sources.is_retryable(error)


def _run_provider(
    provider: str,
    resolver: Callable[[str, dict], list[sources.Resolution]],
    case: dict,
    papers_dir: Path,
) -> dict:
    identifier = case.get("doi") or case.get("arxiv") or case.get("title") or ""
    expected = {
        key: case[key]
        for key in ("doi", "arxiv", "title", "year", "venue", "authors", "author")
        if key in case
    }
    attempts: list[dict] = []
    try:
        candidates = resolver(identifier, expected)
    except (requests.RequestException, OSError, ValueError) as error:
        result, retryable = _outcome(error)
        attempts.append({"result": result, "retryable": retryable})
        return {
            "provider": provider,
            "candidate_count": 0,
            "correct_candidates": 0,
            "readable": False,
            "outcome": result,
            "attempts": attempts,
        }

    correct_candidates = 0
    download_errors: list[BaseException] = []
    for index, candidate in enumerate(candidates):
        correct = _is_expected_work(candidate, expected)
        if correct:
            correct_candidates += 1
        else:
            attempts.append({"result": "identity-mismatch", "retryable": False})
            continue

        try:
            sources._download(candidate.url, f"{provider}-{case['id']}-{index}")
        except (requests.RequestException, OSError, sources.WebSource, sources.NotDownloadable) as error:
            result, retryable = _outcome(error)
            attempts.append({"result": result, "retryable": retryable})
            download_errors.append(error)
        else:
            attempts.append({"result": "readable_pdf", "retryable": False})

    readable = any(attempt["result"] == "readable_pdf" for attempt in attempts)
    if readable:
        outcome = "readable"
    elif download_errors:
        outcome, _ = _outcome(download_errors[-1])
    else:
        outcome = "no-accessible-copy"
    return {
        "provider": provider,
        "candidate_count": len(candidates),
        "correct_candidates": correct_candidates,
        "readable": readable,
        "outcome": outcome,
        "attempts": attempts,
    }


def run_live_benchmark(manifest_path: Path = DEFAULT_MANIFEST) -> dict:
    """Query each provider independently for every DOI and validate downloaded PDFs."""
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("cases"), list):
        raise ValueError("unsupported or malformed live source-resolution manifest")
    providers = manifest.get("providers", list(PROVIDERS))
    if not isinstance(providers, list) or not providers or any(provider not in PROVIDERS for provider in providers):
        raise ValueError("live benchmark providers must be a nonempty list of supported providers")
    case_ids = [case.get("id") for case in manifest["cases"]]
    if not case_ids or not all(isinstance(case_id, str) and case_id for case_id in case_ids):
        raise ValueError("live benchmark cases need nonempty IDs")
    if len(set(case_ids)) != len(case_ids):
        raise ValueError("live benchmark case IDs must be unique")
    if any(not (case.get("doi") or case.get("arxiv") or case.get("title")) for case in manifest["cases"]):
        raise ValueError("live benchmark cases need a DOI, arXiv ID, or title")

    results = []
    with tempfile.TemporaryDirectory(
        prefix=".source-resolution-live-", dir=Path(__file__).parent,
    ) as scratch:
        root = Path(scratch)
        # Keep provider metadata caches and downloads inside this run; never write to the
        # application's configured source/cache database from an evaluation command.
        with (
            patch.object(store, "recall_cache", return_value=None),
            patch.object(store, "remember_cache", return_value=None),
        ):
            for case in manifest["cases"]:
                provider_results = {}
                for provider in providers:
                    resolver = PROVIDERS[provider]
                    provider_dir = root / provider / case["id"]
                    with patch.object(sources, "PAPERS_DIR", provider_dir):
                        provider_results[provider] = _run_provider(
                            provider, resolver, case, provider_dir,
                        )
                results.append({"id": case["id"], "providers": provider_results})

    provider_metrics = {}
    for provider in providers:
        provider_cases = [case["providers"][provider] for case in results]
        candidate_count = sum(case["candidate_count"] for case in provider_cases)
        correct_candidates = sum(case["correct_candidates"] for case in provider_cases)
        readable = sum(case["readable"] for case in provider_cases)
        denominator = len(provider_cases)
        provider_metrics[provider] = {
            "references": denominator,
            "matched_references": sum(case["correct_candidates"] > 0 for case in provider_cases),
            "readable_references": readable,
            "readable_copy_rate": readable / denominator if denominator else None,
            "correct_source_precision": correct_candidates / candidate_count if candidate_count else None,
            "candidate_count": candidate_count,
            "correct_candidates": correct_candidates,
        }

    provider_contribution = None
    if "acl_anthology" in providers and "openalex" in providers:
        acl_readable = {case["id"] for case in results if case["providers"]["acl_anthology"]["readable"]}
        openalex_readable = {case["id"] for case in results if case["providers"]["openalex"]["readable"]}
        provider_contribution = {
            "readable_by_both": len(acl_readable & openalex_readable),
            "readable_only_by_acl_anthology": len(acl_readable - openalex_readable),
            "readable_only_by_openalex": len(openalex_readable - acl_readable),
            "readable_by_neither": len(set(case_ids) - (acl_readable | openalex_readable)),
        }
    return {
        "schema_version": 1,
        "mode": "live-provider-comparison",
        "run_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_revision": _revision(),
        "manifest": manifest_path.name,
        "providers_tested": providers,
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "source_code_sha256": hashlib.sha256(Path(sources.__file__).read_bytes()).hexdigest(),
        "providers": provider_metrics,
        "provider_contribution": provider_contribution,
        "cases": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, help="write JSON here instead of stdout")
    args = parser.parse_args()
    rendered = json.dumps(run_live_benchmark(args.manifest), indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
