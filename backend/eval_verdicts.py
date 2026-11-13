"""Score the judge against the labelers on the labeled claim/reference pairs (#423).

    python eval_verdicts.py labels.csv --split test --out verdicts.csv

`labels.csv` is the Labeler page's "Download labels CSV", with the `split` column filled by
split_dataset.py. Each pair is checked with the same verify_claim the pipeline runs, against the
reference PDF in PAPERS_DIR, so this scores retrieval and the judge together. It needs what an
analysis needs (ColBERT, the LLM), so run it where the worker runs. The judge's answers are
cached, so a second run with the same settings gives the same verdicts.

With `--passages labeled` the judge reads the passages the labelers marked relevant instead, with
no retrieval, so the two runs side by side tell a retrieval miss from a judge miss. Besides the
judge's scores, the report has each verdict against each 1-4 level (`levels`), how often a
labeled passage was among the ones retrieved (`retrieval`), and how often the judge's quote is in
the passages it was given (`quote_grounding`).

With `--claims claims.csv` (the Labeler's claims tab export) each pair is judged the way an analysis
judges it: the judge also gets the claim's sentence with this citation marked, and whether the
sentence cites other works, so check_prepared rechecks as it does in _run_queued (#672, #953).
Without it the judge sees only the claim, which scored recall 0.47 against 0.56 with sentences on
the 13 Nov val split (#962).

With PHOENIX_COLLECTOR_ENDPOINT set, the run is also an experiment in Phoenix: every labeled pair is a
dataset example (its split as a Phoenix split, its topic in the metadata), each verdict is a run,
and each run gets a `correct` evaluation. Runs on the same labels share one dataset, so their
experiments can be compared side by side. The report printed here also scores each topic.
"""

import argparse
import csv
import hashlib
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from app.config import PAPERS_DIR, PHOENIX_COLLECTOR_ENDPOINT, VLLM_MODEL
from app.evaluation import Pair, human_agreement, judge_scores, level_confusion, pairs_from_labels
from app.experiments import Dataset, Run, Score, log_experiment
from app.pipeline import claims, verify
from app.pipeline.audit import _grounded  # the analysis audit's test of "is this text in the evidence"
from app.pipeline.sources import lookup_key
from app.tracing import setup_tracing


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("labels", type=Path, help="the labels CSV export")
    parser.add_argument("--split", default="test", help='which split to score ("" for all rows)')
    parser.add_argument("--out", type=Path, default=Path("verdicts.csv"), help="per-pair results")
    parser.add_argument(
        "--passages",
        choices=["retrieved", "labeled"],
        default="retrieved",
        help="judge on the passages retrieval finds, or on the ones the labelers marked relevant",
    )
    parser.add_argument(
        "--claims", type=Path, help="the claims tab export, to judge with each claim's sentence"
    )
    args = parser.parse_args()
    setup_tracing()

    with args.labels.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    # The topic column comes from the labels export; an older export has none.
    topics = {(row["claim_id"], row["reference_id"]): row.get("topic", "") for row in rows}
    every_pair = pairs_from_labels(rows)
    pairs = [p for p in every_pair if not args.split or p.split == args.split]
    scored = [p for p in pairs if p.gold() is not None]
    print(
        f"{len(pairs)} pairs in split {args.split!r}; {len(pairs) - len(scored)} left out on a tie",
        file=sys.stderr,
    )

    retrieving = args.passages == "retrieved"
    sentences = judged_sentences(args.claims, scored) if args.claims and retrieving else {}
    results = []
    for number, pair in enumerate(scored, 1):
        started = datetime.now(UTC).isoformat()
        sentence = sentences.get((pair.claim_id, pair.reference_id))
        result = check(pair, args.passages, sentence)
        verdict = result.get("verdict") if result.get("status") == "ok" else "error"
        verdict_from = result.get("verdict_from", "none") if verdict != "error" else "none"
        # verify.py can give an empty message, and an errored pair must still read as one.
        error = (result.get("message") or "no verdict and no message") if verdict == "error" else None
        results.append(
            {
                "claim": pair.claim,
                "claim_id": pair.claim_id,
                "reference_id": pair.reference_id,
                "gold": pair.gold(),
                "verdict": verdict,
                "verdict_from": verdict_from,
                "topic": topics[pair.claim_id, pair.reference_id],
                "levels": pair.levels,
                "marked": bool(sentence) and sentence[0] != pair.claim,
                "labeled_retrieved": labeled_retrieved(pair, result) if retrieving else None,
                "quote_grounded": quote_grounded(result) if verdict != "error" else None,
                "error": error,
                "started": started,
                "ended": datetime.now(UTC).isoformat(),
            }
        )
        note = f" ({error.splitlines()[0]})" if error else ""  # the CSV keeps the whole message
        print(f"{number}/{len(scored)} {pair.claim_id} {verdict}{note}", file=sys.stderr)

    with args.out.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "claim_id",
                "reference_id",
                "topic",
                "gold",
                "verdict",
                "verdict_from",
                "marked",
                "labeled_retrieved",
                "quote_grounded",
                "error",
            ],
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(results)

    judged = [r for r in results if r["verdict"] != "error"]
    report = {
        "settings": settings(args.passages),
        # How many pairs got their sentence with the citation marked; the rest kept the claim.
        "marked": sum(r["marked"] for r in results),
        "errors": len(results) - len(judged),
        "judge": judge_scores([r["gold"] for r in judged], [r["verdict"] == "supports" for r in judged]),
        # The text judge and the figure judge are scored apart (SCRUM-80).
        "judge_by_source": {
            source: judge_scores(
                [r["gold"] for r in judged if r["verdict_from"] == source],
                [r["verdict"] == "supports" for r in judged if r["verdict_from"] == source],
            )
            for source in sorted({r["verdict_from"] for r in judged})
        },
        "judge_by_topic": {
            topic or "(none)": judge_scores(
                [r["gold"] for r in judged if r["topic"] == topic],
                [r["verdict"] == "supports" for r in judged if r["topic"] == topic],
            )
            for topic in sorted({r["topic"] for r in judged})
        },
        "levels": level_confusion([r["levels"] for r in judged], [r["verdict"] for r in judged]),
        f"retrieval_recall_at_{verify.EVIDENCE_COUNT}": share([r["labeled_retrieved"] for r in results]),
        "quote_grounding": share([r["quote_grounded"] for r in judged]),
        "humans": human_agreement(pairs),
    }
    print(json.dumps(report, indent=2))
    if PHOENIX_COLLECTOR_ENDPOINT:
        record_experiment(every_pair, topics, results, args.split, report)


