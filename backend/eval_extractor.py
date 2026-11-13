"""Compare claim-extractor prompts and window sizes on the same papers, without hand labels (#139).

    python eval_extractor.py data/papers/2112.01488.pdf data/papers/2205.09707.pdf --runs 2 --fresh

The prompt used to ask for "3-6 claims" per window, and the model nearly always returned 6.
Each variant asks for a different number of claims, from windows of citing paragraphs cut at
12k or 6k characters. With no hand-listed claims yet (SCRUM-70), a variant is scored against
the windows themselves:

- covered: the share of the window's citing sentences that some claim came from
- citing: the share of claims whose sentence is one of those citing sentences
- located: the share of claims whose sentence was found in the PDF
- repeats: claims _deduplicated drops, and kept: what is left after CLAIM_LIMIT
- failed: windows whose answer could not be parsed (often cut off by max_tokens)

With PHOENIX_COLLECTOR_ENDPOINT set, each variant is saved as its own Phoenix experiment on the
same papers, so the variants sit side by side.
"""

import argparse
import statistics
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path

import dspy
from app import store
from app.config import CLAIM_LIMIT, PHOENIX_COLLECTOR_ENDPOINT, VLLM_MODEL
from app.experiments import Dataset, Run, Score, dataset_name, log_experiment, source_sha
from app.metrics import current_analysis_tokens
from app.pipeline import claims
from app.tracing import setup_tracing
from dspy.utils.exceptions import AdapterParseError


@dataclass
class Variant:
    name: str
    asked: str  # {count} is replaced by the number of citing sentences in the window
    max_tokens: int
    window_chars: int = claims.CITING_CHARS


ASK = "{} from this part, with the sentence each came from"
VARIANTS = [
    Variant("3-6, 12k (before #139)", ASK.format("3-6 claims"), 2000, claims.MAX_CHARS),
    Variant("5-10, 12k", ASK.format("5-10 claims"), 4000, claims.MAX_CHARS),
    Variant("up to sentences, 12k", ASK.format("Up to {count} claims"), 4000, claims.MAX_CHARS),
    Variant("every, 12k", claims.CLAIMS_ASKED, 4000, claims.MAX_CHARS),
    Variant("every, 6k (main)", claims.CLAIMS_ASKED, 4000),
]


@dataclass
class Window:
    text: str
    cited: list[str]  # its sentences with a [bN] marker


@dataclass
class Paper:
    path: str
    references: dict
    text: str
    cited: list[str]  # every citing sentence in the paper, as the pipeline matches markers

    def windows(self, size: int) -> list[Window]:
        windows = claims._citing_windows(self.text, size)
        return [Window(text, claims._cited_sentences(text)) for text in windows]


def read_paper(path: str) -> Paper:
    """GROBID's text of the paper, with the references its [bN] markers point at."""
    tei = claims._grobid_pdf("processFulltextDocument", path, coordinates=("ref", "head"))
    claims._link_author_year_citations(tei)
    references, _ = claims._references_by_id(tei)
    text = claims._body_text(tei)
    return Paper(path, references, text, claims._cited_sentences(text))


def matched(sentence: str, cited: list[str]) -> int | None:
    """Index of the citing sentence the claim's sentence copies, matched as _markers_for does."""
    wanted = claims.MARKER.sub("", sentence).lower()
    ratios = [SequenceMatcher(None, wanted, claims.MARKER.sub("", c).lower()).ratio() for c in cited]
    if not ratios or max(ratios) < claims.SENTENCE_MATCH:
        return None
    return ratios.index(max(ratios))


def score_paper(paper: Paper, variant: Variant) -> dict:
    """Extract every window of one paper with one variant and count what came back."""
    counts = dict.fromkeys(
        ("windows", "sentences", "covered", "claims", "citing", "located", "repeats", "kept", "failed"), 0
    )
    per_window, found, seconds = [], [], 0.0
    for window in paper.windows(variant.window_chars):
        extract = claims._build_cited_claim_extractor(
            variant.asked.format(count=len(window.cited)), variant.max_tokens
        )
        started = time.perf_counter()
        try:
            extracted = extract(window.text)
        except AdapterParseError:  # an unparseable or cut-off answer loses the whole window
            counts["failed"] += 1
            extracted = []
        seconds += time.perf_counter() - started
        covered = {matched(item.sentence, window.cited) for item in extracted} - {None}
        counts["windows"] += 1
        counts["sentences"] += len(window.cited)
        counts["covered"] += len(covered)
        counts["citing"] += sum(matched(item.sentence, window.cited) is not None for item in extracted)
        per_window.append(len(extracted))
        found += [claims._cited_claim(item, paper.references, paper.cited, paper.path) for item in extracted]
    counts["claims"] = len(found)
    counts["located"] = sum(claim["source"] is not None for claim in found)
    unique = claims._deduplicated([claim for claim in found if not claims._asserts_nothing(claim["claim"])])
    counts["repeats"] = len(found) - len(unique)
    counts["kept"] = len(claims._most_checkable(unique, CLAIM_LIMIT))
    return {**counts, "seconds": seconds, "per_window": per_window}


