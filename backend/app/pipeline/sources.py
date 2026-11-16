"""Find the open-access PDF of a cited work and download it.

Takes a DOI, arXiv ID, PMID, direct URL, or a bare title. arXiv IDs resolve directly.
Other works are matched through Semantic Scholar and Unpaywall. If the chosen PDF URL fails,
the resolver tries other Unpaywall locations and OpenAlex's open PDF locations before giving up.
Results are cached in SQLite, so a re-run makes no API call. PDFs are saved in PAPERS_DIR so
they can be indexed.
"""

import os
import re
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple
from urllib.parse import quote, urlparse

from app.config import PAPERS_DIR, S2_API_KEY, UNPAYWALL_EMAIL

ARXIV_API = "http://export.arxiv.org/api/query"  # no key needed
ATOM = "{http://www.w3.org/2005/Atom}"
SEMANTIC_SCHOLAR_URL = "https://api.semanticscholar.org/graph/v1/paper"
UNPAYWALL_URL = "https://api.unpaywall.org/v2"
ACL_ANTHOLOGY_RAW = "https://raw.githubusercontent.com/acl-org/acl-anthology/master"
ACL_METADATA_MAX_AGE = 7 * 24 * 3600
S2_FIELDS = "title,year,authors,externalIds,openAccessPdf"
TITLE_MATCH = 0.9  # a wrong paper is worse than no paper
# A 429 is retried until RETRY_BUDGET seconds have passed, waiting these seconds between tries;
# the last wait repeats. On 2026-09-14 Semantic Scholar refused 70 to 80% of calls with a key,
# even one call every 5 s, and let the others through at random. Many short tries get an
# answer, where 4 tries gave up on about 1 lookup in 4 (#173).
RETRY_WAITS = (2, 3, 5, 8, 10)
RETRY_BUDGET = 120.0
# Semantic Scholar answers about one request a second, and never two at once.
# Send three together and two get a 429, one gets an answer. The analysis graph
# checks several cited sources in parallel, so every lookup waits its turn in _s2_get.
S2_MIN_INTERVAL = 1.2
# How long a cached location is trusted before the work is looked up again. Open copies move
# rarely; the bound keeps a link that went bad from staying forever (#414).
SOURCE_MAX_AGE = 30 * 24 * 3600
USER_AGENT = {"User-Agent": "SecretSource/0.1 (academic claim verification; senior project)"}


class Unresolvable(ValueError):
    """We do not know how to follow this, usually a bare title."""


class OnlyOtherWorks(Unresolvable):
    """Works with this title exist, but none from the cited year and first author (#436)."""


class AmbiguousMatch(ValueError):
    """Several distinct works fit the available citation metadata."""


class IdentityMismatch(ValueError):
    """A candidate conflicts with an identifier or title supplied by the citation."""


class NoOpenAccessCopy(ValueError):
    """The work is known, but no free PDF is published for it."""

    def __init__(self, message: str, index: str = ""):
        super().__init__(message)
        self.index = index


class NotDownloadable(ValueError):
    """A PDF was promised but could not be fetched, or was not a PDF."""


class LookupUnavailable(ValueError):
    """The lookup service would not answer, usually rate limiting, not a missing paper."""


class WebSource(ValueError):
    """A blog post, a spec, or a vendor page: a real citation, but not a paper."""


class Withdrawn(ValueError):
    """The authors withdrew the arXiv paper, so its latest version has no PDF."""


REASONS = {
    Unresolvable: "unresolvable",
    NoOpenAccessCopy: "no-open-access",
    NotDownloadable: "not-downloadable",
    LookupUnavailable: "lookup-unavailable",
    WebSource: "web-source",
    Withdrawn: "withdrawn",
    AmbiguousMatch: "ambiguous-match",
    IdentityMismatch: "identity-mismatch",
}
# A service that would not answer may answer later. Every other reason is an answer about the
# work itself, so asking again gets the same answer.
RETRYABLE = {"lookup-unavailable"}


class Resolution(NamedTuple):
    """Where a cited work was found. `index` is the service that answered and `ids` are
    the identifiers it returned. This lets us tell a well-known work from one nobody
    could place. Semantic Scholar returns DOI, ArXiv, PubMed, MAG, DBLP and CorpusId ids,
    never a Scopus id."""

    url: str
    title: str = ""
    index: str = ""  # "" when the identifier was used as-is, for example a bare URL
    ids: dict = {}  # never changed after creation; one shared empty default is safe
    year: int | None = None
    first_author: str = ""  # as the index writes it, for example "Ian J. Goodfellow"
    attempts: tuple[dict, ...] = ()  # safe provider/result summaries; older cache rows have none


# Whether a work found by its title is the one cited, from its year and first author. Two works
# can share a title: "Deep learning" is a 2016 book and a 2018 arXiv paper (#436).
Fits = Callable[[int | None, str], bool]


def _any_work(year: int | None, first_author: str) -> bool:
    """Take the first work with the title, as a lookup with nothing else to go on does."""
    return True


def _from_row(row: dict) -> Resolution:
    """A Resolution from a cached row. Older rows have no index, ids, year or first author."""
    return Resolution(
        row["url"],
        row["title"],
        row.get("index", ""),
        row.get("ids") or {},
        row.get("year"),
        row.get("first_author", ""),
        tuple(row.get("attempts") or ()),
    )


def reason_for(error: BaseException) -> str:
    """The kind of failure, so the UI can tell a missing source from our own error."""
    return next((code for kind, code in REASONS.items() if isinstance(error, kind)), "failed")


def is_retryable(error: BaseException) -> bool:
    """Whether asking again later can help: a lookup service that would not answer, or a
    network timeout or dropped connection, also when it is the cause of `error`."""
    import requests

    override = getattr(error, "retryable", None)
    if override is not None:
        return bool(override)
    network = tuple(
        kind for kind in (
            getattr(requests, "Timeout", None),
            getattr(requests, "ConnectionError", None),
            TimeoutError,
            ConnectionError,
        )
        if isinstance(kind, type)
    )
    cause = error.__cause__
    timed_out = any(isinstance(each, network) for each in (error, cause))
    response = getattr(error, "response", None)
    if response is None:
        response = getattr(cause, "response", None)
    status = getattr(response, "status_code", None)
    server_error = status == 429 or (isinstance(status, int) and status >= 500)
    return reason_for(error) in RETRYABLE or timed_out or server_error


def _outcome_code(error: BaseException) -> str:
    """A stable result for clients; unlike `reason`, this describes what the pipeline learned."""
    if is_retryable(error):
        return "temporary-failure"
    status = _http_status(error)
    if status in (401, 403):
        return "blocked"
    if status == 404:
        return "not-found"
    if isinstance(error, WebSource):
        return "web-page"
    if isinstance(error, AmbiguousMatch):
        return "ambiguous-match"
    if isinstance(error, IdentityMismatch):
        return "identity-mismatch"
    if isinstance(error, OnlyOtherWorks):
        return "identity-mismatch"
    if isinstance(error, Unresolvable):
        return "no-match"
    if isinstance(error, NoOpenAccessCopy):
        return "no-accessible-copy"
    if isinstance(error, NotDownloadable):
        return "download-failed" if status is not None else "invalid-content"
    if isinstance(error, Withdrawn):
        return "withdrawn"
    if isinstance(error, LookupUnavailable):
        return "lookup-failed"
    return "failed"


