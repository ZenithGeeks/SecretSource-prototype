# Search again when the judge says insufficient

14 November 2026.

## Problem Statement

How might we turn the judge's wrong "insufficient" verdicts into "supports" when the cited paper
does say it, without adding false supports or more than a handful of LLM calls per analysis?

## What the data says

- The judge is right when it says "supports" and says it too rarely. 13 Nov pipeline report, 242
  pairs: precision 0.90, recall 0.38, 133 missed supports against 9 false alarms. On the val split
  with the marked sentence (#953): precision 0.93, recall 0.56.
- Retrieval already finds the labeled passage in the top 4 for 95% of test pairs, and within one
  paper the right passage is always in the top 20 (282 generated claims, October). So most of
  the time the evidence is there, but the query that found it was the whole claim.
- `check_prepared` (backend/app/pipeline/verify.py) searches with the claim, judges, and on an
  "insufficient" for a sentence that cites several works asks a second judge about the marked
  sentence (`judged_text`). That second judge reads the **same four passages**. When the
  citation's part was never in those passages, it cannot help.
- The #953 recheck on 40 such checks gave 11 supports and 1 refutes, and that refutes was wrong.
  Taking only a second "supports" is what keeps precision up.
- Run-to-run noise is large: 22 of 184 shared pairs changed verdict between two runs with the
  same code. A change has to beat that, not one row of it.

This is the corrective-retrieval pattern (CRAG, Yan et al. 2024; CS329Z lecture 3): grade the
first answer, and retrieve again only when it fails.

## Recommended Direction

One branch in `check_prepared`, in two steps, each measured on its own.

**Step 1: search with the cited part.** On an "insufficient" where `judged` differs from the claim:

1. Search the same paper again with `judged`, minus the `[cited]` marker (it would be a query
   token), through `evidence_from`.
2. If the top 4 are the passages already judged, keep today's #953 recheck as it is. Otherwise
   ask the judge about `judged` against the new passages.
3. Take the second verdict only when it is "supports", as #953 does.
4. Return the passages that verdict was made on as `evidence`, so `audit.py` checks the quote
   against what the judge actually read and the UI shows the right passages.
5. Mark it `verdict_from: "cited-search"`, so an eval can tell it apart from `"cited"`.

The judge cache key already includes the evidence, so new passages never read an old answer.

**Step 2: neighbour passages.** Only if Step 1's misses include evidence that crosses a passage
boundary. Add the passage before and after the top hit from the second search. This needs a new
ColBERT endpoint, since `/api/search` returns hits, not a passage's neighbours. The store keeps
each paper's passages in order, so it is a lookup, not a model call.

**Variant C: the judge writes the second query.** Only if Step 1 still misses because the marked
sentence is a poor query (for example, the missing piece is one number or model name). After an
"insufficient", ask the judge for one short search query naming what the passages lacked, and
search with that instead of `judged`. This keeps the useful part of Search-R1 (the model chooses
what to search for) without training a policy. It costs one more LLM call per eligible check, and
its query must go in the judge cache key so a reworded prompt does not reuse old queries.

## Key Assumptions to Validate

- [ ] The marked sentence finds passages the claim did not. Test: on the val split, how often the
      top 4 for `judged` differ from the top 4 for the claim, and whether the labeled passage is
      among them. Offline, ColBERT only, no LLM.
- [ ] Extra supports are real. Test: production-faithful val eval, 2 runs, branch and main the
      same day; supports gained against false supports added, compared with the 22/184 noise.
- [ ] No decisive row is lost. Test: `eval_decisive.py --runs 3 --fresh` on the branch and on
      main the same day, as CONSTRAINTS.md requires for a retrieval change.
- [ ] Extra calls are few. Test: count the eligible "insufficient" verdicts in the 13 Nov bench
      run; each costs one ColBERT search and at most one judge call on tokenme (qwen has 2
      parallel calls and $4 a day; 9arm stopped answering on 8 Nov).
- [ ] The labeler is unaffected. Check that candidate passages in labeling round 2 (16–27 Nov)
      come from their own retrieval, not from `check_prepared`'s `evidence`.

## MVP Scope

In: Step 1 behind the val eval and the decisive gate; the offline query-overlap check first.

Out: Step 2 and Variant C until Step 1's misses are read; the Author check (`judge-cited` already marks the
citation); figure-judge changes; new retriever models.

## Not Doing (and Why)

- More passages for every claim (EVIDENCE_COUNT 6): inside the noise and lost decisive rows in
  October. This adds passages only after a failed verdict.
- Searching with the marked sentence for every claim from the start: judging every claim against
  its marked sentence turned supported claims insufficient on decisive rows (#672). The second
  search runs only after an "insufficient".
- Taking a second "refutes": the #953 recheck's one refutes was wrong, and a wrong refutes accuses
  the authors.
- A reranker on the second search: it lowered within-paper recall from 0.965 to 0.904.
- Self-RAG (Asai et al. 2024) as published: it fine-tunes the generator to emit reflection tokens
  (retrieve?, relevant?, supported?). We cannot fine-tune the hosted 9arm judge, the verdict is
  already the "supported?" grade, and every check must retrieve, so "retrieve?" has no use.
- CRAG (Yan et al. 2024) as published: its trained evaluator is replaced here by the judge's own
  verdict, and its web-search fallback cannot apply, since a citation is checked against the
  cited paper only. Its strip filtering adds little on 120-word passages.
- Search-R1 (Jin et al. 2025): it trains a multi-turn search policy with reinforcement learning,
  which needs rollouts, a reward and GPU time we do not have before the 1 December freeze. Within
  one paper the right passage is already in the top 20, so a learned policy has little left to
  find, and each extra turn adds a judge call to a check that takes 16.5 s at the median.
  Multi-query search fits Ask (searches across the library) after the freeze. Finding a free PDF
  for the cited paper (56 of 86 failed checks) is also a search problem, but a fixed lookup such as
  the ACL Anthology is cheaper and gives the same answer every run.

## Open Questions

- Should Step 1 also cover single-citation sentences, where `judged` is the original sentence and
  the claim is the extractor's rewording? It doubles the eligible checks. Measure it as a second
  variant once the multi-citation case works.
- Does this wait for the "judge too strict or labels too generous" decision from the review page?
  If the labels are too generous, some of the 133 misses are not misses, and the eval will
  overstate what is left to gain.
- Freeze is 1 December. Step 1 and both evals fit only if they start this week.
