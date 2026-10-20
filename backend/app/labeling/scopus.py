"""Find papers to label in Scopus.

Scopus (Elsevier) answers with metadata, not PDFs: a DOI for each paper. The DOI then goes to the
same analysis the Researcher role runs, which looks for an open-access copy (Semantic Scholar,
Unpaywall, arXiv). So a search keeps only open-access records, and `downloadable` marks the ones
whose PDF the analysis can actually fetch. A paper whose PDF still cannot be reached fails in that
analysis with a reason the queue shows.
"""

import logging
import re
from urllib.parse import urlparse

from app import config
from app.pipeline.sources import SEMANTIC_SCHOLAR_URL, USER_AGENT

log = logging.getLogger(__name__)

URL = "https://api.elsevier.com/content/search/scopus"
# Publishers that answer a script with 403 or an HTML page, even for open-access papers (#408).
# doi.org only redirects to the publisher's landing page.
SCRIPT_REFUSED_HOSTS = ("dl.acm.org", "ieeexplore.ieee.org", "direct.mit.edu", "doi.org")
PAGE = 15  # the standard Scopus key allows at most 25 records per request

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


def build_query(topic: str, text: str, since: int) -> str:
    """Open-access records of the topic's venues from `since` on, optionally matching `text`."""
    venues = " OR ".join(f'SRCTITLE("{venue}")' for venue in VENUES[topic])
    parts = [f"({venues})", "OPENACCESS(1)", f"PUBYEAR > {since - 1}"]
    words = " ".join(re.sub(r"[\"{}()\\]", " ", text).split())[:100]  # query syntax, and spaces
    if words:
        parts.append(f'TITLE-ABS-KEY("{words}")')
    # SRCTITLE matches the words anywhere in a title, so "International Conference on Software
    # Engineering" also matches "... Software Engineering and Computer Applications" (#579).
    # Scopus applies AND NOT last, so it has to come at the end.
    others = " OR ".join(f'SRCTITLE("{venue} and*")' for venue in VENUES[topic])
    return " AND ".join(parts) + f" AND NOT ({others})"


def downloadable(dois: list[str]) -> dict[str, bool]:
    """Whether the analysis can fetch each paper's PDF, as far as Semantic Scholar knows.

    One batch request for the whole page. An arXiv copy always works; a publisher's PDF works
    unless the publisher refuses scripts. Keys are lower-case DOIs. A DOI that Semantic Scholar
    does not know, or every DOI when it does not answer, is left out: the caller treats that as
    unknown and still lets the paper be added.
    """
    import requests

    headers = {**USER_AGENT, **({"x-api-key": config.S2_API_KEY} if config.S2_API_KEY else {})}
    try:
        response = requests.post(
            f"{SEMANTIC_SCHOLAR_URL}/batch",
            params={"fields": "externalIds,openAccessPdf"},
            json={"ids": [f"DOI:{doi}" for doi in dois]},
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()
    except requests.RequestException as error:
        log.warning("could not check %d papers for a downloadable copy: %r", len(dois), error)
        return {}
    # The answer has one entry per id, in order, and null for an id it does not know.
    return {
        doi.lower(): _has_fetchable_copy(paper)
        for doi, paper in zip(dois, response.json(), strict=True)
        if paper is not None
    }


def _has_fetchable_copy(paper: dict) -> bool:
    if (paper.get("externalIds") or {}).get("ArXiv"):
        return True
    url = (paper.get("openAccessPdf") or {}).get("url") or ""
    host = urlparse(url).hostname or ""
    return bool(url) and not any(host == h or host.endswith(f".{h}") for h in SCRIPT_REFUSED_HOSTS)


def search(topic: str, text: str, since: int, start: int = 0) -> list[dict]:
    if not config.SCOPUS_API_KEY:
        raise NotConfigured("set SCOPUS_API_KEY")
    import requests

    response = requests.get(
        URL,
        params={"query": build_query(topic, text, since), "start": start, "count": PAGE, "field": FIELDS},
        headers={"X-ELS-APIKey": config.SCOPUS_API_KEY, "Accept": "application/json"},
        timeout=30,
    )
    response.raise_for_status()
    found = []
    # An empty result is one entry that only has an "error" key, so it has no DOI and is skipped.
    for entry in response.json().get("search-results", {}).get("entry", []):
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
    return found
