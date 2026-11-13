"""Check that the checks production found decisive stay decisive (CONSTRAINTS.md, verdict quality).

    python eval_decisive.py ../docs/eval/decisive-checks.csv --runs 3 --fresh

Each row is a claim, the cited work it was checked against, and the expected verdict
("supports", "refutes" or "insufficient"). Most are the verdicts production gave;
CONSTRAINTS.md lists the rows corrected by hand. Every row is checked with the pipeline's own
prepare_source and check_prepared, so this scores retrieval and the judge together. It needs what an analysis
needs (ColBERT, the LLM), so run it where the worker runs. The gate compares a PR's rows with
main's, run the same day (CONSTRAINTS.md): the hosted model changes without notice, so the
model id is printed first. --min-kept still exits 1 when a run keeps fewer rows.
"""

import argparse
import csv
import sys
from datetime import UTC, datetime
from pathlib import Path

import dspy
import requests
from app import store
from app.config import PHOENIX_COLLECTOR_ENDPOINT, VLLM_API_KEY, VLLM_MODEL, VLLM_URL
from app.experiments import Dataset, Run, Score, dataset_name, log_experiment
from app.pipeline import verify
from app.tracing import setup_tracing
from eval_verdicts import settings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "cases", type=Path, help="CSV with paper, claim, source, expected, and the claim's sentence and ref"
    )
    parser.add_argument("--runs", type=int, default=3, help="how many times to judge every row")
    parser.add_argument(
        "--fresh", action="store_true",
        help="skip the answer cache, so each run asks the judge again (needed to see run-to-run spread)",
    )
    parser.add_argument("--min-kept", type=int, default=0, help="fail when a run keeps fewer rows")
    args = parser.parse_args()
    setup_tracing()

    model = gateway_model()
    print("gateway model:", model)
    with args.cases.open(newline="", encoding="utf-8") as file:
        cases = list(csv.DictReader(file))
    if args.fresh:
        # Neither read nor write: a fresh answer must not replace the one the pipeline uses.
        store.recall_cache = lambda key: None
        store.remember_cache = lambda key, data: None
        # dspy caches LM responses too, in memory and on disk; without this runs 2+ replay run 1.
        dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)

    paths = {case["source"]: verify.prepare_source(case["source"]) for case in cases}
    kept_per_run = []
    results = []
    for run in range(1, args.runs + 1):
        kept = 0
        for number, case in enumerate(cases, 1):
            started = datetime.now(UTC).isoformat()
            prepared = paths[case["source"]]
            if prepared["status"] == "error":
                verdict = "error: " + prepared.get("reason", "failed")
            else:
                # The judge reads what an analysis would send it: the sentence with the citation
                # marked, when the row carries them.
                citation = {"ref": case.get("ref")}
                judged = verify.judged_text(case, citation)
                result = verify.check_prepared(
                    case["claim"], case["source"], Path(prepared["path"]), judged,
                    verify.cites_others(case, citation),
                )
                if result["status"] == "ok":
                    verdict = result.get("verdict", "error")
                else:
                    # With the reason, so a failed call is not read as a changed verdict.
                    verdict = f"error: {result.get('reason', '')} {result.get('message', '')[:120]}"
            kept += verdict == case["expected"]
            results.append(row_run(number, case, verdict, started, run))
            print(f"run {run} {number}/{len(cases)} {case['expected']:>8} -> {verdict:<12} {case['source']}")
        kept_per_run.append(kept)
        print(f"run {run}: {kept}/{len(cases)} kept")

    print(f"kept per run: {kept_per_run}; minimum {min(kept_per_run)}, required {args.min_kept}")
    if PHOENIX_COLLECTOR_ENDPOINT:
        experiment_id = log_experiment(
            cases_dataset(cases),
            results,
            name=f"{VLLM_MODEL} decisive {settings('retrieved')['verify_py_sha256']}",
            description=f"eval_decisive.py {args.cases.name}, {args.runs} runs, fresh={args.fresh}",
            metadata={**settings("retrieved"), "gateway_model": model, "kept_per_run": kept_per_run},
        )
        print(f"Phoenix experiment {experiment_id}")
    sys.exit(1 if min(kept_per_run) < args.min_kept else 0)


def row_input(number: int, case: dict) -> dict:
    """A row's dataset input. The row number keeps two rows with the same claim and source apart."""
    return {"row": str(number), "claim": case["claim"], "source": case["source"]}


def row_run(number: int, case: dict, verdict: str, started: str, repetition: int) -> Run:
    """One row's result in one run, scored `kept` when the verdict is the expected one."""
    example, ended = row_input(number, case), datetime.now(UTC).isoformat()
    if verdict.startswith("error"):
        return Run(example, {"verdict": "error"}, started, ended, error=verdict, repetition=repetition)
    is_kept = verdict == case["expected"]
    kept = Score(name="kept", score=float(is_kept), label="kept" if is_kept else "changed")
    return Run(example, {"verdict": verdict}, started, ended, scores=[kept], repetition=repetition)


def cases_dataset(cases: list[dict]) -> Dataset:
    """The gate's rows as a Phoenix dataset, with each row's expected verdict."""
    inputs = [row_input(number, case) for number, case in enumerate(cases, 1)]
    outputs = [{"expected": case["expected"]} for case in cases]
    return Dataset(
        name=dataset_name("decisive-checks", inputs + outputs),
        description="Checks production found decisive, with the expected verdict (eval_decisive.py).",
        inputs=inputs,
        outputs=outputs,
        metadata=[{"paper": case.get("paper", "")} for case in cases],
        splits=[None] * len(cases),
    )


def gateway_model() -> str:
    """The model behind VLLM_MODEL as the gateway reports it, so a run can be dated (SCRUM-376).

    A LiteLLM gateway lists the upstream model and a deployment id under /model/info. Plain vLLM
    has no such route, so the answer then only names VLLM_MODEL.
    """
    headers = {"Authorization": f"Bearer {VLLM_API_KEY}"}
    try:
        reply = requests.get(f"{VLLM_URL}/model/info", headers=headers, timeout=10)
        entries = reply.json().get("data", []) if reply.ok else []
    except (requests.RequestException, ValueError) as error:
        return f"{VLLM_MODEL} (no model info from {VLLM_URL}: {error})"
    for entry in entries:
        if entry.get("model_name") == VLLM_MODEL:
            info = entry.get("model_info", {})
            return f"{VLLM_MODEL} = {info.get('key')} (deployment id {info.get('id')})"
    return f"{VLLM_MODEL} (not listed by {VLLM_URL}/model/info)"


if __name__ == "__main__":
    main()
