"""Write claims a citing paper could make about sampled passages or captions, for eval_generated.py.

    python make_eval_claims.py passages.jsonl claims.jsonl --per-paper 6
    python make_eval_claims.py passages.jsonl caption-claims.jsonl --captions --sample 300

For each sampled passage (or figure/table caption) the project LLM writes one claim it supports
and one it contradicts. The claim's kind is its expected verdict, and the passage it came from is
its gold for retrieval; neither comes from a retriever, so no retriever is favoured. Claims that
copy 6 words in a row from their source are dropped: they would test string matching. Run it in
the worker container, where app.llm reaches the LLM.
"""

import argparse
import json
import random
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass

import dspy
from app.llm import dspy_lm
from dspy.utils.exceptions import (
    AdapterParseError,
    LMRateLimitError,
    LMServerError,
    LMTimeoutError,
    LMTransportError,
)

SEED = 17
TRANSIENT = (LMRateLimitError, LMServerError, LMTimeoutError, LMTransportError)
PROSE_WORDS = frozenset({"the", "is", "are", "we", "this", "that", "which", "our", "it", "was", "be", "can"})
# Same pattern as CAPTION in services/colbert/store.py, which starts a passage at each caption.
CAPTION = re.compile(r"^\s*(?:Figure|Fig\.|Table)\s*(?:\d+|[IVX]+)\s*[.:|]", re.I)
# A caption that opens with a field name shows a dataset example ("Figure 2: Caption: The cow is
# ahead of the person. Label: False."). caption_text() cuts the label off, so the example would
# read as a fact.
EXAMPLE_CAPTION = re.compile(
    r"^\s*(?:Figure|Fig\.|Table)\s*(?:\d+|[IVX]+)\s*[.:|]\s*"
    r"(?:Caption|Label|Question|Answer|Input|Output|Prompt|Instruction|Q|A)\s*:",
    re.I,
)
WORD = re.compile(r"[a-z0-9]+")
CAPTION_WORDS = 25


class WriteClaims(dspy.Signature):
    """Write two one-sentence claims that another paper citing this passage could make.

    The supported claim states a specific finding, number, method detail or definition from the
    passage, in your own words, the way a related-work section would cite it. The contradicted
    claim is the same claim with one fact changed (a number, a direction, an entity, a negation)
    so that the passage clearly contradicts it. Do not copy runs of words from the passage.
    Set checkable to false when the passage states nothing specific enough to cite, such as a
    table of numbers without context, a list of captions or an author block.
    """

    passage: str = dspy.InputField()
    checkable: bool = dspy.OutputField()
    supported_claim: str = dspy.OutputField()
    contradicted_claim: str = dspy.OutputField()


class WriteCaptionClaims(dspy.Signature):
    """Write two one-sentence claims that another paper could make about what this figure or
    table shows, citing it.

    The supported claim states what the caption says is shown (a result, a comparison, a number,
    an example, a setup), in your own words. The contradicted claim changes one fact (a number, a
    direction, an entity, a negation) so the caption clearly contradicts it; it must differ from
    the supported claim. Do not copy runs of words. Set checkable to false only when the caption
    names a figure without saying anything, such as "Figure 3: Examples."
    """

    # named passage, like WriteClaims, so write_with_retry calls both the same way
    passage: str = dspy.InputField(desc="the caption")
    checkable: bool = dspy.OutputField()
    supported_claim: str = dspy.OutputField()
    contradicted_claim: str = dspy.OutputField()


@dataclass
class Claim:
    id: str
    paper: str
    gold: int  # index of the passage the claim was written from
    kind: str  # "supports" or "refutes": the expected verdict
    text: str
    caption: str = ""  # caption claims: the caption_text() a retrieved passage must hold whole


def is_prose(text: str) -> bool:
    """Whether a passage is running text worth citing: 80+ words and 6%+ common function words.
    Tables, author blocks and reference lists fall under the 6%."""
    words = text.lower().split()
    return len(words) >= 80 and sum(w in PROSE_WORDS for w in words) / len(words) >= 0.06


def caption_text(passage: str) -> str:
    """A caption passage's first sentence, or its first 25 words when the sentence runs longer."""
    words = passage.split()[:CAPTION_WORDS]
    for i, word in enumerate(words[3:], start=3):  # skip the "Table 2." label itself
        if word.endswith("."):
            return " ".join(words[: i + 1])
    return " ".join(words)


