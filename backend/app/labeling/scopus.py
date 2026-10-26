"""Find papers to label in Scopus.

Scopus (Elsevier) answers with metadata, not PDFs: a DOI for each paper. The DOI then goes to the
same analysis the Researcher role runs, which looks for an open-access copy (Semantic Scholar,
Unpaywall, arXiv). So a search keeps only open-access records, and `downloadable` marks the ones
whose PDF the analysis can actually fetch. A paper whose PDF still cannot be reached fails in that
analysis with a reason the queue shows. Scopus gives no abstracts or keywords on our key, so the
abstract, a subject and keywords come from OpenAlex by DOI.
"""

import logging
import math
import re
import threading
import time
from typing import Literal
from urllib.parse import urlparse

from app import config
from app.pipeline.sources import SEMANTIC_SCHOLAR_URL, USER_AGENT

log = logging.getLogger(__name__)

URL = "https://api.elsevier.com/content/search/scopus"
# Publishers that answer a script with 403 or an HTML page, even for open-access papers (#408).
# doi.org only redirects to the publisher's landing page.
SCRIPT_REFUSED_HOSTS = ("dl.acm.org", "ieeexplore.ieee.org", "direct.mit.edu", "doi.org")
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
#
# Each venue's rank, checked by hand on 2026-10-26: a conference's CORE rank from the ICORE2026
# table (portal.core.edu.au/conf-ranks), a journal's CiteScore 2025 quartile. A search result shows
# the conference rank written here, but a journal's quartile looked up from Scopus (venue_rank), so
# the journal ranks here only decide which venues a rank filter leaves out of the query.
VENUES: dict[str, dict[str, str]] = {
    "CV": {
        "Conference on Computer Vision and Pattern Recognition": "A*",
        "IEEE International Conference on Computer Vision": "A*",
        "IEEE Transactions on Pattern Analysis and Machine Intelligence": "Q1",
    },
    "NLP": {
        "Annual Meeting of the Association for Computational Linguistics": "A*",
        "Empirical Methods in Natural Language Processing": "A*",
        "North American Chapter of the Association for Computational Linguistics": "A",
        "Transactions of the Association for Computational Linguistics": "Q1",
    },
    "SE": {
        "International Conference on Software Engineering": "A*",
        "Foundations of Software Engineering": "A*",
        "International Conference on Automated Software Engineering": "A*",
        "IEEE Transactions on Software Engineering": "Q1",
    },
    "HPC": {
        "High Performance Computing, Networking, Storage and Analysis": "A",
        "International Parallel and Distributed Processing Symposium": "A",
        "High-Performance Parallel and Distributed Computing": "A",
        "IEEE Transactions on Parallel and Distributed Systems": "Q1",
    },
}
CORE_YEAR = 2026  # the ICORE round the conference ranks above come from
# Proceedings that carry a ranked conference's name but are not its main track: CORE ranks the main
# conference only. Scopus names them like "Proceedings of the IEEE International Conference on
# Computer Vision Workshops", which SRCTITLE also matches.
NOT_MAIN_TRACK = re.compile(r"\b(workshops?|companion|findings|demos?|doctoral|students?|tutorials?)\b", re.I)

FIELDS = (
    "dc:title,prism:doi,prism:publicationName,prism:coverDate,dc:creator,citedby-count,"
    "prism:issn,prism:eIssn,prism:aggregationType"
)
SERIAL_URL = "https://api.elsevier.com/content/serial/title"
ISSN_BATCH = 25  # ISSNs per Serial Title request; one page of results has at most 50
UNRANKED = {"system": None, "value": "unranked", "year": None}

# ISSN (no hyphen) -> (its CiteScore rank or None, monotonic time to ask again), for citescore_ranks.
_citescores: dict[str, tuple[dict | None, float]] = {}
_citescores_lock = threading.Lock()

KEYWORDS = 5  # the most keywords shown for one paper
NO_DETAILS = {"abstract": "", "subject": "", "keywords": []}  # a paper OpenAlex does not know
OPENALEX_BATCH = 50  # DOIs per OpenAlex request; its filter takes up to 100 values
RETRY_UNKNOWN = 600.0  # seconds before asking OpenAlex again about a paper it did not know

# DOI -> ({"subject", "keywords"}, monotonic time to ask again), for subjects_of.
_subjects: dict[str, tuple[dict, float]] = {}
_subjects_lock = threading.Lock()

# Where a search looks: the topic's venues above, or every source Scopus indexes.
Scope = Literal["topic", "all"]

# A DOI on its own or inside a link (https://dl.acm.org/doi/10.1145/3784828.3785017). It ends
# at a space, a quote, a backslash (it would escape the query's closing quote), or a link's
# query or fragment.
DOI = re.compile(r"\b10\.\d{4,9}/[^\s\"'<>?#\\]+")


