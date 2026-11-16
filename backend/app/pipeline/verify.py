"""Verify a claim against the source it cites.

The cited PDF is indexed (ColBERT service), passages are retrieved with the claim as the
query, and the LLM judges whether they support it: supports / refutes / insufficient.
Visual evidence (ColPali) is optional and skipped when that service is down.
"""

import hashlib
import logging
import re
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from app import store
from app.clients import retrieval
from app.config import FIGURE_WAIT, PARALLEL_SOURCES, VISUAL_EVIDENCE, VLLM_MODEL
from app.metrics import record_llm_usage

logger = logging.getLogger(__name__)

EVIDENCE_COUNT = 4
PAGE_COUNT = 2
LABELS = ("supports", "refutes", "insufficient")
CITED_MARK = "[cited]"  # app.author.logic.cited_text puts it where the citation stands
OTHER_MARK = "[other]"  # judged_text puts it where other works are cited

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


def _crops(source: Path) -> list[dict]:
    """The cited paper's figure and table crops, as the manifest describes them."""
    from app.pipeline.figures import paper_media

    media = paper_media(source.as_posix())
    if media["status"] != "ok":
        return []
    return [item for item in media.get("figures", []) + media.get("tables", []) if item.get("image")]


def _index_visually(source: Path):
    """Put the cited paper's figure and table crops in the vision index, or its pages when it
    has none. A crop beats a rendered page: it carries a name and a caption to quote."""
    crops = _crops(source)
    if crops:
        retrieval.colpali_add_figures(source.name, source.stem, crops)
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

    With VISUAL_EVIDENCE on (off by default, #446), the figures go into ColPali in the
    background, started at the same time as the text. By default this waits for them too,
    because a figure caption can decide a verdict: without them, one verdict in 15 went from
    supports to refutes (#163). With FIGURE_WAIT set to a
    number, it waits at most that many seconds after they started, then returns without them,
    and check_prepared searches the figures only once they are indexed. `wait_for_figures`
    always waits, for a single check that has nothing else to do.

    Returns the error if the text index failed.
    """
    from app.pipeline.rag import add_paper

    failure = None
    with _lock_for(source.name):
        figures = _visual_indexing.get(source.name)
        # With VISUAL_EVIDENCE off nothing is submitted, so _figures_ready stays false and
        # check_prepared never searches ColPali.
        if figures is None and VISUAL_EVIDENCE:
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
    if failure is None and figures is not None:
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
        return _with_regions(found, source), body.get("model", "")
    except Exception:
        return [], ""


def _with_regions(hits: list[dict], source: Path) -> list[dict]:
    """Each crop hit with its kind and its box on the page, from this worker's manifest.

    The ColPali service returns kind "figure" for every crop, tables too, and keeps no box.
    Its image path and the worker's share only the file name, so the name finds the crop
    here. Page hits, and crops missing from the manifest, are returned as they are.
    """
    if not any(hit.get("image") for hit in hits):
        return hits  # page hits only: no manifest to read
    crops = {Path(crop["image"]).name: crop for crop in _crops(source)}
    return [_with_region(hit, crops) for hit in hits]


def _with_region(hit: dict, crops: dict[str, dict]) -> dict:
    """The hit with its crop's kind and region, or the hit itself when no crop matches."""
    crop = crops.get(Path(hit["image"]).name) if hit.get("image") else None
    if crop is None:
        return hit
    return {**hit, "kind": crop["kind"], "region": crop.get("region")}


def _captions(hits: list[dict]) -> list[str]:
    """Figure and table captions as evidence the judge can read and quote."""
    return [f"{hit['label']}: {hit['caption']}" for hit in hits if hit.get("caption")]


def _figure_crop(hits: list[dict], source: Path) -> Path | None:
    """This worker's copy of the first figure or table hit, for the judge to look at, or None.

    A hit's image is the crop's path on the ColPali service. Docling wrote the same crop
    here under the same file name, so the name finds it. Page hits have no image.
    """
    from app.pipeline.figures import figures_dir

    for hit in hits:
        if hit.get("image"):
            crop = figures_dir(source) / Path(hit["image"]).name
            return crop if crop.is_file() else None
    return None


def _build_judge():
    import dspy
    from dspy.utils.exceptions import AdapterParseError

    from app.llm import dspy_lm

    # 1500, not 1000: the cited_for field made some answers run past 1000 and fail to parse.
    language_model = dspy_lm(temperature=0.0, max_tokens=1500)

    class JudgeClaim(dspy.Signature):
        """Decide whether the cited paper's passages support the claim made about it.
        Answer "supports" only if a passage states it, "refutes" if a passage contradicts it,
        and "insufficient" if the passages do not settle the question.
        Before answering "supports", check each number, each comparison (more or less, higher
        or lower, easy or hard), each direction (from A to B) and what each value belongs to:
        the row and column of a table, or the item that "respectively" pairs it with. Also
        check which thing is on each side of a relation: "A is left of B" and "B is left of
        A" say opposite things, as do "A is derived from B" and "B is derived from A". If any
        of them differs from the passage, the passage contradicts the claim. A claim that
        leaves out details the passage gives is not contradicted by that. The claim may use
        different words than the passage; judge whether it means the same thing."""

        claim: str = dspy.InputField(desc="A claim that cites the source paper")
        evidence: list[str] = dspy.InputField(desc="Passages from the cited paper")
        # Copied before the reasoning starts: without it the judge restated "the cat is below
        # the keyboard" the wrong way round and matched that to the passage (#517).
        claim_says: str = dspy.OutputField(desc="The claim's words, copied in the claim's own order")
        reasoning: str = dspy.OutputField(desc="Compare the claim with the passages, step by step")
        verdict: str = dspy.OutputField(desc="supports, refutes, or insufficient")
        quote: str = dspy.OutputField(desc="The sentence from the evidence that decides it, or empty")

    class JudgeCitedClaim(dspy.Signature):
        """Decide whether the cited paper's passages support what the claim credits to it.
        First decide what the citation is for. "[cited]" marks where the citation stands; it
        usually covers the words just before it. When the claim describes the citing authors'
        own work (their setup, values, data or results) and cites a method, tool, model or
        dataset they used, the citation is only for that method, tool, model or dataset. The
        authors' own settings are not claims about the cited paper, and settings that differ
        from the cited paper's do not count against it. "[other]" marks citations of other
        works: the words they cover are for those works to support and never count against
        this paper.
        Then answer "supports" if the passages state everything the citation is for,
        "refutes" if a passage contradicts it, and "insufficient" if any part of it is not
        in the passages."""

        claim: str = dspy.InputField(desc="A sentence that cites the source paper")
        evidence: list[str] = dspy.InputField(desc="Passages from the cited paper")
        cited_for: str = dspy.OutputField(
            desc="What the claim credits to the cited paper, in one short sentence"
        )
        verdict: str = dspy.OutputField(desc="supports, refutes, or insufficient")
        quote: str = dspy.OutputField(desc="The sentence from the evidence that decides it, or empty")
        reasoning: str = dspy.OutputField(desc="One sentence explaining the verdict")

    class JudgeFigure(dspy.Signature):
        """Decide whether a figure from the cited paper supports the claim made about it.
        Answer "supports" only if the figure shows it, "refutes" if the figure contradicts it,
        and "insufficient" if the figure does not settle the question.
        Before answering "supports", read each number off the figure and check each
        comparison (more or less, higher or lower), each direction and which series, axis or
        label each value belongs to. If any of them differs from the figure, the figure
        contradicts the claim. A claim that leaves out details the figure gives is not
        contradicted by that. The claim may use different words than the figure; judge
        whether it means the same thing."""

        claim: str = dspy.InputField(desc="A claim that cites the source paper")
        # Table crops come in here too. Naming tables in this prompt scored the same on
        # table-claims.jsonl (32 and 33 of 36, both prompts) and was reverted (#564).
        figure: dspy.Image = dspy.InputField(desc="A figure from the cited paper")
        evidence: list[str] = dspy.InputField(desc="The figure's caption, or empty")
        verdict: str = dspy.OutputField(desc="supports, refutes, or insufficient")
        quote: str = dspy.OutputField(desc="The value or label in the figure that decides it, or empty")
        reasoning: str = dspy.OutputField(desc="One sentence explaining the verdict")

    # Only the Author check marks the citation (#437). A paper analysis uses the second judge
    # only to recheck a refutes (check_prepared, #672).
    signatures = {"judge": JudgeClaim, "judge-cited": JudgeCitedClaim, "judge-figure": JudgeFigure}
    # Predict for "judge": ChainOfThought puts its reasoning before every other output, and
    # claim_says only helps if it comes first.
    judges = {
        "judge": dspy.Predict(JudgeClaim),
        "judge-cited": dspy.ChainOfThought(JudgeCitedClaim),
        "judge-figure": dspy.ChainOfThought(JudgeFigure),
    }

    def ask(name: str, inputs: dict) -> dspy.Prediction:
        with dspy.context(lm=language_model, adapter=dspy.JSONAdapter()):
            try:
                return judges[name](**inputs)
            except AdapterParseError:
                # Some replies are not JSON: about 1 in 10 with a figure, and 26 of 819 calls
                # in the 13 Nov benchmark. Ask once more, past dspy's cache: at temperature 0
                # it would hand back the same reply.
                with dspy.context(lm=language_model.copy(cache=False)):
                    return judges[name](**inputs)

    def run(claim: str, evidence: list[str], figure: Path | None = None) -> dict:
        name = "judge-cited" if CITED_MARK in claim else "judge-figure" if figure else "judge"
        # The instructions are in the key, so a reworded prompt never reads the old prompt's answers.
        instructions = signatures[name].instructions
        parts = [name, VLLM_MODEL, instructions, claim, "\x00".join(evidence)]
        if figure:
            parts.append(hashlib.sha256(figure.read_bytes()).hexdigest())
        key = store.cache_key(*parts)
        if (cached := store.recall_cache(key)) is not None:
            return cached
        inputs = {"claim": claim, "evidence": evidence}
        if figure:
            inputs["figure"] = dspy.Image.from_path(figure.as_posix())
        with dspy.track_usage() as usage:
            prediction = ask(name, inputs)
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
    """Why a claim went unchecked, based on the retrieval result rather than citation shape."""
    return verdict.get("reason", "failed")


def checked_citations(claim: dict) -> list[tuple[dict, str]]:
    """Each citation of `claim` to check, with the key it is looked up by. The gateway and the
    graph both plan their jobs with this. Left out: citations with nothing to look up by, and
    the ones that only name something the paper uses (`named`)."""
    from app.pipeline.sources import lookup_key

    named = set(claim.get("named", []))
    return [
        (citation, source)
        for citation in claim["citations"]
        if (source := lookup_key(citation)) and source not in named
    ]


def judged_text(claim: dict, citation: dict) -> str:
    """What the judge reads for one citation of `claim`: the paper's sentence with "[cited]"
    where this citation stands, so it checks only what the citation is for (#672). Without
    it, "Existing language models are generally implemented with Transformers [b37]" was
    judged against the whole 2017 Transformer paper and refuted. The claim itself when the
    sentence does not carry the citation's marker."""
    ref = citation.get("ref")
    sentence = claim.get("sentence") or ""
    if not ref or f"[{ref}]" not in sentence:
        return claim["claim"]
    # Other works' markers stay as "[other]" so the judge does not credit their part to this one.
    marked = re.sub(r"(?:\s*\[b\d+\])+", f" {OTHER_MARK}", sentence.replace(f"[{ref}]", f" {CITED_MARK}"))
    return re.sub(r"\s+", " ", marked).strip()


def cites_others(claim: dict, citation: dict) -> bool:
    """Whether the sentence that carries this citation's marker cites other works too.

    Then each work is cited for only part of the sentence, as in "8.3B in Megatron-LM and 17B
    in Turing-NLG" (#943), and check_prepared asks again about this citation's part.
    """
    ref = citation.get("ref")
    markers = set(re.findall(r"\[(b\d+)\]", claim.get("sentence") or ""))
    return bool(ref) and ref in markers and len(markers) > 1


def fold_check(claim: dict, source: str, citation: dict, verdict: dict) -> None:
    """Add the result of one check to its claim. _run_queued calls it after each check.

    A verdict goes under `verdicts`, keyed by the name the source was looked up by, so the
    card can show it next to its citation. A failure goes under `unchecked` with a reason,
    because a claim we could not check must not look like one nobody tried.
    """
    if verdict["status"] == "ok":
        claim.setdefault("verdicts", []).append({**verdict, "cited": source})
    else:
        row = {"source": source, "reason": unchecked_reason(verdict, citation),
               "message": verdict.get("message", "")}
        if verdict.get("source_outcome"):
            row["source_outcome"] = verdict["source_outcome"]
        claim.setdefault("unchecked", []).append(row)


def verify_claim(claim: str, source_pdf_path: str) -> dict:
    """Check whether a cited paper actually supports a claim made about it.

    Args:
        claim: the claim to check. For example "ColBERT reduces index size by 10x".
        source_pdf_path: the cited paper. A local PDF path, or a DOI, arXiv ID, PMID,
            or URL to download. For example "data/papers/colbertv2.pdf" or "2112.01488".

    Returns:
        {"status": "ok", "verdict", "quote", "reasoning", "evidence", ...}, or {"status":
        "error", "message", "reason", "retryable"}. Retry only when `retryable` is true.
    """
    # One check on its own has nothing else to do while the figures are read, so it waits for
    # them and can show a matching figure.
    prepared = prepare_source(source_pdf_path, wait_for_figures=True)
    if prepared["status"] == "error":
        return {**prepared, "claim": claim, "source": source_pdf_path}
    return check_prepared(
        claim, source_pdf_path, Path(prepared["path"]), source_outcome=prepared.get("source_outcome")
    )


def prepare_source(
    source_pdf_path: str, wait_for_figures: bool = False, expected: dict | None = None,
) -> dict:
    """Get a cited paper ready: download it if needed and index it once.

    Returns {"status": "ok", "path": ...} or an error with a reason and `retryable`. Safe to
    call many times for the same paper: the work is done only once. Returns once the text is indexed;
    the figures follow in the background unless `wait_for_figures` is set.
    """
    try:
        from app.pipeline.sources import local_pdf_with_resolution

        path, source_outcome = local_pdf_with_resolution(source_pdf_path, expected)
        source = Path(path)
        if failure := _index_once(source, wait_for_figures):
            return {
                **failure,
                "source_outcome": failure.get("source_outcome") or {
                    "source_kind": "paper", "outcome": "indexing-failed",
                    "retryable": bool(failure.get("retryable")),
                    "attempts": source_outcome.get("attempts", []),
                },
            }
        return {"status": "ok", "path": source.as_posix(), "source_outcome": source_outcome}
    except Exception as error:
        from app.pipeline.sources import tool_error

        return tool_error(error)


def judge_passages(claim: str, passages: list[str]) -> dict:
    """The judge's verdict on a claim against passages someone else chose, with no retrieval.

    The labeler's review uses it on the passages a person marked relevant. Returns `verdict`
    (one of LABELS), `quote` and `reasoning`, cached like every judge call.
    """
    global _judge
    if _judge is None:
        _judge = _build_judge()
    return _judge(claim, passages)


def check_prepared(
    claim: str, source_pdf_path: str, source: Path, judged: str = "",
    other_citations: bool = False, source_outcome: dict | None = None,
) -> dict:
    """Judge a claim against a paper that prepare_source already made ready.

    `judged` is the claim's sentence with the citation marked (judged_text). It is read
    only to recheck a "refutes", the costly verdict, or an "insufficient" when the sentence
    cites other works too (`other_citations`, from cites_others). Retrieval and the first
    judge keep the claim.
    """
    global _judge
    try:
        from app.pipeline.sources import known_index, version_of

        source_details = {"source_outcome": source_outcome} if source_outcome else {}

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
        version = version_of(source)  # {} unless the PDF came from arXiv (#424)
        if not passages:
            return {"status": "ok", "claim": claim, "source": source.name,
                    "verdict": "insufficient", "quote": "", "reasoning": "no passages retrieved",
                    "verdict_from": "none", "judged_figure": "",
                    "evidence": [], "pages": pages, "page_model": page_model, **source_details,
                    "indexed_in": indexed_in, **version}

        if _judge is None:
            _judge = _build_judge()
        verdict = _judge(claim, passages)
        # Which judge call gave the verdict, so an eval can tell a text flip from a figure one (#514).
        verdict_from, judged_figure = "text", ""
        # A wrong "refutes" accuses the authors, so ask again knowing what the citation is for.
        # "Existing language models are generally Transformers" was refuted by the 2017
        # Transformer paper calling RNNs established (#672). Judging every claim this way
        # turned supported claims insufficient on the decisive rows, so only a refutes is
        # rechecked, and the second judge wins when it disagrees.
        if verdict["verdict"] == "refutes" and judged and judged != claim:
            recheck = _judge(judged, passages)
            if recheck["verdict"] != "refutes":
                verdict, verdict_from = recheck, "cited"
        # A sentence citing several works credits each with only its part, but the first judge
        # wants the whole claim from every one: "8.3B in Megatron-LM and 17B in Turing-NLG" was
        # insufficient against the Turing-NLG page, which says 17B (#943). Ask again about this
        # citation's part, and take only a supports: on 40 such checks the second judge gave
        # 11 supports and 1 refutes, and that refutes was wrong.
        elif verdict["verdict"] == "insufficient" and other_citations and judged and judged != claim:
            recheck = _judge(judged, passages)
            if recheck["verdict"] == "supports":
                verdict, verdict_from = recheck, "cited"
        # Numbers read off a chart are often in no passage, so a claim the text cannot settle
        # is asked again about the top figure, with only its caption. With the passages next
        # to a figure, the judge read the text worse, and turned text it had found
        # insufficient into a verdict (#501). Pages are empty with VISUAL_EVIDENCE off, and
        # the Author check's judge has no figure input.
        # A refutes is asked again too: the text refuted 4 of the 5 figure claims the chart
        # supports (SCRUM-80). Only a figure supports is taken. A figure refutes from an
        # insufficient text verdict came from a table that left a model out (#734).
        figure = _figure_crop(pages, source)
        if verdict["verdict"] in ("insufficient", "refutes") and figure and CITED_MARK not in claim:
            from dspy.utils.exceptions import AdapterParseError

            caption = _captions([hit for hit in pages if hit.get("image")][:1])
            try:
                seen = _judge(claim, caption, figure)
            except AdapterParseError:
                # The figure judge already had its retry (ask in _build_judge). Its verdict counts
                # only when it is supports, so a reply that is still not JSON leaves the text verdict.
                seen = {"verdict": "unparsed"}
            if seen["verdict"] == "supports":
                verdict, verdict_from, judged_figure = seen, "figure", figure.name
        return {"status": "ok", "claim": claim, "source": source.name,
                **verdict, "verdict_from": verdict_from, "judged_figure": judged_figure,
                "evidence": evidence, "pages": pages, **source_details,
                "page_model": page_model, "indexed_in": indexed_in, **version}
    except Exception as error:
        from app.pipeline.sources import tool_error

        # Why it failed, not only that it did: the reader must tell "the source does not
        # support this" from "we could not read the source".
        failure = tool_error(error)
        if source_outcome:
            failure["source_outcome"] = {
                "source_kind": source_outcome.get("source_kind", "paper"),
                "outcome": "retrieval-failed",
                "retryable": failure.get("retryable", False),
                "attempts": [
                    *(source_outcome.get("attempts") or []),
                    {
                        "provider": "retrieval", "result": "failed",
                        "retryable": failure.get("retryable", False),
                    },
                ],
            }
        return {**failure, "claim": claim, "source": source_pdf_path}
