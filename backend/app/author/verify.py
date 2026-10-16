"""One claim against one source, cached, for every place the Author role checks something.

A draft check (one call per \\cite) comes through here, so the same (claim, source) pair
is judged once: the second time it is read back from the `cache` table (app/store.py). Only a
successful verdict is remembered — a lookup that failed (rate limit, no open-access copy)
should be tried again next time, not repeated forever.

The key includes the judge model, like the pipeline's own judge cache, so a model change
never reads another model's verdict.
"""

import logging
from collections.abc import Callable

from app import store
from app.author import logic
from app.config import VLLM_MODEL
from app.metrics import CLAIM_CHECKS_FAILED, CLAIM_VERDICTS
from app.pipeline.audit import check_verdict
from app.pipeline.indexes import IndexUnavailable, find_doi, find_title
from app.pipeline.sources import Fits, NoOpenAccessCopy, Unresolvable, find_by_title, tool_error
from app.pipeline.verify import unchecked_reason

INDEX_NAMES = {"crossref": "Crossref", "openalex": "OpenAlex"}
SOURCE_NAMES = {"arxiv": "arXiv", "semantic-scholar": "Semantic Scholar"}
log = logging.getLogger(__name__)


# A bib URL that gives these is a landing page or a dead link, not the paper (#438).
UNREADABLE_LINK = {"web-source", "not-downloadable"}


def verify_cached(
    claim: str,
    source: str,
    run: Callable[[str, str], dict],
    citation: dict | None = None,
    by_title: bool = False,
) -> dict:
    """Judge `claim` against `source`, or read the verdict back from the cache.

    Args:
        claim: the cited sentence, as the judge reads it.
        source: what to check against: a DOI, arXiv id, URL or local PDF, or with `by_title`
            the title of a bib entry that has none of these.
        run: app.pipeline.verify.verify_claim, passed in rather than imported so the
            gateway's own binding (which its tests monkeypatch) is what runs.
        citation: the bib entry's fields, for the reason a failure is counted under and,
            with `by_title`, the year and first author the found work must match.
        by_title: look the work up by title first, with find_cited_work. A refused lookup
            is counted and returned like any other failure.

    A URL that turns out to be a web page or a dead link is followed by a lookup of the
    entry's title. When that finds nothing either, the URL's own failure is returned.
    """
    citation = citation or {}
    if by_title:
        try:
            source = find_cited_work(source, citation)
        except (ValueError, OSError) as error:  # what a lookup raises; see sources.REASONS
            result = tool_error(error)
            _count(result, citation)
            return result
    result = _judged(claim, source, run)
    title = logic.bib_title(citation)
    if source.startswith("http") and result.get("reason") in UNREADABLE_LINK and title:
        try:
            result = _judged(claim, find_cited_work(title, citation), run)
        except (ValueError, OSError):
            pass  # "a web page, not a paper" tells the author more than "no paper by that title"
    _count(result, citation)
    return result


def _judged(claim: str, source: str, run: Callable[[str, str], dict]) -> dict:
    """run(claim, source), or its verdict from the cache. Failures are not remembered."""
    key = store.cache_key("author-verify", VLLM_MODEL, claim.strip(), source.strip())
    cached = store.recall_cache(key)
    if cached is not None:
        return {**cached, "cached": True}
    try:
        result = run(claim, source)
    except Exception:
        CLAIM_CHECKS_FAILED.labels(reason="failed").inc()
        raise
    if result.get("status") == "ok":
        store.remember_cache(key, result)
    return result


def find_cited_work(title: str, fields: dict) -> str:
    """What to check a title-only bib entry against: the work with that title whose year and
    first author agree with the entry (#436). A same-titled work from another year or by other
    authors is skipped, and when only such works exist the lookup raises Unresolvable.

    An arXiv copy is named by its link; any other work by its DOI, so the check can still fall
    back to an arXiv copy and record the index that knows it.
    """
    found = find_by_title(title, _fits(fields))
    if "arxiv.org" in found.url:
        return found.url
    return found.ids.get("DOI") or found.url


def _count(result: dict, citation: dict) -> None:
    """The claim-verdict counters, counted the way a paper analysis counts them (the check()
    closure in app/main.py), so the dashboards mean the same thing for both roles: once per
    claim checked against a source, a remembered answer included (an analysis counts above
    the judge's cache too), a verdict under its label and a failure under unchecked_reason's.
    """
    if result.get("status") == "ok":
        CLAIM_VERDICTS.labels(verdict=result["verdict"]).inc()
    else:
        CLAIM_CHECKS_FAILED.labels(reason=unchecked_reason(result, citation)).inc()


def citation_outcome(result: dict) -> dict:
    """The fields a draft-check citation takes from a verification result: the verdict and
    the passage it rests on, or why the source could not be read.

    `audit` lists what app.pipeline.audit found wrong with the verdict, such as a quote that
    is not in the passages. The verdict is kept as the judge gave it.
    """
    if result.get("status") != "ok":
        return {
            "verdict": "unavailable",
            "reason": result.get("reason", "failed"),
            "message": result.get("message", "") or "checking it failed",
        }
    evidence = result.get("evidence") or []
    first = evidence[0] if evidence else {}
    outcome = {
        "verdict": result.get("verdict", "insufficient"),
        "explanation": result.get("reasoning", ""),
        "evidence": {
            "passage": result.get("quote") or first.get("text", ""),
            "pdf": result.get("source", ""),
            "page": first.get("page"),
        },
        "indexedIn": result.get("indexed_in") or {},
    }
    # Only a check against an arXiv copy has these: its text can differ from the published paper.
    if result.get("source_version"):
        outcome["sourceVersion"] = result["source_version"]
        outcome["arxiv"] = result.get("arxiv", "")
    findings = check_verdict(result)
    if findings:
        outcome["audit"] = findings
    return outcome


