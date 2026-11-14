"""Find the open-access PDF of a cited work and download it.

Takes a DOI, arXiv ID, PMID, direct URL, or a bare title. arXiv IDs resolve directly.
The rest go to Semantic Scholar, then Unpaywall. Results are cached in SQLite, so a
re-run makes no API call. PDFs are saved in PAPERS_DIR so they can be indexed.
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


class NoOpenAccessCopy(ValueError):
    """The work is known, but no free PDF is published for it. `index` is the lookup that knows
    it ("semantic-scholar", "openalex"), or "" when no one lookup does."""

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
    )


def reason_for(error: BaseException) -> str:
    """The kind of failure, so the UI can tell a missing source from our own error."""
    return next((code for kind, code in REASONS.items() if isinstance(error, kind)), "failed")


def is_retryable(error: BaseException) -> bool:
    """Whether asking again later can help: a lookup service that would not answer, or a
    network timeout or dropped connection, also when it is the cause of `error`."""
    import requests

    network = (requests.Timeout, requests.ConnectionError, TimeoutError, ConnectionError)
    timed_out = any(isinstance(each, network) for each in (error, error.__cause__))
    return reason_for(error) in RETRYABLE or timed_out


def tool_error(error: BaseException) -> dict:
    """The error a tool returns: what failed, the reason code, and whether to retry."""
    return {"status": "error", "message": str(error), "reason": reason_for(error),
            "retryable": is_retryable(error)}


# New ids (2303.12712) and the ones from before 2007 (hep-th/9901001, math.GT/0309136).
ARXIV_PATTERN = re.compile(r"(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?")
ARXIV_VERSION = re.compile(r"v\d+$")
# A DOI on its own or inside a link (https://dl.acm.org/doi/10.1145/3784828.3785017). It ends
# at a space, a quote, a backslash (it would escape a Scopus query's closing quote), or a link's
# query or fragment. "<" and ">" can be part of it, as in old Wiley DOIs.
DOI = re.compile(r"\b10\.\d{4,9}/[^\s\"'?#\\]+")
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
        return Resolution(url, found, "arxiv", {"ArXiv": arxiv_id}, year, first_author)
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
    for paper in found.get("data") or []:
        if not titles_match(title, paper.get("title", "")):
            continue
        if not fits(paper.get("year"), _s2_first_author(paper)):
            others.append(_described(paper["title"], paper.get("year"), _s2_first_author(paper)))
            continue
        return _pdf_of(paper, f"'{title}'")
    if others:
        raise OnlyOtherWorks(f"Semantic Scholar has only other works titled '{title}': {'; '.join(others)}")
    raise Unresolvable(f"no paper found matching the title: {title}")


def _openalex_by_title(title: str, fits: Fits = _any_work) -> Resolution:
    """A work by its title in OpenAlex, with the first PDF link among its locations.

    Asked after Semantic Scholar: OpenAlex lists repository copies too, and keeps a short title
    that Semantic Scholar joins to its subtitle ("Frontier: Exploring Exascale", SC23).
    """
    from app.pipeline.indexes import _IndexError, openalex_works

    # "," and "|" separate values in a filter, and OpenAlex refuses "?" and "*" in a title search.
    words = re.sub(r"[,|?*]", " ", title)
    params = {
        "filter": f"title.search:{words}",
        "select": "doi,title,publication_year,authorships,locations",
        "per-page": 5,
    }
    try:
        works = openalex_works(params)
    except _IndexError as error:
        raise LookupUnavailable(f"OpenAlex did not answer: {error}") from error
    others = []
    paywalled = False
    for work in works:
        found = work.get("title") or ""
        if not titles_match(title, found):
            continue
        year = work.get("publication_year")
        first_author = ((work.get("authorships") or [{}])[0].get("author") or {}).get("display_name") or ""
        if not fits(year, first_author):
            others.append(_described(found, year, first_author))
            continue
        pdf = next((loc["pdf_url"] for loc in work.get("locations") or [] if loc.get("pdf_url")), "")
        if not pdf:
            # The publisher's record and the preprint can be two works with one title: keep looking.
            paywalled = True
            continue
        ids = {"DOI": work["doi"].removeprefix("https://doi.org/")} if work.get("doi") else {}
        return Resolution(pdf, found, "openalex", ids, year, first_author)
    if paywalled:
        raise NoOpenAccessCopy(f"no open-access PDF known for '{title}'", "openalex")
    if others:
        raise OnlyOtherWorks(f"OpenAlex has only other works titled '{title}': {'; '.join(others)}")
    raise Unresolvable(f"OpenAlex knows no paper by that title: {title}")


def _openalex_pdfs(doi: str) -> list[str]:
    """Every PDF link OpenAlex lists for a DOI, publisher and repository copies alike; [] when
    OpenAlex does not answer or the DOI cannot go in a filter."""
    from app.pipeline.indexes import _IndexError, openalex_works

    if re.search(r"[,|]", doi):  # value separators in an OpenAlex filter
        return []
    try:
        works = openalex_works({"filter": f"doi:{doi}", "select": "locations"})
    except _IndexError:
        return []
    return [loc["pdf_url"] for work in works for loc in work.get("locations") or [] if loc.get("pdf_url")]


def _described(title: str, year: int | None, first_author: str) -> str:
    """ "Deep Learning (2018, Nicholas G. Polson)", for a message about a work that was skipped."""
    return f"{title} ({', '.join(str(part) for part in (year, first_author) if part)})"


def _unpaywall_pdf(doi: str) -> Resolution:
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
    location = work.get("best_oa_location") or {}
    pdf = location.get("url_for_pdf") or location.get("url")
    if not pdf:
        raise NoOpenAccessCopy(f"no open-access PDF known for DOI:{doi}")
    # The best location is often the publisher's PDF, which refuses a script (#408). An arXiv
    # copy among the other locations goes into `ids`, so _fetch can fall back to it.
    ids = {"DOI": doi}
    for other in work.get("oa_locations") or []:
        if found := ARXIV_LOCATION.search(f"{other.get('url_for_pdf') or ''} {other.get('url') or ''}"):
            ids["ArXiv"] = found.group(1) or found.group(2)
            break
    return Resolution(pdf, work.get("title") or "", "unpaywall", ids)


def _first_answer(resolvers, argument: str) -> Resolution:
    """Ask each resolver in turn. An unavailable service is not an answer about the paper."""
    failures: list[Exception] = []
    for resolver in resolvers:
        try:
            return resolver(argument)
        except (ValueError, OSError) as error:
            failures.append(error)
    raise _reported(failures) if failures else LookupUnavailable("no resolver was asked")


# The indexes asked for a work by its title, in this order.
TITLE_RESOLVERS = (_arxiv_by_title, _semantic_scholar_by_title, _openalex_by_title)


def _by_title(title: str) -> Resolution:
    return _first_answer(TITLE_RESOLVERS, title)


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
    for resolver in TITLE_RESOLVERS:
        try:
            found = resolver(title, fits)
            break
        except (ValueError, OSError) as error:  # what _first_answer catches too
            failures.append(error)
    else:
        raise _reported(failures)

    for known in _cache_keys(title, found):
        store.remember_source(known, {**found._asdict(), "fetched_at": time.time()})
    return found


def _reported(failures: list[Exception]) -> Exception:
    """The failure to report when no index had the work, the one that says the most, the
    latest of equals. A paywall means an index knew the work. A rate limit or network error
    means we could not tell, which must not read as "does not exist". A work an index skipped
    (OnlyOtherWorks) is what the author needs to see over a plain "no paper found"."""
    return max(reversed(failures), key=_says_most)


def _says_most(error: Exception) -> int:
    if isinstance(error, NoOpenAccessCopy):
        return 3
    if isinstance(error, OnlyOtherWorks):
        return 1
    if isinstance(error, Unresolvable):
        return 0
    return 2  # LookupUnavailable, a rate limit, a network error


def _by_doi(doi: str) -> Resolution:
    return _first_answer((lambda found: _semantic_scholar_pdf(f"DOI:{quote(found)}"), _unpaywall_pdf), doi)


def _lookup(identifier: str) -> Resolution:
    arxiv = ARXIV_PATTERN.search(identifier)
    doi = doi_in(identifier)

    if arxiv and ("arxiv" in identifier.lower() or arxiv.group(0) == identifier):
        return Resolution(
            f"https://arxiv.org/pdf/{arxiv.group(1)}", "", "arxiv", {"ArXiv": arxiv.group(1)}
        )
    if doi:
        return _by_doi(doi)
    if identifier.isdigit():
        return _semantic_scholar_pdf(f"PMID:{identifier}")
    if identifier.startswith("http"):
        return Resolution(identifier)  # used as-is: nothing says where it is indexed
    return _by_title(identifier)


def _resolve(identifier: str) -> Resolution:
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
        return _from_row(cached)

    found = _lookup(identifier)
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
        return path

    response = requests.get(pdf_url, headers=USER_AGENT, timeout=120, allow_redirects=True)
    response.raise_for_status()
    if not response.content.startswith(b"%PDF"):
        if "html" in response.headers.get("Content-Type", "").lower():
            raise WebSource(f"a web page, not a paper: {pdf_url}")
        raise NotDownloadable(f"not a PDF: {pdf_url}")
    # Written aside, then renamed, as save_upload does: another worker that finds this name
    # never reads half a file. The link goes next to the PDF first, so a PDF on disk always
    # says where it came from (#424).
    _write_whole(_link_file(path), pdf_url.encode())
    _write_whole(path, response.content)
    return path


def _write_whole(path: Path, content: bytes) -> None:
    partial = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
    partial.write_bytes(content)
    os.replace(partial, path)


def _link_file(pdf: Path) -> Path:
    """Where _download keeps the link a PDF was downloaded from."""
    return pdf.with_name(f"{pdf.name}.url")


def _pdf_link(url: str) -> str:
    """The PDF behind a link: OSTI's record page becomes its purl, anything else stays."""
    return OSTI_RECORD_PAGE.sub(r"https://www.osti.gov/servlets/purl/\1", url)