def check(pair: Pair, passages: str, sentence: tuple[str, bool] | None = None) -> dict:
    """The judge's result on one pair, with the passages it read under `evidence`. `sentence` is
    (judged_text, cites_others) from judged_sentences; without it the judge sees the claim only."""
    if passages == "retrieved":
        source = (PAPERS_DIR / f"{pair.reference_id}.pdf").as_posix()
        if sentence is None:
            return verify.verify_claim(pair.claim, source)
        # verify_claim's two steps, with the sentence passed on as _run_queued passes it.
        prepared = verify.prepare_source(source, wait_for_figures=True)
        if prepared["status"] == "error":
            return {**prepared, "claim": pair.claim, "source": source}
        return verify.check_prepared(pair.claim, source, Path(prepared["path"]), *sentence)
    if not pair.spans:
        return {"status": "error", "message": "no passage was marked relevant"}
    try:
        verdict = verify.judge_passages(pair.claim, pair.spans)
    except Exception as error:  # as verify_claim does, one failed call becomes an error row
        print(f"{pair.claim_id}: {error!r}", file=sys.stderr)
        return {"status": "error", "message": str(error)}
    return {"status": "ok", **verdict, "evidence": [{"text": span} for span in pair.spans]}


def judged_sentences(claims_csv: Path, pairs: list[Pair]) -> dict[tuple[str, str], tuple[str, bool]]:
    """What _run_queued gives the judge besides the claim, for each pair: the claim's sentence
    with this citation marked (judged_text), and whether it cites other works (cites_others).

    The labels export has neither. The sentence comes from the claims tab, and the citation's
    "[b12]" from GROBID on the citing paper, matched to the reference by the file name its PDF was
    saved under. A pair that cannot be matched gets the claim back, as without --claims.
    """
    with claims_csv.open(newline="", encoding="utf-8") as file:
        sentences = {row["claim_id"]: row["sentence"] for row in csv.DictReader(file)}
    ids_by_paper: dict[str, dict[str, str]] = {}
    judged = {}
    for pair in pairs:
        paper_id = pair.claim_id.split("#")[0]
        if paper_id not in ids_by_paper:
            ids_by_paper[paper_id] = reference_ids(paper_id)
        claim = {"claim": pair.claim, "sentence": sentences.get(pair.claim_id, "")}
        citation = {"ref": ids_by_paper[paper_id].get(_squash(pair.reference_id), "")}
        judged[pair.claim_id, pair.reference_id] = (
            verify.judged_text(claim, citation),
            verify.cites_others(claim, citation),
        )
    return judged


