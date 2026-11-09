# Annotation guideline, round 2

How to label claims and their evidence in the Labeler role. `docs/labeling.md` covers the tool.
This page covers the judgment: what a claim is, what kind it is, what counts as evidence, and how
to grade the evidence against the claim.

Round 1 (SCRUM-70) is in the git history of this file. Round 2 changes three things, because the
round 1 labels could not be scored cleanly:

- **Level 3 had no clear edge.** It said "backs it, with a gap", but not which gaps. Labelers put
  pairs with large gaps at 3, and the judge called most of them insufficient. On the 9 November
  test run the judge said "supports" on 35% of level-3 pairs and 60% of level-4 pairs. A second
  labeler then reviewed the 58 computer-vision pairs the judge missed and agreed with the judge on
  55, which were changed to level 2 (dataset v1.1). Section 7 now lists the gaps that level 3
  allows. Every other gap is level 2.
- **The label did not say what kind of claim it was.** A result claim needs a result as evidence.
  A background claim does not. Each claim now gets a type (section 3) and a citation intent
  (section 4).
- **Evidence had no standard.** Section 5 says which passages count, how many, and where they may
  come from.

## 1. The task

For each claim, and each reference it cites: find the smallest set of passages in the reference
that settles what the citation is for, and grade how well they back it.

## 2. What counts as a claim

A claim is one statement in the citing paper that credits a cited work with something a reader
could check in that work. Keep a claim only if it passes all five tests.

| Test | Means | Fails when |
|---|---|---|
| Attributable | Some part of it is credited to the cited work | It states the citing paper's own result ("our model reaches 74.0") |
| Checkable | The cited work could show it true or false | It is an opinion, a plan or a judgment ("X is a promising direction") |
| Atomic | It says one thing | It joins two facts with "and" that could each be true or false alone |
| Faithful | It says what the paper's sentence says, no more | Extraction widened it ("13 tasks from BEIR" became "BEIR has 13 tasks") |
| Self-contained | It reads without the paragraph around it | It has "this method", "it", "the former" |

Fix a claim before you grade it:

- **Split** a claim that fails *atomic* into one claim per fact, each with the citations that
  belong to it. "ColBERT is a late-interaction model [b3] that compresses its index 6-10x [b4]"
  becomes two claims.
- **Edit** a claim that fails *faithful* or *self-contained* back to the paper's sentence, with the
  pronoun replaced by what it names.
- **Reject** a claim that fails *attributable* or *checkable*.

## 3. Claim type

Pick the one type that matches what the citation is for. The type tells you where in the
reference the evidence should be. The types follow the scientific-zoning scheme CoreSC (Liakata
et al., 2010), merged into six that our claims actually use.

| Type | The claim says the cited work... | Example | Evidence usually in |
|---|---|---|---|
| Result | found or measured something | "BLIP-2 outperforms Flamingo80B by 8.7% on zero-shot VQAv2 [b5]" | Results, tables, figures, abstract |
| Comparison | is better, worse, faster or different than another | "Transformers train faster than recurrent models [b12]" | Results, tables |
| Method | proposed or works in a certain way | "ColBERT scores passages by late interaction [b3]" | Method section |
| Resource | made a dataset, benchmark, model or tool with certain properties | "BEIR covers 18 datasets [b54]" | Dataset section, intro, tables |
| Background | states a fact about the field or the world | "Self-attention cost grows quadratically with length [b37]" | Intro, method |
| Claim or hypothesis | argued, proposed or hypothesized something, not shown | "[b9] argues that scale alone yields reasoning" | Intro, discussion |

Two checks follow from the type:

- A **result** or **comparison** claim needs evidence that reports the result: a results
  sentence, a table cell or a figure. The cited paper's introduction saying "we show that X" is
  acceptable only when it gives the same numbers or the same direction as the results.
- A **claim or hypothesis** is backed when the cited work argues it. It does not need to be shown.
  If the citing paper turns a hypothesis into a finding ("[b9] showed..."), that is a modality gap
  (section 6).

## 4. Citation intent

Decide what the citation is for before you look at passages. This follows SciCite (Cohan et al.,
2019), plus one class our pipeline already uses.

