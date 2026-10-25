# Annotation guideline, round 1

How to label claims in the Labeler role for round 1 (SCRUM-70). `docs/labeling.md` covers the tool
itself. This page covers the judgment: what each level means and what to do with the hard cases.
Open questions that are not decided yet are listed at the end.

## What you grade

For each claim you decide two things:

1. Is the claim right as written? **Keep** it, **Edit** it to match the paper's sentence, or
   **Reject** it. Fix the claim before you grade it. The level is for the claim as you saved it.
2. For each reference the claim cites, how well do the reference's passages back the part of the
   claim that reference is cited for? Mark each passage **Relevant** or **Not relevant**, then give
   the reference a level from 1 to 4 and a reason.

Grade only what the citation is for. In "Existing language models are generally implemented with
Transformers [b37], which require memory and compute that increases quadratically in sequence
length", [b37] is "Attention Is All You Need". It is cited for the Transformer and its cost. Whether
most language models today are Transformers is not something a 2017 paper can show, so that part is
not graded against it.

## The four levels

| Level | Name | Use it when |
|---|---|---|
| 4 | Strong | A passage states what the citation is for, directly and fully. |
| 3 | Clear | A passage backs it, but covers less than the claim says (fewer cases, a narrower setting) or leaves a detail out. |
| 2 | Weak | A passage is related but indirect, vague, or backs only part of it. |
| 1 | No support | No passage backs it, or a passage says something different. |

The examples below use passages from the BLIP-2 paper (arXiv 2301.12597) and "Attention Is All You
Need" (arXiv 1706.03762).

- **4.** Claim: "BLIP-2 outperforms Flamingo80B by 8.7% on zero-shot VQAv2 with 54x fewer trainable
  parameters." Passage: "our model outperforms Flamingo80B by 8.7% on zero-shot VQAv2 with 54x fewer
  trainable parameters." Every number and the direction match.
- **3.** Claim: "BLIP-2 outperforms Flamingo80B on visual question answering with far fewer
  trainable parameters." Same passage. It backs the claim for one benchmark, zero-shot VQAv2, and
  the claim says visual question answering in general. If the passage saying that on OK-VQA
  "BLIP-2 comes secondary to Flamingo80B" is listed too, it says something different about the
  general claim, and the level is 1.
- **2.** Claim: "Transformers train faster than recurrent models because they can be
  parallelized." Passage from "Attention Is All You Need": "This inherently sequential nature
  precludes parallelization within training examples, which becomes critical at longer sequence
  lengths." It says recurrent models cannot be parallelized. It does not say Transformers train
  faster.
- **1 (no support).** The Transformer claim above, against the four passages retrieval found: one on
  restricting self-attention to a neighbourhood, and three from the introduction about RNNs. None
  states the quadratic cost. If you find the passage that does, add it and grade again.
- **1 (says something else).** Claim: "BLIP-2 trails Flamingo80B on zero-shot VQAv2." The BLIP-2
  passage above says the opposite. Start the reason with "Contradicts:" (see open question 1).

When you are between two levels, pick the lower one and say why in the reason. Set **confidence** to
low when you are unsure of the field or the passage is hard to read, high when the passage settles
it, and medium otherwise.

## How levels are scored

`backend/app/evaluation.py` turns levels into yes or no: 3 or 4 means the source supports the claim,
1 or 2 means it does not. The judge's "supports" counts as yes; "refutes" and "insufficient" count as
no. So the line between 2 and 3 matters most. Ask: would a careful reader accept this passage as the
source for what the citation is for? Yes is 3 or 4. No is 1 or 2.

Two people label each pair, and agreement is measured with weighted kappa (`human_agreement` in
`evaluation.py`). Do not talk about a pair with the other labeler before you both save it.

## Checks before you save

Before 3 or 4, check each of these against the passage. If any differs, the level is 1.
- every number;
- every comparison: more or less, higher or lower, easier or harder;
- which item a value belongs to: the row and column of a table, the series of a figure, the item
  "respectively" pairs it with;
