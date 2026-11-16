"""Whether a cited work is real, by asking Crossref and then OpenAlex for its DOI (#421) or,
when the entry has none, for its title (#439).

A reference we cannot read can be paywalled, briefly unreachable, or made up. Only an index
can tell these apart. Both indexes are free. A contact address puts Crossref calls in its
faster "polite" queue; OpenAlex needs OPENALEX_API_KEY for a budget of its own.
"""

import re
from collections.abc import Callable
from dataclasses import asdict, dataclass
from urllib.parse import quote

from app import store
from app.config import OPENALEX_API_KEY, UNPAYWALL_EMAIL
from app.names import surname
from app.pipeline.sources import USER_AGENT, Fits, titles_match

CROSSREF_URL = "https://api.crossref.org/works"
OPENALEX_URL = "https://api.openalex.org/works"
OPENALEX_SOURCE_FIELDS = "doi,title,publication_year,authorships,locations"
# Short: the lookups run one after another at the end of a draft check, and a slow index
# only makes the answer "unknown".
TIMEOUT = 5
# How many search hits to compare with a cited title. Crossref often lists one paper several
# times (preprint, proceedings, a 2025 re-deposit), so the cited one can be fifth.
SEARCH_HITS = 5


@dataclass(frozen=True)
class IndexRecord:
    """What an index says about a work: its title, year and first author's surname."""

    title: str
    year: int | None
    first_author: str
    index: str  # "crossref" or "openalex"


class IndexUnavailable(Exception):
    """No index could give a sure answer: one failed and the other did not know the DOI."""


def find_doi(doi: str) -> IndexRecord | None:
    """The work a DOI names, or None when neither Crossref nor OpenAlex knows it.

    Crossref is asked first, and OpenAlex only when Crossref has no record, so a real DOI
    usually costs one call. A found record is cached: a DOI's metadata does not change.

    Raises:
        IndexUnavailable: an index failed (network, 5xx) and the other did not find the DOI,
            so "not found" would not be a fair answer.
    """
    key = store.cache_key("doi-index", doi.lower())
    if cached := store.recall_cache(key):
        return IndexRecord(**cached)
    failures: list[str] = []
    for lookup in (_crossref, _openalex):
        try:
            record = lookup(doi)
        except _IndexError as error:
            failures.append(str(error))
            continue
        if record:
            store.remember_cache(key, asdict(record))
            return record
    if failures:
        raise IndexUnavailable("; ".join(failures))
    return None


# One index's search: a title and an author in, its best hits out.
Search = Callable[[str, str], list[IndexRecord]]


def find_title(title: str, author: str, fits: Fits) -> IndexRecord | None:
    """The work with this title whose first author `fits` accepts, or None when neither
    Crossref nor OpenAlex has one. Same order and failure rule as find_doi.

    Both indexes are searched by the title and the first author's surname. By title alone, the
    papers that quote a famous title ("Attention Is All You Need In Speech Separation") fill
    the top hits and push the cited one out.

    Raises:
        IndexUnavailable: an index failed and the other had no matching work.
    """
    failures: list[str] = []
    for search in (_crossref_search, _openalex_search):
        try:
            records = _matching_hits(search, title, author)
        except _IndexError as error:
            failures.append(str(error))
            continue
        if found := next((r for r in records if fits(r.year, r.first_author)), None):
            return found
    if failures:
        raise IndexUnavailable("; ".join(failures))
    return None


def _matching_hits(search: Search, title: str, author: str) -> list[IndexRecord]:
    """search(title, author), keeping only hits with the same title. A non-empty answer is
    cached; an empty one is not, since the index may add the work later."""
    key = store.cache_key("title-index", search.__name__, title.lower(), author.lower())
    if cached := store.recall_cache(key):
        return [IndexRecord(**record) for record in cached["records"]]
    records = [record for record in search(title, author) if titles_match(title, record.title)]
    if records:
        store.remember_cache(key, {"records": [asdict(record) for record in records]})
    return records


