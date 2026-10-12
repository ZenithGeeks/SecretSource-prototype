# Labeling data

The **Labeler** role (pick it on the first screen, or open `?role=labeler`) builds the dataset the
DSPy GEPA optimizer trains on and the system's own evaluation scores against. Everything is decided
by a person: claim extraction and RAG retrieval only supply what is shown first, and nothing is
saved until someone saves it.

## One-time setup

1. Create a Google service account, enable the Sheets API, download its key file.
2. In `.env` set `LABELING_SHEET_ID` (from the Sheet's URL), `LABELING_GOOGLE_CREDENTIALS` (the key
   file path). Anyone who signs in can label.
3. Share the Sheet with the service account's address as an **Editor**. The page shows the address
   under "The Sheet is not set up yet" until the settings are in.

## Working a paper

1. Analyse the paper first (Researcher role). Its claims and the passages found for them are what
   the page starts from. Only your own finished analyses show up.
2. Open it under **Papers to label**. Left: the paper at the claim's sentence. Right: the reference
   paper at the passage you picked.
3. For each claim: **Keep**, **Edit** or **Reject** it. Judge every passage **Relevant / Not
   relevant**. Add what retrieval missed (a claim, or a passage in a cited paper). Give every
   reference you called relevant a 1-4 level and the reason (`1`-`4` keys label the reference on
   the right). **Save** writes that claim's rows; **Ctrl/⌘+S** works too.

The 1-4 labels grade how well the reference passage backs the claim (1 no support, 2 weak, 3 clear, 4 strong). The wording is `LEVELS` in `frontend/src/lib/labeling.ts`.

## What lands in the Sheet

Append-only; a later row for the same key replaces an earlier one when read back.

| tab | one row per | use |
| --- | --- | --- |
| `claims` | claim judged (`extracted` / `human_added`; `accepted` / `edited` / `rejected`) | claim-extraction precision and recall |
| `candidates` | passage judged (`retrieved` / `human_added`; `relevant` / `rejected`), with its RAG rank and score | retrieval recall and precision |
| `labels` | (claim, reference paper) with `evidence` 1-4, `rationale`, `spans`, `confidence` | GEPA train / val / test |

Two people can label the same pair: the page tells the second person it was already labeled. Keep a
double-labeled subset in the test split and measure agreement (weighted kappa) before trusting it.

## Making the GEPA files

"Download labels CSV" (or `/api/labeling/export?tab=labels`) gives the current labels, without the
claims and passages their author later rejected or removed. Then:

```
uv run --with pandas --with scikit-learn python split_dataset.py labels.csv
```

fills `split` in equal thirds, label-balanced, with a paper and every paper that shares one of its
references kept in one split, so nothing leaks between train, val and test. Add the paper text
(or the retrieved passages) from `paper_id` / `reference_id` when you build the `dspy.Example`s.
