"""Verify a claim against the source it cites.

The cited PDF is indexed (ColBERT service), passages are retrieved with the claim as the
query, and the LLM judges whether they support it: supports / refutes / insufficient.
Visual evidence (ColPali) is optional and skipped when that service is down.
"""

import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from app import store
from app.clients import retrieval
from app.config import FIGURE_WAIT, PARALLEL_SOURCES, VLLM_MODEL
from app.metrics import record_llm_usage

logger = logging.getLogger(__name__)

EVIDENCE_COUNT = 4
PAGE_COUNT = 2
LABELS = ("supports", "refutes", "insufficient")

_judge = None  # built on first use: needs dspy and a running LM


def evidence_from(claim: str, source_name: str) -> list[dict]:
    """Passages from one indexed paper, most relevant first, each keeping page and span."""
    passages = [
        passage for passage in retrieval.colbert_search(claim, k=10, source=source_name)
        if passage.get("source") == source_name
    ]
    return [
        {key: passage[key] for key in ("text", "page", "start", "end", "score")}
        for passage in passages[:EVIDENCE_COUNT]
    ]


HIT_FIELDS = ("page", "score", "kind", "label", "caption", "image")


def _index_visually(source: Path):
    """Put the cited paper's figures in the vision index, or its pages when it has none.
    A cropped figure beats a rendered page: it carries a name and a caption to quote."""
    from app.pipeline.figures import paper_media

    media = paper_media(source.as_posix())
    figures = media.get("figures", []) if media["status"] == "ok" else []
    if figures:
        retrieval.colpali_add_figures(source.name, source.stem, figures)
    else:
        retrieval.colpali_add_pdf(source.as_posix())


