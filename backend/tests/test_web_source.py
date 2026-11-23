from pathlib import Path

import pytest
from app.pipeline import sources, verify, web


class _ResponseAdapter:
    def __init__(self, response):
        self._response = response
        self.status = response.status_code
        self.headers = response.headers

    def stream(self, size, decode_content=True):
        return self._response.iter_content(size)

    def close(self):
        self._response.close()

    def release_conn(self):
        pass


class _Pool:
    def close(self):
        pass


def _mock_pinned_get(monkeypatch, get):
    monkeypatch.setattr(web, "_pinned_get", lambda url, _address: (_ResponseAdapter(get(url)), _Pool()))


def test_pinned_https_request_uses_validated_ip_and_original_host_for_tls(monkeypatch):
    seen = {}

    class Pool:
        def __init__(self, host, **kwargs):
            seen.update(host=host, **kwargs)

        def urlopen(self, method, target, **kwargs):
            seen.update(method=method, target=target, request=kwargs)
            return object()

        def close(self):
            pass

    monkeypatch.setattr(web, "HTTPSConnectionPool", Pool)
    response, _pool = web._pinned_get("https://example.org:8443/a?q=1#part", "93.184.216.34")

    assert response is not None
    assert seen["host"] == "93.184.216.34"
    assert seen["port"] == 8443
    assert seen["server_hostname"] == seen["assert_hostname"] == "example.org"
    assert seen["target"] == "/a?q=1"
    assert seen["request"]["headers"]["Host"] == "example.org:8443"
    assert seen["request"]["redirect"] is False


def test_pinned_http_request_uses_the_validated_ip(monkeypatch):
    seen = {}

    class Pool:
        def __init__(self, host, **kwargs):
            seen.update(host=host, **kwargs)

        def urlopen(self, method, target, **kwargs):
            seen.update(method=method, target=target, request=kwargs)
            return object()

        def close(self):
            pass

    monkeypatch.setattr(web, "HTTPConnectionPool", Pool)
    response, _pool = web._pinned_get("http://example.org/path", "93.184.216.34")

    assert response is not None
    assert seen["host"] == "93.184.216.34"
    assert seen["request"]["headers"]["Host"] == "example.org"
    assert seen["target"] == "/path"


def test_pinned_request_closes_its_pool_when_connection_fails(monkeypatch):
    import urllib3

    closed = []

    class Pool:
        def __init__(self, *_args, **_kwargs):
            pass

        def urlopen(self, *_args, **_kwargs):
            raise urllib3.exceptions.HTTPError("offline")

        def close(self):
            closed.append(True)

    monkeypatch.setattr(web, "HTTPConnectionPool", Pool)
    with pytest.raises(urllib3.exceptions.HTTPError):
        web._pinned_get("http://example.org/path", "93.184.216.34")

    assert closed == [True]


def test_fetch_resource_preserves_a_declared_html_encoding(monkeypatch):
    monkeypatch.setattr(
        web.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )

    class Response:
        status_code = 200
        headers = {"Content-Type": "text/html; charset=iso-8859-1"}

        def iter_content(self, _size):
            yield b"<p>caf\xe9"

        def close(self):
            pass

    _mock_pinned_get(monkeypatch, lambda _url: Response())
    resource = web.fetch_resource("https://example.org/page")

    assert resource.encoding == "iso-8859-1"
    assert resource.body.decode(resource.encoding) == "<p>café"


def test_unknown_html_encoding_falls_back_to_utf8(monkeypatch):
    monkeypatch.setattr(
        web.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )

    class Response:
        status_code = 200
        headers = {"Content-Type": "text/html; charset=not-real"}

        def iter_content(self, _size):
            yield b"<p>hello"

        def close(self):
            pass

    _mock_pinned_get(monkeypatch, lambda _url: Response())

    assert web.fetch_resource("https://example.org/page").encoding == "utf-8"


def test_a_body_read_that_exceeds_the_total_deadline_is_retryable(monkeypatch):
    import time

    monkeypatch.setattr(
        web.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )
    monkeypatch.setattr(web, "BODY_DEADLINE", 0.01)

    class Response:
        status_code = 200
        headers = {"Content-Type": "text/html"}

        def iter_content(self, _size):
            time.sleep(0.03)
            yield b"page"

        def close(self):
            pass

    _mock_pinned_get(monkeypatch, lambda _url: Response())
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/page")

    assert error.value.outcome == "temporary-failure"
    assert error.value.retryable