def _source_outcome(error: BaseException, attempts: list[dict] | None = None) -> dict:
    """Safe metadata carried from lookup/fetch to the analysis and the Labeler."""
    if isinstance(error, WebSource):
        source_kind = "web-page"
    else:
        source_kind = getattr(error, "source_kind", "paper" if isinstance(
            error, (OnlyOtherWorks, AmbiguousMatch, IdentityMismatch, NoOpenAccessCopy, Withdrawn)
        ) else "unknown")
    return {
        "source_kind": source_kind,
        "outcome": _outcome_code(error),
        "retryable": is_retryable(error),
        "attempts": attempts if attempts is not None else list(getattr(error, "source_attempts", []) or []),
    }


def _safe_locator(url: str) -> str:
    """A useful source location without credentials, query parameters, or fragments."""
    parsed = urlparse(url)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        return ""
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    try:
        if parsed.port:
            host = f"{host}:{parsed.port}"
    except ValueError:
        return ""
    return parsed._replace(scheme=parsed.scheme.lower(), netloc=host, query="", fragment="").geturl()[:512]


def _attempt(
    provider: str, result: str, error: BaseException | None = None,
    host: str = "", locator: str = "",
) -> dict:
    """One safe provider attempt; never retain credentials or URL query parameters."""
    item = {"provider": provider, "result": result}
    if host:
        item["host"] = host
    if locator and (safe_locator := _safe_locator(locator)):
        item["locator"] = safe_locator
    if error is not None:
        item["outcome"] = _outcome_code(error)
        item["retryable"] = is_retryable(error)
        status = _http_status(error)
        if isinstance(status, int):
            item["status_code"] = status
    return item


def _http_status(error: BaseException) -> int | None:
    response = getattr(error, "response", None)
    if response is None:
        response = getattr(error.__cause__, "response", None)
    status = getattr(response, "status_code", None) or getattr(error, "status_code", None)
    return status if isinstance(status, int) else None


def _safe_message(error: BaseException) -> str:
    """Remove query strings from URLs in upstream errors before storing or returning them."""
    def without_query(match: re.Match) -> str:
        value = match.group(0)
        clean_value = value.rstrip(".,;)]}")
        suffix = value[len(clean_value):]
        parsed = urlparse(clean_value)
        host = parsed.hostname or ""
        try:
            if parsed.port:
                host = f"{host}:{parsed.port}"
        except ValueError:
            return value
        clean = parsed._replace(netloc=host, query="", fragment="").geturl()
        return clean + suffix

    return re.sub(r"https?://[^\s\"']+", without_query, str(error))


def tool_error(error: BaseException) -> dict:
    """The error a tool returns: legacy reason plus structured outcome and safe attempts."""
    return {"status": "error", "message": _safe_message(error), "reason": reason_for(error),
            "retryable": is_retryable(error), "source_outcome": _source_outcome(error)}


# New ids (2303.12712) and the ones from before 2007 (hep-th/9901001, math.GT/0309136).
ARXIV_PATTERN = re.compile(r"(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?")
ARXIV_VERSION = re.compile(r"v\d+$")
# A DOI on its own or inside a link (https://dl.acm.org/doi/10.1145/3784828.3785017). It ends
# at a space, a quote, a backslash (it would escape a Scopus query's closing quote), or a link's
# query or fragment. "<" and ">" can be part of it, as in old Wiley DOIs.
DOI = re.compile(r"\b10\.\d{4,9}/[^\s\"'?#\\]+")
ACL_DOI_ID = re.compile(
    r"^10\.(?:18653|3115)/(?:v1/)?(20\d{2}\.[a-z0-9]+(?:-[a-z0-9]+)*\.\d+|[A-Z]\d{2}-\d{3,4})$",
    re.IGNORECASE,
)
CLOSING = {")": "(", ">": "<"}


def doi_in(text: str) -> str | None:
    """The DOI in a pasted DOI, link or reference, without trailing punctuation; None when there is none.

    A ")" or ">" is trailing punctuation only when it closes nothing in the DOI: old Wiley DOIs
    such as 10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0 hold their own.
    """
    match = DOI.search(text)
    if not match:
        return None
    doi = match.group().rstrip(".,;]")
    while doi[-1:] in CLOSING and doi.count(doi[-1]) > doi.count(CLOSING[doi[-1]]):
        doi = doi[:-1].rstrip(".,;]")
    return doi
# An arXiv copy in an Unpaywall location: arxiv.org/pdf/<id>, arxiv.org/abs/<id>, or arXiv's DOI.
ARXIV_LOCATION = re.compile(
    r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})|10\.48550/arxiv\.(\d{4}\.\d{4,5})", re.IGNORECASE
)
# arXiv's abstract page says this for a withdrawn paper. Its API does not say it anywhere: the
# entry of 2305.13664 has the comment "requires revision".
ARXIV_WITHDRAWN = re.compile(r"This paper has been withdrawn by ([^<]+)<")
# OSTI's record page for a DOE report or paper. Semantic Scholar sometimes links it, and the PDF
# of the same record is at osti.gov/servlets/purl/<id>.
OSTI_RECORD_PAGE = re.compile(r"^https?://(?:www\.)?osti\.gov/biblio/(\d+)\b.*")


def _headers() -> dict:
    return {**USER_AGENT, **({"x-api-key": S2_API_KEY} if S2_API_KEY else {})}


_s2_gate = threading.Lock()  # one Semantic Scholar request in flight, process-wide
_s2_free_at = 0.0  # the monotonic time the next one may go out


def _s2_get(path: str, params: dict):
    """One Semantic Scholar request at a time. The service sends a 429 when calls
    overlap, so lookups from parallel checks wait here instead of each getting a 429.
    Only the lookup waits its turn. Indexing the PDF, the slow part, still overlaps."""
    global _s2_free_at
    import requests

    with _s2_gate:
        delay = _s2_free_at - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        try:
            return requests.get(
                f"{SEMANTIC_SCHOLAR_URL}{path}", params=params, headers=_headers(), timeout=60
            )
        finally:
            _s2_free_at = time.monotonic() + S2_MIN_INTERVAL


def _rate_limited() -> LookupUnavailable:
    """The error to raise when the lookup gave up to rate limiting."""
    if S2_API_KEY:
        # Our calls already go out S2_MIN_INTERVAL apart, under the key's limit, so the refusals
        # come from Semantic Scholar's side, or from someone else using the same key.
        return LookupUnavailable(
            f"Semantic Scholar refused every call for {RETRY_BUDGET:.0f} s with S2_API_KEY set and "
            f"our calls {S2_MIN_INTERVAL} s apart; it is throttling on its side, try again later"
        )
    return LookupUnavailable("Semantic Scholar is rate limiting us; set S2_API_KEY for a higher limit")


def _retry_after(response, fallback: float) -> float:
    """How long the service asked us to wait, when it says so. Our own backoff otherwise."""
    try:
        return max(float(response.headers.get("Retry-After", "")), fallback)
    except ValueError:
        return fallback


def _semantic_scholar(path: str, params: dict) -> dict:
    """One Semantic Scholar call; a 429 is retried, not treated as an answer about the paper."""
    give_up_at = time.monotonic() + RETRY_BUDGET
    attempt = 0
    while True:
        response = _s2_get(path, params)
        if response.status_code != 429:
            break
        wait = _retry_after(response, RETRY_WAITS[min(attempt, len(RETRY_WAITS) - 1)])
        if time.monotonic() + wait > give_up_at:
            raise _rate_limited()
        time.sleep(wait)
        attempt += 1
    response.raise_for_status()
    return response.json()