- which side of a relation each thing is on: "A is derived from B" is not "B is derived from A".

A claim that leaves out details the passage gives is not contradicted by that. A claim may use other
words than the passage; grade whether it means the same thing.

## Tables, figures and text

The passage list shows text from the reference. Evidence can also sit in a table or a figure.

- **Table.** Read the value from its row and column. Mark the passage that holds the table, or add
  it with "Add a passage retrieval missed" if it is not listed. In the reason, name the table and
  the cell, for example "Table 2, BEIR row, nDCG@10".
- **Figure.** If only a figure shows it, add its caption as the passage and name the figure in the
  reason, for example "Figure 3, red curve passes 0.8 at 10k steps". Grade from what the figure shows,
  not only from the caption.
- **Text.** Grade the sentence or sentences that say it.

The tool does not record whether evidence came from text, a table or a figure (open question 2).
Until it does, the reason is the only place that says so. Always name the table or figure.

## Hard cases

- **Time words.** "Existing", "current", "recent", "today" and "generally" in a claim mean the time
  the citing paper was written, not the time of the cited paper. A cited paper describing what was
  common before it does not contradict such a claim. Grade only what the citation is for (see the
  Transformer example).
- **Citations that only name what the paper used.** In "We train on MS MARCO [b12] with AdamW
  [b7]", the citations only credit the dataset and the optimizer. The pipeline does not check these
  (#475) and lists the claim as "names only". Keep the claim if it is a real claim about the paper.
  Mark a reference's passages relevant only if one describes the thing named, then grade that.
  See open question 3.
- **One claim, several citations.** Grade each reference on its own, for the part it is cited for.
  "Optimized late interaction engines [b45][b31] enable scaling to millions of documents" credits
  both papers with the same thing, so both are graded against all of it. A sentence that cites
  different papers for different parts gives each paper its own part.
- **No open copy of the reference.** A reference the system could not download has no passages, so
  it cannot get a level. Leave it without one. Do not grade from memory or from an abstract on the
  web. If you know where an open copy is, say so in the claim's reason so it can be added later.
- **The claim misreads its sentence.** Claim extraction sometimes rewrites a sentence into a claim
  that says more than the authors did. For example, "13 diverse retrieval and semantic similarity
  tasks from BEIR [b54]" became "BEIR is a benchmark consisting of 13 tasks". BEIR has more than 13.
  Edit the claim back to what the sentence says, then grade the edited claim.
- **The claim states the citing paper's own result.** "Our model reaches 74.0 on MMVet" cites
  nothing about MMVet's results. Grade only what the citation is for (here, that MMVet is the
  benchmark named), or reject the claim if nothing in it is credited to the reference.

## Open questions

Decisions for the lead (Vitawat) before round 1 starts. The guideline above takes no position on
them beyond the temporary rule stated.

1. **Contradicts vs no support.** Level 1 covers both, so the judge's "refutes" is never scored
   against people. Until the tool has a separate choice, this guideline asks labelers to start the
   reason with "Contradicts:" when a passage says the opposite. Is that enough, or should the tool
   get a fifth choice before round 1?
2. **Modality field.** SCRUM-67, SCRUM-79 and SCRUM-84 set 75 table and 75 figure targets, but no row
   records the modality. Add a text, table or figure choice per label before round 1, or count them
   from the reasons afterwards?
3. **Names-only claims.** Should labelers keep them and grade only what the citation names, as
   written above, or reject them so they do not count toward the 80 claims?
4. **Unit of "80 claims".** 80 claims, or 80 (claim, reference) pairs? #423 needs about 50
   double-labeled pairs.
5. **Agreement bar.** What weighted kappa is good enough to start round 2, and who settles the pairs
   two labelers disagree on?
6. **AI review.** The Review button shows the judge's verdict before a label is final. Should round 1
   labelers use it, given that labels made after a review are flagged `ai_reviewed` and reported
   apart?
