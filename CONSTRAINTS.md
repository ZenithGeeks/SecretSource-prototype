# Constraints

Last reviewed: 2026-10-17 by @EarthWittawat

This file holds the numbers a change must not break: running cost, verdict quality and
analysis time.
Do not weaken a number here to make a change pass; change it in its own pull request, with
the reason.

## Cost budget

An active user should cost us less than half of what the closest paid tool charges.
scite, which also shows whether a citation supports a claim, is $20 a month on monthly
billing (SciSpace Premium is the same, Consensus about $10). Half leaves room for a paid
LLM and for users who do not pay.

An active user is someone who starts at least one analysis in the month.

| Rule | Number | Why this number |
| --- | --- | --- |
| Cost per active user per month | at most $10 | half of scite's $20 monthly price |
| Analyses per active user per month | plan for 20 | a thesis student checking a draft and its main sources each week |
| Cost per analysis, Cloud Run plus LLM priced as if paid | at most $0.50 | $10 divided by 20 analyses |
| Services that bill with no traffic | none | idle settings cost $4.51 a day from 2 to 16 Oct 2026 with no analyses |

The LLM is priced at Gemini 2.5 Flash list prices ($0.30 input, $2.50 output per million
tokens) even though Qwen on 9arm is free to us today, so the budget still holds if we have
to pay for one.

## How it is checked

| Rule | Checked by | Runs |
| --- | --- | --- |
| Cost per analysis, idle settings | `python deploy/cost/report.py --days 7` | by hand, once a week; it warns and does not block |
| Services that bill with no traffic | the same report, line "Bills with no traffic" | once a week |
| ColPali GPU left on | Cloud Scheduler job `gpu-guard-colpali` and the alert "GPU Cloud Run service billed continuously" | every hour, in Google Cloud |
| Gateway left on | Cloud Scheduler job `scale-guard-gateway` | every hour, in Google Cloud |

A Cloud Billing budget alert would be the better outside check, but the project bills to a
university account we cannot change. Ask its admin for one before relying on the report
alone.

## Measured, not yet within budget

| Metric | Today | Direction |
| --- | --- | --- |
| Cost per analysis, Cloud Run only | about $1.11 (Cloud Run spend on 15 and 16 Oct 2026 divided by the analyses those days; README "Cost and speed") | must fall to $0.50 |
| LLM tokens per analysis | each analysis record has `llm_tokens` from SCRUM-326 on, keyed like `judge_prompt` | must not grow without a reason in the PR |

The largest part was the ColPali GPU, about $0.75 of the $1.11. Since #446 checks leave it out
by default; measure again with the report a week after that deploy. The README section "Cost
and speed" lists what else would close the gap.

## Verdict quality

A change to the prompts, the retrieval, the passage cutting or the models must not lose a check
that production found decisive. A lost "backed" or "contradicted" check is the costly error: the
reader never learns the paper cited a source that settles the claim.

| Rule | Number | Why this number |
| --- | --- | --- |
| Decisive checks kept, in every one of 3 runs without the answer cache | at least 12 of 13 | measured with dspy's LM cache off on 18 Oct 2026, after SCRUM-348: 13, 12, 12 |

The 13 rows in `docs/eval/decisive-checks.csv` are the checks production rated backed (9) or
contradicted (4) on arXiv 2409.12191, 2407.01449 and 2112.01488. They are production's verdicts,
not human labels, so this rule checks that verdicts stay put, not that they are right. Two rows
were corrected by hand in #490: production said contradicted for the ColBERT check (2004.12832)
and the DensePhrases check (2021.acl-long.518), but both claims hold, so they now expect backed.
A third was corrected in SCRUM-343: production said contradicted for the late-interaction engines
check (2304.01982), but the sentence it rests on is about plain ColBERT scoring, not the engines
the claim names, so it now expects insufficient. With these labels, ColBERT 32/180 and 64/300
with plain 120-word windows each keep 11. The row that is not kept is the MTEB check (2210.07316):
production said contradicted, the current pipeline says insufficient in all 3 runs.
SCRUM-347 changed the DensePhrases row again, to insufficient. Its passages say each phrase is
one dense vector searched with MIPS, but none says the system encodes passages as many vectors.
Before SCRUM-347 the 12 of 13 came from dspy's cache replaying one answer; asked again 3 times,
the judge said insufficient each time.
SCRUM-348 changed the MTEB check to insufficient. Production said contradicted, but the
pipeline said insufficient in all 9 fresh runs on 18 Oct 2026, so the bar of 12 had no room
left for the DensePhrases row, which still flips to supports in about 2 of 3 runs.