class NotConfigured(Exception):
    """There is no SCOPUS_API_KEY."""


def doi_in(text: str) -> str | None:
    """The DOI in a pasted DOI or paper link, without trailing punctuation; None when there is none.

    A ")" is trailing punctuation only when it closes nothing in the DOI: old Wiley DOIs such as
    10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0 hold their own parentheses.
    """
    match = DOI.search(text)
    if not match:
        return None
    doi = match.group().rstrip(".,;]")
    while doi.endswith(")") and doi.count(")") > doi.count("("):
        doi = doi[:-1].rstrip(".,;]")
    return doi


def build_query(
    topic: str,
    text: str,
    since: int,
    until: int | None = None,
    scope: Scope = "topic",
    ranks: frozenset[str] = frozenset(),
) -> str | None:
    """Open-access records from `since` to `until`, optionally matching `text`.

    `scope="topic"` keeps the topic's venues; `"all"` searches every venue. A DOI or paper link
    in `text` finds that one paper whatever the venue, year or access, so it can always be found.
    `ranks` keeps only the topic venues with one of these ranks; None when that leaves none.
    """
    doi = doi_in(text)
    if doi:
        return f'DOI("{doi}")'
    parts = ["OPENACCESS(1)", f"PUBYEAR > {since - 1}"]
    if until is not None:
        parts.append(f"PUBYEAR < {until + 1}")
    words = " ".join(re.sub(r"[\"{}()\\]", " ", text).split())[:100]  # query syntax, and spaces
    if words:
        parts.append(f'TITLE-ABS-KEY("{words}")')
    if scope == "all":
        return " AND ".join(parts)
    kept = [venue for venue, rank in VENUES[topic].items() if not ranks or rank in ranks]
    if not kept:
        return None
    venues = " OR ".join(f'SRCTITLE("{venue}")' for venue in kept)
    # SRCTITLE matches the words anywhere in a title, so "International Conference on Software
    # Engineering" also matches "... Software Engineering and Computer Applications" (#579).
    # Scopus applies AND NOT last, so it has to come at the end.
    others = " OR ".join(f'SRCTITLE("{venue} and*")' for venue in kept)
    return f"({venues}) AND " + " AND ".join(parts) + f" AND NOT ({others})"


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


def search(
    topic: str,
    text: str,
    since: int,
    until: int | None = None,
    sort: str = "cited",
    start: int = 0,
    scope: Scope = "topic",
    ranks: frozenset[str] = frozenset(),
) -> dict:
    """One page of open-access papers (see `build_query`), with how many Scopus has in all.

    `ranks` keeps only papers whose venue rank is one of these values ("Q1", "A*", "unranked"...).
    Scopus cannot filter by rank, so outside the topic venues the page is filtered after it comes
    back and `hidden` says how many it left out.

    Returns:
        `{"total", "results", "hidden"}`. Each result has its DOI, title, venue, year, first author,
        citation count, venue `rank` (see `venue_rank`), and the abstract, subject and keywords
        from OpenAlex (empty when it has none).

    Raises:
        NotConfigured: there is no SCOPUS_API_KEY.
        requests.RequestException: Scopus refused the request or did not answer, after one retry
            for a timeout or a server error.
    """
    if not config.SCOPUS_API_KEY:
        raise NotConfigured("set SCOPUS_API_KEY")
    query = build_query(topic, text, since, until, scope, ranks)
    if query is None:
        return {"total": 0, "results": [], "hidden": 0}
    entries = _entries({"query": query, "start": start, "count": PAGE, "sort": SORTS[sort]})
    found = [
        {
            "doi": entry["prism:doi"],
            "title": entry.get("dc:title", ""),
            "venue": entry.get("prism:publicationName", ""),
            "year": (entry.get("prism:coverDate") or "")[:4],
            "first_author": entry.get("dc:creator", ""),
            "cited_by": int(entry.get("citedby-count") or 0),
            "rank": rank,
        }
        for entry, rank in zip(entries["entries"], _ranks(entries["entries"]), strict=True)
    ]
    shown = [paper for paper in found if not ranks or (paper["rank"] or {}).get("value") in ranks]
    details = openalex_details([paper["doi"] for paper in shown])
    results = [{**paper, **details.get(paper["doi"].lower(), NO_DETAILS)} for paper in shown]
    return {"total": entries["total"], "results": results, "hidden": len(found) - len(shown)}


