# Labeling data

The **Labeler** role (pick it on the first screen, or open `?role=labeler`) builds the dataset the
DSPy GEPA optimizer trains on and the system's own evaluation scores against. Everything is decided
by a person: claim extraction and RAG retrieval only supply what is shown first, and nothing is
saved until someone saves it.

## One-time setup

Labels are saved in Supabase, in the `labeling_rows` table
(`supabase/migrations/20261012160000_labeling_rows.sql`, plus `20261013120000_labeling_rows_paper_index.sql`,
an index so one paper's rows are read without scanning the whole tab). The gateway needs `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, which it already has when login is on. Anyone who signs in can label.
Until those are set the page says "Labels cannot be saved yet".

## Where the papers come from

The queue lists only papers brought in on purpose, from Scopus. Under **Add papers from Scopus** pick a
topic (CV, NLP, SE or HPC), optionally a few words, and a year; Scopus returns open-access papers of that
topic's conferences and journals (the venue lists are `VENUES` in `backend/app/labeling/scopus.py`).
**Add** reads the paper like any other analysis (its DOI goes to Semantic Scholar, Unpaywall and arXiv for a
PDF) and lists it for the whole team under that topic. A paper with no reachable PDF shows why and can be
removed. Needs `SCOPUS_API_KEY` in the gateway's `.env` (a key from https://dev.elsevier.com); without it the
page says the search is not set up. Scopus gives metadata, not PDFs, which is why the PDF is looked for
elsewhere.

Each result shows how strong its venue is. A journal gets its CiteScore quartile: the best subject
percentile in the latest complete CiteScore year, looked up by ISSN from Elsevier's Serial Title API with the
same key (Scopus counts the 75th-99th percentile as Q1). A conference gets its CORE rank (A*, A, B, C) from
the ICORE2026 table at https://portal.core.edu.au/conf-ranks, written by hand next to the topic venues in
`VENUES`; any other conference shows "unranked", because matching a proceedings title to a CORE row by
similar words can pick the wrong conference. SJR quartiles are not used: SCImago's legal notice asks for
written permission to reproduce its data. The rank is saved with a paper when it is listed and goes into
the labels CSV as `venue_rank` and `venue_rank_source` (for example `Q1`, `CiteScore 2025`), so a table of
the labeled papers by venue rank can be made from the export. Papers listed before 26 Oct 2026 have no rank.

## Working a paper

1. Add the paper from Scopus (above). Its claims and the passages found for them are what the page starts
   from.
2. Open it under **Papers to label**. Left: the paper at the claim's sentence. Right: the reference
   paper at the passage you picked.
3. For each claim: **Keep**, **Edit** or **Reject** it. Judge every passage **Relevant / Not
   relevant**. Add what retrieval missed (a claim, or a passage in a cited paper). Give every
   reference you called relevant a 1-4 level and the reason (`1`-`4` keys label the reference on
   the right). **Save** writes that claim's rows; **Ctrl/⌘+S** works too.
   A cited paper the pipeline could not download is still in the add form, marked "(no PDF)":
   paste the passage from your own copy, with its page, and give it a level. It never opens on the right.

The 1-4 labels grade how well the reference passage backs the claim (1 no support, 2 weak, 3 clear, 4 strong). The wording is `LEVELS` in `frontend/src/lib/labeling.ts`. How to choose a level, with examples and the hard cases, is in `docs/annotation-guideline.md`.

## What is saved

One row per save, in `labeling_rows` (`tab` + a JSON `data` row). Append-only; a later row for the same key replaces an earlier one when read back.

Every row carries `annotator` (the person's name when it was written, for reading) and `annotator_id` (their
account). Rows belong to the account: renaming yourself keeps your labels, and two people with the same name
stay apart. Topics in "Who labels what" are still kept by name.

| tab | one row per | use |
| --- | --- | --- |
| `claims` | claim judged (`extracted` / `human_added`; `accepted` / `edited` / `rejected`) | claim-extraction precision and recall |
| `candidates` | passage judged (`retrieved` / `human_added`; `relevant` / `rejected`), with its RAG rank and score | retrieval recall and precision |
| `labels` | (claim, reference paper) with `evidence` 1-4, `rationale`, `spans`, `confidence` | GEPA train / val / test |

Opening a paper reads only that paper's rows. Each paper in the queue shows how many of its claims you have
decided (keep, edit or reject; a claim you added by hand is not counted), a progress bar, and who else has labeled it. The button says
Label before you start, Continue part-way and Review once every claim has your decision; a claim with a decision
can still have passages or a level left, which the workspace shows: its bar counts a claim as finished only when the passages and levels are done too. Papers you have not finished list before finished ones
within a topic. Removing a paper from the team's list asks first; saved labels are kept.

Two people can label the same pair: the page tells the second person it was already labeled. Keep a
double-labeled subset in the test split and measure agreement (weighted kappa) before trusting it.

## Ask AI

**Ask AI** under the claim panel has two parts:
- **Review** works only on a claim you saved, with no unsaved changes. It points out passages you
  have not judged, a relevant reference with no level, a level with no relevant passage, and a level
  with no reason. Then it shows how the pipeline's judge reads the passages you marked relevant. A
  cursor moves to each thing it talks about.
- **Ask a question** answers from the paper under review or from one of the references this claim
  cites. The answer is the same checked statements as Ask in the other roles.

The review never changes or proposes a label. The judge reads the whole claim, but a level grades only
the part the reference is cited for. On 20 Oct 2026 it agreed with 1 of the 14 saved levels: it said
"insufficient" on 13 levels of 3 or 4. So where it disagrees, it asks whether your level holds.

Each review is kept in the `reviews` tab (ts, annotator, annotator_id, paper_id, claim_id, and the
findings as JSON). Every later save of that claim writes `ai_reviewed = "1"` on its `claims`,
`candidates` and `labels` rows. Before using labels to train or score anything, report the numbers
with and without the `ai_reviewed` rows, since the AI may have swayed those.

## Making the GEPA files

"Download labels CSV" (or `/api/labeling/export?tab=labels`) gives the current labels, without the
claims and passages their author later rejected or removed. Then:

```
uv run --with pandas --with scikit-learn python split_dataset.py labels.csv
```

fills `split` in equal thirds, balanced on label and topic (the export's `topic` column), with a paper and every paper that shares one of its
references kept in one split, so nothing leaks between train, val and test. A topic needs papers in at least three such groups to reach every split. Add the paper text
(or the retrieved passages) from `paper_id` / `reference_id` when you build the `dspy.Example`s.

## Topics

The queue has a "Who labels what" panel: pick CV, NLP, SE or HPC for anyone on the team (the panel lists each domain's conferences and journal).
A paper's owner shares it with a dropdown next to the paper ("Not shared" by default). Shared papers,
and the papers their claims cite, open for every signed-in person under "Shared by the team", with
the viewer's own topic first. Unsharing takes it back. Both choices are `assignments` rows, appended like everything else, so the table shows who set what and when.

## Blind checks

A blind check is a paper someone else already labeled, which a second person labels again on their
own, so the team can measure how well people agree (`human_agreement` in `backend/app/evaluation.py`).
A lead (an e-mail in `LABELING_LEADS`) assigns them under **Blind checks** in the sidebar, picking a
person who has not labeled the paper, ideally from another topic. The person finds the paper under
that tab only; it is left out of "Papers to label". While they label it, other people's labels are
hidden, nobody else is named, and Review and Ask are off, so the judge cannot sway the level. Only a
lead can download the whole team's labels, for the same reason. Each assignment is an
`assignments` row of kind `blind`, appended like the others.

## Examples for a DSPy program

A fact-check program has two steps, and each gets its own file from `/api/labeling/export`:

| `tab=` | signature | one record per | fields |
| --- | --- | --- | --- |
| `dspy_claims` | `article -> claims: list[str]` | paper and annotator | `article`, `claims` (kept or edited, as they should read), `rejected` (hard negatives) |
| `dspy_verdicts` | `claim, source -> verdict` | claim, reference and annotator | `claim`, `source` (the passages called relevant), `verdict` ("1"-"4"), `verdict_name`, `rationale`, `confidence` |

Both are JSONL. A paper whose PDF is not on the server has no `article`, so it is left out of
`dspy_claims`; a label with no relevant passage has no `source`, so it is left out of
`dspy_verdicts`. Every record keeps `paper_id`, so a split into train, validation and test can keep each paper
whole (see below).

```python
import json, dspy

rows = [json.loads(line) for line in open("dspy_verdicts.jsonl")]
trainset = [
    dspy.Example(claim=r["claim"], source=r["source"], verdict=r["verdict"]).with_inputs("claim", "source")
    for r in rows
]
```