class _IndexError(Exception):
    """One index did not answer."""


def _get(url: str, params: dict | None = None) -> dict | None:
    """GET a JSON answer. None for a 404, which is the index's answer that it has no such DOI;
    a search never gives one."""
    import requests

    params = {**(params or {}), **({"mailto": UNPAYWALL_EMAIL} if UNPAYWALL_EMAIL else {})}
    headers = dict(USER_AGENT)
    if OPENALEX_API_KEY and url.startswith(OPENALEX_URL):
        headers["Authorization"] = f"Bearer {OPENALEX_API_KEY}"
    try:
        response = requests.get(url, params=params, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as error:
        raise _IndexError(f"{url}: {error}") from error
    if response.status_code == 404:
        return None
    if not response.ok:
        raise _IndexError(f"{url}: HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as error:
        raise _IndexError(f"{url}: not JSON") from error


def _crossref(doi: str) -> IndexRecord | None:
    work = _get(f"{CROSSREF_URL}/{quote(doi, safe='/')}")
    if work is None:
        return None
    return _crossref_record(work.get("message") or {})


def _crossref_search(title: str, author: str) -> list[IndexRecord]:
    """Crossref's best few works for a title and an author, by its own relevance."""
    params = {"query.bibliographic": title, "query.author": author, "rows": SEARCH_HITS}
    found = _get(CROSSREF_URL, params) or {}
    return [_crossref_record(work) for work in (found.get("message") or {}).get("items") or []]


def _crossref_record(work: dict) -> IndexRecord:
    year = (work.get("issued", {}).get("date-parts") or [[None]])[0][0]
    authors = work.get("author") or [{}]
    return IndexRecord(
        title=(work.get("title") or [""])[0],
        year=year,
        first_author=authors[0].get("family", ""),
        index="crossref",
    )


def openalex_works(params: dict) -> list[dict]:
    """OpenAlex works for a filter, with this gateway's key and contact address.

    Raises:
        _IndexError: OpenAlex did not answer, or not with JSON.
    """
    return (_get(OPENALEX_URL, params) or {}).get("results") or []


def openalex_work_by_doi(doi: str) -> dict | None:
    """OpenAlex's full record for a DOI, including its legal-access locations.

    Source retrieval uses this only after its primary PDF URL failed, so the extra metadata
    request does not slow down papers that were already readable.
    """
    return _get(
        f"{OPENALEX_URL}/doi:{quote(doi, safe='/')}",
        {"select": OPENALEX_SOURCE_FIELDS},
    )


def openalex_search_works(title: str) -> list[dict]:
    """A small set of OpenAlex title matches with source locations included."""
    found = _get(
        OPENALEX_URL,
        {"search": title, "per-page": SEARCH_HITS, "select": OPENALEX_SOURCE_FIELDS},
    ) or {}
    return found.get("results") or []


def _openalex(doi: str) -> IndexRecord | None:
    work = _get(f"{OPENALEX_URL}/doi:{quote(doi, safe='/')}")
    if work is None:
        return None
    return _openalex_record(work)


def _openalex_search(title: str, author: str) -> list[IndexRecord]:
    """OpenAlex's works whose title has the title's words and whose authors have the name."""
    # In a filter "," separates two filters, "|" means or, and "?" and "*" are wildcards that
    # OpenAlex refuses with a 400 on a stemmed field. None of them may stay in a value.
    title, author = (re.sub(r"[,|?*]", " ", value) for value in (title, author))
    params = {"filter": f"title.search:{title},raw_author_name.search:{author}", "per-page": SEARCH_HITS}
    found = _get(OPENALEX_URL, params) or {}
    return [_openalex_record(work) for work in found.get("results") or []]


def _openalex_record(work: dict) -> IndexRecord:
    authors = work.get("authorships") or [{}]
    name = (authors[0].get("author") or {}).get("display_name", "")
    return IndexRecord(
        title=work.get("title") or "",
        year=work.get("publication_year"),
        first_author=surname(name),
        index="openalex",
    )
