from pathlib import Path

import pytest
from app.pipeline import sources, verify, web


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
        == "https://example.org/article"
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
    import requests

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

    monkeypatch.setattr(requests, "get", get)
    try:
        web.fetch_resource("https://example.org/article")
    except web.WebReadError as error:
        assert error.outcome == "blocked"
    else:
        raise AssertionError("a redirect to localhost was accepted")
    assert requested == ["https://example.org/article"]


def test_response_body_is_capped_before_html_parsing(monkeypatch):
    import requests

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

    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: Response())
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

    checked = verify.check_web_page("Static analysis detects software defects.", page.url, page)

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


def test_direct_pdf_identity_mismatch_removes_the_saved_file(monkeypatch, tmp_path):
    resource = web.WebResource("https://example.org/paper.pdf", "application/pdf", "utf-8", b"%PDF-fake")
    monkeypatch.setattr(web, "fetch_resource", lambda _: resource)
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    monkeypatch.setattr(
        verify, "validate_pdf_identity",
        lambda *_: (_ for _ in ()).throw(sources.IdentityMismatch("wrong paper")),
    )

    result = verify.prepare_source(resource.url)

    assert result["status"] == "error"
    assert result["reason"] == "identity-mismatch"
    assert not list(tmp_path.glob("url-*.pdf"))


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
    import requests

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
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: Response())
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/page")
    assert error.value.outcome == outcome


def test_http_timeout_and_connection_errors_are_retryable(monkeypatch):
    import requests

    monkeypatch.setattr(
        web.socket, "getaddrinfo",
        lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 443))],
    )
    for failure, expected in (
        (requests.Timeout("slow"), "temporary-failure"),
        (requests.ConnectionError("offline"), "fetch-failed"),
    ):
        monkeypatch.setattr(
            requests, "get", lambda *args, error=failure, **kwargs: (_ for _ in ()).throw(error)
        )
        with pytest.raises(web.WebReadError) as error:
            web.fetch_resource("https://example.org/page")
        assert error.value.outcome == expected
        assert error.value.retryable


def test_redirects_are_followed_with_the_new_public_url_and_response_is_closed(monkeypatch):
    import requests

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

    monkeypatch.setattr(requests, "get", get)
    resource = web.fetch_resource("https://example.org/start")

    assert requested == ["https://example.org/start", "https://example.org/final"]
    assert resource.url == "https://example.org/final"
    assert resource.body == b"<p>page</p>"
    assert first.closed and second.closed


def test_streamed_body_over_limit_is_stopped(monkeypatch):
    import requests

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

    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: Response())
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/page")
    assert error.value.outcome == "too-large"


def test_redirect_without_location_and_too_many_redirects_are_reported(monkeypatch):
    import requests

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

    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: Redirect())
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/start")
    assert error.value.outcome == "redirect-limit"

    Redirect.headers = {}
    with pytest.raises(web.WebReadError) as error:
        web.fetch_resource("https://example.org/start")
    assert error.value.outcome == "http-error"


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
