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

## Rerun after the fixes

The same 10 papers were checked again on 2026-10-16 with the backend at `13fad25`. That is
main with #437 (judge sees what the citation is for), #436 (title match checks year and first
author), #438 (a bad bib URL falls back to the title) and #439 (existence check by title).
The setup was the same as above, with an empty verdict and source cache. The 10 checks took
40 s to 320 s each, 18 minutes in all.

Every citation was matched to its row in `ai-scientist-cases.csv` by paper, line and bib
key, and the new verdict was set against the first run's reading. The new verdicts were not
read again one by one. The comparison assumes the first run's reading still holds, which is
true when the claim and the passage are the same.

| Reading in the first run | Citations | First run | Rerun |
|---|---|---|---|
| Right "supports" | 35 | 35 supports | 31 supports, 4 insufficient |
| M: miscitation | 15 | 3 refutes, 12 insufficient | 7 refutes, 7 insufficient, 1 unavailable |
| P: source backs part of it | 10 | 10 insufficient | 2 refutes, 4 insufficient, 4 supports |
| B: claim about the whole field | 13 | 13 insufficient | 9 insufficient, 4 supports |
| O: own setup, wrongly flagged | 27 | 5 refutes, 22 insufficient | 1 refutes, 9 insufficient, 17 supports |
| J: judge mistake | 13 | 4 refutes, 8 insufficient, 1 supports | 2 refutes, 2 insufficient, 9 supports |
| R: checked against the wrong "Deep learning" | 17 | 15 insufficient, 2 supports | 17 unavailable |
| Unavailable: EDM's OpenReview page | 6 | 6 unavailable | 5 supports, 1 insufficient |
| Unavailable: other reasons | 15 | 15 unavailable | 15 unavailable |
| No bib entry | 1 | unchecked | unchecked |

What changed, by ticket:

- #436: all 17 citations of `goodfellow2016deep` are now "unavailable", with the reason
  "arXiv has only other works titled 'Deep learning': Deep Learning (2018, Nicholas G.
  Polson)". The book has no free copy, so nothing can be judged against it. That is the
  honest answer.
- #438: the 6 citations of EDM whose bib URL is an OpenReview page are now judged against
  arXiv 2206.00364. The 7 GAN citations stay "unavailable" with the 404 message. Semantic
  Scholar knows the paper but has no free PDF, and arXiv titles it "Generative Adversarial
  Networks", which is below the 0.9 title match for "Generative adversarial nets".
- #439: 122 citations now have an existence answer from their title and first author, and
  all 122 are "yes". None was wrongly called made up. The other 30 have a DOI-less entry
  with a link, or no author, so they are not looked up.
- #437: own-setup flags fell from 27 to 10, and judge-mistake flags from 12 to 4. The cost
  is 8 right flags turned into "supports" (4 of 10 P and 4 of 13 B), and 4 right "supports"
  turned into "insufficient". All 15 miscitations are still flagged or unavailable.

In all, the checks raised 92 flags (refutes or insufficient) in the first run and 48 now.
Flags that are right on reading (M, P and B) went from 38 of 92 to 29 of 48. Of the other
19 flags now, 10 are own-setup, 4 are judge mistakes, 4 are on citations the first run
read as rightly supported, and 1 is an EDM citation nobody has read yet.

## Not done

- The wrong verdicts are not in the labeled set for #423 yet. The readings above are one
  person's, so a labeler should confirm them first. The CSV has what the Labeler page
  needs to find each pair: the paper, the line and the bib key.
- The DOI check (#421) is not measured here, because no entry had a DOI. The title check
  from #439 is measured in the rerun.
- ColPali was off, so figure and table evidence was not used. A verdict that depends on a
  figure could differ in production.

## Running it again

`backend/eval_draft_checks.py` uploads each LaTeX project in a folder and saves each
check's JSON. Start a gateway with login off (no `SUPABASE_URL`) and its own
`ANALYSES_DB`, then:

    python eval_draft_checks.py <AI-Scientist>/example_papers results/ http://127.0.0.1:8082

Compare the counts in the tables above, code by code, using `ai-scientist-cases.csv`.
