"""The opt-in live benchmark reports safe provider metrics without network access here."""

import json
from pathlib import Path

from bench_source_resolution_live import run_live_benchmark, run_pipeline_benchmark
from app.pipeline import sources


def test_live_benchmark_compares_providers_on_the_same_manifest(monkeypatch, tmp_path):
    doi = "10.1000/example"
    title = "Example paper"
    manifest = tmp_path / "live-manifest.json"
    manifest.write_text(json.dumps({
        "schema_version": 1,
        "cases": [{"id": "example", "doi": doi, "title": title, "year": 2024}],
    }), encoding="utf-8")

    def candidate(url: str, index: str) -> sources.Resolution:
        return sources.Resolution(url, title, index, {"DOI": doi}, 2024)

    monkeypatch.setattr(
        "bench_source_resolution_live.PROVIDERS",
        {
            "acl_anthology": lambda identifier, expected: [candidate("https://acl.example/p.pdf", "acl")],
            "openalex": lambda identifier, expected: [candidate("https://openalex.example/p.pdf", "openalex")],
        },
    )
    monkeypatch.setattr(sources, "_download", lambda url, name: Path(name))

    report = run_live_benchmark(manifest)

    assert report["mode"] == "live-provider-comparison"
    assert report["providers"]["acl_anthology"]["readable_copy_rate"] == 1.0
    assert report["providers"]["openalex"]["readable_copy_rate"] == 1.0
    assert report["providers"]["acl_anthology"]["correct_source_precision"] == 1.0
    assert report["provider_contribution"] == {
        "readable_by_both": 1,
        "readable_only_by_acl_anthology": 0,
        "readable_only_by_openalex": 0,
        "readable_by_neither": 0,
    }
    assert report["git_revision"]
    assert report["run_at_utc"].endswith("+00:00")
    assert all("url" not in attempt for provider in report["cases"][0]["providers"].values()
               for attempt in provider["attempts"])


def test_live_benchmark_accepts_title_only_corpus_and_provider_subset(monkeypatch, tmp_path):
    title = "The Coding Manual for Qualitative Researchers"
    manifest = tmp_path / "reported-live-manifest.json"
    manifest.write_text(json.dumps({
        "schema_version": 1,
        "providers": ["openalex"],
        "cases": [{
            "id": "coding-manual-2009",
            "title": title,
            "year": 2009,
            "authors": ["Johnny Saldaña"],
        }],
    }), encoding="utf-8")

    def resolve(identifier, expected):
        assert identifier == title
        assert expected["year"] == 2009
        return [sources.Resolution(
            "https://openalex.example/book.pdf", title, "openalex", {}, 2009, "Johnny Saldana",
        )]

    monkeypatch.setattr("bench_source_resolution_live.PROVIDERS", {"openalex": resolve})
    monkeypatch.setattr(sources, "_download", lambda url, name: Path(name))

    report = run_live_benchmark(manifest)

    assert report["providers_tested"] == ["openalex"]
    assert report["providers"]["openalex"]["correct_source_precision"] == 1.0
    assert report["providers"]["openalex"]["readable_copy_rate"] == 1.0
    assert report["provider_contribution"] is None


def test_live_benchmark_rejects_unknown_provider(tmp_path):
    manifest = tmp_path / "invalid-provider-manifest.json"
    manifest.write_text(json.dumps({
        "schema_version": 1,
        "providers": ["unknown"],
        "cases": [{"id": "example", "doi": "10.1000/example"}],
    }), encoding="utf-8")

    try:
        run_live_benchmark(manifest)
    except ValueError as error:
        assert "providers" in str(error)
    else:
        raise AssertionError("unsupported providers should be rejected")


def test_pipeline_benchmark_reports_end_to_end_download_recovery_without_identifiers_or_urls(
    monkeypatch, tmp_path,
):
    doi = "10.1000/private-example"
    title = "Example paper"
    manifest = tmp_path / "pipeline-manifest.json"
    manifest.write_text(json.dumps({
        "schema_version": 1,
        "cases": [
            {"id": "recovered", "doi": doi, "title": title, "year": 2024},
            {"id": "unreadable", "doi": "10.1000/unreadable", "title": "Other paper", "year": 2020},
        ],
    }), encoding="utf-8")

    def fetch(identifier, expected=None):
        if identifier == doi:
            primary_attempt = sources._attempt(
                "semantic_scholar", "blocked", locator="https://publisher.example/paper.pdf",
            )
            if hasattr(sources._fallback_resolutions, "return_value"):
                error = sources.NotDownloadable("primary download blocked")
                error.source_kind = "paper"
                error.status_code = 403
                error.source_attempts = [primary_attempt]
                raise error
            attempts = (
                primary_attempt,
                sources._attempt("openalex", "matched", locator="https://repository.example/paper.pdf"),
                sources._attempt("openalex", "readable_pdf", locator="https://repository.example/paper.pdf"),
            )
            return Path("mock.pdf"), sources.Resolution(
                "https://repository.example/paper.pdf", title, "openalex", {"DOI": doi}, 2024,
                attempts=attempts,
            )
        error = sources.NoOpenAccessCopy("no public copy")
        error.source_attempts = [sources._attempt("openalex", "no-accessible-copy")]
        raise error

    monkeypatch.setattr(sources, "_fetch", fetch)

    report = run_pipeline_benchmark(manifest)

    assert report["mode"] == "live-pipeline"
    assert report["metrics"]["references"] == 2
    assert report["metrics"]["matched_references"] == 1
    assert report["metrics"]["identity_validated_candidate_matches"] == 1
    assert report["metrics"]["identity_validated_candidate_precision"] == 1.0
    assert report["metrics"]["primary_only_readable_references"] == 0
    assert report["metrics"]["fallback_enabled_readable_references"] == 1
    assert report["metrics"]["recovered_by_fallback"] == 1
    assert report["metrics"]["absolute_gain_percentage_points"] == 50
    assert report["metrics"]["failed_attempts"] == 2
    assert report["metrics"]["retryable_attempts"] == 0
    assert report["metrics"]["retry_success_references"] == 0
    assert report["metrics"]["outcome_counts"] == {
        "no-accessible-copy": 1,
        "readable": 1,
    }
    assert report["cases"][0]["primary_only"]["outcome"] == "blocked"
    assert report["cases"][0]["fallback_enabled"]["resolved_by"] == "openalex"
    assert report["cases"][0]["improved_by_fallback"] is True
    rendered = str(report)
    assert doi not in rendered
    assert "publisher.example" not in rendered
    assert "repository.example" not in rendered