| Intent | Meaning | Graded? |
|---|---|---|
| Background | The cited work is the source of a fact or idea | Yes |
| Method | The citing paper uses or builds on the cited work's method | Yes, for what the claim says about the method |
| Result comparison | The citing paper compares its results with the cited work's | Yes, for the cited work's side only |
| Names only | The citation just identifies a dataset, metric, tool or model the paper uses ("we train on MS MARCO [b12]") | No. Keep the claim only if it says something about the thing named |

Grade only the part of the claim the citation is for. In "Existing language models are generally
implemented with Transformers [b37], which require memory that grows quadratically", the 2017
Transformer paper is cited for the Transformer and its cost. It is not graded on whether most
language models today are Transformers.

## 5. Evidence: which passages count

A passage is evidence only if it meets all of these rules. The first three follow how SciFact
(Wadden et al., 2020) defines a rationale.

1. **From the cited work itself.** Not from another paper, the abstract on a website, or memory.
2. **Minimal.** The fewest sentences that together settle the claim, at most three. Remove any
   sentence the decision does not need.
3. **Sufficient.** A reader given only these sentences and the claim reaches your level.
4. **Verbatim and whole.** Copy complete sentences as printed. For a table, name the table, row and
   column in the reason ("Table 2, BEIR row, nDCG@10"). For a figure, add the caption and say what
   the figure shows ("Figure 3, red curve passes 0.8 at 10k steps").
5. **The cited work's own statement.** A sentence where the cited work describes *other* papers (its
   related work) is not evidence that the cited work showed it. It is evidence only for a
   background claim that the cited work states.
6. **Matches the claim type.** See section 3: a result claim needs a result.
7. **Located.** Record where it came from: abstract, introduction, method, results, discussion,
   table or figure.

Mark every passage in the list as relevant or not relevant, even when you have found enough. Add a
passage retrieval did not list when you find better evidence in the PDF. Added passages show us
what retrieval misses.

When no passage meets the rules, the level is 1 and the reason says what you looked for and where.

## 6. Comparing the claim with the evidence

Do not compare words. Compare these seven parts of what is said. Each row is a place where a claim
can drift from its source. The first five are what round 1's "checks before you save" covered.
Quantifiers and modality are new.

| Part | Check | Claim | Evidence | Gap |
|---|---|---|---|---|
| Entities | Same method, dataset, model, metric | "on MS MARCO" | "on TREC-DL" | Major |
| Numbers and units | Same value, unit and rounding | "8.7%" | "8.7 points" | Major if the meaning differs |
| Comparison and direction | Same order, same side of each relation | "A is derived from B" | "B is derived from A" | Contradicts |
| Polarity | Same affirmed or negated | "does not need labels" | "needs few labels" | Major |
| Quantifiers and scope | Same "all", "most", "some"; same setting | "on visual question answering" | "on zero-shot VQAv2" | Minor if one case of a family, else major |
| Modality | Same certainty | "shows", "proves" | "suggests", "may" | Major when the claim is stronger |
| Conditions and time | Same conditions, same time | "always converges" | "converges with warm-up" | Major |

Hedges ("may", "suggests", "appears to") carry the authors' certainty (Hyland, 1998). A citing claim
that drops a hedge reports more than the source found. Medical citation studies count this as one
of the common quotation errors (Jergas and Baethge, 2015).

Part-of-speech tags are not the right tool here: a noun or a verb can carry any of these seven
parts. What matters is the content in each slot, not its grammatical class.

## 7. The four levels

| Level | Name | Use it when |
|---|---|---|
| 4 | Strong | The evidence states what the citation is for, with every part in section 6 the same. A paraphrase is fine. |
| 3 | Clear, minor gap | Every part matches except one or more **minor gaps** from the list below. |
| 2 | Weak | At least one **major gap**: related evidence that does not settle the claim. |
| 1 | No support | No evidence meets section 5, or the evidence **contradicts** the claim. Start the reason with "Contradicts:" for a contradiction. |

Minor gaps, the only ones level 3 allows:

- The claim leaves out a detail the evidence gives (a condition that does not change the truth, a
  second dataset, a standard deviation).
