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
| `table-claims.jsonl` | 36 claims (18 supports/refutes pairs) from 5 tables of ColBERT, DPR and RocketQA; `figure` is the Docling table crop |

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

With `VISUAL_EVIDENCE` on, a claim the text leaves "insufficient" is asked again about the top ColPali figure hit. That second call gets the claim, the figure's crop as an image and its caption, but not the passages. Some claims rest on a number read off a chart that no passage or caption states. With `VISUAL_EVIDENCE` off, the judge reads text only, as before.

`figure-claims.jsonl` comes from `backend/make_figure_claims.py`. It keeps a figure only if the claim's key number is in neither the caption nor the 4 passages the judge gets. 51 figures from 19 papers passed that filter. Three readers checked every pair against its figure and kept 26. The other 25 had a wrong value, swapped labels, a series not in the figure, a contradicted value too close to the real one, or an unreadable figure.

Retrieval: for 51 of the 52 claims, ColPali's top figure hit is the figure the claim was written from. This used Ops-Colqwen3-4B on vLLM. Production's colqwen2-v1.0 gets 50 of 52: both misses are the two claims about CLIP's `figure-19.png`, and both got `figure-21.png`. Each claim was written from its own figure, so retrieval is easier here than for claims in real papers.

The judge on its own, with the claim's own figure (`backend/eval_figures.py --runs 3`), got 5, 5 and 6 of 52 right from text, and 48, 49 and 45 with the figure.

The whole pipeline (`eval_generated.py --runs 3 --fresh`, ColPali on, local ColBERT 64/300), mean of 3 runs. Each column is one way to give the judge the figure; the last one is what this change does:

| Claims | main (captions only) | Crop on every claim | Crop + passages when text says insufficient | Crop + caption when text says insufficient |
|---|---|---|---|---|
| `figure-claims.jsonl` (52) | 0.083 | 0.853 | 0.782 | 0.769 (spread 0.058) |
| `claims.jsonl` (278) | 0.977 | 0.966 | 0.976 | 0.976 (spread 0.007) |
| `caption-claims.jsonl` (148) | 0.975 | 0.899 | 0.975 | 0.986 (spread 0.000) |
| Errors (reply not JSON after one retry) | 0 | 20 | 3 | 5, all on figure claims |
| `eval_decisive.py` (13), kept per run | 12, 12, 11 | 11, 11, 11 | 9, 10, 10 | 11, 11, 11 |

With ColPali off, 0.109 on the figure claims.

The table above used Ops-Colqwen3-4B for ColPali. Production runs colqwen2-v1.0. The same last column with colqwen2-v1.0 (19 Oct 2026, same judge, ColBERT and claim sets):

| Claims | Ops-Colqwen3-4B | colqwen2-v1.0 |
|---|---|---|
| `figure-claims.jsonl` (52) | 0.769 (spread 0.058) | 0.756 (spread 0.019) |
| `claims.jsonl` (278) | 0.976 (spread 0.007) | 0.981 (spread 0.004) |
| `caption-claims.jsonl` (148) | 0.986 (spread 0.000) | 0.968 (spread 0.007) |
| Errors (reply not JSON after one retry) | 5, all on figure claims | 4, all on figure claims |
| `eval_decisive.py` (13), kept per run | 11, 11, 11 | 11, 11, 11 |

The decisive checks lost are the same two, rows 3 and 13.

3 caption claims that Ops-Colqwen3-4B got right in all 3 runs are wrong with colqwen2-v1.0. A second set of runs (b8d3df7, which records which judge call gave each verdict) shows that all 3 change in the text call. That call gets the captions of the ColPali pages next to the passages, so the ColPali model changes what the judge reads even when no crop is sent:

- `Finetuned-language-models-are-zero-shot-learners.pdf#140` (supports): Ops-Colqwen3-4B finds Figure 14, whose caption states the claim. colqwen2-v1.0 finds Figures 15 and 2, and the judge says refutes. This one is a retrieval loss.
- `Visual-spatial-reasoning.pdf#77` (refutes, "the cat is located below the keyboard"): colqwen2-v1.0 finds the right caption, Figure 13 "The keyboard is below the cat.", and the judge says supports. The judge read the relation the wrong way round. Ops-Colqwen3-4B finds unrelated figures, and the judge refutes from the passages.
- `Visual-spatial-reasoning.pdf#9` (refutes, "the person is located ahead of the cow"): colqwen2-v1.0 finds Figure 2, "The cow is ahead of the person. Label: False.", and the judge says supports. A false label does not show that the person is ahead of the cow either, so "refutes" was the wrong expected verdict.

The two claims whose figure call differs (`Finetuned-language-models-are-zero-shot-learners.pdf#143` and `#145`) keep their verdict.

Both VSR claims, and the two `Visual-spatial-reasoning.pdf#78` claims, were written from dataset-example captions (`Figure 2: Caption: ...`). #498 dropped their "supports" twins and made `make_eval_claims.py` skip such captions, so these 4 are now removed from `caption-claims.jsonl` too, leaving 144 claims. The tables above still count 148. Scored on the 144 (same runs, the 4 claims left out):

| ColPali | Caption claims (144), per run | Verdicts from the text call / figure call (432) |
|---|---|---|
| Ops-Colqwen3-4B | 0.986, 0.986, 0.986 | 428 / 4 |
| colqwen2-v1.0 | 0.979, 0.979, 0.979 | 427 / 5 |

