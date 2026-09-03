"""Small deterministic tasks for architecture comparison."""

from __future__ import annotations

from ..common.models import EvidenceItem, Task


def sample_task() -> Task:
    """Return the original supported-claim fixture.

    This function remains the single-case default used by the individual
    architecture entry points. ``sample_tasks`` provides the broader case
    suite for comparison runs.
    """

    return Task(
        task_id="sample-method-a-001",
        claim="Method A improves accuracy by 12.3% over baseline B.",
        evidence=(
            EvidenceItem(
                evidence_id="paragraph-1",
                source="paper-123",
                location="page 4, paragraph 2",
                excerpt=(
                    "On the held-out test set, Method A achieved 87.3% accuracy "
                    "versus 75.0% for baseline B."
                ),
                kind="paragraph",
            ),
            EvidenceItem(
                evidence_id="table-1",
                source="paper-123",
                location="Table 2",
                excerpt="Method A: 87.3%; baseline B: 75.0%; reported difference: 12.3 percentage points.",
                kind="table",
            ),
        ),
        metadata={
            "paper_id": "paper-123",
            "citation_id": "citation-456",
            "source_metadata": {"dataset": "held-out test set", "mock": True},
            "mock_case": "supported_claim",
            "fixture_expected_verdict": "supported",
            "fixture_description": "The supplied paragraph and table support the reported comparison.",
        },
    )


def refuted_task() -> Task:
    """Return a fixture where the reported numerical improvement is contradicted."""

    return Task(
        task_id="sample-method-c-002",
        claim="Method C improves accuracy by 10 percentage points over baseline D.",
        evidence=(
            EvidenceItem(
                evidence_id="paragraph-2",
                source="paper-124",
                location="page 5, paragraph 1",
                excerpt=(
                    "On the reported test set, Method C achieved 70.0% accuracy, "
                    "while baseline D achieved 75.0% accuracy."
                ),
                kind="paragraph",
            ),
            EvidenceItem(
                evidence_id="table-3",
                source="paper-124",
                location="Table 3",
                excerpt="Method C: 70.0%; baseline D: 75.0%; reported difference: -5.0 percentage points.",
                kind="table",
            ),
        ),
        metadata={
            "paper_id": "paper-124",
            "citation_id": "citation-457",
            "source_metadata": {"dataset": "reported test set", "mock": True},
            "mock_case": "refuted_claim",
            "fixture_expected_verdict": "refuted",
            "fixture_description": "The source reports a lower result for Method C, contradicting the claim.",
        },
    )


def overclaim_task() -> Task:
    """Return a fixture where narrow evidence is used to make a broad claim."""

    return Task(
        task_id="sample-method-a-003",
        claim="Method A improves accuracy across all datasets and production settings.",
        evidence=(
            EvidenceItem(
                evidence_id="paragraph-3",
                source="paper-123",
                location="page 4, paragraph 2",
                excerpt=(
                    "On one held-out test set, Method A achieved 87.3% accuracy "
                    "versus 75.0% for baseline B."
                ),
                kind="paragraph",
            ),
            EvidenceItem(
                evidence_id="limitation-1",
                source="paper-123",
                location="page 8, limitations",
                excerpt="The experiment covered one dataset and did not evaluate production deployment.",
                kind="limitation",
            ),
        ),
        metadata={
            "paper_id": "paper-123",
            "citation_id": "citation-456",
            "source_metadata": {"dataset": "one held-out test set", "mock": True},
            "mock_case": "overclaim",
            "fixture_expected_verdict": "partially_supported",
            "fixture_description": (
                "The evidence supports a narrow result but not the universal generalization."
            ),
        },
    )


def insufficient_evidence_task() -> Task:
    """Return a fixture whose source does not report the claimed comparison."""

    return Task(
        task_id="sample-method-z-004",
        claim="Method Z improves accuracy by 18 percentage points over baseline Y.",
        evidence=(
            EvidenceItem(
                evidence_id="paragraph-4",
                source="paper-125",
                location="page 2, paragraph 3",
                excerpt=(
                    "The paper describes the training procedure and dataset collection, "
                    "but this section does not report an accuracy comparison."
                ),
                kind="paragraph",
            ),
        ),
        metadata={
            "paper_id": "paper-125",
            "citation_id": "citation-458",
            "source_metadata": {"dataset": "not reported", "mock": True},
            "mock_case": "insufficient_evidence",
            "fixture_expected_verdict": "insufficient_evidence",
            "fixture_description": "The supplied source does not contain evidence for the numerical claim.",
        },
    )


def sample_tasks() -> tuple[Task, ...]:
    """Return the deterministic case suite used by the multi-case runner."""

    return (
        sample_task(),
        refuted_task(),
        overclaim_task(),
        insufficient_evidence_task(),
    )


def get_sample_task(task_id: str) -> Task:
    """Return one fixture by ID with a helpful error for CLI/API callers."""

    for task in sample_tasks():
        if task.task_id == task_id:
            return task
    available = ", ".join(task.task_id for task in sample_tasks())
    raise KeyError(f"Unknown sample task {task_id!r}. Available: {available}")