def test_a_read_interrupted_by_deadline_is_retryable(monkeypatch):
    import time

    monkeypatch.setattr(
        web.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )
    monkeypatch.setattr(web, "BODY_DEADLINE", 0.01)

    class Response:
        status_code = 200
        headers = {"Content-Type": "text/html"}

        def iter_content(self, _size):
            time.sleep(0.03)
            raise OSError("read interrupted")
            yield b"unreachable"

        def close(self):
            pass

    _mock_pinned_get(monkeypatch, lambda _url: Response())
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/page")

    assert error.value.outcome == "temporary-failure"
    assert error.value.retryable


def test_a_connection_error_while_streaming_is_retryable(monkeypatch):
    monkeypatch.setattr(
        web.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )

    class Response:
        status_code = 200
        headers = {"Content-Type": "text/html"}

        def iter_content(self, _size):
            raise OSError("connection reset")

        def close(self):
            pass

    _mock_pinned_get(monkeypatch, lambda _url: Response())
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/page")

    assert error.value.outcome == "fetch-failed"
    assert error.value.retryable


def test_static_html_keeps_title_anchor_and_stable_page_url():
    parser = web._PageParser("https://example.org/article")
    parser.feed("""
        <html><head><title>  A useful page </title>
        <link rel="canonical" href="https://example.org/canonical"></head>
        <body><nav>Ignore this navigation text because it is not evidence</nav>
        <p id="finding">This paragraph is long enough to be extracted as a useful passage.
        It stays associated with its stable page anchor.</p></body></html>
    """)

    assert " ".join(parser.title.split()) == "A useful page"
    assert parser.passages == [
        web.WebPassage(
            "This paragraph is long enough to be extracted as a useful passage. "
            "It stays associated with its stable page anchor.",
            "https://example.org/article#finding",
            1,
        )
    ]
    assert parser.canonical == "https://example.org/canonical"


def test_a_supplied_page_url_is_used_before_a_guessed_title():
    assert (
        sources.lookup_key({"title": "A page title", "url": "https://example.org/article"})
        == "A page title"
    )


def test_only_public_http_destinations_are_accepted(monkeypatch):
    monkeypatch.setattr(
        web.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (None, None, None, None, ("127.0.0.1", 80)),
        ],
    )

    try:
        web._public_http_url("http://example.org/page")
    except web.WebReadError as error:
        assert error.outcome == "blocked"
    else:
        raise AssertionError("a private address was accepted")


def test_non_http_schemes_are_refused_before_dns_lookup(monkeypatch):
    monkeypatch.setattr(
        web.socket,
        "getaddrinfo",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("DNS should not run for a non-HTTP URL"),
        ),
    )

    try:
        web._public_http_url("file:///etc/passwd")
    except web.WebReadError as error:
        assert error.outcome == "unsupported-url"
    else:
        raise AssertionError("a non-HTTP URL was accepted")


def test_prepare_source_rejects_non_http_links_without_asking_paper_indexes(monkeypatch):
    monkeypatch.setattr(
        sources, "_fetch", lambda *args, **kwargs: pytest.fail("unsupported scheme reached paper lookup")
    )

    result = verify.prepare_source("file:///private/paper.html")

    assert result["status"] == "error"
    assert result["source_outcome"]["outcome"] == "unsupported-url"


def test_page_without_static_text_but_with_interaction_is_dynamic():
    resource = web.WebResource(
        "https://example.org/app",
        "text/html",
        "utf-8",
        b"<html><head><title>Application</title></head><body><main>"
        b"<div id='app'></div><button>Load</button></main></body></html>",
    )

    try:
        web.page_from_resource(resource)
    except web.WebReadError as error:
        assert error.outcome == "dynamic"
    else:
        raise AssertionError("an interactive page with no static text was accepted")