def _fetch(identifier: str) -> tuple[Path, Resolution]:
    """Download the work's PDF from where the lookup found it, or else from its arXiv copy, or
    else from another PDF link OpenAlex lists for its DOI.

    Semantic Scholar's open-access link is often the publisher's landing page (doi.org), and
    ACM, MIT Press and IEEE refuse a script there with a 403 or an HTML page, even when the same
    paper is free on arXiv (#408). When both fail, the first link's error is the one reported,
    and the cached location is dropped, so the next attempt looks the work up again (#414).
    """
    import requests

    from app import store

    try:
        found = _resolve(identifier)
    except requests.RequestException as error:
        raise NotDownloadable(str(error)) from error
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", identifier.strip()).strip("-")[:80]
    urls = [_pdf_link(found.url)]
    if (arxiv := found.ids.get("ArXiv")) and "arxiv.org" not in found.url:
        urls.append(f"https://arxiv.org/pdf/{arxiv}")

    def links():
        yield from urls
        # A refused publisher link often has a repository copy OpenAlex knows, such as OSTI's
        # for ACM's SC papers. Asked only after the links above failed.
        if doi := found.ids.get("DOI"):
            yield from (url for url in map(_pdf_link, _openalex_pdfs(doi)) if url not in urls)

    failure: Exception | None = None
    for url in links():
        try:
            return _download(url, name), found._replace(url=url)
        except (requests.RequestException, WebSource, NotDownloadable) as error:
            failure = failure or error
    for key in _cache_keys(identifier, found):
        store.forget_source(key)
    # A withdrawn paper's PDF link answers 404. The author needs to know it was withdrawn.
    if (arxiv := found.ids.get("ArXiv")) and (withdrawn_by := _withdrawn_by(arxiv)):
        raise Withdrawn(
            f"arXiv {arxiv} was withdrawn by {withdrawn_by}; cite a published version or another source"
        ) from failure
    if isinstance(failure, requests.RequestException):
        # Kept as the cause, so a timeout still reads as retryable.
        raise NotDownloadable(str(failure)) from failure
    raise failure


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
    if Path(paper).is_file():
        return paper
    path, _ = _fetch(paper)
    return path.as_posix()


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
                "index": found.index, "ids": found.ids}
    except Exception as error:
        return tool_error(error)