def share(part: int, whole: int) -> str:
    return f"{part}/{whole} ({part / whole:.0%})" if whole else "0/0"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("papers", nargs="+", help="PDF paths")
    parser.add_argument("--runs", type=int, default=2, help="how many times to extract every window")
    parser.add_argument(
        "--fresh", action="store_true",
        help="skip the extraction cache, so each run asks the LLM again (needed to see run-to-run spread)",
    )
    args = parser.parse_args()
    setup_tracing()

    if args.fresh:
        # Neither read nor write: a variant's answer must not replace the one the pipeline uses.
        store.recall_cache = lambda key: None
        store.remember_cache = lambda key, data: None
        dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)
    papers = [read_paper(path) for path in args.papers]
    for paper in papers:
        windows = {size: len(paper.windows(size)) for size in (claims.MAX_CHARS, claims.CITING_CHARS)}
        print(f"{Path(paper.path).name}: {len(paper.cited)} citing sentences, windows by size {windows}")

    results: dict[str, list[Run]] = {variant.name: [] for variant in VARIANTS}
    for run in range(1, args.runs + 1):
        for variant in VARIANTS:
            tokens: dict[str, int] = {}
            current_analysis_tokens.set(tokens)
            total, per_window = {}, []
            for paper in papers:
                started = datetime.now(UTC).isoformat()
                result = score_paper(paper, variant)
                per_window += result.pop("per_window")
                results[variant.name].append(paper_run(paper, result, started, run))
                for key, value in result.items():
                    total[key] = total.get(key, 0) + value
                print(f"run {run} {variant.name:<22} {Path(paper.path).name}: {result}")
            print(
                f"run {run} {variant.name}: claims per window median {statistics.median(per_window)}"
                f" max {max(per_window)}; covered {share(total['covered'], total['sentences'])};"
                f" citing {share(total['citing'], total['claims'])};"
                f" located {share(total['located'], total['claims'])}; repeats {total['repeats']};"
                f" kept {total['kept']}; failed windows {total['failed']}/{total['windows']};"
                f" {total['seconds']:.0f}s; tokens in {tokens.get('extract_prompt', 0)}"
                f" out {tokens.get('extract_completion', 0)}"
            )

    if PHOENIX_COLLECTOR_ENDPOINT:
        sha = source_sha(claims)
        for variant in VARIANTS:
            experiment_id = log_experiment(
                papers_dataset(papers),
                results[variant.name],
                name=f"{VLLM_MODEL} extractor {variant.name} {sha}",
                description=f"eval_extractor.py, {len(papers)} papers, {args.runs} runs, fresh={args.fresh}",
                metadata={"model": VLLM_MODEL, "claims_py_sha256": sha, **asdict(variant)},
            )
            print(f"Phoenix experiment ({variant.name}) {experiment_id}")


def paper_input(paper: Paper) -> dict:
    """A paper's dataset input."""
    return {"paper": Path(paper.path).name}


def papers_dataset(papers: list[Paper]) -> Dataset:
    """The papers as a Phoenix dataset, with how many citing sentences each has."""
    inputs = [paper_input(paper) for paper in papers]
    outputs = [{"citing_sentences": len(paper.cited)} for paper in papers]
    return Dataset(
        name=dataset_name("extractor-papers", inputs + outputs),
        description="Papers the claim extractor runs on; scored against their own citing sentences.",
        inputs=inputs,
        outputs=outputs,
        metadata=[{} for _ in papers],
        splits=[None] * len(papers),
    )


def paper_run(paper: Paper, counts: dict, started: str, repetition: int) -> Run:
    """One paper's counts for one variant in one run, with the shares as scores."""
    shares = {
        "covered": ("covered", "sentences"),
        "citing": ("citing", "claims"),
        "located": ("located", "claims"),
        "failed": ("failed", "windows"),
    }
    scores = [
        Score(name=name, score=counts[part] / counts[whole])
        for name, (part, whole) in shares.items()
        if counts[whole]
    ]
    output = {**counts, "seconds": round(counts["seconds"], 1)}
    ended = datetime.now(UTC).isoformat()
    return Run(paper_input(paper), output, started, ended, scores=scores, repetition=repetition)


if __name__ == "__main__":
    main()
