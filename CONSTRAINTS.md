# Constraints

Last reviewed: 2026-10-16 by @EarthWittawat

This file holds the numbers a change must not break. It covers running cost only for now.
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

The README section "Cost and speed" lists the changes that would close the gap. The largest
is the ColPali GPU, about $0.75 of the $1.11.

## Exceptions

None.
