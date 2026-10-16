"""Whether a cited DOI names a real work, by asking Crossref and then OpenAlex (#421).

A reference we cannot read can be paywalled, briefly unreachable, or made up. Only an index
can tell these apart. Both indexes are free and need no key; a contact address puts the calls
in their faster "polite" queues.
"""

from dataclasses import asdict, dataclass

from app import store
from app.config import UNPAYWALL_EMAIL
from app.pipeline.sources import USER_AGENT

CROSSREF_URL = "https://api.crossref.org/works"
OPENALEX_URL = "https://api.openalex.org/works"


@dataclass(frozen=True)
class IndexRecord:
    """What an index says about a DOI: the work's title, year and first author's surname."""

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


class _IndexError(Exception):
    """One index did not answer."""


def _get(url: str) -> dict | None:
    """GET a JSON record. None for a 404, which is the index's answer that it has no such DOI."""
    import requests

    params = {"mailto": UNPAYWALL_EMAIL} if UNPAYWALL_EMAIL else {}
    try:
        response = requests.get(url, params=params, headers=USER_AGENT, timeout=30)
    except requests.RequestException as error:
        raise _IndexError(f"{url}: {error}") from error
    if response.status_code == 404:
        return None
    if not response.ok:
        raise _IndexError(f"{url}: HTTP {response.status_code}")
    return response.json()


def _crossref(doi: str) -> IndexRecord | None:
    work = _get(f"{CROSSREF_URL}/{doi}")
    if work is None:
        return None
    work = work.get("message") or {}
    year = (work.get("issued", {}).get("date-parts") or [[None]])[0][0]
    authors = work.get("author") or [{}]
    return IndexRecord(
        title=(work.get("title") or [""])[0],
        year=year,
        first_author=authors[0].get("family", ""),
        index="crossref",
    )


def _openalex(doi: str) -> IndexRecord | None:
    work = _get(f"{OPENALEX_URL}/doi:{doi}")
    if work is None:
        return None
    authors = work.get("authorships") or [{}]
    name = (authors[0].get("author") or {}).get("display_name", "")
    return IndexRecord(
        title=work.get("title") or "",
        year=work.get("publication_year"),
        first_author=name.split()[-1] if name else "",
        index="openalex",
    )
