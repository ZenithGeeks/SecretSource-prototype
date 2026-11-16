"""The source-resolution benchmark stays deterministic, offline and privacy-safe."""

from pathlib import Path

from bench_source_resolution import DEFAULT_MANIFEST, run_benchmark


def test_mocked_source_resolution_benchmark_is_repeatable_and_aggregates_outcomes():
    first = run_benchmark(DEFAULT_MANIFEST)
    second = run_benchmark(DEFAULT_MANIFEST)

    assert first["mode"] == "mocked-offline"
    assert first["metrics"] == second["metrics"]
    assert first["cases"] == second["cases"]
    assert first["metrics"] == {
        "cases": 15,
        "cases_attempted": 13,
        "provider_attempts": 20,
        "matched": 10,
        "read": 5,
        "correct": 5,
        "known_accessible_copy_cases": 6,
        "correctly_read_accessible_copy_cases": 5,
        "outcome_exact_matches": 15,
        "outcome_accuracy": 1.0,
        "source_kind_exact_matches": 15,
        "source_kind_accuracy": 1.0,
        "accessible_copy_read_rate": 5 / 6,
        "fallback_comparison": {
            "known_accessible_fallback_cases": 3,
            "primary_only_readable": 0,
            "fallback_enabled_readable": 3,
            "recovered_by_fallback": 3,
            "primary_only_read_rate": 0.0,
            "fallback_enabled_read_rate": 1.0,
            "absolute_gain_percentage_points": 100.0,
        },
        "by_outcome": {
            "ambiguous-match": 1,
            "blocked": 1,
            "identity-mismatch": 1,
            "invalid-content": 1,
            "named-only": 1,
            "no-accessible-copy": 1,
            "no-match": 1,
            "not-found": 1,
            "not-attempted": 1,
            "readable": 5,
            "web-page": 1,
        },
    }


def test_benchmark_shows_primary_and_fallback_results_per_recovery_case():
    report = run_benchmark(DEFAULT_MANIFEST)
    cases = {case["id"]: case for case in report["cases"]}

    assert cases["blocked-primary-openalex-readable"]["primary_outcome"] == "blocked"
    assert cases["blocked-primary-openalex-readable"]["actual_outcome"] == "readable"
    assert cases["blocked-primary-openalex-readable"]["improved_by_fallback"] is True
    assert cases["no-primary-copy-acl-readable"]["primary_outcome"] == "no-accessible-copy"
    assert cases["no-primary-copy-acl-readable"]["actual_outcome"] == "readable"
    assert cases["no-primary-copy-acl-readable"]["improved_by_fallback"] is True
    assert cases["blocked-primary-unpaywall-readable"]["primary_outcome"] == "blocked"
    assert cases["blocked-primary-unpaywall-readable"]["actual_outcome"] == "readable"
    assert cases["blocked-primary-unpaywall-readable"]["improved_by_fallback"] is True


def test_benchmark_does_not_emit_raw_identifiers_or_query_secrets():
    report = run_benchmark(DEFAULT_MANIFEST)
    rendered = str(report)

    assert "fixture-secret" not in rendered
    assert "10.0000/blocked-example" not in rendered
    assert "acl-legacy-example" not in rendered
    assert "user:password" not in rendered
    assert len(report["manifest_sha256"]) == 64
    assert len(report["pipeline_sha256"]) == 64
    assert all("identifier" not in case for case in report["cases"])


def test_default_manifest_is_checked_in_with_the_runner():
    assert DEFAULT_MANIFEST == Path(__file__).parents[1] / "fixtures" / "source_resolution_manifest.json"