def rank_of(doi: str) -> dict | None:
    """The venue rank of one paper (see `venue_rank`); None when Scopus does not know the DOI.

    Raises the same errors as `search`.
    """
    if not config.SCOPUS_API_KEY:
        raise NotConfigured("set SCOPUS_API_KEY")
    entries = _entries({"query": f'DOI("{doi}")', "count": 1})["entries"]
    return _ranks(entries)[0] if entries else None


def _entries(params: dict) -> dict:
    """`{"total", "entries"}`: Scopus's records that have a DOI, asked for with FIELDS."""
    body = _ask_scopus({**params, "field": FIELDS}).get("search-results", {})
    # An empty result is one entry that only has an "error" key, so it has no DOI and is skipped.
    entries = [entry for entry in body.get("entry", []) if entry.get("prism:doi")]
    return {"total": int(body.get("opensearch:totalResults") or 0), "entries": entries}


def _ranks(entries: list[dict]) -> list[dict | None]:
    """The venue rank of each record, in order, with one CiteScore request for the whole list."""
    citescores = citescore_ranks([issn for entry in entries for issn in _issns(entry)])
    return [venue_rank(entry, citescores) for entry in entries]


def _issns(entry: dict) -> list[str]:
    return [issn.replace("-", "") for issn in (entry.get("prism:issn"), entry.get("prism:eIssn")) if issn]


def venue_rank(entry: dict, citescores: dict[str, dict | None]) -> dict | None:
    """How strong a Scopus record's venue is: `{"system", "value", "year"}`.

    A conference gets the CORE rank written in VENUES when its proceedings carry one of those
    names, and is unranked otherwise: matching any other proceedings title to a CORE row by
    similar words can pick the wrong conference, and a wrong rank is worse than none. A journal
    (or book series) gets its CiteScore quartile by ISSN from `citescores`, and is unranked when
    Scopus has none for it. None when the quartile could not be looked up.
    """
    venue = entry.get("prism:publicationName", "")
    if entry.get("prism:aggregationType") == "Conference Proceeding":
        rank = _core_rank(venue)
        return {"system": "CORE", "value": rank, "year": CORE_YEAR} if rank else UNRANKED
    issns = _issns(entry)
    if not issns:
        return UNRANKED
    found = [citescores[issn] for issn in issns if issn in citescores]
    if not found:
        return None  # the lookup failed
    return next((rank for rank in found if rank), UNRANKED)


def _core_rank(venue: str) -> str | None:
    """The CORE rank in VENUES of the conference these proceedings belong to, if any."""
    if NOT_MAIN_TRACK.search(venue):
        return None
    name = _words(venue)
    for venues in VENUES.values():
        for known, rank in venues.items():
            # Same rule as the query: the venue's words in a row, not followed by "and" (#579).
            if not rank.startswith("Q") and re.search(rf"\b{_words(known)}\b(?! and\b)", name):
                return rank
    return None


def _words(text: str) -> str:
    """Lower-case words separated by single spaces, as SRCTITLE compares them."""
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def citescore_ranks(issns: list[str]) -> dict[str, dict | None]:
    """The CiteScore quartile of each ISSN, by ISSN without a hyphen.

    The value is `{"system": "CiteScore", "value": "Q1"..."Q4", "year"}` from the best subject
    percentile in the latest complete CiteScore year (Scopus's quartiles: Q1 is the 75th-99th
    percentile), or None for an ISSN Scopus has no CiteScore for. An ISSN missing from the answer
    could not be looked up. Answers are kept in this process: a quartile changes once a year; a
    failed lookup is tried again after RETRY_UNKNOWN seconds.
    """
    now = time.monotonic()
    wanted = set(issns)
    with _citescores_lock:
        missing = sorted(issn for issn in wanted if _citescores.get(issn, (None, 0.0))[1] <= now)
    for start in range(0, len(missing), ISSN_BATCH):
        batch = missing[start : start + ISSN_BATCH]
        found = _ask_citescores(batch)
        with _citescores_lock:
            for issn in batch:
                _citescores[issn] = (
                    (None, now + RETRY_UNKNOWN) if found is None else (found.get(issn), math.inf)
                )
    with _citescores_lock:
        return {
            issn: _citescores[issn][0] for issn in wanted if _citescores.get(issn, (None, 0.0))[1] == math.inf
        }


