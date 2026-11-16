"""The opt-in live benchmark reports safe provider metrics without network access here."""

import json
from pathlib import Path

from bench_source_resolution_live import run_live_benchmark
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
