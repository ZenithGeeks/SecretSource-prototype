"""Resolve a cited work to an open-access PDF and download it.

Accepts a DOI, arXiv ID, PMID, direct URL, or a bare title. arXiv resolves directly; the
rest go to whoever answers: Semantic Scholar (one request at a time, see _s2_get), then
Unpaywall.
A DOI with no open-access copy falls back to its arXiv twin. Resolutions are cached in
SQLite so a re-run costs no API call. PDFs land in PAPERS_DIR so they can be indexed.
"""

import re
import threading
import time
from pathlib import Path
from typing import NamedTuple

from app.config import PAPERS_DIR, S2_API_KEY, UNPAYWALL_EMAIL

ARXIV_API = "http://export.arxiv.org/api/query"  # no key needed
ATOM = "{http://www.w3.org/2005/Atom}"
SEMANTIC_SCHOLAR_URL = "https://api.semanticscholar.org/graph/v1/paper"
UNPAYWALL_URL = "https://api.unpaywall.org/v2"
S2_FIELDS = "title,year,externalIds,openAccessPdf"
TITLE_MATCH = 0.9  # a wrong paper is worse than no paper
RETRY_WAITS = (2, 6, 15)  # a 429 is the service asking us to wait, so wait, three times over
# One Semantic Scholar request a second, and never two at once. Measured against the graph
# API: a keyed call answers in ~5s, and firing three together returns two 429s and one
# answer. Since the analysis graph checks several cited sources in parallel, every lookup
# goes through _s2_get, which queues them.
S2_MIN_INTERVAL = 1.2
USER_AGENT = {"User-Agent": "SecretSource/0.1 (academic claim verification; senior project)"}


class Unresolvable(ValueError):
    """Nothing here we know how to follow — usually a bare title."""


class NoOpenAccessCopy(ValueError):
    """The work is known, but no free PDF is published for it."""


class NotDownloadable(ValueError):
    """A PDF was promised and could not be fetched, or was not a PDF."""


class LookupUnavailable(ValueError):
    """The lookup service would not answer — usually rate limiting, not a missing paper."""


class WebSource(ValueError):
    """A blog post, a spec, a vendor page: a real citation, but not a paper to check against."""


REASONS = {
    Unresolvable: "unresolvable",
    NoOpenAccessCopy: "no-open-access",
    NotDownloadable: "not-downloadable",
    LookupUnavailable: "lookup-unavailable",
    WebSource: "web-source",
}


class Resolution(NamedTuple):
    """Where a cited work was found. `index` is which service answered and `ids` are the
    identifiers it returned, so a reader can tell a work a major index knows from one
    nobody could place. Semantic Scholar answers with DOI, ArXiv, PubMed, MAG, DBLP and
    CorpusId and never a Scopus id, so nothing here claims Scopus was consulted."""

    url: str
    title: str = ""
    index: str = ""  # "" when the identifier was taken at face value, e.g. a bare URL
    ids: dict = {}  # never mutated; a shared empty default is the point


def reason_for(error: BaseException) -> str:
    """Which kind of failure this was, so the UI can tell "no source" from "we broke"."""
    return next((code for kind, code in REASONS.items() if isinstance(error, kind)), "failed")


ARXIV_PATTERN = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?")
ARXIV_VERSION = re.compile(r"v\d+$")
DOI_PATTERN = re.compile(r"(10\.\d{4,9}/\S+)")


def _headers() -> dict:
    return {**USER_AGENT, **({"x-api-key": S2_API_KEY} if S2_API_KEY else {})}


_s2_gate = threading.Lock()  # one Semantic Scholar request in flight, process-wide
_s2_free_at = 0.0  # the monotonic time the next one may go out


def _s2_get(path: str, params: dict):
    """One Semantic Scholar request, on its own. A key buys about one request a second, not
    parallelism: the service 429s calls that overlap. The analysis graph checks several
    cited sources at once, so their lookups queue here instead of each collecting a 429.
    Only the lookup is serialised; indexing a cited PDF, the slow part, still overlaps."""
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
    """Why the lookup gave up, without sending a reader to change a setting already set."""
    if S2_API_KEY:
        return LookupUnavailable(
            "Semantic Scholar kept rate limiting us even with S2_API_KEY set; a key allows "
            "about one request a second and this run has more sources than that to look up"
        )
    return LookupUnavailable("Semantic Scholar is rate limiting us; set S2_API_KEY for a higher limit")