- The claim rounds a number in the usual way ("about 9%" for 8.7%).
- The claim names one case where the evidence shows that case among others.
- The claim uses a common synonym or a general term for the same thing ("retrieval model" for "dense
  retriever").

Every other gap is major: a wider scope, a stronger modality, a missing condition that changes the
truth, a different entity, a number that does not match, or a claim that needs two references
together.

When you are between two levels, pick the lower one and say why. Set confidence to low when you
are unsure of the field or the evidence is hard to read, high when the evidence settles it, and
medium otherwise.

`backend/app/evaluation.py` counts 3 or 4 as supported. The judge's prompt
(`backend/app/pipeline/verify.py`) has to accept the same minor gaps and no others, so the two
sides use one line.

## 8. Agreement and adjudication

Labels are only as good as two people's agreement on them.

1. **Calibration.** Before a round, every labeler grades the same 20 pairs. The group discusses
   every pair where levels differ by more than one, and adds a hard case below when a rule was
   unclear.
2. **Double labels.** At least 25% of each round's pairs, and at least 100 pairs, get two labelers
   who do not see each other's label.
3. **The bar.** Report Cohen's kappa on supported vs not supported, and Krippendorff's alpha on
   the 1-4 levels as ordinal data. Accept the round when kappa is at least 0.6 ("substantial" in
   Landis and Koch, 1977) and alpha at least 0.667 (Krippendorff's lowest bar for tentative
   conclusions). Below that, fix the guideline and recalibrate before more labeling.
4. **Adjudication.** A pair where the two labelers fall on different sides of the 2-3 line goes to
   a third labeler, who sees both reasons. The third label decides. All three labels are kept.
5. **Version.** Every label records the guideline round it was made under.

The judge is compared with people on the same pairs. Human agreement is its ceiling: the judge is
not expected to agree with a labeler more often than two labelers agree with each other.

## 9. Fields the labeler needs to record

Round 2 asks for these per label. Until the tool has a field for one, write it in the reason in
this order: `type; intent; location; gaps`.

| Field | Values |
|---|---|
| Claim type | result, comparison, method, resource, background, claim or hypothesis |
| Citation intent | background, method, result comparison, names only |
| Evidence location | abstract, introduction, method, results, discussion, table, figure |
| Gaps | none, or the parts from section 6 that differ, each minor or major |
| Contradicts | yes or no |

## 10. Hard cases

- **Time words.** "Existing", "current", "recent" and "generally" in a claim mean the time of the
  citing paper. A cited paper describing what was common before it does not contradict such a claim.
- **One claim, several citations.** Grade each reference for its own part. When a sentence credits
  two references with the same thing, grade both against all of it. When a claim is only true with
  both references together, each one alone is level 2.
- **No open copy of the reference.** No passages means no level. Do not grade from memory or from
  an abstract on the web.
- **A secondary citation.** The cited work repeats a finding from another paper ("as [12] showed,
  ..."). For a result claim this is level 2: the cited work is not the source. For a background
  claim it is evidence.
- **A survey or a book.** Grade against the sentence that states it, as for any other reference.
  A whole chapter "about" the topic is not evidence.
- **The citing paper's own result with a citation for the benchmark.** "Our model reaches 74.0 on
  MMVet [b8]" credits MMVet only as the benchmark: intent is names only, and the claim is rejected
  unless it says something about MMVet itself.

## References

- Cohan, A., Ammar, W., van Zuylen, M., and Cady, F. (2019). Structural scaffolds for citation
  intent classification in scientific publications. NAACL.
- Hyland, K. (1998). *Hedging in Scientific Research Articles*. John Benjamins.
- Jergas, H., and Baethge, C. (2015). Quotation accuracy in medical journal articles: a systematic
  review and meta-analysis. *PeerJ* 3:e1364.
- Krippendorff, K. (2004). *Content Analysis: An Introduction to Its Methodology*, 2nd ed. Sage.
- Landis, J. R., and Koch, G. G. (1977). The measurement of observer agreement for categorical data.
  *Biometrics* 33(1).
- Liakata, M., Teufel, S., Siddharthan, A., and Batchelor, C. (2010). Corpora for the
  conceptualisation and zoning of scientific papers. LREC.
- Wadden, D., Lin, S., Lo, K., Wang, L. L., van Zuylen, M., Cohan, A., and Hajishirzi, H. (2020).
  Fact or fiction: verifying scientific claims. EMNLP.
