"""Citations that only name a benchmark, dataset, model or technique the paper uses are not
checked (#475): the role model names them, the sentence must say it is about this paper, and
the job planners skip them."""

from app.pipeline import claims
from app.pipeline.verify import checked_citations
from dspy.utils.exceptions import LMTransportError

TITLE = "Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution"


def _claim(sentence, *titles):
    return {"claim": sentence, "sentence": sentence, "citations": [{"title": t} for t in titles]}


def _roles(monkeypatch, positions):
    monkeypatch.setattr(claims, "_citation_roles", lambda title, found: positions)


def test_own_work_needs_we_our_or_the_papers_model_name():
    assert claims._says_own_work("To support this, we modified ViT", TITLE)
    assert claims._says_own_work("On MMVet, Qwen2-VL-72B achieves 74.0", TITLE)
    colpali = "ColPali: Efficient Document Retrieval with Vision Language Models"
    assert not claims._says_own_work("The naive ColBERT indexing strategy can be compressed", colpali)
    assert not claims._says_own_work("Standard LVLMs encode images at 224x224", TITLE)


def test_named_citations_are_kept_only_when_the_sentence_is_about_this_paper(monkeypatch):
    found = [
        _claim("On MMVet, Qwen2-VL-72B achieves 74.0", "MM-Vet"),
        _claim("Standard LVLMs encode images at 224x224", "Kosmos-1", "LLaVA"),
    ]
    _roles(monkeypatch, [{0}, {0, 1}])  # the model names both, wrongly for the second claim

    claims._mark_named_citations(TITLE, found)

    assert found[0]["named"] == ["MM-Vet"]
    assert found[1]["named"] == []


def test_a_failed_role_call_names_nothing(monkeypatch):
    def fail(title, found):
        raise LMTransportError("server closed connection before sending response")

    monkeypatch.setattr(claims, "_citation_roles", fail)
    found = [_claim("We train on MS MARCO", "MS MARCO")]

    claims._mark_named_citations("ColBERTv2: Effective", found)

    assert found[0]["named"] == []


def test_claims_without_citations_keep_their_number_in_the_listing():
    listing = claims._claims_with_citations([
        _claim("Uncited sentence."),
        {**_claim("We use MMMU [b110].", "MMMU"), "citations": [{"title": "MMMU", "year": "2023"}]},
    ])

    assert listing == "2. We use MMMU.\n   [1] MMMU (2023)"


def test_the_planners_skip_named_citations():
    claim = {**_claim("We train on MS MARCO", "MS MARCO", "ColBERT"), "named": ["MS MARCO"]}

    assert checked_citations(claim) == [({"title": "ColBERT"}, "ColBERT")]
