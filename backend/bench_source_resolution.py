"""Repeatable, network-free source-resolution benchmark for mocked provider outcomes.

Run from ``backend`` with ``python bench_source_resolution.py``. The manifest contains
synthetic records and locations; this runner only uses mocked HTTP responses and writes
downloads to a temporary directory. It reports aggregate metrics and fixture IDs, never
raw citation identifiers or provider URLs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import requests
from app import store
from app.pipeline import sources


DEFAULT_MANIFEST = Path(__file__).parent / "fixtures" / "source_resolution_manifest.json"
NON_ATTEMPT_OUTCOMES = {"named-only", "not-attempted"}
NON_MATCH_OUTCOMES = {
    "ambiguous-match", "identity-mismatch", "no-match", "named-only", "not-attempted",
}


def _mock_error(case: dict) -> BaseException:
    mock = case["mock"]
    result = mock["result"]
    errors = {
        "no-match": sources.Unresolvable,
        "ambiguous-match": sources.AmbiguousMatch,
        "no-accessible-copy": sources.NoOpenAccessCopy,
        "identity-mismatch": sources.IdentityMismatch,
    }
    error = errors[result](f"mocked {result}")
    error.source_attempts = [sources._attempt(
        mock["provider"], result, error, locator=mock.get("locator", "")
    )]
    if result in {"ambiguous-match", "no-accessible-copy", "identity-mismatch"}:
        error.source_kind = "paper"
    return error


def _response(result: str, status_code: int | None = None) -> requests.Response:
    response = requests.Response()
    response.status_code = status_code or {
        "blocked": 403,
        "not-found": 404,
        "temporary-failure": 503,
    }.get(result, 200)
    response.url = "https://fixture.invalid/mock"
    if result == "readable":
        response._content = b"%PDF-1.7\nmock fixture paper\n%%EOF"
        response.headers["Content-Type"] = "application/pdf"
    elif result == "web-page":
        response._content = b"<!doctype html><html><body>Mock web page</body></html>"
        response.headers["Content-Type"] = "text/html; charset=utf-8"
    else:
        response._content = b"not a PDF"
        response.headers["Content-Type"] = "application/octet-stream"
    return response


def _observed_attempt(case: dict, result: str) -> dict:
    mock = case["mock"] if result == case["mock"]["result"] else case["retry"]
    return sources._attempt(
        mock["provider"], result, locator=mock.get("locator", "")
    )


def _run_case(case: dict, papers_dir: Path) -> dict:
    expected = case["expected_outcome"]
    if expected in NON_ATTEMPT_OUTCOMES:
        return {
            "id": case["id"],
            "expected_source_kind": case["expected_source_kind"],
            "actual_source_kind": "unknown",
            "primary_outcome": expected,
            "expected_outcome": expected,
            "actual_outcome": expected,
            "attempt_count": 0,
            "attempts": [],
            "improved_by_fallback": False,
            "identity_match": False,
        }

    mock = case["mock"]
    identity = mock.get("identity", "")
    provider = mock.get("provider", "")
    resolution = sources.Resolution(
        url=mock.get("locator", ""),
        title=case.get("label", ""),
        index="" if provider == "direct_url" else provider.replace("_", "-"),
        ids={},
    )
    http_events = [mock]
    if "fallback" in case:
        http_events.append(case["fallback"])
    if "retry" in case:
        http_events.append(case["retry"])
    responses = iter([
        _response(
            event["result"],
            event.get("status_code"),
        )
        for event in http_events
        if event["result"] not in {"no-match", "ambiguous-match", "no-accessible-copy", "identity-mismatch"}
    ])

    def resolve(_identifier: str, expected_metadata: dict | None = None):
        if mock["result"] in {"no-match", "ambiguous-match", "no-accessible-copy", "identity-mismatch"}:
            raise _mock_error(case)
        return resolution

    def fallback_resolutions(_identifier: str, expected_metadata: dict | None, _primary):
        fallback = case.get("fallback")
        if not fallback:
            return [], [], []
        provider = fallback["provider"]
        alternate = sources.Resolution(
            url=fallback["locator"],
            title=case.get("label", ""),
            index=provider.replace("_", "-"),
            ids={"DOI": case.get("identifier", "")} if case.get("identifier", "").startswith("10.") else {},
        )
        return [alternate], [sources._attempt(provider, "matched", locator=alternate.url)], []

    events: list[dict] = []
    attempts = 0
    actual = "failed"
    actual_source_kind = "unknown"
    with (
        patch.object(sources, "PAPERS_DIR", papers_dir),
        patch.object(sources, "_resolve", side_effect=resolve),
        patch.object(sources, "_fallback_resolutions", side_effect=fallback_resolutions),
        patch.object(requests, "get", side_effect=lambda *args, **kwargs: next(responses)),
        patch.object(store, "forget_source", return_value=None),
        patch.object(store, "remember_source", return_value=None),
    ):
        runs = 2 if "retry" in case else 1
        for run_index in range(runs):
            attempts += 1
            try:
                _path, found = sources._fetch(case.get("identifier", ""))
            except (sources.Unresolvable, sources.AmbiguousMatch, sources.NoOpenAccessCopy,
                    sources.IdentityMismatch, sources.NotDownloadable, sources.WebSource,
                    sources.LookupUnavailable) as error:
                outcome = sources._source_outcome(error)
                actual = outcome["outcome"]
                actual_source_kind = outcome["source_kind"]
                events.extend(outcome["attempts"])
                if "retry" not in case or run_index == runs - 1:
                    break
            else:
                actual = "readable"
                actual_source_kind = "paper"
                events.extend(found.attempts)
                break

    fallback = case.get("fallback") or {}
    fallback_identity = fallback.get("identity", identity)
    final_identity = fallback_identity if actual == "readable" and fallback else identity
    identity_match = bool(
        final_identity
        and final_identity == case.get("expected_identity")
        and actual not in NON_MATCH_OUTCOMES
    )
    improved_by_fallback = bool(
        fallback
        and mock["result"] != "readable"
        and actual == "readable"
        and fallback_identity == case.get("expected_identity")
    )
    return {
        "id": case["id"],
        "expected_source_kind": case["expected_source_kind"],
        "actual_source_kind": actual_source_kind,
        "primary_outcome": mock["result"],
        "expected_outcome": expected,
        "actual_outcome": actual,
        "attempt_count": attempts,
        "attempts": events,
        "improved_by_fallback": improved_by_fallback,
        "identity_match": identity_match,
    }


def run_benchmark(manifest_path: Path = DEFAULT_MANIFEST) -> dict:
    """Run all manifest cases using the source pipeline with mocked network and persistence."""
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("cases"), list):
        raise ValueError("unsupported or malformed source-resolution manifest")
    ids = [case.get("id") for case in manifest["cases"]]
    if not all(isinstance(case_id, str) and case_id for case_id in ids) or len(set(ids)) != len(ids):
        raise ValueError("manifest case IDs must be nonempty and unique")

    results = []
    # Keep temporary writes beside the manifest: some managed Windows environments allow
    # workspace writes but deny writes to the interpreter's system temp directory.
    with tempfile.TemporaryDirectory(
        prefix=".source-resolution-benchmark-", dir=Path(__file__).parent
    ) as scratch:
        root = Path(scratch)
        for index, case in enumerate(manifest["cases"]):
            results.append(_run_case(case, root / str(index)))

    outcomes = Counter(result["actual_outcome"] for result in results)
    matched = sum(result["identity_match"] for result in results)
    readable = outcomes["readable"]
    correct = sum(
        result["actual_outcome"] == "readable" and result["identity_match"]
        for result in results
    )
    known_accessible = sum(case.get("known_accessible_copy", False) for case in manifest["cases"])
    correctly_read_accessible = sum(
        result["actual_outcome"] == "readable"
        and result["identity_match"]
        and case.get("known_accessible_copy", False)
        for case, result in zip(manifest["cases"], results, strict=True)
    )
    exact = sum(
        result["actual_outcome"] == result["expected_outcome"] for result in results
    )
    exact_source_kinds = sum(
        result["actual_source_kind"] == result["expected_source_kind"] for result in results
    )
    fallback_cases = [
        (case, result)
        for case, result in zip(manifest["cases"], results, strict=True)
        if case.get("fallback") and case.get("known_accessible_copy", False)
    ]
    primary_readable = sum(
        case["mock"].get("result") == "readable"
        and case["mock"].get("identity") == case.get("expected_identity")
        for case, _ in fallback_cases
    )
    fallback_readable = sum(
        result["actual_outcome"] == "readable" and result["identity_match"]
        for _, result in fallback_cases
    )
    fallback_recovered = sum(result["improved_by_fallback"] for _, result in fallback_cases)
    fallback_denominator = len(fallback_cases)
    primary_read_rate = primary_readable / fallback_denominator if fallback_denominator else None
    fallback_read_rate = fallback_readable / fallback_denominator if fallback_denominator else None
    return {
        "schema_version": 1,
        "mode": "mocked-offline",
        "manifest": manifest_path.name,
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "pipeline_sha256": hashlib.sha256(Path(sources.__file__).read_bytes()).hexdigest(),
        "metric_definitions": {
            "matched": (
                "cases with a fixture identity equal to expected identity and no "
                "mismatch/no-match/ambiguity"
            ),
            "read": "cases where the pipeline downloaded and validated a PDF",
            "correct": "read cases whose fixture identity equals expected identity",
            "provider_attempts": "safe lookup and download attempt records from the pipeline",
            "primary_outcome": (
                "result from the first provider/location before alternate-copy fallback"
            ),
            "improved_by_fallback": (
                "primary path did not read the paper but fallback read the expected identity"
            ),
        },
        "metrics": {
            "cases": len(results),
            "cases_attempted": sum(result["attempt_count"] > 0 for result in results),
            "provider_attempts": sum(len(result["attempts"]) for result in results),
            "matched": matched,
            "read": readable,
            "correct": correct,
            "known_accessible_copy_cases": known_accessible,
            "correctly_read_accessible_copy_cases": correctly_read_accessible,
            "outcome_exact_matches": exact,
            "outcome_accuracy": exact / len(results) if results else 1.0,
            "source_kind_exact_matches": exact_source_kinds,
            "source_kind_accuracy": exact_source_kinds / len(results) if results else 1.0,
            "accessible_copy_read_rate": (
                correctly_read_accessible / known_accessible if known_accessible else None
            ),
            "fallback_comparison": {
                "known_accessible_fallback_cases": fallback_denominator,
                "primary_only_readable": primary_readable,
                "fallback_enabled_readable": fallback_readable,
                "recovered_by_fallback": fallback_recovered,
                "primary_only_read_rate": primary_read_rate,
                "fallback_enabled_read_rate": fallback_read_rate,
                "absolute_gain_percentage_points": (
                    (fallback_read_rate - primary_read_rate) * 100
                    if fallback_denominator else None
                ),
            },
            "by_outcome": dict(sorted(outcomes.items())),
        },
        "cases": [
            {key: value for key, value in result.items() if key != "identity_match"}
            for result in results
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, help="write JSON here instead of stdout")
    args = parser.parse_args()
    report = run_benchmark(args.manifest)
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