def test_redirect_to_private_host_is_rejected_before_the_second_request(monkeypatch):
    requested = []
    monkeypatch.setattr(
        web.socket,
        "getaddrinfo",
        lambda host, *args, **kwargs: [
            (None, None, None, None, ("93.184.216.34" if host == "example.org" else "127.0.0.1", 80)),
        ],
    )

    class Response:
        status_code = 302
        headers = {"Location": "http://127.0.0.1/private"}
        encoding = "utf-8"
        ok = False

        @property
        def is_redirect(self):
            return True

        @property
        def is_permanent_redirect(self):
            return False

        def close(self):
            pass

    def get(url, **kwargs):
        requested.append(url)
        return Response()

    _mock_pinned_get(monkeypatch, get)
    try:
        web.fetch_resource("https://example.org/article")
    except web.WebReadError as error:
        assert error.outcome == "blocked"
    else:
        raise AssertionError("a redirect to localhost was accepted")
    assert requested == ["https://example.org/article"]


def test_response_body_is_capped_before_html_parsing(monkeypatch):
    monkeypatch.setattr(
        web.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (None, None, None, None, ("93.184.216.34", 443)),
        ],
    )

    class Response:
        status_code = 200
        headers = {"Content-Type": "text/html", "Content-Length": str(web.MAX_BYTES + 1)}
        encoding = "utf-8"
        ok = True
        is_redirect = False
        is_permanent_redirect = False

        def iter_content(self, size):
            raise AssertionError("a declared oversized response should not be read")

        def close(self):
            pass

    _mock_pinned_get(monkeypatch, lambda _url: Response())
    try:
        web.fetch_resource("https://example.org/article")
    except web.WebReadError as error:
        assert error.outcome == "too-large"
    else:
        raise AssertionError("an oversized response was accepted")


def test_direct_static_html_is_returned_as_a_web_source_without_indexing(monkeypatch):
    monkeypatch.setattr(
        web,
        "fetch_resource",
        lambda url: web.WebResource(
            "https://example.org/final",
            "text/html",
            "utf-8",
            b"<html><head><title>Useful Page</title></head><body>"
            b"<p id='evidence'>This paragraph describes the method and gives enough static text "
            b"to verify a claim.</p></body></html>",
        ),
    )
    monkeypatch.setattr(
        verify, "_index_once", lambda *args, **kwargs: pytest.fail("web pages are not PDF-indexed")
    )

    # Numeric segments in an ordinary URL are not arXiv identifiers and still use the safe reader.
    ready = verify.prepare_source("https://example.org/2024.03578", expected={"title": "Useful Page"})

    assert ready["status"] == "web-page"
    assert ready["source_outcome"]["source_kind"] == "web-page"
    assert ready["web_page"].url == "https://example.org/final"
    assert ready["web_page"].passages[0].locator == "https://example.org/final#evidence"


def test_a_direct_url_with_neither_html_nor_pdf_is_rejected(monkeypatch):
    monkeypatch.setattr(
        web, "fetch_resource",
        lambda url: web.WebResource(url, "text/plain", "utf-8", b"not a paper or page"),
    )

    result = verify.prepare_source("https://example.org/file")

    assert result["status"] == "error"
    assert result["source_outcome"]["outcome"] == "invalid-content"


def test_html_body_with_a_generic_content_type_is_still_read_as_a_page(monkeypatch):
    monkeypatch.setattr(
        web,
        "fetch_resource",
        lambda url: web.WebResource(
            url,
            "application/octet-stream",
            "utf-8",
            b"<!doctype html><html><title>Useful</title><p>This paragraph contains enough "
            b"static text for evidence.</p></html>",
        ),
    )

    result = verify.prepare_source("https://example.org/article")

    assert result["status"] == "web-page"
    assert result["web_page"].title == "Useful"


def test_failed_paper_lookup_falls_back_to_the_citation_page(monkeypatch):
    attempts = []

    def paper_lookup(source, _expected):
        attempts.append(("paper", source))
        raise sources.NoOpenAccessCopy("no free copy", "semantic-scholar")

    def page_lookup(url):
        attempts.append(("page", url))
        return web.WebResource(
            url,
            "text/html",
            "utf-8",
            b"<title>Cited work</title><p>This page gives enough static text to support the claim.</p>",
        )

    monkeypatch.setattr(sources, "local_pdf_with_resolution", paper_lookup)
    monkeypatch.setattr(web, "fetch_resource", page_lookup)

    ready = verify.prepare_source(
        "Cited work", expected={"title": "Cited work", "url": "https://example.org/work"}
    )

    assert ready["status"] == "web-page"
    assert attempts == [("paper", "Cited work"), ("page", "https://example.org/work")]


