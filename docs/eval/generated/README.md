# Generated-claim evals

Two evals that decided #490 and #492:

- **Retrieval**: is the passage a claim was written from among the 4 passages the judge gets? It scores ColBERT alone, so it can compare encoders, passage cutting and rerankers.
- **Verdicts**: does the whole pipeline, retrieval and judge, return the claim's known verdict? `backend/eval_generated.py` runs 426 claims. `backend/eval_decisive.py` (13 real production checks) stays the merge gate in `CONSTRAINTS.md`.

The claims were written by the project LLM from passages of the 28 papers in `papers.csv`. A "supports" claim restates its passage; a "refutes" claim changes one fact in it. So the kind is the expected verdict and the passage index is the retrieval gold, and neither comes from a retriever.

ColBERT settings are written query/passage token limits: "64/300" is `QUERY_LEN, DOC_LEN = 64, 300` in `services/colbert/encoder.py` (main since #490); "32/180" is the checkpoint's own setting that main used before.

## Files

| File | What |
|---|---|
| `papers.csv` | The 28 PDFs: file name as saved in `data/papers`, and source URL |
| `claims.jsonl` | 278 claims from 168 prose passages: `id`, `paper`, `gold` (passage index), `kind`, `text` |
| `caption-claims.jsonl` | 148 claims from 300 sampled figure and table captions; `caption` is the caption text a passage must hold whole to count |
| `figure-claims.jsonl` | 52 claims (26 supports/refutes pairs) that only a figure can decide; `figure` is the Docling crop the claim was written from |

`gold` in `claims.jsonl` indexes passages cut with 120-word windows and no caption breaks, the `pdf_passages` of #490 (commit 5ae4133). To score it, export passages with that version of `services/colbert/store.py`. Caption claims are scored by caption text, so they work with any cutting.

## Run it

The PDFs are not in the repo. Save them in `data/papers` under the names in `papers.csv` (the URL column says where each came from).

Retrieval runs in the colbert image (pypdf, torch, the service's `store.py` and `encoder.py`), from `services/colbert`:

```bash
# 1. cut the PDFs into the passages the service indexes
python eval/export_passages.py data/papers passages.jsonl
# 2. rank each claim against its own paper's passages with the encoder.py next to store.py
python eval/rank_passages.py passages.jsonl ../../docs/eval/generated/claims.jsonl ranks_main.jsonl
# 3. to compare a change, run 1-2 again with the changed store.py or encoder.py mounted over /app,
#    writing ranks_change.jsonl; the first ranks file is the baseline
python eval/score_retrieval.py ../../docs/eval/generated/claims.jsonl ranks_main.jsonl ranks_change.jsonl
# caption claims: one passages + ranks pair per cutting
python eval/rank_passages.py passages.jsonl ../../docs/eval/generated/caption-claims.jsonl caption_ranks.jsonl
python eval/score_captions.py ../../docs/eval/generated/caption-claims.jsonl passages.jsonl caption_ranks.jsonl
# a reranker over the top 20
python eval/rerank.py passages.jsonl ../../docs/eval/generated/claims.jsonl ranks_main.jsonl ranks_reranked.jsonl
# SciFact: writes scifact/scifact_passages.jsonl and scifact/scifact_claims.jsonl for steps 2-3
python eval/scifact.py scifact
```

Verdicts run in the worker container (it reaches ColBERT and the LLM), from `backend`:

```bash
python eval_generated.py ../docs/eval/generated/claims.jsonl ../docs/eval/generated/caption-claims.jsonl --runs 3 --fresh
# new claims, from a passages.jsonl made by step 1
python make_eval_claims.py passages.jsonl claims.jsonl --per-paper 6
python make_eval_claims.py passages.jsonl caption-claims.jsonl --captions --sample 300
```

`--fresh` turns off the answer cache for the run. `--evidence-count N` overrides `verify.EVIDENCE_COUNT` (the passages the judge gets) for one run, `--out` saves every claim's verdicts, and `COLBERT_URL` points the run at another ColBERT.

## Results so far (RTX 5070 Ti, `qwen3.8-27b` judge, 17-18 Oct 2026)

Retrieval on `claims.jsonl` (282 claims) and SciFact (300 claims):

| Retriever | Ours, top 4 | Ours, top 1 | SciFact, top 4 | SciFact nDCG@10 | Encode 2,806 passages |
|---|---|---|---|---|---|
| ColBERT 32/180 | 0.936 | 0.805 | 0.697 | 0.646 | 7.5 s |
| ColBERT 32/300 | 0.957 | 0.826 | 0.737 | 0.692 (paper: 69.3) | 10.4 s |
| ColBERT 64/300 (main) | 0.965 | 0.851 | 0.763 | 0.699 | 10.3 s |
| jina-embeddings-v5-text-small | 0.929 | 0.688 | 0.813 | 0.766 (paper: 76.5) | 30 s |
| jina-embeddings-v4, multi-vector | 0.989 | 0.940 | 0.833 | 0.771 | 145 s, 10-15 GB GPU |

Caption claims (151), whole caption among the top 4: 0.762 with 120-word windows, 0.954 with caption passages (#492).

Verdict accuracy, `eval_generated.py --runs 3 --fresh`, mean of 3 runs. Before SCRUM-347, `--fresh` left dspy's LM cache on, so runs 2 and 3 mostly replayed run 1 and the spread looked smaller than it is. With the cache off, the run-to-run spread is 0.004 on prose claims and 0.027 on caption claims, and up to 0.039 for one kind (caption "refutes"); 18 of the 426 claims changed verdict between runs. Smaller differences are noise.

| Setup | Prose claims (282) | Caption claims (151) | `eval_decisive.py` (13) |
|---|---|---|---|
| 64/300, 120-word windows | 0.960 | 0.874 | 11, 11, 11 |
| 64/300, caption passages (before SCRUM-345) | 0.955 | 0.934 | 12, 12, 12 |
| + judge checks numbers, direction and table columns (SCRUM-345) | 0.948 (runs 2-3: 0.961) | 0.927 (runs 2-3: 0.947) | 12, 12, 12 |
| Same, dspy's LM cache off, 7 faulty claims dropped (SCRUM-344, SCRUM-347) | 0.965 (278) | 0.962 (148) | 12, 12, 12 (DensePhrases row now insufficient) |

## Figure evidence for the judge (SCRUM-346)

With `VISUAL_EVIDENCE` on, the judge also gets the crop of the top ColPali figure hit as an image. Some claims rest on a number read off a chart that no passage or caption states. With it off, the judge reads text only, as before.

`figure-claims.jsonl` comes from `backend/make_figure_claims.py`. It keeps a figure only if the claim's key number is in neither the caption nor the 4 passages the judge gets. 51 figures from 19 papers passed that filter. Three readers checked every pair against its figure and kept 26. The other 25 had a wrong value, swapped labels, a series not in the figure, a contradicted value too close to the real one, or an unreadable figure.

Retrieval: for 51 of the 52 claims, ColPali's top figure hit is the figure the claim was written from. This used Ops-Colqwen3-4B on vLLM, not production's colqwen2-v1.0. Each claim was written from its own figure, so retrieval is easier here than for claims in real papers.

The judge on its own, with the claim's own figure (`backend/eval_figures.py --runs 3`), got 5, 5 and 6 of 52 right from text, and 48, 49 and 45 with the figure.

The whole pipeline (`eval_generated.py --runs 3 --fresh`, ColPali on, local ColBERT 64/300), mean of 3 runs:

| Claims | ColPali off | main, ColPali on (captions only) | This change, ColPali on (crop to the judge) |
|---|---|---|---|
| `figure-claims.jsonl` (52) | 0.109 | 0.083 | 0.853 (supports 0.872, refutes 0.833; spread 0.058) |
| `claims.jsonl` (278) | | 0.977 (spread 0.004) | 0.966 (spread 0.011) |
| `caption-claims.jsonl` (148) | | 0.975 (spread 0.014) | 0.899 (spread 0.000) |
| `eval_decisive.py` (13), kept per run | | 12, 12, 11 | 11, 11, 11 |

The crop helps the claims only a figure can decide and hurts the rest:

- Caption "supports" claims: 0.972 on main, 0.838 with the crop. Over the 3 runs the judge called 26 of them "refutes", against 6 on main. A likely cause is that the top ColPali hit is not the figure the caption belongs to, and the judge trusts the image over the caption. That is not checked yet: the runs did not save per-claim verdicts.
- Prose claims: 12 "supports" claims judged "refutes", against 6 on main.
- 17 errors on the 426 claims, against none on main: replies that were not valid JSON even after one retry.
- On the figure claims, the crop turned 11 "refutes" claims into "supports" over the 3 runs, and gave 3 errors.

The decisive check that changes with ColPali on is DensePhrases (row 13, labelled insufficient). The crop is the paper's Figure 1: it draws a passage as many phrase vectors and a search that picks single vectors, which is what the claim says. So the judge says supports in all 3 runs. The text alone does not say it, and the merge gate runs with ColPali off, so the row stays insufficient.

With ColPali off, the judge gets no image and the answer cache key is unchanged. In the same session, with another eval sharing the LLM gateway, this change kept 12, 11, 12 and main kept 11, 11, 11. Both builds lose row 3 every time. Row 13 turns into supports in 1 of 3 runs here and 2 of 3 on main, and main also lost row 8 once. These rows move with the judge's run-to-run noise, not with this change.

## Tried and not adopted

| Idea | Result | Why not |
|---|---|---|
| bge-reranker-v2-m3 over ColBERT's top 20 | Ours top 4: 0.965 → 0.904 (+6 / -23 claims); SciFact 0.763 → 0.797 | Hurts ranking within one paper, which is what the pipeline does; +120-160 ms per claim |
| Judge prompt v1: check numbers, comparisons, direction, table column; without the "different words" sentence | False "supports" 15 → 12 (prose), 6 → 3 (captions); `eval_decisive.py` 12 → 11 | It made the judge demand the claim's exact terms (DensePhrases row) |
| Judge gets 6 passages instead of 4 | Prose 0.955 → 0.948, captions 0.934 → 0.954 (inside the spread); `eval_decisive.py` 12 → 10 | The extra passages gave the judge contradicting-looking text on real rows; +18% time |
| jina-embeddings-v4 instead of ColBERT | Best retrieval scores above | `eval_decisive.py` kept 9 of 13 against ColBERT's 12; 14x slower to index; research-only licence |

## Caveats

- The results above were measured on the first 433 claims. Reading the 19 claims that failed in every run showed 7 whose expected verdict was wrong, so they were removed: two Visual-spatial-reasoning dataset examples labelled "False" taken as facts, two "refutes" claims that another passage of the paper states as true, one "supports" claim that overstates its passage, and two ambiguous ones. The other 12 are real pipeline errors.
- The claims are LLM-written and each has one gold passage. A broad claim can be supported by other passages too, so a retrieval "miss" is sometimes a fair answer.
- These claims may favour LLM-based retrievers: jina-v4 led here and was worst on the real rows.
- Verdict runs use the shared LLM gateway. Gateway failures show up as "error" verdicts; read the confusion counts before comparing two runs.