def _retry_after(response, fallback: float) -> float:
    """What the service asked us to wait, when it says so; our own backoff otherwise."""
    try:
        return max(float(response.headers.get("Retry-After", "")), fallback)
    except ValueError:
        return fallback


def _semantic_scholar(path: str, params: dict) -> dict:
    """One Semantic Scholar call; a 429 is retried, not treated as an answer about the paper."""
    for wait in (*RETRY_WAITS, None):
        response = _s2_get(path, params)
        if response.status_code != 429:
            break
        if wait is None:
            raise _rate_limited()
        time.sleep(_retry_after(response, wait))
    response.raise_for_status()
    return response.json()


def _pdf_of(paper: dict, described_as: str) -> Resolution:
    """Semantic Scholar record -> (pdf_url, title). Falls back to the arXiv twin:
    a paywalled DOI often has one, and not looking loses most cited papers."""
    title = paper.get("title", "")
    ids = paper.get("externalIds") or {}
    pdf = (paper.get("openAccessPdf") or {}).get("url")
    if pdf:
        return Resolution(pdf, title, "semantic-scholar", ids)
    arxiv = ids.get("ArXiv")
    if arxiv:
        return Resolution(f"https://arxiv.org/pdf/{arxiv}", title, "semantic-scholar", ids)
    raise NoOpenAccessCopy(f"no open-access PDF known for {described_as}")


def _semantic_scholar_pdf(paper_id: str) -> Resolution:
    return _pdf_of(_semantic_scholar(f"/{paper_id}", {"fields": S2_FIELDS}), paper_id)


def _normalised(title: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", title.lower()).strip()


def _matches(wanted: str, found: str) -> bool:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, _normalised(wanted), _normalised(found)).ratio() >= TITLE_MATCH


def _arxiv_by_title(title: str) -> Resolution:
    import xml.etree.ElementTree as ET

    import requests

    response = requests.get(
        ARXIV_API,
        params={"search_query": f'ti:"{title}"', "max_results": 5},
        headers=USER_AGENT,
        timeout=60,
    )
    response.raise_for_status()
    for entry in ET.fromstring(response.text).iter(f"{ATOM}entry"):
        found = " ".join((entry.findtext(f"{ATOM}title") or "").split())
        if _matches(title, found):
            arxiv_id = ARXIV_VERSION.sub("", (entry.findtext(f"{ATOM}id") or "").rsplit("/", 1)[-1])
            return Resolution(
                f"https://arxiv.org/pdf/{arxiv_id}", found, "arxiv", {"ArXiv": arxiv_id}
            )
    raise Unresolvable(f"arXiv knows no paper by that title: {title}")


def _semantic_scholar_by_title(title: str) -> Resolution:
    found = _semantic_scholar("/search", {"query": title, "fields": S2_FIELDS, "limit": 5})
    for paper in found.get("data") or []:
        if _matches(title, paper.get("title", "")):
            return _pdf_of(paper, f"'{title}'")
    raise Unresolvable(f"no paper found matching the title: {title}")


def _unpaywall_pdf(doi: str) -> Resolution:
    import requests

    if not UNPAYWALL_EMAIL:
        raise LookupUnavailable("set S2_API_KEY, or UNPAYWALL_EMAIL to ask Unpaywall instead")
    response = requests.get(
        f"{UNPAYWALL_URL}/{doi}", params={"email": UNPAYWALL_EMAIL}, headers=USER_AGENT, timeout=60
    )
    if response.status_code == 404:
        raise Unresolvable(f"Unpaywall knows no work with DOI {doi}")
    response.raise_for_status()
    work = response.json()
    location = work.get("best_oa_location") or {}
    pdf = location.get("url_for_pdf") or location.get("url")
    if not pdf:
        raise NoOpenAccessCopy(f"no open-access PDF known for DOI:{doi}")
    return Resolution(pdf, work.get("title") or "", "unpaywall", {"DOI": doi})