def test_failed_paper_and_page_lookup_returns_the_paper_failure(monkeypatch):
    def paper_lookup(_source, _expected):
        raise sources.NoOpenAccessCopy("no free copy", "semantic-scholar")

    def page_lookup(_url):
        raise web.WebReadError("not-found", "page is gone")

    monkeypatch.setattr(sources, "local_pdf_with_resolution", paper_lookup)
    monkeypatch.setattr(web, "fetch_resource", page_lookup)

    result = verify.prepare_source(
        "Cited work", expected={"title": "Cited work", "url": "https://example.org/work"}
    )

    assert result["status"] == "error"


def test_failed_paper_lookup_without_a_page_url_returns_its_error(monkeypatch):
    def paper_lookup(_source, _expected):
        raise sources.NoOpenAccessCopy("no free copy", "semantic-scholar")

    monkeypatch.setattr(sources, "local_pdf_with_resolution", paper_lookup)

    result = verify.prepare_source("Cited work", expected={"title": "Cited work"})

    assert result["status"] == "error"
    assert result["reason"] == "no-open-access"


def test_web_claim_check_returns_stable_paragraph_locations(monkeypatch):
    page = web.WebPage(
        "Useful page",
        "https://example.org/article",
        "2026-11-23T00:00:00+00:00",
        (
            web.WebPassage(
                "A general note about other work with no matching terms.",
                "https://example.org/article#other",
                1,
            ),
            web.WebPassage(
                "The system uses static analysis to detect software defects.",
                "https://example.org/article#finding",
                2,
            ),
        ),
    )
    received = []
    monkeypatch.setattr(
        verify,
        "_judge",
        lambda claim, passages: (
            received.append(passages)
            or {
                "verdict": "supports",
                "quote": passages[0],
                "reasoning": "directly stated",
            }
        ),
    )

    monkeypatch.setattr(
        verify, "prepare_source", lambda *_args, **_kwargs: {"status": "web-page", "web_page": page}
    )
    checked = verify.verify_claim("Static analysis detects software defects.", page.url)

    assert checked["source_kind"] == "web-page"
    assert checked["evidence"][0]["locator"].endswith("#finding")
    assert checked["evidence"][0]["paragraph"] == 2
    assert received[0][0] == checked["evidence"][0]["text"]


def test_a_web_page_with_no_passages_is_insufficient_without_building_a_judge(monkeypatch):
    page = web.WebPage("Empty", "https://example.org", "now", ())
    monkeypatch.setattr(verify, "_build_judge", lambda: pytest.fail("no judge is needed"))

    result = verify.check_web_page("a claim", page.url, page)

    assert result["verdict"] == "insufficient"
    assert result["source_outcome"]["outcome"] == "readable"


def test_web_judgment_uses_the_claim_first_and_rechecks_insufficient_for_other_citations(monkeypatch):
    page = web.WebPage(
        "Useful", "https://example.org", "now",
        (web.WebPassage("A sufficiently long evidence paragraph for a check.", "https://example.org#p", 1),),
    )
    calls = []
    verdicts = iter(("insufficient", "supports"))

    def judge(claim, _passages):
        calls.append(claim)
        return {"verdict": next(verdicts), "quote": "evidence", "reasoning": "checked"}

    monkeypatch.setattr(verify, "_judge", judge)
    checked = verify.check_web_page(
        "the complete claim", page.url, page, "marked sentence [cited]", other_citations=True
    )

    assert calls == ["the complete claim", "marked sentence [cited]"]
    assert checked["verdict"] == "supports"
    assert checked["verdict_from"] == "cited"


def test_web_judgment_does_not_recheck_insufficient_without_other_citations(monkeypatch):
    page = web.WebPage(
        "Useful", "https://example.org", "now",
        (web.WebPassage("A sufficiently long evidence paragraph for a check.", "https://example.org#p", 1),),
    )
    calls = []
    monkeypatch.setattr(
        verify, "_judge",
        lambda claim, _passages: calls.append(claim) or {
            "verdict": "insufficient", "quote": "", "reasoning": "not enough"
        },
    )

    verify.check_web_page("claim", page.url, page, "marked sentence [cited]")

    assert calls == ["claim"]