_indexed: set[str] = set()  # sources whose text this process has put in ColBERT
_visual_indexing: dict[str, Future] = {}  # each source's figure indexing, started once
_figures_due: dict[str, float] = {}  # when its checks stop waiting for them (monotonic time)
# Indexing a cited paper's figures means Docling reading the whole PDF, a minute or more on a
# CPU. It runs here, at most PARALLEL_SOURCES papers at a time, the same as when each check
# indexed its own, so that FIGURE_WAIT can let a check go on without it (#163).
_visual_pool = ThreadPoolExecutor(max_workers=PARALLEL_SOURCES, thread_name_prefix="figures")
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(name: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(name, threading.Lock())


def _index_once(source: Path, wait_for_figures: bool = False) -> dict | None:
    """Index a cited paper, only the first time we see it.

    The text goes into ColBERT before this returns. Indexing deletes the old copy first. If two
    checks indexed the same paper at once, one could search in the middle and find nothing.
    The lock makes the second check wait.

    The figures go into ColPali in the background, started at the same time as the text. By
    default this waits for them too, because a figure caption can decide a verdict: without
    them, one verdict in 15 went from supports to refutes (#163). With FIGURE_WAIT set to a
    number, it waits at most that many seconds after they started, then returns without them,
    and check_prepared searches the figures only once they are indexed. `wait_for_figures`
    always waits, for a single check that has nothing else to do.

    Returns the error if the text index failed.
    """
    from app.pipeline.rag import add_paper

    failure = None
    with _lock_for(source.name):
        figures = _visual_indexing.get(source.name)
        if figures is None:
            figures = _visual_pool.submit(_index_visually_if_available, source)
            _visual_indexing[source.name] = figures
            if FIGURE_WAIT is not None:
                _figures_due[source.name] = time.monotonic() + FIGURE_WAIT
        if source.name not in _indexed:
            indexed = add_paper(source.as_posix())
            if indexed["status"] == "error":
                failure = indexed  # not remembered: the next check should try again
            else:
                _indexed.add(source.name)
    if failure is None:
        # A number counts from when the figures started, so a later check of the same paper, or
        # a slow text index, does not add another full wait.
        due = _figures_due.get(source.name)
        wait = None if wait_for_figures or due is None else due - time.monotonic()
        if wait is None or wait > 0:
            try:
                figures.result(timeout=wait)
            except TimeoutError:
                pass  # go on with the text; a later check of this paper may get the figures
    return failure


def _figures_ready(source: Path) -> bool:
    """Whether this source's figures are in ColPali, or its figure indexing ended without them.
    Until then, searching ColPali could hit the index halfway through being replaced."""
    figures = _visual_indexing.get(source.name)
    return figures is not None and figures.done()


def _index_visually_if_available(source: Path):
    """Index figures or pages in ColPali. Visual hints are optional, so errors are ignored."""
    try:
        if retrieval.colpali_available():
            _index_visually(source)
    except Exception as error:
        # _visual reports nothing when the visual index is missing, so say why here
        logger.warning("indexing %s in ColPali failed: %s", source.name, error)


def _visual(claim: str, source: Path) -> tuple[list[dict], str]:
    """What the cited paper *shows* that matches the claim, and the model that matched it."""
    try:
        if not retrieval.colpali_available():
            return [], ""
        body = retrieval.colpali_search(claim, k=5, source=source.name)
        hits = [hit for hit in body["topk"] if hit.get("source") == source.name]
        found = [{field: hit.get(field, "") for field in HIT_FIELDS} for hit in hits[:PAGE_COUNT]]
        return found, body.get("model", "")
    except Exception:
        return [], ""


def _captions(hits: list[dict]) -> list[str]:
    """Figure captions as evidence the judge can read and quote."""
    return [f"{hit['label']}: {hit['caption']}" for hit in hits if hit.get("caption")]


def _build_judge():
    import dspy

    from app.llm import dspy_lm

    language_model = dspy_lm(temperature=0.0, max_tokens=1000)

    class JudgeClaim(dspy.Signature):
        """Decide whether the cited paper's passages support the claim made about it.
        Answer "supports" only if a passage states it, "refutes" if a passage contradicts it,
        and "insufficient" if the passages do not settle the question."""

        claim: str = dspy.InputField(desc="A claim that cites the source paper")
        evidence: list[str] = dspy.InputField(desc="Passages from the cited paper")
        verdict: str = dspy.OutputField(desc="supports, refutes, or insufficient")
        quote: str = dspy.OutputField(desc="The sentence from the evidence that decides it, or empty")
        reasoning: str = dspy.OutputField(desc="One sentence explaining the verdict")

    judge = dspy.ChainOfThought(JudgeClaim)

    def run(claim: str, evidence: list[str]) -> dict:
        key = store.cache_key("judge", VLLM_MODEL, claim, "\x00".join(evidence))
        if (cached := store.recall_cache(key)) is not None:
            return cached
        with dspy.track_usage() as usage, dspy.context(lm=language_model, adapter=dspy.JSONAdapter()):
            prediction = judge(claim=claim, evidence=evidence)
        record_llm_usage("judge", usage)
        verdict = prediction.verdict.strip().lower()
        result = {
            "verdict": verdict if verdict in LABELS else "insufficient",
            "quote": prediction.quote,
            "reasoning": prediction.reasoning,
        }
        store.remember_cache(key, result)
        return result

    return run


def unchecked_reason(verdict: dict, citation: dict) -> str:
    """Why a claim went unchecked.

    A citation we could not find that has a link is usually a blog post or a spec. That is
    a fact about the source list, not a lookup that failed on our side.
    """
    reason = verdict.get("reason", "failed")
    return "web-source" if reason == "unresolvable" and citation.get("url") else reason


def fold_check(claim: dict, source: str, citation: dict, verdict: dict) -> None:
    """Add the result of one check to its claim. The gateway and the graph both use this.

    A verdict goes under `verdicts`, keyed by the name the source was looked up by, so the
    card can show it next to its citation. A failure goes under `unchecked` with a reason,
    because a claim we could not check must not look like one nobody tried.
    """
    if verdict["status"] == "ok":
        claim.setdefault("verdicts", []).append({**verdict, "cited": source})
    else:
        claim.setdefault("unchecked", []).append(
            {"source": source, "reason": unchecked_reason(verdict, citation),
             "message": verdict.get("message", "")}
        )


def verify_claim(claim: str, source_pdf_path: str) -> dict:
    """Check whether a cited paper actually supports a claim made about it.

    Args:
        claim: the claim to check. For example "ColBERT reduces index size by 10x".
        source_pdf_path: the cited paper. A local PDF path, or a DOI, arXiv ID, PMID,
            or URL to download. For example "data/papers/colbertv2.pdf" or "2112.01488".
    """
    # One check on its own has nothing else to do while the figures are read, so it waits for
    # them and can show a matching figure.
    prepared = prepare_source(source_pdf_path, wait_for_figures=True)
    if prepared["status"] == "error":
        return {**prepared, "claim": claim, "source": source_pdf_path}
    return check_prepared(claim, source_pdf_path, Path(prepared["path"]))


def prepare_source(source_pdf_path: str, wait_for_figures: bool = False) -> dict:
    """Get a cited paper ready: download it if needed and index it once.

    Returns {"status": "ok", "path": ...} or an error with a reason. Safe to call many
    times for the same paper: the work is done only once. Returns once the text is indexed;
    the figures follow in the background unless `wait_for_figures` is set.
    """
    try:
        from app.pipeline.sources import local_pdf

        source = Path(local_pdf(source_pdf_path))
        if failure := _index_once(source, wait_for_figures):
            return failure
        return {"status": "ok", "path": source.as_posix()}
    except Exception as error:
        from app.pipeline.sources import reason_for

        return {"status": "error", "message": str(error), "reason": reason_for(error)}


def check_prepared(claim: str, source_pdf_path: str, source: Path) -> dict:
    """Judge a claim against a paper that prepare_source already made ready."""
    global _judge
    try:
        from app.pipeline.sources import known_index, known_version

        # Text search (ColBERT) and visual search (ColPali) are independent, so run both at once.
        # Figures still being indexed are left out rather than waited for (#163).
        with ThreadPoolExecutor(max_workers=1) as pool:
            visual_search = pool.submit(_visual, claim, source) if _figures_ready(source) else None
            evidence = evidence_from(claim, source.name)
            pages, page_model = visual_search.result() if visual_search else ([], "")
        passages = [item["text"] for item in evidence]  # the judge reads text, not where it came from
        # A caption is evidence like any other line.
        passages += _captions(pages)
        indexed_in = known_index(source_pdf_path)
        version = known_version(source_pdf_path)  # {} unless the PDF came from arXiv (#424)
        if not passages:
            return {"status": "ok", "claim": claim, "source": source.name,
                    "verdict": "insufficient", "quote": "", "reasoning": "no passages retrieved",
                    "evidence": [], "pages": pages, "page_model": page_model,
                    "indexed_in": indexed_in, **version}

        if _judge is None:
            _judge = _build_judge()
        return {"status": "ok", "claim": claim, "source": source.name,
                **_judge(claim, passages), "evidence": evidence, "pages": pages,
                "page_model": page_model, "indexed_in": indexed_in, **version}
    except Exception as error:
        from app.pipeline.sources import reason_for

        # Why it failed, not only that it did: the reader must tell "the source does not
        # support this" from "we could not read the source".
        return {"status": "error", "message": str(error), "reason": reason_for(error),
                "claim": claim, "source": source_pdf_path}