def _pdf_of(paper: dict, described_as: str) -> Resolution:
    """Turn a Semantic Scholar record into a Resolution with a PDF URL. Falls back to
    the arXiv twin. A paywalled DOI often has one, and not looking loses most papers."""
    title = paper.get("title", "")
    ids = paper.get("externalIds") or {}
    pdf = (paper.get("openAccessPdf") or {}).get("url")
    year, first_author = paper.get("year"), _s2_first_author(paper)
    if pdf:
        return Resolution(pdf, title, "semantic-scholar", ids, year, first_author)
    arxiv = ids.get("ArXiv")
    if arxiv:
        url = f"https://arxiv.org/pdf/{arxiv}"
        return Resolution(url, title, "semantic-scholar", ids, year, first_author)
    raise NoOpenAccessCopy(f"no open-access PDF known for {described_as}", "semantic-scholar")


def _s2_first_author(paper: dict) -> str:
    """The first author's name in a Semantic Scholar record, or "" when it lists none."""
    authors = paper.get("authors") or [{}]
    return authors[0].get("name") or ""


def _semantic_scholar_pdf(paper_id: str) -> Resolution:
    return _pdf_of(_semantic_scholar(f"/{paper_id}", {"fields": S2_FIELDS}), paper_id)


def _normalised(title: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", title.lower()).strip()


def titles_match(wanted: str, found: str) -> bool:
    """Whether two titles are the same up to case, punctuation and a typo or two."""
    from difflib import SequenceMatcher

    return SequenceMatcher(None, _normalised(wanted), _normalised(found)).ratio() >= TITLE_MATCH


def _arxiv_by_title(title: str, fits: Fits = _any_work) -> Resolution:
    import xml.etree.ElementTree as ET

    import requests

    response = requests.get(
        ARXIV_API,
        params={"search_query": f'ti:"{title}"', "max_results": 5},
        headers=USER_AGENT,
        timeout=60,
    )
    response.raise_for_status()
    others = []
    matches = []
    for entry in ET.fromstring(response.text).iter(f"{ATOM}entry"):
        found = " ".join((entry.findtext(f"{ATOM}title") or "").split())
        if not titles_match(title, found):
            continue
        published = re.match(r"\d{4}", entry.findtext(f"{ATOM}published") or "")
        year = int(published.group(0)) if published else None
        first_author = (entry.findtext(f"{ATOM}author/{ATOM}name") or "").strip()
        if not fits(year, first_author):
            others.append(_described(found, year, first_author))
            continue
        arxiv_id = ARXIV_VERSION.sub("", (entry.findtext(f"{ATOM}id") or "").rsplit("/", 1)[-1])
        url = f"https://arxiv.org/pdf/{arxiv_id}"
        matches.append(Resolution(url, found, "arxiv", {"ArXiv": arxiv_id}, year, first_author))
    unique = {item.ids.get("ArXiv"): item for item in matches}
    if len(unique) > 1:
        raise AmbiguousMatch(f"more than one arXiv work matches '{title}'")
    if unique:
        return next(iter(unique.values()))
    if others:
        raise OnlyOtherWorks(f"arXiv has only other works titled '{title}': {'; '.join(others)}")
    raise Unresolvable(f"arXiv knows no paper by that title: {title}")


def arxiv_titles(arxiv_ids: list[str]) -> dict[str, str]:
    """{id as given: title} from arXiv, in one request for all the ids.

    "2204.02311" and "2204.02311v3" are asked for once and both get the title. Empty when
    arXiv does not answer: the lookup goes by the id, so the analysis goes on without titles.
    """
    import xml.etree.ElementTree as ET

    import requests

    bare_ids = sorted({ARXIV_VERSION.sub("", arxiv_id) for arxiv_id in arxiv_ids})
    if not bare_ids:
        return {}
    try:
        response = requests.get(
            ARXIV_API,
            params={"id_list": ",".join(bare_ids), "max_results": len(bare_ids)},
            headers=USER_AGENT,
            timeout=60,
        )
        response.raise_for_status()
        feed = ET.fromstring(response.text)
    except (requests.RequestException, ET.ParseError):
        return {}
    found = {}
    for entry in feed.iter(f"{ATOM}entry"):
        bare_id = ARXIV_VERSION.sub("", (entry.findtext(f"{ATOM}id") or "").split("/abs/")[-1])
        found[bare_id] = " ".join((entry.findtext(f"{ATOM}title") or "").split())
    return {
        arxiv_id: found[bare_id]
        for arxiv_id in arxiv_ids
        if (bare_id := ARXIV_VERSION.sub("", arxiv_id)) in found
    }


def _semantic_scholar_by_title(title: str, fits: Fits = _any_work) -> Resolution:
    found = _semantic_scholar("/search", {"query": title, "fields": S2_FIELDS, "limit": 5})
    others = []
    matches = []
    for paper in found.get("data") or []:
        if not titles_match(title, paper.get("title", "")):
            continue
        if not fits(paper.get("year"), _s2_first_author(paper)):
            others.append(_described(paper["title"], paper.get("year"), _s2_first_author(paper)))
            continue
        matches.append(paper)
    if len(matches) > 1:
        raise AmbiguousMatch(f"more than one Semantic Scholar work matches '{title}'")
    if matches:
        return _pdf_of(matches[0], f"'{title}'")
    if others:
        raise OnlyOtherWorks(f"Semantic Scholar has only other works titled '{title}': {'; '.join(others)}")
    raise Unresolvable(f"no paper found matching the title: {title}")


def _openalex_by_title(title: str, fits: Fits = _any_work) -> Resolution:
    """Resolve title-only citations through OpenAlex after arXiv and Semantic Scholar."""
    from app.pipeline.indexes import _IndexError, openalex_works

    words = re.sub(r"[,|?*]", " ", title)
    try:
        works = openalex_works({
            "filter": f"title.search:{words}",
            "select": "doi,title,publication_year,authorships,locations",
            "per-page": 5,
        })
    except _IndexError as error:
        raise LookupUnavailable(f"OpenAlex did not answer: {error}") from error

    others = []
    paywalled = False
    for work in works:
        found_title = work.get("title") or ""
        if not titles_match(title, found_title):
            continue
        year = work.get("publication_year")
        authorships = work.get("authorships") or []
        first_author = (
            ((authorships[0].get("author") or {}).get("display_name") or "")
            if authorships else ""
        )
        if not fits(year, first_author):
            others.append(_described(found_title, year, first_author))
            continue
        pdf = next((loc.get("pdf_url") for loc in work.get("locations") or [] if loc.get("pdf_url")), "")
        if not pdf:
            paywalled = True
            continue
        doi = doi_in(str(work.get("doi") or ""))
        ids = {"DOI": doi} if doi else {}
        return Resolution(pdf, found_title, "openalex", ids, year, first_author)
    if paywalled:
        raise NoOpenAccessCopy(f"no open-access PDF known for '{title}'", "openalex")
    if others:
        raise OnlyOtherWorks(f"OpenAlex has only other works titled '{title}': {'; '.join(others)}")
    raise Unresolvable(f"OpenAlex knows no paper by that title: {title}")


def _openalex_pdfs(doi: str) -> list[str]:
    """Return every OpenAlex PDF copy listed for a DOI; lookup failures are best effort."""
    from app.pipeline.indexes import _IndexError, openalex_works

    if "," in doi or "|" in doi:
        return []
    normalized = doi_in(doi)
    if not normalized:
        return []
    try:
        works = openalex_works({
            "filter": f"doi:{normalized}",
            "select": "locations",
            "per-page": 5,
        })
    except _IndexError:
        return []
    return list(dict.fromkeys(
        location["pdf_url"]
        for work in works
        for location in work.get("locations") or []
        if location.get("pdf_url")
    ))


def _described(title: str, year: int | None, first_author: str) -> str:
    """ "Deep Learning (2018, Nicholas G. Polson)", for a message about a work that was skipped."""
    return f"{title} ({', '.join(str(part) for part in (year, first_author) if part)})"


def _unpaywall_resolutions(doi: str) -> list[Resolution]:
    """Every PDF or landing-page location Unpaywall marks open for a DOI.

    Its best location can be a publisher endpoint that refuses automated downloads while a
    repository copy is available in the same response. Keep those locations as separate
    candidates so `_fetch` can continue after one host blocks the download.
    """
    import requests

    if not UNPAYWALL_EMAIL:
        raise LookupUnavailable("set S2_API_KEY, or UNPAYWALL_EMAIL to ask Unpaywall instead")
    response = requests.get(
        f"{UNPAYWALL_URL}/{quote(doi)}", params={"email": UNPAYWALL_EMAIL}, headers=USER_AGENT, timeout=60
    )
    if response.status_code == 404:
        raise Unresolvable(f"Unpaywall knows no work with DOI {doi}")
    response.raise_for_status()
    work = response.json()
    locations = []
    if best := work.get("best_oa_location"):
        locations.append(best)
    locations.extend(work.get("oa_locations") or [])
    if not locations:
        raise NoOpenAccessCopy(f"no open-access PDF known for DOI:{doi}", "unpaywall")

    ids = {"DOI": doi}
    for location in locations:
        if found := ARXIV_LOCATION.search(
            f"{location.get('url_for_pdf') or ''} {location.get('url') or ''}"
        ):
            ids["ArXiv"] = found.group(1) or found.group(2)
            break

    resolutions = []
    seen = set()
    for location in locations:
        url = location.get("url_for_pdf") or location.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        resolutions.append(Resolution(
            url, work.get("title") or "", "unpaywall", ids,
            _as_year(work.get("year")),
        ))
    if not resolutions:
        raise NoOpenAccessCopy(f"no open-access PDF known for DOI:{doi}", "unpaywall")
    return resolutions


def _unpaywall_pdf(doi: str) -> Resolution:
    """The best available Unpaywall location, preserving the legacy single-answer API."""
    return _unpaywall_resolutions(doi)[0]


def _as_year(value) -> int | None:
    match = re.search(r"\d{4}", str(value or ""))
    return int(match.group()) if match else None


def _surname(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z -]", " ", name).strip().lower()
    if not cleaned:
        return ""
    return cleaned.split(",", 1)[0].split()[-1]


def _expected_fits(expected: dict | None) -> Fits:
    """Filter title results by the cited year and first author when those values are known."""
    expected = expected or {}
    year = _as_year(expected.get("year"))
    authors = expected.get("authors") or expected.get("author") or []
    if isinstance(authors, list):
        author = authors[0] if authors else ""
    else:
        author = authors if isinstance(authors, str) else ""
    wanted_surname = _surname(str(author)) if author else ""

    def fits(found_year: int | None, found_author: str) -> bool:
        if year is not None and found_year is not None and year != found_year:
            return False
        found_surname = _surname(found_author)
        return not (wanted_surname and found_surname and wanted_surname != found_surname)

    return fits


def _validate_resolution(found: Resolution, expected: dict) -> None:
    """Reject a resolved candidate when identifiers or title conflict with the citation."""
    expected_doi = doi_in(str(expected.get("doi") or ""))
    found_doi = found.ids.get("DOI") or found.ids.get("doi")
    if expected_doi and found_doi and (doi_in(str(found_doi)) or "").lower() != expected_doi.lower():
        raise IdentityMismatch("the resolved DOI does not match the citation DOI")

    expected_arxiv_match = ARXIV_PATTERN.search(str(expected.get("arxiv") or ""))
    found_arxiv = found.ids.get("ArXiv") or found.ids.get("arxiv")
    if expected_arxiv_match and found_arxiv:
        wanted = ARXIV_VERSION.sub("", expected_arxiv_match.group(1))
        actual_match = ARXIV_PATTERN.search(str(found_arxiv))
        actual = ARXIV_VERSION.sub("", actual_match.group(1)) if actual_match else str(found_arxiv)
        if actual != wanted:
            raise IdentityMismatch("the resolved arXiv ID does not match the citation arXiv ID")

    expected_title = " ".join(str(expected.get("title") or "").split())
    if expected_title and found.title and not titles_match(expected_title, found.title):
        raise IdentityMismatch("the resolved title does not match the citation title")


def _openalex_resolutions(work: dict, expected: dict | None = None) -> list[Resolution]:
    """Turn a validated OpenAlex work into its known open PDF locations."""
    title = work.get("title") or ""
    doi = doi_in(str(work.get("doi") or ""))
    authorships = work.get("authorships") or []
    first_author = (authorships[0].get("author") or {}).get("display_name", "") if authorships else ""
    ids = {"DOI": doi} if doi else {}
    base = Resolution(
        "", title, "openalex", ids, work.get("publication_year"), first_author,
    )
    if expected:
        _validate_resolution(base, expected)

    locations = [
        location for location in work.get("locations") or []
        if location.get("is_oa") and location.get("pdf_url")
    ]
    # Repository versions are usually less likely to block a scripted download than the
    # publisher's copy. Within each class keep OpenAlex's own ranking.
    locations.sort(key=lambda location: (
        0 if (urlparse(location.get("pdf_url") or "").hostname or "").lower() in {
            "arxiv.org", "biorxiv.org", "medrxiv.org", "europepmc.org",
        } else 1
    ))
    resolutions = []
    seen = set()
    for location in locations:
        pdf_url = location["pdf_url"]
        if pdf_url in seen:
            continue
        seen.add(pdf_url)
        location_ids = dict(ids)
        if found := ARXIV_LOCATION.search(pdf_url):
            location_ids["ArXiv"] = found.group(1) or found.group(2)
        candidate = base._replace(url=pdf_url, ids=location_ids)
        if expected:
            _validate_resolution(candidate, expected)
        resolutions.append(candidate)
    if not resolutions:
        raise NoOpenAccessCopy("OpenAlex knows the work but lists no open PDF location")
    return resolutions


def _openalex_candidates(identifier: str, expected: dict | None = None) -> list[Resolution]:
    """Find open PDF locations through OpenAlex after a primary URL fails."""
    from app.pipeline import indexes

    doi = doi_in(identifier) or doi_in(str((expected or {}).get("doi") or ""))
    if doi:
        work = indexes.openalex_work_by_doi(doi)
        if not work:
            raise Unresolvable(f"OpenAlex knows no work with DOI {doi}")
        candidate_doi = doi_in(str(work.get("doi") or ""))
        if candidate_doi and candidate_doi.lower() != doi.lower():
            raise IdentityMismatch("OpenAlex returned a different DOI")
        return _openalex_resolutions(work, expected)

    title = str((expected or {}).get("title") or identifier).strip()
    if not title or title.startswith("http") or ARXIV_PATTERN.search(title):
        return []
    fits = _expected_fits(expected)
    others = []
    matches = []
    for work in indexes.openalex_search_works(title):
        found_title = work.get("title") or ""
        year = work.get("publication_year")
        authorships = work.get("authorships") or []
        first_author = (authorships[0].get("author") or {}).get("display_name", "") if authorships else ""
        if not titles_match(title, found_title):
            continue
        if not fits(year, first_author):
            others.append(_described(found_title, year, first_author))
            continue
        matches.append(work)

    unique = {
        doi_in(str(work.get("doi") or "")) or work.get("id") or work.get("title"): work
        for work in matches
    }
    if len(unique) > 1:
        raise AmbiguousMatch(f"more than one OpenAlex work matches '{title}'")
    if unique:
        return _openalex_resolutions(next(iter(unique.values())), expected)
    if others:
        raise OnlyOtherWorks(f"OpenAlex has only other works titled '{title}': {'; '.join(others)}")
    raise Unresolvable(f"OpenAlex knows no work matching the title: {title}")


def _acl_anthology_candidate(doi: str, expected: dict | None = None) -> Resolution | None:
    """Build an ACL Anthology PDF URL for ACL-assigned DOIs whose suffix is the paper ID.

    The Anthology documents that its ACL DOI suffix embeds its canonical paper identifier.
    Older ACM-assigned DOIs such as 10.3115/1073083.1073135 do not, and are intentionally
    excluded rather than guessed.
    """
    match = ACL_DOI_ID.fullmatch(doi)
    if not match:
        return None
    anthology_id = match.group(1)
    candidate = Resolution(
        f"https://aclanthology.org/{anthology_id}.pdf", "", "acl_anthology",
        {"DOI": doi, "ACL": anthology_id},
    )
    if expected:
        _validate_resolution(candidate, expected)
    return candidate


def _acl_resource(path: str, *, json_response: bool = False):
    """Read and cache one public ACL Anthology metadata file for a week."""
    import requests

    from app import store

    url = f"{ACL_ANTHOLOGY_RAW}/{path}"
    key = store.cache_key("acl-anthology-metadata", path)
    cached = store.recall_cache(key)
    if cached and time.time() - cached.get("fetched_at", 0) < ACL_METADATA_MAX_AGE:
        return cached.get("data")

    response = requests.get(url, headers=USER_AGENT, timeout=20)
    if response.status_code == 404:
        raise Unresolvable(f"ACL Anthology has no metadata file for {path}")
    response.raise_for_status()
    try:
        data = response.json() if json_response else response.text
    except ValueError as error:
        unavailable = LookupUnavailable("ACL Anthology metadata was not readable")
        raise unavailable from error
    if not data:
        raise LookupUnavailable("ACL Anthology returned an empty metadata file")
    store.remember_cache(key, {"data": data, "fetched_at": time.time()})
    return data


def _acl_venue(venue: str, year: int | None = None) -> tuple[str, dict]:
    """Find the official ACL Anthology venue key for a citation's venue text."""
    cleaned = re.sub(r"\b\d+(?:st|nd|rd|th)\b", " ", venue, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bproceedings of\b", " ", cleaned, flags=re.IGNORECASE)
    wanted = _normalised(cleaned)
    if not wanted:
        raise Unresolvable("the citation does not name an ACL Anthology venue")
    venues = _acl_resource("data/json/venues.json", json_response=True)
    matches = []
    for venue_id, details in venues.items():
        name = _normalised(str(details.get("name") or ""))
        acronym = _normalised(str(details.get("acronym") or ""))
        key = _normalised(venue_id)
        if wanted in {name, acronym, key}:
            matches.append((3, venue_id, details))
        elif (name and wanted.startswith(name)) or (
            acronym and len(acronym) >= 4 and wanted.startswith(f"{acronym} ")
        ):
            # GROBID often appends a journal volume after its full name or acronym.
            matches.append((2, venue_id, details))
        elif acronym and len(acronym) >= 3 and re.search(rf"\b{re.escape(acronym)}\b", wanted):
            matches.append((2, venue_id, details))
        else:
            ignored = {"the", "of", "for", "on", "in", "proceedings", "vol", "volume"}
            wanted_words = set(wanted.split()) - ignored
            name_words = set(name.split()) - ignored
            shared_words = wanted_words & name_words
            venue_coverage = len(shared_words) / len(name_words) if name_words else 0
            citation_coverage = len(shared_words) / len(wanted_words) if wanted_words else 0
            if venue_coverage >= 0.8:
                # Prefer a full venue-name match over a shorter venue nested in it (for
                # example, ACL over the broader "Computational Linguistics" journal).
                matches.append((1 + citation_coverage, venue_id, details))
    if not matches:
        raise Unresolvable(f"ACL Anthology has no venue matching '{venue}'")
    best_score = max(score for score, _, _ in matches)
    best = [(venue_id, details) for score, venue_id, details in matches if score == best_score]
    if year is not None and year < 2020:
        # Older Anthology collections use one-letter venue IDs (for example P02 for ACL).
        # Track venues may share nearly the same display name, but only the parent entry
        # carries the historical ID prefix needed to select that collection's XML file.
        legacy = [(venue_id, details) for venue_id, details in best if details.get("oldstyle_letter")]
        if legacy:
            best = legacy
    if len(best) > 1:
        raise AmbiguousMatch(f"more than one ACL Anthology venue matches '{venue}'")
    return best[0]


def _xml_text(element) -> str:
    return " ".join("".join(element.itertext()).split()) if element is not None else ""


def _acl_paper_id(root, volume, paper) -> str:
    """Build the paper's canonical ID from the collection, volume, and paper IDs."""
    collection_id = root.get("id", "")
    volume_id = volume.get("id", "")
    paper_id = paper.get("id", "")
    if re.fullmatch(r"20\d{2}\..+", collection_id):
        return f"{collection_id}-{volume_id}.{paper_id}"
    if collection_id and volume_id.isdigit() and paper_id.isdigit():
        return f"{collection_id}-{volume_id}{int(paper_id):03d}"
    raise LookupUnavailable("ACL Anthology paper metadata had an unknown identifier format")


def _acl_anthology_candidates(identifier: str, expected: dict | None = None) -> list[Resolution]:
    """Find a matching paper and canonical PDF through ACL's official metadata files."""
    import xml.etree.ElementTree as ET

    expected = expected or {}
    doi = doi_in(identifier) or doi_in(str(expected.get("doi") or ""))
    if doi and (direct := _acl_anthology_candidate(doi, expected)):
        return [direct]

    venue_text = str(expected.get("venue") or "")
    year = _as_year(expected.get("year"))
    title = " ".join(str(expected.get("title") or identifier).split())
    if not venue_text or year is None or not title:
        raise Unresolvable("ACL Anthology lookup needs a cited venue, year, and title")

    venue_id, venue = _acl_venue(venue_text, year)
    if year >= 2020:
        xml_name = f"{year}.{venue_id}.xml"
    elif venue.get("oldstyle_letter"):
        xml_name = f"{venue['oldstyle_letter']}{year % 100:02d}.xml"
    else:
        xml_name = f"{year}.{venue_id}.xml"
    xml_data = _acl_resource(f"data/xml/{xml_name}")
    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError as error:
        unavailable = LookupUnavailable("ACL Anthology paper metadata was malformed")
        raise unavailable from error

    fits = _expected_fits(expected)
    matches = []
    mismatched_doi_titles = []
    for volume in root.findall("./volume"):
        for paper in volume.findall("./paper"):
            found_title = _xml_text(paper.find("title"))
            found_doi = doi_in(_xml_text(paper.find("doi")) or "")
            if doi:
                if not found_doi or found_doi.lower() != doi.lower():
                    continue
                if expected.get("title") and not titles_match(str(expected["title"]), found_title):
                    mismatched_doi_titles.append(found_title)
                    continue
            elif not titles_match(title, found_title):
                continue

            authors = paper.findall("./author")
            first_author = " ".join(filter(None, (
                _xml_text(authors[0].find("first")), _xml_text(authors[0].find("last")),
            ))) if authors else ""
            if not fits(year, first_author):
                continue
            if paper.find("pdf") is None:
                raise NoOpenAccessCopy("ACL Anthology metadata has no PDF for this paper")
            anthology_id = _acl_paper_id(root, volume, paper)
            ids = {"ACL": anthology_id}
            if found_doi:
                ids["DOI"] = found_doi
            matches.append(Resolution(
                f"https://aclanthology.org/{anthology_id}.pdf", found_title,
                "acl_anthology", ids, year, first_author,
            ))

    if mismatched_doi_titles:
        raise IdentityMismatch("the ACL Anthology DOI matches a paper with a different title")
    unique = {item.ids.get("ACL"): item for item in matches}
    if len(unique) > 1:
        raise AmbiguousMatch(f"more than one ACL Anthology paper matches '{title}'")
    if not unique:
        raise Unresolvable(f"ACL Anthology has no paper matching '{title}'")
    return list(unique.values())


def _fallback_resolutions(
    identifier: str, expected: dict | None, found: Resolution,
) -> tuple[list[Resolution], list[dict], list[Exception]]:
    """Ask other legal-copy indexes after the first provider's PDF could not be read."""
    import requests

    resolutions: list[Resolution] = []
    attempts: list[dict] = []
    failures: list[Exception] = []
    doi = (
        doi_in(identifier)
        or doi_in(str((expected or {}).get("doi") or ""))
        or doi_in(str(found.ids.get("DOI") or found.ids.get("doi") or ""))
    )

    def ask(provider: str, resolver: Callable[[], list[Resolution]]) -> None:
        try:
            answers = resolver()
            for answer in answers:
                if expected:
                    _validate_resolution(answer, expected)
            if not answers:
                raise Unresolvable(f"{provider} found no downloadable copy")
        except (requests.RequestException, OSError) as cause:
            error = LookupUnavailable(f"{provider} did not respond")
            error.__cause__ = cause
            attempts.append(_attempt(provider, _outcome_code(error), error))
            failures.append(error)
        except Exception as error:
            # Provider adapters can raise their own lookup-unavailable error (for example
            # OpenAlex's wrapper) as well as the shared resolution errors above.
            from app.pipeline import indexes

            if not isinstance(error, (ValueError, indexes._IndexError)):
                raise
            if isinstance(error, indexes._IndexError):
                wrapped = LookupUnavailable(f"{provider} did not respond")
                wrapped.__cause__ = error
                error = wrapped
            attempts.append(_attempt(provider, _outcome_code(error), error))
            failures.append(error)
        else:
            for answer in answers:
                attempts.append(_attempt(provider, "matched", locator=answer.url))
            resolutions.extend(answers)

    prior_providers = {
        str(attempt.get("provider", "")) for attempt in found.attempts
    }
    if doi and UNPAYWALL_EMAIL and "unpaywall" not in prior_providers:
        ask("unpaywall", lambda: _unpaywall_resolutions(doi))

    if doi and (acl := _acl_anthology_candidate(doi, expected)):
        attempts.append(_attempt("acl_anthology", "matched", locator=acl.url))
        resolutions.append(acl)

    venue = str((expected or {}).get("venue") or "")
    year = _as_year((expected or {}).get("year"))
    title = str((expected or {}).get("title") or identifier).strip()
    if venue and year is not None and title:
        ask("acl_anthology", lambda: _acl_anthology_candidates(identifier, expected))

    title_query = str((expected or {}).get("title") or identifier).strip()
    if doi or (title_query and not title_query.startswith("http") and not ARXIV_PATTERN.search(title_query)):
        ask("openalex", lambda: _openalex_candidates(identifier, expected))
    return resolutions, attempts, failures


def _first_answer(resolvers, argument: str, expected: dict | None = None) -> Resolution:
    """Ask each resolver in turn. An unavailable service is not an answer about the paper."""
    failures: list[Exception] = []
    attempts = []
    for provider, resolver in resolvers:
        try:
            found = resolver(argument)
            if expected:
                _validate_resolution(found, expected)
        except (ValueError, OSError) as error:
            attempts.append(_attempt(provider, _outcome_code(error), error))
            failures.append(error)
        else:
            attempts.append(_attempt(provider, "matched", locator=found.url))
            return found._replace(attempts=tuple([*found.attempts, *attempts]))
    raise _reported(failures, attempts)


def _by_title(title: str, expected: dict | None = None) -> Resolution:
    return _first_answer((
        ("arxiv", lambda query: _arxiv_by_title(query, _expected_fits(expected))),
        ("semantic_scholar", lambda query: _semantic_scholar_by_title(query, _expected_fits(expected))),
        ("openalex", lambda query: _openalex_by_title(query, _expected_fits(expected))),
    ), title, expected)


def find_by_title(title: str, fits: Fits) -> Resolution:
    """A work by its title, the first one whose year and first author `fits` accepts.

    Cached under the title like _resolve. A cached work is used only when it carries a year or
    an author that `fits` accepts; rows saved before they had either are looked up again.

    Raises:
        OnlyOtherWorks: an index knows the title, but only works that do not fit (#436).
        ValueError: what a title lookup raises otherwise, for example Unresolvable.
    """
    from app import store

    key = _normalised(title)
    cached = store.recall_source(key)
    if cached and time.time() - cached.get("fetched_at", time.time()) < SOURCE_MAX_AGE:
        work = _from_row(cached)
        # A row with neither would pass any `fits`, and older rows hold the wrong
        # "deep learning" this ticket is about.
        if (work.year or work.first_author) and fits(work.year, work.first_author):
            return work

    failures: list[Exception] = []
    attempts = []
    for provider, resolver in (
        ("arxiv", _arxiv_by_title),
        ("semantic_scholar", _semantic_scholar_by_title),
        ("openalex", _openalex_by_title),
    ):
        try:
            found = resolver(title, fits)
            break
        except (ValueError, OSError) as error:  # what _first_answer catches too
            failures.append(error)
            attempts.append(_attempt(provider, _outcome_code(error), error))
    else:
        raise _reported(failures, attempts)

    found = found._replace(attempts=tuple([
        *found.attempts, *attempts, _attempt(provider, "matched", locator=found.url),
    ]))

    for known in _cache_keys(title, found):
        store.remember_source(known, {**found._asdict(), "fetched_at": time.time()})
    return found


def _reported(
    failures: list[Exception], attempts: list[dict] | None = None, *, prefer_first: bool = False,
) -> Exception:
    """Choose the most informative failure without hiding an outage behind a no-match."""
    if not failures:
        return LookupUnavailable("no resolver was asked")
    retryable = next((error for error in failures if is_retryable(error)), None)
    mismatch = next((error for error in failures if isinstance(error, IdentityMismatch)), None)
    ambiguous = next((error for error in failures if isinstance(error, AmbiguousMatch)), None)
    no_copy = next((error for error in failures if isinstance(error, NoOpenAccessCopy)), None)
    if retryable:
        chosen = retryable
    elif mismatch or ambiguous or no_copy:
        chosen = mismatch or ambiguous or no_copy
    else:
        skipped = next((error for error in failures if isinstance(error, OnlyOtherWorks)), None)
        chosen = (
            skipped if skipped and any(type(error) is Unresolvable for error in failures)
            else failures[0] if prefer_first else failures[-1]
        )
    chosen.source_attempts = list(attempts or [])
    if not hasattr(chosen, "source_kind") and isinstance(
        chosen, (OnlyOtherWorks, AmbiguousMatch, IdentityMismatch, NoOpenAccessCopy, Withdrawn)
    ):
        chosen.source_kind = "paper"
    return chosen


def _by_doi(doi: str, expected: dict | None = None) -> Resolution:
    return _first_answer((
        ("semantic_scholar", lambda found: _semantic_scholar_pdf(f"DOI:{quote(found)}")),
        ("unpaywall", _unpaywall_pdf),
    ), doi, expected)


def _lookup(identifier: str, expected: dict | None = None) -> Resolution:
    arxiv = ARXIV_PATTERN.search(identifier)
    doi = doi_in(identifier)

    if arxiv and ("arxiv" in identifier.lower() or arxiv.group(0) == identifier):
        found = Resolution(
            f"https://arxiv.org/pdf/{arxiv.group(1)}", "", "arxiv", {"ArXiv": arxiv.group(1)}
        )
        if expected:
            _validate_resolution(found, expected)
        return found._replace(attempts=(_attempt("arxiv", "matched", locator=found.url),))
    if doi:
        return _by_doi(doi, expected)
    if identifier.isdigit():
        found = _semantic_scholar_pdf(f"PMID:{identifier}")
        if expected:
            _validate_resolution(found, expected)
        return found._replace(attempts=(_attempt("semantic_scholar", "matched", locator=found.url),))
    if identifier.startswith("http"):
        found = Resolution(identifier)
        if expected:
            _validate_resolution(found, expected)
        return found  # used as-is: nothing says where it is indexed
    return _by_title(identifier, expected)


def _resolve(identifier: str, expected: dict | None = None) -> Resolution:
    """_lookup, cached. One run checks several claims against the same work. The result
    is kept under both the query and the returned title, with the time it was found.

    A row older than SOURCE_MAX_AGE is looked up again. A row saved before rows carried a
    time is still used: expiring them all at once would send every cited work back to
    Semantic Scholar, which refuses many calls even with a key. _fetch drops a row whose
    link fails, so a bad old row goes the first time it is used.
    """
    from app import store

    identifier = identifier.strip()
    key = _normalised(identifier)
    cached = store.recall_source(key)
    if cached and time.time() - cached.get("fetched_at", time.time()) < SOURCE_MAX_AGE:
        found = _from_row(cached)
        try:
            if expected:
                _validate_resolution(found, expected)
                arxiv = ARXIV_PATTERN.search(identifier)
                title_lookup = (
                    not doi_in(identifier) and not arxiv
                    and not identifier.startswith("http") and not identifier.isdigit()
                )
                if title_lookup:
                    if not _expected_fits(expected)(found.year, found.first_author):
                        raise IdentityMismatch(
                            "the cached work conflicts with the cited year or first author"
                        )
        except IdentityMismatch:
            store.forget_source(key)
        else:
            return found

    found = _lookup(identifier, expected)
    if expected:
        _validate_resolution(found, expected)
    for known in _cache_keys(identifier, found):
        store.remember_source(known, {**found._asdict(), "fetched_at": time.time()})
    return found


def _cache_keys(identifier: str, found: Resolution) -> set[str]:
    """The keys _resolve keeps a work under: the query, and the title the lookup returned."""
    return {_normalised(identifier.strip()), _normalised(found.title)} - {""}


def _download(pdf_url: str, name: str) -> Path:
    import requests

    PAPERS_DIR.mkdir(parents=True, exist_ok=True)
    path = PAPERS_DIR / f"{name}.pdf"
    if path.is_file():
        try:
            with path.open("rb") as cached:
                if cached.read(5).startswith(b"%PDF"):
                    return path
        except OSError:
            pass

    response = requests.get(pdf_url, headers=USER_AGENT, timeout=120, allow_redirects=True)
    response.raise_for_status()
    if not response.content.startswith(b"%PDF"):
        content_type = response.headers.get("Content-Type", "").lower()
        prefix = response.content[:1024].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
        is_html = (
            "html" in content_type
            or prefix.startswith((b"<!doctype html", b"<html"))
            or b"<html" in prefix[:512]
        )
        if is_html:
            raise WebSource(f"a web page, not a paper: {pdf_url}")
        raise NotDownloadable(f"not a PDF: {pdf_url}")
    # Written aside, then renamed, as save_upload does: another worker that finds this name
    # never reads half a file. The link goes next to the PDF first, so a PDF on disk always
    # says where it came from (#424).
    _write_whole(_link_file(path), _safe_locator(pdf_url).encode())
    _write_whole(path, response.content)
    return path


def _write_whole(path: Path, content: bytes) -> None:
    partial = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
    partial.write_bytes(content)
    os.replace(partial, path)


def _link_file(pdf: Path) -> Path:
    """Where _download keeps the link a PDF was downloaded from."""
    return pdf.with_name(f"{pdf.name}.url")


def _fetch(identifier: str, expected: dict | None = None) -> tuple[Path, Resolution]:
    """Download a paper, trying legal alternate copies when a provider URL fails.

    Semantic Scholar's open-access link is often the publisher's landing page (doi.org), and
    ACM, MIT Press and IEEE refuse a script there with a 403 or an HTML page. After the resolved
    URL and any known arXiv twin fail, try the other Unpaywall locations, ACL Anthology's
    DOI-derived canonical URL, and OpenAlex's open PDF locations. A working alternate is cached
    so later requests do not repeat a known-bad publisher URL.
    """
    import requests

    from app import store

    lookup_failures: list[Exception] = []
    lookup_attempts: list[dict] = []
    try:
        found = _resolve(identifier, expected)
    except requests.RequestException as cause:
        unavailable = LookupUnavailable("the source lookup service did not respond")
        unavailable.source_kind = "unknown"
        unavailable.source_attempts = [_attempt("source_lookup", _outcome_code(cause), cause)]
        unavailable.__cause__ = cause
        lookup_failures.append(unavailable)
        lookup_attempts.extend(unavailable.source_attempts)
        ids = {}
        if doi := doi_in(identifier) or doi_in(str((expected or {}).get("doi") or "")):
            ids["DOI"] = doi
        if arxiv := ARXIV_PATTERN.search(str((expected or {}).get("arxiv") or identifier)):
            ids["ArXiv"] = arxiv.group(1)
        found = Resolution(
            "",
            str((expected or {}).get("title") or ""),
            "",
            ids=ids,
            year=_as_year((expected or {}).get("year")),
            attempts=tuple(lookup_attempts),
        )
    except (ValueError, OSError) as error:
        if isinstance(error, (IdentityMismatch, AmbiguousMatch)):
            raise
        lookup_failures.append(error)
        lookup_attempts.extend(getattr(error, "source_attempts", []) or [])
        if not lookup_attempts:
            lookup_attempts.append(_attempt("source_lookup", _outcome_code(error), error))
        ids = {}
        if doi := doi_in(identifier) or doi_in(str((expected or {}).get("doi") or "")):
            ids["DOI"] = doi
        if arxiv := ARXIV_PATTERN.search(str((expected or {}).get("arxiv") or identifier)):
            ids["ArXiv"] = arxiv.group(1)
        found = Resolution(
            "",
            str((expected or {}).get("title") or ""),
            "",
            ids=ids,
            year=_as_year((expected or {}).get("year")),
            attempts=tuple(lookup_attempts),
        )
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", identifier.strip()).strip("-")[:80]
    candidates: list[tuple[str, str, Resolution]] = []
    seen_urls: set[str] = set()

    def add_candidate(url: str, provider: str, resolution: Resolution) -> None:
        if url and url not in seen_urls:
            seen_urls.add(url)
            candidates.append((url, provider, resolution))

    def add_resolution(resolution: Resolution) -> None:
        provider = resolution.index.replace("-", "_") or "direct_url"
        locator = OSTI_RECORD_PAGE.sub(r"https://www.osti.gov/servlets/purl/\1", resolution.url)
        add_candidate(locator, provider, resolution)
        if (arxiv := resolution.ids.get("ArXiv")) and "arxiv.org" not in resolution.url:
            add_candidate(f"https://arxiv.org/pdf/{arxiv}", "arxiv", resolution)

    add_resolution(found)
    failures: list[Exception] = list(lookup_failures)
    attempts = list(found.attempts or lookup_attempts)

    def try_candidates() -> tuple[Path, Resolution] | None:
        while candidates:
            url, provider, resolution = candidates.pop(0)
            host = urlparse(url).hostname or ""
            try:
                path = _download(url, name)
            except (requests.RequestException, WebSource, NotDownloadable) as caught:
                error = caught
                if isinstance(caught, requests.RequestException):
                    error = NotDownloadable(_safe_message(caught))
                    error.response = getattr(caught, "response", None)
                    error.source_kind = "paper" if resolution.index else "unknown"
                    error.__cause__ = caught
                elif isinstance(caught, NotDownloadable):
                    caught.source_kind = "paper" if resolution.index else "unknown"
                elif isinstance(caught, WebSource) and resolution.index:
                    # A metadata provider's HTML response is usually a landing page, not
                    # evidence that the cited work itself is a web page.
                    error = NotDownloadable("the paper location returned an HTML landing page")
                    error.source_kind = "paper"
                    error.__cause__ = caught
                attempts.append(_attempt(provider, _outcome_code(error), error, host, url))
                failures.append(error)
            else:
                attempts.append(_attempt(provider, "readable_pdf", host=host, locator=url))
                used = resolution._replace(url=url, attempts=tuple(attempts))
                return path, used
        return None

    downloaded = try_candidates()
    if downloaded:
        return downloaded

    alternate_resolutions, provider_attempts, provider_failures = _fallback_resolutions(
        identifier, expected, found,
    )
    attempts.extend(provider_attempts)
    failures.extend(provider_failures)
    for resolution in alternate_resolutions:
        add_resolution(resolution)
    downloaded = try_candidates()
    if downloaded:
        path, used = downloaded
        for key in _cache_keys(identifier, used):
            store.remember_source(key, {**used._asdict(), "fetched_at": time.time()})
        return path, used

    for key in _cache_keys(identifier, found):
        store.forget_source(key)
    # A withdrawn paper's PDF link answers 404. The author needs to know it was withdrawn.
    if (arxiv := found.ids.get("ArXiv")) and (withdrawn_by := _withdrawn_by(arxiv)):
        withdrawn = Withdrawn(
            f"arXiv {arxiv} was withdrawn by {withdrawn_by}; cite a published version or another source"
        )
        withdrawn.source_attempts = attempts
        raise withdrawn from (failures[-1] if failures else None)
    raise _reported(failures, attempts, prefer_first=True)


def _withdrawn_by(arxiv_id: str) -> str:
    """Who withdrew this arXiv paper, from its abstract page, or "" when it was not withdrawn
    or the page could not be read. Asked only after every download link failed."""
    import requests

    try:
        page = requests.get(f"https://arxiv.org/abs/{arxiv_id}", headers=USER_AGENT, timeout=30)
    except requests.RequestException:
        return ""
    found = ARXIV_WITHDRAWN.search(page.text) if page.ok else None
    return found.group(1).strip() if found else ""


def lookup_key(citation: dict) -> str:
    """What to look a cited work up by, or "" when the reference has nothing usable.
    URL is last. It is usually a blog post or a spec, but we still report it."""
    return citation.get("doi") or citation.get("arxiv") or citation.get("title") or citation.get("url") or ""


def index_paper(title: str, doi: str = "") -> dict:
    """Best-effort: whether the paper itself (not what it cites) is known to a public index,
    using the same resolvers and cache as a citation lookup. Always returns a dict and never
    raises — a paper the resolvers cannot place (a preprint that never sold, a first upload)
    is common and must not fail or slow down the analysis that calls this."""
    identifier = doi or title
    if not identifier:
        return {"index": "", "ids": {}}
    try:
        _resolve(identifier)
    except Exception:
        return {"index": "", "ids": {}}
    return known_index(identifier)


def known_index(identifier: str) -> dict:
    """Where the resolution found this work, read back from the cache. Costs no request.
    The caller has resolved the work to a PDF first. An empty index means the work was
    never looked up, for example a local path or a bare URL."""
    from app import store

    cached = store.recall_source(_normalised(identifier.strip())) or {}
    return {"index": cached.get("index", ""), "ids": cached.get("ids") or {}}


def known_title(identifier: str) -> str:
    """The title the lookup found for this work, read back from the cache. Costs no request.
    Empty for a work used as given (an arXiv ID, a URL, a file) or never looked up."""
    from app import store

    return (store.recall_source(_normalised(identifier.strip())) or {}).get("title", "")


def version_of(pdf: Path) -> dict:
    """Whether this PDF file was downloaded from arXiv, read from the link saved beside it.

    Decided by the file, not by the shared cache: another draft's lookup can change the cached
    link without changing the file on this disk. Empty for an upload, or for a PDF downloaded
    before links were saved.
    """
    try:
        url = _link_file(pdf).read_text(encoding="utf-8")
    except OSError:
        return {}
    return preprint_of(url)


def preprint_of(url: str) -> dict:
    """{"source_version": "preprint", "arxiv": id} for a link to an arXiv PDF, else {}.
    A preprint's wording or numbers can differ from the published paper."""
    host = urlparse(url).hostname or ""
    if (host == "arxiv.org" or host.endswith(".arxiv.org")) and (found := ARXIV_PATTERN.search(url)):
        return {"source_version": "preprint", "arxiv": found.group(0)}
    return {}


def local_pdf(paper: str) -> str:
    """Any paper reference -> a local PDF path. Downloads it first if needed."""
    path, _ = local_pdf_with_resolution(paper)
    return path


def local_pdf_with_resolution(paper: str, expected: dict | None = None) -> tuple[str, dict]:
    """Return the local PDF path and safe provenance for how the source was obtained."""
    if Path(paper).is_file():
        return paper, {
            "source_kind": "paper", "outcome": "readable", "retryable": False,
            "attempts": [{"provider": "local", "result": "readable_pdf"}],
        }
    path, found = _fetch(paper, expected)
    return path.as_posix(), {
        "source_kind": "paper", "outcome": "readable", "retryable": False,
        "attempts": list(found.attempts) or [
            {"provider": found.index or "direct_url", "result": "readable_pdf"}
        ],
    }


def fetch_source(identifier: str) -> dict:
    """Download the open-access PDF of a cited work.

    Args:
        identifier: a DOI (for example "10.18653/v1/2022.naacl-main.272"), an arXiv ID
            (for example "2112.01488"), a PMID, or a direct URL to a paper.

    Returns:
        {"status": "ok", "path", "url", "title", "index", "ids"}, or {"status": "error",
        "message", "reason", "retryable"}. Retry only when `retryable` is true.
    """
    try:
        path, found = _fetch(identifier)
        return {"status": "ok", "path": path.as_posix(), "url": found.url, "title": found.title,
                "index": found.index, "ids": found.ids,
                "source_outcome": {"source_kind": "paper", "outcome": "readable", "retryable": False,
                                   "attempts": list(found.attempts)}}
    except Exception as error:
        return tool_error(error)
