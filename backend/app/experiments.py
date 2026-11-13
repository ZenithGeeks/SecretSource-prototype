"""Save an eval run in Phoenix as an experiment, so runs on the same examples sit side by side.

An eval script describes its examples as a Dataset and its results as one Run per example, then
calls log_experiment. The dataset is uploaded on first use and found by name after that. It uses
Phoenix's REST API (/v1/datasets, /v1/experiments, /v1/experiment_evaluations), so the scripts
need no Phoenix client.
"""

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType

import requests

from app.config import PHOENIX_COLLECTOR_ENDPOINT


@dataclass
class Dataset:
    """The examples an eval runs on. Give a new name when the examples change."""

    name: str
    description: str
    inputs: list[dict]
    outputs: list[dict]
    metadata: list[dict]
    splits: list[str | None]


@dataclass
class Score:
    """One evaluation of a run, such as `correct` with score 1.0 and label "correct"."""

    name: str
    score: float
    label: str | None = None
    metadata: dict = field(default_factory=dict)


@dataclass
class Run:
    """The result for one example. `input` must equal that example's input in the Dataset.

    An eval that runs every example several times gives each pass its own repetition, from 1.
    """

    input: dict
    output: dict
    started: str
    ended: str
    error: str | None = None
    scores: list[Score] = field(default_factory=list)
    repetition: int = 1


def dataset_name(prefix: str, rows: list[dict]) -> str:
    """`prefix` and a hash of `rows`, so changed rows make a new dataset and the same rows reuse one."""
    digest = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()[:10]
    return f"{prefix}-{digest}"


def source_sha(module: ModuleType) -> str:
    """The first 12 hex digits of a module's source hash, so a run records the prompt it used."""
    return hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()[:12]


def log_experiment(
    dataset: Dataset, runs: list[Run], *, name: str, description: str, metadata: dict, split: str = ""
) -> str:
    """Create an experiment on `dataset` with one run and its scores per entry of `runs`.

    Args:
        dataset: The examples, uploaded when Phoenix has no dataset of that name yet.
        runs: The results, each matched to its example by input.
        name: The experiment's name in the Phoenix UI.
        description: What made this run, such as the script and its options.
        metadata: Settings two runs are compared on, such as the model and a prompt hash.
        split: Limit the experiment to one split of the dataset; "" for all examples.

    Returns:
        The experiment id.
    """
    phoenix = PHOENIX_COLLECTOR_ENDPOINT.rstrip("/")
    dataset_id = _dataset_id(phoenix, dataset)
    example_ids = _example_ids(phoenix, dataset_id)
    # Match every run before creating anything, so a bad input cannot leave a half-filled experiment.
    run_example_ids = []
    for run in runs:
        if _key(run.input) not in example_ids:
            raise ValueError(f"run input {run.input} is not an example of dataset {dataset.name!r}")
        run_example_ids.append(example_ids[_key(run.input)])
    body = {
        "name": name,
        "description": description,
        "metadata": metadata,
        "splits": [split] if split else None,
    }
    created = requests.post(f"{phoenix}/v1/datasets/{dataset_id}/experiments", json=body, timeout=30)
    created.raise_for_status()
    experiment_id = created.json()["data"]["id"]
    for run, example_id in zip(runs, run_example_ids, strict=True):
        posted = requests.post(
            f"{phoenix}/v1/experiments/{experiment_id}/runs",
            json={
                "dataset_example_id": example_id,
                "output": run.output,
                "repetition_number": run.repetition,
                "start_time": run.started,
                "end_time": run.ended,
                "error": run.error,
            },
            timeout=30,
        )
        posted.raise_for_status()
        run_id = posted.json()["data"]["id"]
        for score in run.scores:
            evaluation = {
                "experiment_run_id": run_id,
                "name": score.name,
                "annotator_kind": "CODE",
                "start_time": run.ended,
                "end_time": run.ended,
                "result": {"label": score.label, "score": score.score},
                "metadata": score.metadata,
            }
            requests.post(
                f"{phoenix}/v1/experiment_evaluations", json=evaluation, timeout=30
            ).raise_for_status()
    return experiment_id


def _dataset_id(phoenix: str, dataset: Dataset) -> str:
    """The id of the dataset with this name, uploading it first if Phoenix has none."""
    found = requests.get(f"{phoenix}/v1/datasets", params={"name": dataset.name}, timeout=30)
    found.raise_for_status()
    if found.json()["data"]:
        return found.json()["data"][0]["id"]
    body = {
        "action": "create",
        "name": dataset.name,
        "description": dataset.description,
        "inputs": dataset.inputs,
        "outputs": dataset.outputs,
        "metadata": dataset.metadata,
        "splits": dataset.splits,
    }
    uploaded = requests.post(f"{phoenix}/v1/datasets/upload", params={"sync": "true"}, json=body, timeout=60)
    uploaded.raise_for_status()
    return uploaded.json()["data"]["dataset_id"]


def _example_ids(phoenix: str, dataset_id: str) -> dict[str, str]:
    """Each example's Phoenix id, keyed by its input."""
    examples = requests.get(f"{phoenix}/v1/datasets/{dataset_id}/examples", timeout=30)
    examples.raise_for_status()
    found = examples.json()["data"]["examples"]
    ids = {_key(e["input"]): e["id"] for e in found}
    if len(ids) != len(found):
        raise ValueError(f"dataset {dataset_id} has examples with the same input; runs cannot be matched")
    return ids


def _key(example_input: dict) -> str:
    # Matching on the whole input works for datasets uploaded before this module existed, which
    # carry no id of their own. Keep inputs to strings: Phoenix may store a number differently
    # (1.0 as 1), and then it would not match.
    return json.dumps(example_input, sort_keys=True)
