"""Folding checks onto claims must not touch the claims it was given.

The graph's session hands the same claims list to every node and to whoever ran it, so a
fold that mutates its input corrupts the caller's copy — and folding twice then doubles
every verdict, which is what happened while wiring the gateway onto the graph.

Needs google-adk, so run it in the gateway image: docker run --rm -v .../app:/app/app
secretsource-prototype-gateway python -m pytest tests/test_workflow_assemble.py
"""

import copy

from app.pipeline.verify import fold_check
from app.workflow import finished_analysis, fold_checks, pair_with_sources, with_audit

CLAIMS = [
    {"claim": "Late interaction beats single-vector retrieval.", "citations": [{"doi": "10.1/a"}]},
    {"claim": "Residual compression loses no quality.", "citations": [{"arxiv": "2112.01488"}]},
]

CHECKS = [
    {"claim": 0, "source": "colbertv2.pdf", "url": "",
     "verdict": {"status": "ok", "verdict": "supports", "quote": "…late interaction…"}},
    {"claim": 1, "source": "plaid.pdf", "url": "",
     "verdict": {"status": "error", "reason": "no-open-access", "message": "no free copy"}},
]


def test_the_claims_passed_in_are_not_touched():
    original = copy.deepcopy(CLAIMS)
    fold_checks(CLAIMS, CHECKS)
    assert CLAIMS == original


def test_folding_twice_gives_the_same_answer_as_folding_once():
    once = fold_checks(CLAIMS, CHECKS)
    twice = fold_checks(CLAIMS, CHECKS)
    assert twice == once
    assert len(once[0]["verdicts"]) == 1
    assert len(once[1]["unchecked"]) == 1


def test_folding_onto_already_folded_claims_appends_rather_than_doubling():
    """The reachable case: a rerun sees claims that already carry verdicts."""
    already = fold_checks(CLAIMS, CHECKS)
    again = fold_checks(already, CHECKS)
    assert len(again[0]["verdicts"]) == 2  # the new fold, on top of what was there
    assert len(already[0]["verdicts"]) == 1  # and the input it was given is unchanged


def test_a_verdict_is_keyed_by_what_the_source_was_looked_up_by():
    folded = fold_checks(CLAIMS, CHECKS)
    assert folded[0]["verdicts"][0]["cited"] == "colbertv2.pdf"
    assert folded[1]["unchecked"][0]["reason"] == "no-open-access"


def test_each_job_gets_the_prepared_source_it_cites():
    jobs = [
        {"claim": 0, "text": "a", "source": "10.1/a", "url": ""},
        {"claim": 1, "text": "b", "source": "10.1/b", "url": ""},
        {"claim": 2, "text": "c", "source": "10.1/a", "url": ""},
    ]
    prepared = [
        {"source": "10.1/a", "status": "ok", "path": "data/papers/a.pdf"},
        {"source": "10.1/b", "status": "error", "reason": "no-open-access", "message": "no free copy"},
    ]
    paired = pair_with_sources(jobs, prepared)
    assert [job["prepared"]["status"] for job in paired] == ["ok", "error", "ok"]
    assert paired[2]["prepared"]["path"] == "data/papers/a.pdf"
    assert "prepared" not in jobs[0]  # the jobs passed in are not changed


def test_a_finished_run_has_a_status_like_a_failed_one():
    finished = finished_analysis(CHECKS, CLAIMS, "2112.01488", "data/papers/2112.01488.pdf")
    assert finished["status"] == "ok"
    assert finished["checked"] == 2


def test_the_graph_and_the_gateway_fold_a_check_the_same_way():
    """The gateway calls fold_check on its own claims; the graph calls it through fold_checks."""
    gateway_claims = copy.deepcopy(CLAIMS)
    for check in CHECKS:
        fold_check(gateway_claims[check["claim"]], check["source"], {"url": check["url"]}, check["verdict"])
    assert fold_checks(CLAIMS, CHECKS) == gateway_claims


def test_a_link_we_could_not_resolve_is_a_web_source():
    claim = {"claim": "A spec says so.", "citations": []}
    fold_check(claim, "https://example.org/spec", {"url": "https://example.org/spec"},
               {"status": "error", "reason": "unresolvable", "message": "not a paper"})
    assert claim["unchecked"][0]["reason"] == "web-source"


def test_a_finished_run_is_audited_like_the_gateway_does():
    finished = with_audit(finished_analysis(CHECKS, CLAIMS, "2112.01488", "data/papers/2112.01488.pdf"))
    assert finished["status"] == "ok"
    assert isinstance(finished["audit"], list)