def test_web_judgment_keeps_insufficient_when_cited_sentence_is_also_insufficient(monkeypatch):
    page = web.WebPage(
        "Useful", "https://example.org", "now",
        (web.WebPassage("A sufficiently long evidence paragraph for a check.", "https://example.org#p", 1),),
    )
    calls = []
    monkeypatch.setattr(
        verify,
        "_judge",
        lambda claim, _passages: calls.append(claim) or {
            "verdict": "insufficient", "quote": "", "reasoning": "not enough evidence"
        },
    )

    checked = verify.check_web_page(
        "claim", page.url, page, "marked sentence [cited]", other_citations=True
    )

    assert calls == ["claim", "marked sentence [cited]"]
    assert checked["verdict"] == "insufficient"


def test_web_judgment_rechecks_refutes_with_the_cited_sentence(monkeypatch):
    page = web.WebPage(
        "Useful", "https://example.org", "now",
        (web.WebPassage("A sufficiently long evidence paragraph for a check.", "https://example.org#p", 1),),
    )
    calls = []
    verdicts = iter(("refutes", "supports"))

    def judge(claim, _passages):
        calls.append(claim)
        return {"verdict": next(verdicts), "quote": "evidence", "reasoning": "checked"}

    monkeypatch.setattr(verify, "_judge", judge)
    checked = verify.check_web_page("claim", page.url, page, "marked sentence [cited]")

    assert calls == ["claim", "marked sentence [cited]"]
    assert checked["verdict"] == "supports"
    assert checked["verdict_from"] == "cited"


def test_web_judgment_keeps_a_refutes_result_when_the_cited_sentence_also_refutes(monkeypatch):
    page = web.WebPage(
        "Useful", "https://example.org", "now",
        (web.WebPassage("A sufficiently long evidence paragraph for a check.", "https://example.org#p", 1),),
    )
    monkeypatch.setattr(
        verify, "_judge",
        lambda *_: {"verdict": "refutes", "quote": "evidence", "reasoning": "checked"},
    )

    checked = verify.check_web_page("claim", page.url, page, "marked sentence [cited]")

    assert checked["verdict"] == "refutes"
    assert checked["verdict_from"] == "text"


def test_web_judgment_builds_the_judge_on_first_use(monkeypatch):
    page = web.WebPage(
        "Useful", "https://example.org", "now",
        (web.WebPassage("A sufficiently long evidence paragraph for a check.", "https://example.org#p", 1),),
    )
    monkeypatch.setattr(verify, "_judge", None)
    built = []
    def build_judge():
        built.append(True)

        def judge(*_args):
            return {"verdict": "supports", "quote": "evidence", "reasoning": "checked"}

        return judge

    monkeypatch.setattr(verify, "_build_judge", build_judge)

    checked = verify.check_web_page("claim", page.url, page)

    assert built == [True]
    assert checked["verdict"] == "supports"


def test_a_page_judge_failure_becomes_a_safe_tool_error(monkeypatch):
    page = web.WebPage(
        "Useful", "https://example.org", "now",
        (web.WebPassage("A sufficiently long evidence paragraph for a check.", "https://example.org#p", 1),),
    )
    monkeypatch.setattr(verify, "_judge", lambda *_: (_ for _ in ()).throw(RuntimeError("judge down")))

    result = verify.check_web_page("claim", page.url, page)

    assert result["status"] == "error"
    assert result["source"] == page.url


def test_html_title_mismatch_is_reported_as_identity_mismatch(monkeypatch):
    monkeypatch.setattr(
        web, "fetch_resource",
        lambda _: web.WebResource(
            "https://example.org/page", "text/html", "utf-8",
            b"<title>Other work</title><p>This paragraph contains enough readable static text "
            b"for extraction.</p>",
        ),
    )
    monkeypatch.setattr(sources, "titles_match", lambda *_: False)

    result = verify.prepare_source(
        "https://example.org/page", expected={"title": "Cited work", "_validate_web_title": True}
    )

    assert result["reason"] == "web-page-unavailable"
    assert result["source_outcome"]["outcome"] == "identity-mismatch"


