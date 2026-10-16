# Citation checks on the AI Scientist's generated papers (#425)

Sakana's AI Scientist publishes 10 papers that it wrote itself, with their LaTeX and `.bib`
files, in `example_papers/` of github.com/SakanaAI/AI-Scientist. Its own write-up says
they contain inaccurate citations. We ran the Author check on all 10 to see what it flags
and whether each flag is right.

The sentences quoted here and in `ai-scientist-cases.csv` come from those
machine-generated papers. The papers themselves are not in this repo. They are under "The
AI Scientist Source Code License v1.0", which allows this use and asks that shared generated
text say it was machine-generated.

## Setup

- Run on 2026-10-16 with the backend at `2804a71` (main plus #433, so the DOI check from
  #421 and the quote audit from #422 were both on).
- Each paper's `latex/template.tex` and `latex/references.bib` were uploaded as one zip
  to `POST /author/drafts/upload`, then checked with `POST /author/drafts/{id}/check`.
- Judge: `qwen3.8-27b-fp8`. Text search: the production ColBERT service. ColPali was off,
  so no figure captions were used. `PARALLEL_CHECKS=3`.
- The gateway ran in a throwaway container with login, Supabase and Redis off and its own
  SQLite file, so nothing was written to shared data.
- Each flagged citation and each "supports" was read against the passage the judge was
  given, and against the cited paper where the passage was not enough. One person read
  them; a labeler has not checked the readings.

## Results

152 citations (each `\cite` key in each sentence counts once). The 10 checks took 20 s to
380 s each.

| Verdict | Citations | Right on reading | Wrong | Checked against the wrong paper |
|---|---|---|---|---|
| supports | 38 | 35 | 1 | 2 |
| refutes | 12 | 3 | 9 | 0 |
| insufficient ("source is silent") | 80 | 35 | 30 | 15 |
| unavailable | 21 | all 21 are real papers we could not download | | |
| unchecked (no bib entry) | 1 | 1 | | |

What "right" means for each flag, from the `code` column of `ai-scientist-cases.csv`:

| Code | Meaning | refutes | insufficient |
|---|---|---|---|
| M | A miscitation: the cited work does not say this | 3 | 12 |
| P | The source backs part of the sentence, not all of it | | 10 |
| B | A claim about the whole field, which the cited paper cannot make | | 13 |
| O | Wrong: the sentence states the paper's own setup and cites a method or tool for it | 5 | 22 |
| J | Wrong: the judge misread the claim or missed the passage | 4 | 8 |
| R | Checked against arXiv 1807.07987 instead of the Goodfellow et al. book | | 15 |

## What the checks got right

- 15 real miscitations. Some examples:
  - DDPM is said to use an MLP; it uses a U-Net.
  - Song et al.'s SDE paper is said to integrate GANs; it leaves that as future work.
  - TabDDPM is said to combine diffusion with GANs; it is compared against them.
  - The Adam paper is cited for pruning and for policy-gradient learning rates.
  - PyTorch is cited for MDL, and Bahdanau et al. for the Information Bottleneck and for
    the Transformer's self-attention.
  - EDM is said to propose a multi-scale architecture.
- One `\cite{loshchilov2016sgdr}` whose key is not in the paper's `.bib`.
- No reference was made up. All 21 unavailable sources are real, well-known papers. This
  matches how the AI Scientist builds its bibliography: it copies entries from search
  results, so the papers exist, but the claims made about them are not checked.

## What went wrong, and the tickets for it

1. **Own setup judged against a method citation: 27 of 92 flags.** For example, "We
   used AdamW \cite{loshchilov2017adamw} with beta_2 = 0.98" was refuted because the
   AdamW paper uses 0.999. #437 (SCRUM-322).
2. **A title-only entry matched a different paper.** `goodfellow2016deep` has only a
   title, "Deep learning", and the title search returned arXiv 1807.07987, a 2018 paper
   with the same title. All 18 of its citations were judged against that paper: 16
   insufficient (one of them still a miscitation whatever the source) and 2 supports.
   #436 (SCRUM-321).
3. **A bib URL that does not give a PDF ends the search.** EDM's URL is an OpenReview
   page (6 citations) and the GAN paper's NeurIPS link returns 404 (7 citations). Both are
   free on arXiv. #438 (SCRUM-323).
4. **The existence check from #421 never ran.** None of the 152 entries has a DOI, and the
   check only looks up DOIs. #439 (SCRUM-324).
5. **Judge mistakes: 12 flags and 1 "supports".** Two refutes read DDPM's "there has been no
   demonstration…" (about the field before DDPM) as DDPM's own result. Others missed a
   passage the paper has (Power et al. do train Transformers). These have no ticket of
   their own. #423's labeled set and `eval_verdicts.py` are where they would be measured.

The other unavailable sources: four papers have no open copy that Semantic Scholar knows
(GPT-2, Glorot & Bengio, Ko et al. and Xu et al.: 6 citations), one arXiv ID returned 404,
and one PDF failed to index.

## Not done

- The wrong verdicts are not in the labeled set for #423 yet. The readings above are one
  person's, so a labeler should confirm them first. The CSV has what the Labeler page
  needs to find each pair: the paper, the line and the bib key.
- The DOI check (#421) is not measured here, because no entry had a DOI. #439 covers
  entries without one.
- ColPali was off, so figure and table evidence was not used. A verdict that depends on a
  figure could differ in production.

## Running it again

`backend/eval_draft_checks.py` uploads each LaTeX project in a folder and saves each
check's JSON. Start a gateway with login off (no `SUPABASE_URL`) and its own
`ANALYSES_DB`, then:

    python eval_draft_checks.py <AI-Scientist>/example_papers results/ http://127.0.0.1:8082

Compare the counts in the tables above, code by code, using `ai-scientist-cases.csv`.
