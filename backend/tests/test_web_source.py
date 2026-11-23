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
    assert parser.passages == [web.WebPassage(
        "This paragraph is long enough to be extracted as a useful passage. It stays associated with its stable page anchor.",
        "https://example.org/article#finding",
        1,
    )]
    assert parser.canonical == "https://example.org/canonical"


def test_a_supplied_page_url_is_used_before_a_guessed_title():
    assert sources.lookup_key({"title": "A page title", "url": "https://example.org/article"}) == "https://example.org/article"


def test_only_public_http_destinations_are_accepted(monkeypatch):
    monkeypatch.setattr(web.socket, "getaddrinfo", lambda *args, **kwargs: [
        (None, None, None, None, ("127.0.0.1", 80)),
    ])

    try:
        web._public_http_url("http://example.org/page")
    except web.WebReadError as error:
        assert error.outcome == "blocked"
    else:
        raise AssertionError("a private address was accepted")


def test_non_http_schemes_are_refused_before_dns_lookup(monkeypatch):
    monkeypatch.setattr(web.socket, "getaddrinfo", lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("DNS should not run for a non-HTTP URL"),
    ))

    try:
        web._public_http_url("file:///etc/passwd")
    except web.WebReadError as error:
        assert error.outcome == "unsupported-url"
    else:
        raise AssertionError("a non-HTTP URL was accepted")


def test_prepare_source_rejects_non_http_links_without_asking_paper_indexes(monkeypatch):
    monkeypatch.setattr(sources, "_fetch", lambda *args, **kwargs: pytest.fail("unsupported scheme reached paper lookup"))

    result = verify.prepare_source("file:///private/paper.html")

    assert result["status"] == "error"
    assert result["source_outcome"]["outcome"] == "unsupported-url"


def test_page_without_static_text_but_with_interaction_is_dynamic():
    resource = web.WebResource(
        "https://example.org/app", "text/html", "utf-8",
        b"<html><head><title>Application</title></head><body><main><div id='app'></div><button>Load</button></main></body></html>",
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
    monkeypatch.setattr(web.socket, "getaddrinfo", lambda host, *args, **kwargs: [
        (None, None, None, None, ("93.184.216.34" if host == "example.org" else "127.0.0.1", 80)),
    ])

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

    monkeypatch.setattr(web.socket, "getaddrinfo", lambda *args, **kwargs: [
        (None, None, None, None, ("93.184.216.34", 443)),
    ])

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
    monkeypatch.setattr(web, "fetch_resource", lambda url: web.WebResource(
        "https://example.org/final", "text/html", "utf-8",
        b"<html><head><title>Useful Page</title></head><body><p id='evidence'>This paragraph describes the method and gives enough static text to verify a claim.</p></body></html>",
    ))
    monkeypatch.setattr(verify, "_index_once", lambda *args, **kwargs: pytest.fail("web pages are not PDF-indexed"))

    # Numeric segments in an ordinary URL are not arXiv identifiers and still use the safe reader.
    ready = verify.prepare_source("https://example.org/2024.03578", expected={"title": "Useful Page"})

    assert ready["status"] == "web-page"
    assert ready["source_outcome"]["source_kind"] == "web-page"
    assert ready["web_page"].url == "https://example.org/final"
    assert ready["web_page"].passages[0].locator == "https://example.org/final#evidence"


def test_web_claim_check_returns_stable_paragraph_locations(monkeypatch):
    page = web.WebPage(
        "Useful page", "https://example.org/article", "2026-11-23T00:00:00+00:00",
        (
            web.WebPassage("A general note about other work with no matching terms.", "https://example.org/article#other", 1),
            web.WebPassage("The system uses static analysis to detect software defects.", "https://example.org/article#finding", 2),
        ),
    )
    received = []
    monkeypatch.setattr(verify, "_judge", lambda claim, passages: received.append(passages) or {
        "verdict": "supports", "quote": passages[0], "reasoning": "directly stated",
    })

    checked = verify.check_web_page("Static analysis detects software defects.", page.url, page)

    assert checked["source_kind"] == "web-page"
    assert checked["evidence"][0]["locator"].endswith("#finding")
    assert checked["evidence"][0]["paragraph"] == 2
    assert received[0][0] == checked["evidence"][0]["text"]