def reference_ids(paper_id: str) -> dict[str, str]:
    """{saved file name, squashed: GROBID id} for each reference of the citing paper."""
    try:
        references = claims.references_of((PAPERS_DIR / f"{paper_id}.pdf").as_posix())
    except Exception as error:  # one unreadable paper leaves its pairs on the claim alone
        print(f"{paper_id}: could not read its references: {error!r}", file=sys.stderr)
        return {}
    ids = {}
    for ref, citation in references.items():
        for identifier in (lookup_key(citation), citation.get("doi"), citation.get("arxiv")):
            if identifier:
                ids.setdefault(_squash(_saved_name(identifier)), ref)
    return ids


def _saved_name(identifier: str) -> str:
    """The file name prepare_source saves a cited work under (sources._fetch)."""
    return re.sub(r"[^A-Za-z0-9._-]+", "-", identifier.strip()).strip("-")[:80]


def _squash(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def labeled_retrieved(pair: Pair, result: dict) -> bool | None:
    """Was a passage a labeler marked relevant among the ones retrieval gave the judge?"""
    if not pair.spans or result.get("status") != "ok":
        return None
    retrieved = {"evidence": result.get("evidence", [])}
    return any(_grounded(span, retrieved) for span in pair.spans)


def quote_grounded(result: dict) -> bool | None:
    """Is the judge's quote in the passages or captions it was given? None with no quote."""
    quote = result.get("quote") or ""
    return _grounded(quote, result) if quote.strip() else None


def share(flags: list[bool | None]) -> dict:
    """How many pairs a yes/no applies to, and the share of them that are yes."""
    counted = [flag for flag in flags if flag is not None]
    return {"pairs": len(counted), "share": sum(counted) / len(counted) if counted else 0.0}


def settings(passages: str) -> dict:
    """What the verdicts depend on, so two runs can be compared: the model, which passages and
    how many the judge reads, and a hash of verify.py, which holds the judge's prompt."""
    source = Path(verify.__file__).read_bytes()
    return {
        "model": VLLM_MODEL,
        "passages": passages,
        "evidence_count": verify.EVIDENCE_COUNT,
        "verify_py_sha256": hashlib.sha256(source).hexdigest()[:12],
    }


# What each Phoenix run shows of a result.
RUN_OUTPUT = ("verdict", "verdict_from", "labeled_retrieved", "quote_grounded")


def record_experiment(
    pairs: list[Pair], topics: dict[tuple[str, str], str], results: list[dict], split: str, report: dict
) -> None:
    """Save this run in Phoenix as an experiment on the labeled pairs, with `correct` per pair."""
    settings = report["settings"]
    runs = [
        Run(
            input=pair_input(result),
            output={key: result[key] for key in RUN_OUTPUT},
            started=result["started"],
            ended=result["ended"],
            error=result["error"],
            scores=[] if result["verdict"] == "error" else [correct(result)],
        )
        for result in results
    ]
    experiment_id = log_experiment(
        labels_dataset(pairs, topics),
        runs,
        name=f"{settings['model']} verify {settings['verify_py_sha256']} {settings['passages']}",
        description=f"eval_verdicts.py on split {split or 'all'}",
        metadata={**settings, "split": split, "judge": report["judge"]},
        split=split,
    )
    print(f"Phoenix experiment {experiment_id}", file=sys.stderr)


def labels_dataset(pairs: list[Pair], topics: dict[tuple[str, str], str]) -> Dataset:
    """The labeled pairs as a Phoenix dataset.

    The name carries a hash of the pairs and their levels, so new labels make a new dataset and
    runs on the same labels reuse one.
    """
    keys = sorted((p.claim_id, p.reference_id, sorted(p.levels.items())) for p in pairs)
    return Dataset(
        name="labeler-pairs-" + hashlib.sha256(json.dumps(keys).encode()).hexdigest()[:10],
        description="Labeled claim/reference pairs from the Labeler export; gold is the majority.",
        inputs=[{"claim": p.claim, "claim_id": p.claim_id, "reference_id": p.reference_id} for p in pairs],
        outputs=[{"supported": p.gold(), "levels": p.levels} for p in pairs],
        metadata=[{"paper_id": p.paper_id, "topic": topics[p.claim_id, p.reference_id]} for p in pairs],
        splits=[p.split or None for p in pairs],
    )


def pair_input(result: dict) -> dict:
    """The dataset input of the pair this result is for, as labels_dataset wrote it."""
    return {"claim": result["claim"], "claim_id": result["claim_id"], "reference_id": result["reference_id"]}


def correct(result: dict) -> Score:
    """Did the judge's supports / not-supports match the labelers' majority?"""
    is_correct = (result["verdict"] == "supports") == result["gold"]
    return Score(
        name="correct",
        score=float(is_correct),
        label="correct" if is_correct else "wrong",
        metadata={"topic": result["topic"]},
    )


if __name__ == "__main__":
    main()