This rule blocks a merge. Raise the number when a change keeps more; lowering it needs its own
pull request with the reason.

## Analysis time

| Rule | Number | Why this number |
| --- | --- | --- |
| One analysis of arXiv 2305.06500 on the local stack (RTX 5070 Ti, local GROBID and ColBERT, LLM on 9arm) | about 84 s, warn when over 120 s | measured on main (c734b40) on 17 Oct 2026, one run; 120 s leaves room for the LLM gateway's spread |

Steps in that run: claims extracted at 37 s, checks from 48 s to 84 s (11 checks), figures done
by 84 s. A paper the store has seen before reuses cached answers and runs faster, so time a
paper it has not seen. This rule warns and does not block.

## Assistant answers, measured, not yet enforced

The assistant in `docs/ideas/secretsource-assistant.md` is not built yet. These numbers come from
two tests, each answering 20 questions as short statements that the judge then checks. In #504
every question names one of the three decisive-check papers. In #506 no paper is named: 14
questions are answered from the whole local library (about 30 papers) and 6 ask about topics it
does not hold. They become rules when the first assistant PR lands.

| Metric | Today | Direction |
| --- | --- | --- |
| Slowest checked answer about one paper, in each of 3 runs without the answer cache | 13.0 s, local GPU, one user at a time | must stay under 20 s, the one-pager's target |
| Slowest checked answer from the whole library, the same way | 19.3 to 27.1 s; 5 of 42 answers over 20 s | must fall under 20 s |
| Statements the judge does not back | 1 to 3% about one paper, 0 to 1% from the library | must not rise above 3% |
| Questions outside the library answered with no statements | 6 of 6 in every run | must stay 6 of 6 |

Checked by `python eval_assistant.py ../docs/eval/assistant-questions.csv --runs 3 --fresh`, and the
same with `assistant-library-questions.csv`, in the worker container with
`PAPERS_DIR=/app/data/papers`, alone on the LLM gateway.

## How quality and time are checked

| Rule | Checked by | Runs |
| --- | --- | --- |
| Decisive checks kept | `python eval_decisive.py ../docs/eval/decisive-checks.csv --runs 3 --fresh --min-kept 12` in the worker container | by hand before merging a change to the pipeline, prompts, retrieval or models; the result goes in the PR's Verified section |
| Analysis time | `python bench_analysis.py data/papers/<new paper>.pdf` in the gateway container | the same changes, by hand |

Neither runs in CI: both need the LLM gateway and a GPU, which the shared CI runner does not have.

## Where the system runs

From 17 Oct 2026 the system is developed and run on the local stack only, until it is
finished. Then it is deployed to Google Cloud in one planned release.

| Rule | Number | Why |
| --- | --- | --- |
| Cloud Run services serving traffic | 0 (gateway, colbert, colpali and grobid at manual scaling, 0 instances) | each deploy and each idle GPU or CPU minute costs money on a university account, and the design is still changing |
| Deploys to Google Cloud | none until the release | a half-finished pipeline in production gives teammates and testers wrong verdicts |

What was switched off on 17 Oct 2026, and how to turn it back on at release time:

| What | Off with | On again with |
| --- | --- | --- |
| Cloud Run services | `gcloud run services update <svc> --region asia-southeast1 --scaling=0` | `--scaling=auto --min=0` and the old max (gateway 1, colpali 2, colbert 10, grobid 3) |
| Cloud Scheduler `scale-guard-gateway`, `gpu-guard-colpali` | `gcloud scheduler jobs pause` | `gcloud scheduler jobs resume`, after the services are back on automatic scaling |
| Workflows `deploy-gateway`, `deploy` | `gh workflow disable` | `gh workflow enable` |

Checked by `gcloud run services list` (every service shows manual scaling with 0 instances)
and `gh workflow list --all`. A change that needs a cloud deploy before the release needs
an entry under Exceptions first.

## Exceptions

None.