def _first_answer(resolvers, argument: str) -> Resolution:
    """Ask each resolver in turn; an unavailable service is not an answer about the paper."""
    failure: Exception = LookupUnavailable("no resolver was asked")
    for resolver in resolvers:
        try:
            return resolver(argument)
        except (ValueError, OSError) as error:
            failure = error
    raise failure


def _by_title(title: str) -> Resolution:
    return _first_answer((_arxiv_by_title, _semantic_scholar_by_title), title)


def _by_doi(doi: str) -> Resolution:
    return _first_answer((lambda found: _semantic_scholar_pdf(f"DOI:{found}"), _unpaywall_pdf), doi)


def _lookup(identifier: str) -> Resolution:
    arxiv = ARXIV_PATTERN.search(identifier)
    doi = DOI_PATTERN.search(identifier)

    if arxiv and ("arxiv" in identifier.lower() or arxiv.group(0) == identifier):
        return Resolution(
            f"https://arxiv.org/pdf/{arxiv.group(1)}", "", "arxiv", {"ArXiv": arxiv.group(1)}
        )
    if doi:
        return _by_doi(doi.group(1).rstrip(".,;)"))
    if identifier.isdigit():
        return _semantic_scholar_pdf(f"PMID:{identifier}")
    if identifier.startswith("http"):
        return Resolution(identifier)  # taken at face value: nothing says where it is indexed
    return _by_title(identifier)


def _resolve(identifier: str) -> Resolution:
    """_lookup, cached: one run verifies several claims against the same work, and the
    resolution is kept under both the query and the returned title."""
    from app import store

    identifier = identifier.strip()
    key = _normalised(identifier)
    cached = store.recall_source(key)
    if cached:  # rows written before the index was recorded simply have nothing to say
        return Resolution(
            cached["url"], cached["title"], cached.get("index", ""), cached.get("ids") or {}
        )

    found = _lookup(identifier)
    for known in {key, _normalised(found.title)} - {""}:
        store.remember_source(known, found._asdict())
    return found


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
    path.write_bytes(response.content)
    return path


def _fetch(identifier: str) -> tuple[Path, Resolution]:
    import requests

    try:
        found = _resolve(identifier)
        name = re.sub(r"[^A-Za-z0-9._-]+", "-", identifier.strip()).strip("-")[:80]
        return _download(found.url, name), found
    except requests.RequestException as error:
        raise NotDownloadable(str(error)) from error


def lookup_key(citation: dict) -> str:
    """What to look a cited work up by, or "" when the reference carries nothing usable.
    URL last: usually a blog post or a spec, but still reportable."""
    return citation.get("doi") or citation.get("arxiv") or citation.get("title") or citation.get("url") or ""


def known_index(identifier: str) -> dict:
    """Where the resolution found this work, read back from the cache it already wrote.
    Costs no request: whoever asks has resolved the work to a PDF first. A work resolved
    from a local path or a bare URL was never looked up, and says so with an empty index
    rather than claiming it is indexed nowhere."""
    from app import store

    cached = store.recall_source(_normalised(identifier.strip())) or {}
    return {"index": cached.get("index", ""), "ids": cached.get("ids") or {}}


def local_pdf(paper: str) -> str:
    """Any reference to a paper -> a local PDF path. Downloads it first if needed."""
    if Path(paper).is_file():
        return paper
    path, _ = _fetch(paper)
    return path.as_posix()


def fetch_source(identifier: str) -> dict:
    """Download the open-access PDF of a cited work so it can be analyzed or indexed.

    Args:
        identifier: a DOI (e.g. "10.18653/v1/2022.naacl-main.272"), an arXiv ID
            (e.g. "2112.01488"), a PMID, or a direct URL to a paper.
    """
    try:
        path, found = _fetch(identifier)
        return {"status": "ok", "path": path.as_posix(), "url": found.url, "title": found.title,
                "index": found.index, "ids": found.ids}
    except Exception as error:
        return {"status": "error", "message": str(error), "reason": reason_for(error)}