def _ask_citescores(issns: list[str]) -> dict[str, dict] | None:
    """One Serial Title request: ISSN -> CiteScore rank for the ISSNs that have one; None on failure."""
    import requests

    headers = {"X-ELS-APIKey": config.SCOPUS_API_KEY, "Accept": "application/json"}
    params = {"issn": ",".join(issns), "view": "CITESCORE", "count": len(issns)}
    try:
        response = requests.get(SERIAL_URL, params=params, headers=headers, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as error:
        # Not the response: its links repeat the API key.
        log.warning("could not look up the CiteScore of %d ISSNs: %s", len(issns), type(error).__name__)
        return None
    found: dict[str, dict] = {}
    # No match at all is a reply with "error": "No results found" and no entries.
    for serial in response.json().get("serial-metadata-response", {}).get("entry", []):
        rank = _citescore_quartile(serial)
        for issn in (serial.get("prism:issn"), serial.get("prism:eIssn")):
            if issn and rank:
                found[issn.replace("-", "")] = rank
    return found


def _citescore_quartile(serial: dict) -> dict | None:
    years = (serial.get("citeScoreYearInfoList") or {}).get("citeScoreYearInfo") or []
    complete = [year for year in years if year.get("@status") == "Complete"]
    if not complete:
        return None
    latest = max(complete, key=lambda year: int(year["@year"]))
    percentiles = [
        int(subject["percentile"])
        for info in latest.get("citeScoreInformationList") or []
        for score in info.get("citeScoreInfo") or []
        for subject in score.get("citeScoreSubjectRank") or []
        if subject.get("percentile")
    ]
    if not percentiles:
        return None
    quartile = 4 - min(max(percentiles) // 25, 3)  # 75-99 -> Q1, 50-74 -> Q2, 25-49 -> Q3, 0-24 -> Q4
    return {"system": "CiteScore", "value": f"Q{quartile}", "year": int(latest["@year"])}


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


def openalex_details(dois: list[str]) -> dict[str, dict]:
    """What OpenAlex knows about these DOIs, by lower-case DOI.

    Each value has `abstract`, `subject` (OpenAlex's main research topic for the paper) and
    `keywords`, best first; any of them can be empty. Empty when OpenAlex fails: a result
    without them is still worth showing.
    """
    from app.pipeline.indexes import _IndexError, openalex_works

    # "," and "|" separate values in an OpenAlex filter, so a DOI holding one cannot be asked for.
    wanted = [doi for doi in dois if not re.search(r"[,|]", doi)]
    if not wanted:
        return {}
    params = {
        "filter": "doi:" + "|".join(wanted),
        "select": "doi,abstract_inverted_index,primary_topic,keywords",
        "per-page": len(wanted),
    }
    try:
        works = openalex_works(params)
    except _IndexError as error:
        log.warning("OpenAlex details for %d papers: %s", len(wanted), error)
        return {}
    return {
        work["doi"].removeprefix("https://doi.org/").lower(): {
            "abstract": _abstract_text(work.get("abstract_inverted_index") or {}),
            # OpenAlex can send "display_name": null; the page wants text.
            "subject": (work.get("primary_topic") or {}).get("display_name") or "",
            "keywords": _keywords(work),
        }
        for work in works
        if work.get("doi")
    }


def _keywords(work: dict) -> list[str]:
    ranked = sorted(work.get("keywords") or [], key=lambda keyword: keyword.get("score", 0), reverse=True)
    return [keyword["display_name"] for keyword in ranked[:KEYWORDS] if keyword.get("display_name")]


def subjects_of(dois: list[str]) -> dict[str, dict]:
    """`subject` and `keywords` of each DOI, by lower-case DOI, for the paper list.

    The list is asked for every few seconds, so answers are kept in this process: a paper
    OpenAlex knows is kept for good (its topic and keywords rarely change), and one it does not
    know, or every one when OpenAlex fails, is asked again after RETRY_UNKNOWN seconds.
    """
    now = time.monotonic()
    wanted = {doi.lower() for doi in dois}
    with _subjects_lock:
        missing = sorted(doi for doi in wanted if _subjects.get(doi, (None, 0.0))[1] <= now)
    for start in range(0, len(missing), OPENALEX_BATCH):
        batch = missing[start : start + OPENALEX_BATCH]
        found = openalex_details(batch)
        with _subjects_lock:
            for doi in batch:
                if doi in found:
                    _subjects[doi] = ({key: found[doi][key] for key in ("subject", "keywords")}, math.inf)
                else:
                    _subjects[doi] = ({"subject": "", "keywords": []}, now + RETRY_UNKNOWN)
    with _subjects_lock:
        return {doi: _subjects[doi][0] for doi in wanted if doi in _subjects}


def _abstract_text(index: dict[str, list[int]]) -> str:
    """The abstract from OpenAlex's index of each word to the positions it holds."""
    words = {position: word for word, positions in index.items() for position in positions}
    text = " ".join(words[position] for position in sorted(words))
    # Many publishers' abstracts start with the heading itself: "Abstract Event cameras are...".
    return re.sub(r"^\s*abstract\b[\s.:—-]*", "", text, flags=re.IGNORECASE)