def sample_passages(passages: list[dict], per_paper: int) -> list[dict]:
    """Up to per_paper prose passages from each paper, the same ones every run."""
    rng = random.Random(SEED)
    by_paper: dict[str, list[dict]] = {}
    for passage in passages:
        if is_prose(passage["text"]):
            by_paper.setdefault(passage["paper"], []).append(passage)
    return [
        p
        for paper in sorted(by_paper)
        for p in rng.sample(by_paper[paper], min(per_paper, len(by_paper[paper])))
    ]


def sample_captions(passages: list[dict], sample: int) -> list[dict]:
    """Up to `sample` caption passages, cut to their caption text, the same ones every run.
    Captions of dataset examples are skipped."""
    captions = [
        {**p, "text": caption_text(p["text"])}
        for p in passages
        if CAPTION.match(p["text"]) and not EXAMPLE_CAPTION.match(p["text"])
    ]
    captions = [c for c in captions if len(c["text"].split()) >= 6]
    return random.Random(SEED).sample(captions, min(sample, len(captions)))


def copies_source(claim: str, source: str, n: int = 6) -> bool:
    """Whether the claim repeats any n words in a row from its source (case and punctuation ignored)."""
    words = WORD.findall(source.lower())
    grams = {tuple(words[i : i + n]) for i in range(len(words) - n + 1)}
    claim_words = WORD.findall(claim.lower())
    return any(tuple(claim_words[i : i + n]) in grams for i in range(len(claim_words) - n + 1))


def write_with_retry(write: dspy.Predict, text: str, attempts: int = 6) -> dspy.Prediction:
    """The shared gateway answers 429 under load; back off and try again."""
    for attempt in range(attempts - 1):
        try:
            return write(passage=text)
        except TRANSIENT:
            time.sleep(2**attempt + random.random())
    return write(passage=text)  # the last try lets the error through


def claims_for(source: dict, write: dspy.Predict, is_caption: bool) -> tuple[list[Claim], str]:
    """-> (kept claims, outcome): ok, unchecked, same, copied or error."""
    try:
        result = write_with_retry(write, source["text"])
    except (AdapterParseError, *TRANSIENT):
        return [], "error"
    if not result.checkable:
        return [], "unchecked"
    if result.supported_claim.strip() == result.contradicted_claim.strip():
        return [], "same"
    base = f"{source['paper']}#{source['index']}"
    claims = [
        Claim(
            f"{base}:{kind}",
            source["paper"],
            source["index"],
            kind,
            text.strip(),
            source["text"] if is_caption else "",
        )
        for kind, text in (("supports", result.supported_claim), ("refutes", result.contradicted_claim))
        if not copies_source(text, source["text"])
    ]
    return claims, "ok" if len(claims) == 2 else "copied"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("passages", help="from services/colbert/eval/export_passages.py")
    parser.add_argument("out")
    parser.add_argument("--captions", action="store_true", help="write claims from figure and table captions")
    parser.add_argument("--per-paper", type=int, default=6, help="prose passages sampled per paper")
    parser.add_argument("--sample", type=int, default=300, help="captions sampled in all")
    args = parser.parse_args()

    with open(args.passages, encoding="utf-8") as file:
        passages = [json.loads(line) for line in file]
    sources = (
        sample_captions(passages, args.sample) if args.captions else sample_passages(passages, args.per_paper)
    )

    dspy.configure(lm=dspy_lm(temperature=0.3, max_tokens=400))
    write = dspy.Predict(WriteCaptionClaims if args.captions else WriteClaims)
    # The first call imports litellm; threads that start together race on a half-loaded module.
    results = [claims_for(sources[0], write, args.captions)]
    with ThreadPoolExecutor(max_workers=2) as pool:  # the judge gateway allows 3 requests at once
        results += pool.map(lambda s: claims_for(s, write, args.captions), sources[1:])

    with open(args.out, "w", encoding="utf-8") as file:
        for claims, _ in results:
            for claim in claims:
                file.write(json.dumps(asdict(claim), ensure_ascii=False) + "\n")
    outcomes = Counter(outcome for _, outcome in results)
    kept = sum(len(claims) for claims, _ in results)
    print(
        f"{len(sources)} sampled, {kept} claims kept; "
        + ", ".join(f"{o} {n}" for o, n in sorted(outcomes.items()))
    )


if __name__ == "__main__":
    main()
