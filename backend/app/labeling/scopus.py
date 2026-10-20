"""Find papers to label in Scopus.

Scopus (Elsevier) answers with metadata, not PDFs: a DOI for each paper. The DOI then goes to the
same analysis the Researcher role runs, which looks for an open-access copy (Semantic Scholar,
Unpaywall, arXiv). So a search keeps only open-access records, and a paper whose PDF still cannot
be reached fails in that analysis with a reason the queue shows. Scopus gives no abstracts on our
key, so they come from OpenAlex by DOI.
"""

import logging
import re

from app import config

log = logging.getLogger(__name__)

URL = "https://api.elsevier.com/content/search/scopus"
PAGE = 25  # the most the standard Scopus key returns per request
TIMEOUT = 30
# The orders a search can ask for, as Scopus names them. Without one Scopus lists the newest first,
# so "since 2020" showed only papers from this year.
SORTS = {"cited": "citedby-count", "newest": "-coverDate", "oldest": "+coverDate", "match": "relevancy"}

# The team's domains and where each one publishes. SRCTITLE matches the words of a source title, so
# these are chosen from what Scopus really returns (checked against the live index, 2026-10): a name
# too short pulls in the wrong venue ("Supercomputing" is a journal, "Computer Vision and Pattern
# Recognition" is also a Springer book series). ECCV is left out: Scopus files it under a generic book
# series, so it cannot be searched by name. Scopus flags few CVPR papers as open access, so CV is
# mostly TPAMI and ICCV. Edit the lists if a venue is missing.
VENUES: dict[str, list[str]] = {
    "CV": [
        "Conference on Computer Vision and Pattern Recognition",
        "IEEE International Conference on Computer Vision",
        "IEEE Transactions on Pattern Analysis and Machine Intelligence",
    ],
    "NLP": [
        "Annual Meeting of the Association for Computational Linguistics",
        "Empirical Methods in Natural Language Processing",
        "North American Chapter of the Association for Computational Linguistics",
        "Transactions of the Association for Computational Linguistics",
    ],
    "SE": [
        "International Conference on Software Engineering",
        "Foundations of Software Engineering",
        "International Conference on Automated Software Engineering",
        "IEEE Transactions on Software Engineering",
    ],
    "HPC": [
        "High Performance Computing, Networking, Storage and Analysis",
        "International Parallel and Distributed Processing Symposium",
        "High-Performance Parallel and Distributed Computing",
        "IEEE Transactions on Parallel and Distributed Systems",
    ],
}

FIELDS = "dc:title,prism:doi,prism:publicationName,prism:coverDate,dc:creator,citedby-count"


class NotConfigured(Exception):
    """There is no SCOPUS_API_KEY."""


def build_query(topic: str, text: str, since: int, until: int | None = None) -> str:
    """Open-access records of the topic's venues from `since` to `until`, optionally matching `text`."""
    venues = " OR ".join(f'SRCTITLE("{venue}")' for venue in VENUES[topic])
    parts = [f"({venues})", "OPENACCESS(1)", f"PUBYEAR > {since - 1}"]
    if until is not None:
        parts.append(f"PUBYEAR < {until + 1}")
    words = " ".join(re.sub(r"[\"{}()\\]", " ", text).split())[:100]  # query syntax, and spaces
    if words:
        parts.append(f'TITLE-ABS-KEY("{words}")')
    return " AND ".join(parts)


def search(
    topic: str, text: str, since: int, until: int | None = None, sort: str = "cited", start: int = 0
) -> dict:
    """One page of the topic's open-access papers, with how many Scopus has in all.

    Returns:
        `{"total", "results"}`. Each result has its DOI, title, venue, year, first author, citation
        count, and the abstract from OpenAlex ("" when OpenAlex has none).

    Raises:
        NotConfigured: there is no SCOPUS_API_KEY.
        requests.RequestException: Scopus refused the request or did not answer, after one retry
            for a timeout or a server error.
    """
    if not config.SCOPUS_API_KEY:
        raise NotConfigured("set SCOPUS_API_KEY")
    params = {
        "query": build_query(topic, text, since, until),
        "start": start,
        "count": PAGE,
        "field": FIELDS,
        "sort": SORTS[sort],
    }
    body = _ask_scopus(params)
    found = []
    # An empty result is one entry that only has an "error" key, so it has no DOI and is skipped.
    for entry in body.get("search-results", {}).get("entry", []):
        if not entry.get("prism:doi"):
            continue
        found.append(
            {
                "doi": entry["prism:doi"],
                "title": entry.get("dc:title", ""),
                "venue": entry.get("prism:publicationName", ""),
                "year": (entry.get("prism:coverDate") or "")[:4],
                "first_author": entry.get("dc:creator", ""),
                "cited_by": int(entry.get("citedby-count") or 0),
            }
        )
    abstracts = abstracts_of([paper["doi"] for paper in found])
    total = int(body.get("search-results", {}).get("opensearch:totalResults") or 0)
    results = [{**paper, "abstract": abstracts.get(paper["doi"].lower(), "")} for paper in found]
    return {"total": total, "results": results}


def _ask_scopus(params: dict) -> dict:
    """Scopus's JSON answer, asking a second time after a timeout or a server error."""
    import requests

    try:
        return _scopus_json(params)
    except (requests.Timeout, requests.ConnectionError) as error:
        log.warning("Scopus search: %s, asking again", error)
    except requests.HTTPError as error:
        if error.response is None or error.response.status_code < 500:
            raise  # a refused key or a used-up quota does not get better by asking again
        log.warning("Scopus search: HTTP %s, asking again", error.response.status_code)
    return _scopus_json(params)


def _scopus_json(params: dict) -> dict:
    import requests

    headers = {"X-ELS-APIKey": config.SCOPUS_API_KEY, "Accept": "application/json"}
    response = requests.get(URL, params=params, headers=headers, timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()


def abstracts_of(dois: list[str]) -> dict[str, str]:
    """The abstracts OpenAlex has for these DOIs, by lower-case DOI. Empty when OpenAlex fails:
    a result without its abstract is still worth showing."""
    from app.pipeline.indexes import _IndexError, openalex_works

    # "," and "|" separate values in an OpenAlex filter, so a DOI holding one cannot be asked for.
    wanted = [doi for doi in dois if not re.search(r"[,|]", doi)]
    if not wanted:
        return {}
    params = {
        "filter": "doi:" + "|".join(wanted),
        "select": "doi,abstract_inverted_index",
        "per-page": len(wanted),
    }
    try:
        works = openalex_works(params)
    except _IndexError as error:
        log.warning("OpenAlex abstracts for a Scopus page: %s", error)
        return {}
    return {
        work["doi"].removeprefix("https://doi.org/").lower(): _abstract_text(work["abstract_inverted_index"])
        for work in works
        if work.get("doi") and work.get("abstract_inverted_index")
    }


def _abstract_text(index: dict[str, list[int]]) -> str:
    """The abstract from OpenAlex's index of each word to the positions it holds."""
    words = {position: word for word, positions in index.items() for position in positions}
    text = " ".join(words[position] for position in sorted(words))
    # Many publishers' abstracts start with the heading itself: "Abstract Event cameras are...".
    return re.sub(r"^\s*abstract\b[\s.:—-]*", "", text, flags=re.IGNORECASE)