def test_repaired_page_title_may_append_a_site_name(monkeypatch):
    monkeypatch.setattr(
        web, "fetch_resource",
        lambda url: web.WebResource(
            url, "text/html", "utf-8",
            b"<title>Cited work - Example Org</title>"
            b"<p>This paragraph contains enough static text for evidence.</p>",
        ),
    )
    monkeypatch.setattr(sources, "titles_match", lambda cited, found: cited == found)

    result = verify.prepare_source(
        "https://example.org/work", expected={"title": "Cited work", "_validate_web_title": True}
    )

    assert result["status"] == "web-page"


def test_direct_pdf_url_is_validated_and_indexed_once(monkeypatch, tmp_path):
    resource = web.WebResource("https://example.org/paper.pdf", "application/pdf", "utf-8", b"%PDF-fake")
    monkeypatch.setattr(web, "fetch_resource", lambda _: resource)
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    monkeypatch.setattr(verify, "validate_pdf_identity", lambda *_: None)
    monkeypatch.setattr(verify, "_index_once", lambda *_: None)

    result = verify.prepare_source(resource.url)

    assert result["status"] == "ok"
    assert Path(result["path"]).read_bytes() == resource.body
    assert result["source_outcome"]["outcome"] == "readable"


def test_direct_pdf_indexing_failure_has_a_retrieval_outcome(monkeypatch, tmp_path):
    resource = web.WebResource("https://example.org/paper.pdf", "application/pdf", "utf-8", b"%PDF-fake")
    monkeypatch.setattr(web, "fetch_resource", lambda _: resource)
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    monkeypatch.setattr(verify, "validate_pdf_identity", lambda *_: None)
    monkeypatch.setattr(
        verify, "_index_once", lambda *_: {"status": "error", "reason": "indexing-failed", "retryable": True}
    )

    result = verify.prepare_source(resource.url)

    assert result["reason"] == "indexing-failed"
    assert result["source_outcome"]["outcome"] == "indexing-failed"


@pytest.mark.parametrize("previously_accepted", [False, True])
def test_direct_pdf_identity_mismatch_preserves_shared_cache(monkeypatch, tmp_path, previously_accepted):
    resource = web.WebResource("https://example.org/paper.pdf", "application/pdf", "utf-8", b"%PDF-fake")
    monkeypatch.setattr(web, "fetch_resource", lambda _: resource)
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    if previously_accepted:
        monkeypatch.setattr(verify, "_index_once", lambda *_: None)
        assert verify.prepare_source(resource.url)["status"] == "ok"
    before = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    monkeypatch.setattr(
        verify, "validate_pdf_identity",
        lambda *_: (_ for _ in ()).throw(sources.IdentityMismatch("wrong paper")),
    )

    result = verify.prepare_source(resource.url)

    assert result["status"] == "error"
    assert result["reason"] == "identity-mismatch"
    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == before


@pytest.mark.parametrize(
    ("expected", "metadata", "front", "title", "message"),
    [
        ({"title": "Cited"}, {"author": "A. Smith"}, "", "Different", "title"),
        ({"authors": ["Smith, A."]}, {"author": "Jones"}, "", "", "author"),
        ({"doi": "10.1234/cited"}, {"author": "A. Smith"}, "doi:10.1234/other", "", "DOI"),
    ],
)
def test_pdf_identity_rejects_conflicting_available_metadata(
    monkeypatch, expected, metadata, front, title, message
):
    import pymupdf

    class Page:
        def get_text(self, _kind):
            return front

    class Document:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __len__(self):
            return 1

        def __getitem__(self, _index):
            return Page()

        @property
        def metadata(self):
            return metadata

    monkeypatch.setattr(pymupdf, "open", lambda _path: Document())
    monkeypatch.setattr("app.pipeline.claims._printed_title", lambda _path: title)
    monkeypatch.setattr(sources, "titles_match", lambda *_: False)

    with pytest.raises(sources.IdentityMismatch, match=message):
        verify.validate_pdf_identity("paper.pdf", expected)


def test_pdf_identity_tolerates_unreadable_metadata(monkeypatch):
    import pymupdf

    monkeypatch.setattr(pymupdf, "open", lambda _path: (_ for _ in ()).throw(RuntimeError("bad PDF")))

    verify.validate_pdf_identity("unreadable.pdf", {"title": "Cited work"})