def _fits(fields: dict) -> Fits:
    """Whether a work's year and first author agree with the bib entry, by the rules of
    logic.metadata_mismatches: a year one off still agrees, and so does a missing field."""
    return lambda year, author: not logic.metadata_mismatches(fields, year, author, "the index")


def reference_check(fields: dict) -> dict:
    """Whether a cited work is real, and where the bib entry disagrees with it.

    An unreadable source alone cannot tell a paywalled paper from a made-up one, so a draft
    check asks the indexes for every cited DOI (#421), and for the title and first author of
    an entry with no DOI (#439).

    Args:
        fields: the bib entry's fields, as `logic.parse_bib` gives them.

    Returns:
        The fields a draft-check citation adds. `exists` is "yes", "no" (no index knows the
        work, so the reference may be made up) or "unknown" (an index could not be reached).
        With "yes", `index` names the index and, for a DOI, `mismatches` lists the year or
        first author the bib entry gets wrong. A title lookup adds `lookedUpBy: "title"`; a
        result without it is a DOI lookup, as in checks saved before #439. Empty for an entry
        looked up by neither (see _lookup_kind).
    """
    kind = _lookup_kind(fields)
    if not kind:
        return {}
    check = _doi_check if kind == "doi" else _title_check
    try:
        return check(fields)
    except IndexUnavailable:
        return _unknown(kind)
    except Exception:  # a store error or a bad answer must not fail the whole draft check
        log.exception("index lookup of %s failed", logic.bib_doi(fields) or logic.bib_title(fields))
        return _unknown(kind)


def _lookup_kind(fields: dict) -> str:
    """How reference_check looks an entry up: "doi", "title", or "" when it does not."""
    if logic.bib_doi(fields):
        return "doi"
    # An entry with a link is often a blog post, a spec or a dataset page. No index lists
    # those, and "may not exist" would be wrong about them. A title search needs the first
    # author: by title alone, the cited paper is often not among the hits.
    has_link = fields.get("url") or fields.get("howpublished")
    if logic.bib_title(fields) and _first_surname(fields) and not has_link:
        return "title"
    return ""


def _unknown(kind: str) -> dict:
    """reference_check's answer when an index could not be reached."""
    return {"exists": "unknown", **({"lookedUpBy": "title"} if kind == "title" else {})}


def _doi_check(fields: dict) -> dict:
    """Whether Crossref or OpenAlex knows the entry's DOI, and what the entry gets wrong."""
    record = find_doi(logic.bib_doi(fields))
    if record is None:
        return {"exists": "no"}
    index = INDEX_NAMES[record.index]
    mismatches = logic.metadata_mismatches(fields, record.year, record.first_author, index)
    return {"exists": "yes", "index": index, "mismatches": mismatches}


def _title_check(fields: dict) -> dict:
    """Whether Crossref, OpenAlex, arXiv or Semantic Scholar lists a work with the entry's
    title and first author. No year mismatch is reported (see _same_first_author).

    Raises:
        IndexUnavailable: an index could not be reached and none of the others listed it.
    """
    title, fits = logic.bib_title(fields), _same_first_author(fields)
    found = {"exists": "yes", "lookedUpBy": "title"}
    unavailable: IndexUnavailable | None = None
    try:
        if record := find_title(title, _first_surname(fields), fits):
            return {**found, "index": INDEX_NAMES[record.index]}
    except IndexUnavailable as error:  # arXiv or Semantic Scholar may still list it
        unavailable = error
    # Crossref and OpenAlex miss many arXiv-only papers and reports, such as LoRA and GPT-2.
    # find_by_title is the lookup a check uses to download a title-only source, so for an
    # entry the draft check just read it answers from its cache.
    try:
        work = find_by_title(title, fits)
    except NoOpenAccessCopy:  # Semantic Scholar knows the work, but has no free PDF of it
        return {**found, "index": "Semantic Scholar"}
    except Unresolvable as error:  # neither arXiv nor Semantic Scholar has the title
        if unavailable:
            raise unavailable from error
        return {"exists": "no", "lookedUpBy": "title"}
    except (ValueError, OSError) as error:  # a rate limit or a network error
        raise IndexUnavailable(str(error)) from error
    return {**found, "index": SOURCE_NAMES[work.index]}


def _same_first_author(fields: dict) -> Fits:
    """Whether a work's first author is the entry's. The year is not compared (a None year
    is never a mismatch): both Crossref and OpenAlex date "Attention Is All You Need" 2025,
    and OpenAlex dates the GAN paper 2024."""
    return lambda year, author: not logic.metadata_mismatches(fields, None, author, "the index")


def _first_surname(fields: dict) -> str:
    return (logic.bib_surnames(fields.get("author", "")) or [""])[0]


def reference_checks(entries: dict[str, dict]) -> dict[str, dict]:
    """reference_check for each cited bib entry, by bib key, one entry at a time.

    Once an index cannot be reached, the entries after it are "unknown" without asking, so an
    outage costs a check one timeout, not one per citation.
    """
    results: dict[str, dict] = {}
    reachable = True
    for key, fields in entries.items():
        if not (kind := _lookup_kind(fields)):
            continue
        results[key] = reference_check(fields) if reachable else _unknown(kind)
        reachable = results[key]["exists"] != "unknown"
    return results
