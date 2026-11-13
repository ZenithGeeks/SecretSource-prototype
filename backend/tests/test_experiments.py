"""app/experiments.py: what log_experiment sends to Phoenix's REST API, with HTTP faked."""

import pytest
from app import experiments
from app.experiments import Dataset, Run, Score


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def json(self):
        return self.body

    def raise_for_status(self):
        pass


class FakePhoenix:
    """Answers the calls log_experiment makes and keeps every request for the test to read."""

    def __init__(self, has_dataset):
        self.has_dataset = has_dataset
        self.posts = []

    def get(self, url, params=None, timeout=None):
        if url.endswith("/v1/datasets"):
            return FakeResponse({"data": [{"id": "ds1"}] if self.has_dataset else []})
        examples = [{"id": "ex-a", "input": {"q": "a"}}, {"id": "ex-b", "input": {"q": "b"}}]
        return FakeResponse({"data": {"examples": examples}})

    def post(self, url, params=None, json=None, timeout=None):
        self.posts.append((url.removeprefix("http://phoenix:6006"), json))
        if url.endswith("/upload"):
            return FakeResponse({"data": {"dataset_id": "ds1"}})
        if url.endswith("/experiments"):
            return FakeResponse({"data": {"id": "exp1"}})
        return FakeResponse({"data": {"id": f"run{len(self.posts)}"}})


DATASET = Dataset(
    name="toy",
    description="two questions",
    inputs=[{"q": "a"}, {"q": "b"}],
    outputs=[{"answer": 1}, {"answer": 2}],
    metadata=[{}, {}],
    splits=["test", "test"],
)


def run(question, error=None, scores=()):
    return Run({"q": question}, {"answer": 1}, "t0", "t1", error, list(scores))


@pytest.fixture
def phoenix(monkeypatch):
    monkeypatch.setattr(experiments, "PHOENIX_COLLECTOR_ENDPOINT", "http://phoenix:6006/")

    def install(has_dataset):
        fake = FakePhoenix(has_dataset)
        monkeypatch.setattr(experiments, "requests", fake)
        return fake

    return install


def test_a_new_dataset_is_uploaded_and_each_run_posted_with_its_scores(phoenix):
    fake = phoenix(has_dataset=False)
    runs = [run("b", scores=[Score("correct", 1.0, "correct")]), run("a", error="timed out")]

    experiment_id = experiments.log_experiment(
        DATASET, runs, name="model x", description="toy eval", metadata={"model": "x"}, split="test"
    )

    assert experiment_id == "exp1"
    urls = [url for url, _ in fake.posts]
    assert urls == [
        "/v1/datasets/upload",
        "/v1/datasets/ds1/experiments",
        "/v1/experiments/exp1/runs",
        "/v1/experiment_evaluations",  # only the run with a score gets one
        "/v1/experiments/exp1/runs",
    ]
    assert fake.posts[1][1]["splits"] == ["test"]
    first_run, evaluation, second_run = fake.posts[2][1], fake.posts[3][1], fake.posts[4][1]
    assert first_run["dataset_example_id"] == "ex-b"  # matched by input, not by position
    assert evaluation["experiment_run_id"] == "run3"
    assert evaluation["result"] == {"label": "correct", "score": 1.0}
    assert second_run["dataset_example_id"] == "ex-a" and second_run["error"] == "timed out"


def test_a_dataset_phoenix_already_has_is_reused(phoenix):
    fake = phoenix(has_dataset=True)

    experiments.log_experiment(DATASET, [run("a")], name="model x", description="", metadata={})

    urls = [url for url, _ in fake.posts]
    assert urls == ["/v1/datasets/ds1/experiments", "/v1/experiments/exp1/runs"]
    assert fake.posts[0][1]["splits"] is None  # no split asked for: all examples


def test_a_run_for_an_unknown_input_fails_before_the_experiment_is_created(phoenix):
    fake = phoenix(has_dataset=True)

    with pytest.raises(ValueError, match="not an example of dataset 'toy'"):
        experiments.log_experiment(DATASET, [run("a"), run("z")], name="x", description="", metadata={})

    assert fake.posts == []