def test_pdf_identity_accepts_matching_title_author_and_doi(monkeypatch):
    import pymupdf

    class Page:
        def get_text(self, _kind):
            return "DOI: 10.1234/cited"

    class Document:
        metadata = {"title": "Cited work", "author": "A. Smith"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __len__(self):
            return 1

        def __getitem__(self, _index):
            return Page()

    monkeypatch.setattr(pymupdf, "open", lambda _path: Document())
    monkeypatch.setattr("app.pipeline.claims._printed_title", lambda _path: "")
    monkeypatch.setattr(sources, "titles_match", lambda *_: True)

    verify.validate_pdf_identity(
        "paper.pdf", {"title": "Cited work", "authors": "A. Smith", "doi": "10.1234/cited"}
    )


@pytest.mark.parametrize(
    ("expected_title", "printed_title", "cited_author", "pdf_author"),
    [
        ("Useful Page", "Useful Page - Example Org", "Müller", "Hans Müller"),
        ("Useful Page", "Useful Page | Example Org", "Smith-Jones", "Anna Smith Jones"),
    ],
)
def test_pdf_identity_accepts_site_suffixes_and_folded_hyphenated_surnames(
    monkeypatch, expected_title, printed_title, cited_author, pdf_author
):
    import pymupdf

    class Page:
        def get_text(self, _kind):
            return ""

    class Document:
        metadata = {"author": pdf_author}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __len__(self):
            return 1

        def __getitem__(self, _index):
            return Page()

    monkeypatch.setattr(pymupdf, "open", lambda _path: Document())
    monkeypatch.setattr("app.pipeline.claims._printed_title", lambda _path: printed_title)
    monkeypatch.setattr(
        sources, "titles_match", lambda cited, actual: cited.lower() == actual.lower()
    )

    verify.validate_pdf_identity("paper.pdf", {"title": expected_title, "authors": [cited_author]})


def test_page_parser_discards_short_text_and_rejects_unsafe_anchors():
    parser = web._PageParser("https://example.org/page")
    parser.feed(
        "<nav><p>" + "ignored navigation " * 4 + "</p></nav>"
        "<p>short</p><p id='bad anchor'>" + "x" * 45 + "</p>"
        "<p id='good:id'>" + "y" * 45 + "</p>"
    )

    assert len(parser.passages) == 2
    assert [item.locator for item in parser.passages] == [
        "https://example.org/page",
        "https://example.org/page#good:id",
    ]


def test_page_parser_ignores_unmatched_closing_tags():
    parser = web._PageParser("https://example.org/page")
    parser.feed("</p>")
    parser.feed("<blockquote><p>" + "useful static text " * 3 + "</blockquote></p>")

    assert parser.passages[0].text.startswith("useful static text")


def test_private_or_unresolvable_hosts_and_credentials_are_rejected(monkeypatch):
    with pytest.raises(web.WebReadError, match="credentials"):
        web._public_http_url("https://user:pass@example.org/page")

    monkeypatch.setattr(web.socket, "getaddrinfo", lambda *args, **kwargs: [])
    with pytest.raises(web.WebReadError, match="non-public"):
        web._public_http_url("https://example.org/page")

    monkeypatch.setattr(
        web.socket, "getaddrinfo", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("DNS down"))
    )
    with pytest.raises(web.WebReadError) as error:
        web._public_http_url("https://example.org/page")
    assert error.value.retryable


@pytest.mark.parametrize(
    ("status", "headers", "outcome"),
    [
        (302, {}, "http-error"),
        (401, {}, "blocked"),
        (503, {}, "temporary-failure"),
        (404, {}, "http-error"),
    ],
)
def test_http_statuses_are_reported_without_reading_body(monkeypatch, status, headers, outcome):
    monkeypatch.setattr(
        web.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )

    class Response:
        encoding = "utf-8"
        is_permanent_redirect = False

        def close(self):
            pass

        def iter_content(self, _size):
            raise AssertionError("an unsuccessful response has no body")

    Response.status_code = status
    Response.headers = headers
    Response.ok = status < 400
    Response.is_redirect = status == 302
    _mock_pinned_get(monkeypatch, lambda _url: Response())
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/page")
    assert error.value.outcome == outcome


