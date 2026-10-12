"""Find papers to label in Scopus.

Scopus (Elsevier) answers with metadata, not PDFs: a DOI for each paper. The DOI then goes to the
same analysis the Researcher role runs, which looks for an open-access copy (Semantic Scholar,
Unpaywall, arXiv). So a search keeps only open-access records, and a paper whose PDF still cannot
be reached fails in that analysis with a reason the queue shows.
"""

import re

from app import config

URL = "https://api.elsevier.com/content/search/scopus"
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
    return " AND ".join(parts)


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
