"""The parts of make_eval_claims.py that decide which claims and sources are kept. No LLM calls."""

import make_eval_claims as claims

PASSAGE = (
    "We train the retriever on web pages and show that the encoder reads the text in the image, "
    "which is what the retrieval step needs. This is the part a claim is checked against. "
) * 3


def test_a_claim_that_copies_six_words_in_a_row_is_caught():
    assert claims.copies_source("They show that the encoder reads the text in the image.", PASSAGE)
    assert not claims.copies_source("The image encoder can read printed words inside pictures.", PASSAGE)


def test_caption_text_stops_at_the_first_sentence_after_the_label():
    caption = "Table 2. MRR@10 and latency of each model. Lower is better for latency and memory."
    assert claims.caption_text(caption) == "Table 2. MRR@10 and latency of each model."


def test_caption_text_keeps_at_most_25_words():
    long_caption = "Figure 3: " + " ".join(f"word{i}" for i in range(40))
    assert len(claims.caption_text(long_caption).split()) == claims.CAPTION_WORDS


def test_only_long_prose_passages_are_sampled():
    assert claims.is_prose(PASSAGE)
    assert not claims.is_prose("12.4 55.1 63.0 71.9 ColPali BM25 " * 20)  # a table
    assert not claims.is_prose("We show that it works.")  # too short


def test_captions_of_dataset_examples_are_not_sampled():
    example = "Figure 2: Caption: The cow is ahead of the person. Label: False."
    caption = "Figure 3: Top: accuracy of each model on the test split."
    passages = [
        {"paper": "vsr.pdf", "index": 0, "text": example},
        {"paper": "vsr.pdf", "index": 1, "text": caption},
    ]
    sampled = claims.sample_captions(passages, sample=10)
    assert [p["index"] for p in sampled] == [1]
