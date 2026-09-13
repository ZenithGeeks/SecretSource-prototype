"""Verify a claim against the source it cites.

The cited PDF is indexed (ColBERT service), passages are retrieved with the claim as the
query, and the LLM judges whether they support it: supports / refutes / insufficient.
Visual evidence (ColPali) is optional and skipped when that service is down.
"""

import threading
from pathlib import Path

from app.clients import retrieval

EVIDENCE_COUNT = 4
PAGE_COUNT = 2
LABELS = ("supports", "refutes", "insufficient")

_judge = None  # built on first use: needs dspy and a running LM


def _evidence(claim: str, source_name: str) -> list[dict]:
    """Passages from one indexed paper, most relevant first, each keeping page and span."""
    passages = [
        passage for passage in retrieval.colbert_search(claim, k=30)
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


_indexed: set[str] = set()  # sources this process has already put in the retrieval stores
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(name: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(name, threading.Lock())


def _index_once(source: Path) -> dict | None:
    """Index a cited paper in both stores, only the first time we see it.

    Indexing deletes the old copy first. If two checks indexed the same paper at once, one
    could search in the middle and find nothing. The lock makes the second check wait.
    Returns the error if the text index failed.
    """
    from app.pipeline.rag import add_paper

    with _lock_for(source.name):
        if source.name in _indexed:
            return None
        indexed = add_paper(source.as_posix())
        if indexed["status"] == "error":
            return indexed  # not remembered: the next check should try again
        try:
            if retrieval.colpali_available():
                _index_visually(source)
        except Exception:
            pass  # visual hints are optional, and _visual reports nothing when they are missing
        _indexed.add(source.name)
        return None


def _visual(claim: str, source: Path) -> tuple[list[dict], str]:
    """What the cited paper *shows* that matches the claim, and the model that matched it."""
    try:
        if not retrieval.colpali_available():
            return [], ""
        body = retrieval.colpali_search(claim, k=20)
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
        with dspy.context(lm=language_model, adapter=dspy.JSONAdapter()):
            prediction = judge(claim=claim, evidence=evidence)
        verdict = prediction.verdict.strip().lower()
        return {
            "verdict": verdict if verdict in LABELS else "insufficient",
            "quote": prediction.quote,
            "reasoning": prediction.reasoning,
        }

    return run


def unchecked_reason(verdict: dict, citation: dict) -> str:
    """Why a claim went unchecked.

    A citation we could not find that has a link is usually a blog post or a spec. That is
    a fact about the source list, not a lookup that failed on our side.
    """
    reason = verdict.get("reason", "failed")
    return "web-source" if reason == "unresolvable" and citation.get("url") else reason


def verify_claim(claim: str, source_pdf_path: str) -> dict:
    """Check whether a cited paper actually supports a claim made about it.

    Args:
        claim: the claim to check. For example "ColBERT reduces index size by 10x".
        source_pdf_path: the cited paper. A local PDF path, or a DOI, arXiv ID, PMID,
            or URL to download. For example "data/papers/colbertv2.pdf" or "2112.01488".
    """
    global _judge
    try:
        from app.pipeline.sources import known_index, local_pdf

        source = Path(local_pdf(source_pdf_path))
        if failure := _index_once(source):
            return failure

        evidence = _evidence(claim, source.name)
        passages = [item["text"] for item in evidence]  # the judge reads text, not where it came from
        pages, page_model = _visual(claim, source)
        # A caption is evidence like any other line.
        passages += _captions(pages)
        indexed_in = known_index(source_pdf_path)
        if not passages:
            return {"status": "ok", "claim": claim, "source": source.name,
                    "verdict": "insufficient", "quote": "", "reasoning": "no passages retrieved",
                    "evidence": [], "pages": pages, "page_model": page_model,
                    "indexed_in": indexed_in}

        if _judge is None:
            _judge = _build_judge()
        return {"status": "ok", "claim": claim, "source": source.name,
                **_judge(claim, passages), "evidence": evidence, "pages": pages,
                "page_model": page_model, "indexed_in": indexed_in}
    except Exception as error:
        from app.pipeline.sources import reason_for

        # Why it failed, not only that it did: the reader must tell "the source does not
        # support this" from "we could not read the source".
        return {"status": "error", "message": str(error), "reason": reason_for(error),
                "claim": claim, "source": source_pdf_path}