def test_http_timeout_and_connection_errors_are_retryable(monkeypatch):
    import urllib3

    monkeypatch.setattr(
        web.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )
    for failure, expected in (
        (urllib3.exceptions.TimeoutError("slow"), "temporary-failure"),
        (urllib3.exceptions.HTTPError("offline"), "fetch-failed"),
    ):
        monkeypatch.setattr(web, "_pinned_get", lambda *args, error=failure: (_ for _ in ()).throw(error))
        with pytest.raises(web.WebReadError) as error:
            web.fetch_resource("https://example.org/page")
        assert error.value.outcome == expected
        assert error.value.retryable


def test_redirects_are_followed_with_the_new_public_url_and_response_is_closed(monkeypatch):
    monkeypatch.setattr(
        web.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )
    responses = []

    class Response:
        def __init__(self, status, headers, body=b""):
            self.status_code = status
            self.headers = headers
            self.encoding = "utf-8"
            self.ok = status < 400
            self.is_redirect = status == 302
            self.is_permanent_redirect = False
            self.body = body
            self.closed = False

        def iter_content(self, _size):
            yield self.body

        def close(self):
            self.closed = True

    first = Response(302, {"Location": "/final"})
    second = Response(200, {"Content-Type": "text/html; charset=utf-8"}, b"<p>page</p>")
    responses.extend([first, second])
    requested = []

    def get(url, **_kwargs):
        requested.append(url)
        return responses.pop(0)

    _mock_pinned_get(monkeypatch, get)
    resource = web.fetch_resource("https://example.org/start")

    assert requested == ["https://example.org/start", "https://example.org/final"]
    assert resource.url == "https://example.org/final"
    assert resource.body == b"<p>page</p>"
    assert first.closed and second.closed


def test_streamed_body_over_limit_is_stopped(monkeypatch):
    monkeypatch.setattr(
        web.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )

    class Response:
        status_code = 200
        headers = {"Content-Type": "text/html"}
        encoding = "utf-8"
        ok = True
        is_redirect = False
        is_permanent_redirect = False

        def iter_content(self, _size):
            yield b"x" * web.MAX_BYTES
            yield b"overflow"

        def close(self):
            pass

    _mock_pinned_get(monkeypatch, lambda _url: Response())
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/page")
    assert error.value.outcome == "too-large"


def test_redirect_without_location_and_too_many_redirects_are_reported(monkeypatch):
    monkeypatch.setattr(
        web.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )

    class Redirect:
        status_code = 302
        headers = {"Location": "/next"}
        encoding = "utf-8"
        ok = False
        is_redirect = True
        is_permanent_redirect = False

        def close(self):
            pass

        def iter_content(self, _size):
            return iter(())

    _mock_pinned_get(monkeypatch, lambda _url: Redirect())
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/start")
    assert error.value.outcome == "redirect-limit"

    Redirect.headers = {}
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/start")
    assert error.value.outcome == "http-error"


def test_redirect_limit_of_zero_is_reported(monkeypatch):
    monkeypatch.setattr(web, "MAX_REDIRECTS", -1)
    with pytest.raises(web.WebReadError, match="redirected too many times"):
        web.fetch_resource("https://example.org/start")


def test_static_html_rejects_non_html_empty_text_and_unsafe_canonical():
    with pytest.raises(web.WebReadError, match="HTML"):
        web.page_from_resource(web.WebResource("https://example.org", "application/pdf", "utf-8", b"%PDF"))
    with pytest.raises(web.WebReadError) as empty:
        web.page_from_resource(web.WebResource("https://example.org", "text/html", "utf-8", b"<p>tiny</p>"))
    assert empty.value.outcome == "empty"

    unsafe = web.WebResource(
        "https://example.org", "text/html", "utf-8",
        b"<link rel='canonical' href='http://localhost/private'>"
        b"<p>This paragraph has enough readable static text to count as evidence.</p>",
    )
    with pytest.raises(web.WebReadError) as blocked:
        web.page_from_resource(unsafe)
    assert blocked.value.outcome == "blocked"


def test_read_page_fetches_then_extracts(monkeypatch):
    resource = web.WebResource(
        "https://example.org", "text/html", "utf-8",
        b"<p>This paragraph has enough readable static text to count as evidence.</p>",
    )
    monkeypatch.setattr(web, "fetch_resource", lambda _url: resource)

    assert web.read_page(resource.url).passages[0].text.startswith("This paragraph")