colqwen2-v1.0 now misses one claim more than Ops-Colqwen3-4B, the FLAN #140 retrieval loss. The judge's direction error on #77 is tracked in #517.

- Crop on every claim: with a figure in the prompt, the judge read the text worse even when the text decided the claim. On caption claims it called 26 "supports" claims "refutes" over 3 runs, against 6 on main. In a logged run, 22 of 28 such false "refutes" came with a crop of a different figure than the caption's own. A guard that also named the crop's figure and told the judge to ignore an unrelated one did not help: prose 0.941, captions 0.890.
- Crop + passages, only when the text says insufficient: the text sets are back at main, but decisive row 8 (XTR) went from insufficient to refutes in all 3 runs. The crop was the paper's overview diagram; the judge reread the abstract and decided from it.
- Crop + caption, no passages: row 8 stays insufficient. The second answer can only come from the figure and its caption.

The decisive checks this changes with ColPali on, in all 3 runs:

- Row 13 (DensePhrases, labelled insufficient) becomes supports. The crop is the paper's Figure 1: it draws a passage as many phrase vectors and a search that picks single vectors, which is what the claim says.
- Row 3 (MTEB, labelled refutes) becomes supports. Without the figure it is insufficient, so it was already a miss. The crop is Figure 4, where SGPT-5.8B and GTR-XXL score highest, but the paper's text says no model wins on every task.

The merge gate runs with ColPali off. There the judge gets no image, and the signature, inputs and answer cache key are the same as on main. Run alone on the gateway, branch first, the off mode kept 11, 12, 12 with this change and 11, 12, 11 on main. Both builds lose row 3 every time. Row 13 flips in run 1 on both and once more on main, so these differences are the judge's run-to-run noise.

## Table crops for the judge (SCRUM-81)

Since #564, Docling's table crops go into ColPali with the figure crops. A table can then be the top hit that the figure judge looks at. The judge gets the crop and its caption, with the same prompt as for a figure.

`table-claims.jsonl` was written by hand from the table crops of `10.1145-3397271.3401075.pdf` (ColBERT, Tables 1-4), `10.18653-v1-2020.emnlp-main.550.pdf` (DPR, Tables 2 and 4) and `10.18653-v1-2021.naacl-main.466.pdf` (RocketQA, Table 2). Each "refutes" claim takes its number from the wrong row or column of the same table, or flips a comparison. The key numbers are in no caption. One reader wrote and checked them. Make the crops with `python -m app.pipeline.figures <pdf>` before a run.

The figure judge on its own (`backend/eval_figure_judge.py --runs 2`), 20 Oct 2026, gateway model `openai/qwen/qwen3.8-27b-nvfp4`, main's prompt and a prompt that names tables, run the same day:

| Prompt | Tables (36), per run | Figures (52), per run | False "supports" on tables (2 runs) | Replies not JSON (2 runs) |
|---|---|---|---|---|
| main (figure only) | 32, 33 | 48, 46 | 6 | 0 tables, 4 figures |
| names tables, row and column | 32, 33 | 46, 46 | 3 | 4 tables, 5 figures |

Main's prompt stays. The false "supports" on tables came from three claims, all row swaps: ColBERT Table 4 (143 against 154 GiB) and RocketQA Table 2 twice (ME-BERT's 33.8 given to ANCE, doc2query's 89.1 given to DeepCT).

## Tried and not adopted

| Idea | Result | Why not |
|---|---|---|
| bge-reranker-v2-m3 over ColBERT's top 20 | Ours top 4: 0.965 → 0.904 (+6 / -23 claims); SciFact 0.763 → 0.797 | Hurts ranking within one paper, which is what the pipeline does; +120-160 ms per claim |
| Judge prompt v1: check numbers, comparisons, direction, table column; without the "different words" sentence | False "supports" 15 → 12 (prose), 6 → 3 (captions); `eval_decisive.py` 12 → 11 | It made the judge demand the claim's exact terms (DensePhrases row) |
| Judge gets 6 passages instead of 4 | Prose 0.955 → 0.948, captions 0.934 → 0.954 (inside the spread); `eval_decisive.py` 12 → 10 | The extra passages gave the judge contradicting-looking text on real rows; +18% time |
| Figure judge prompt that names tables and their rows and columns | Tables 32, 33 of 36 on both prompts; figures 46, 46 against 48, 46 | No gain outside the spread; 4 replies on tables were not JSON, against 0 |
| jina-embeddings-v4 instead of ColBERT | Best retrieval scores above | `eval_decisive.py` kept 9 of 13 against ColBERT's 12; 14x slower to index; research-only licence |

## Caveats

- The results above were measured on the first 433 claims. Reading the 19 claims that failed in every run showed 7 whose expected verdict was wrong, so they were removed: two Visual-spatial-reasoning dataset examples labelled "False" taken as facts, two "refutes" claims that another passage of the paper states as true, one "supports" claim that overstates its passage, and two ambiguous ones. The other 12 are real pipeline errors.
- The claims are LLM-written and each has one gold passage. A broad claim can be supported by other passages too, so a retrieval "miss" is sometimes a fair answer.
- These claims may favour LLM-based retrievers: jina-v4 led here and was worst on the real rows.
- Verdict runs use the shared LLM gateway. Gateway failures show up as "error" verdicts; read the confusion counts before comparing two runs.
