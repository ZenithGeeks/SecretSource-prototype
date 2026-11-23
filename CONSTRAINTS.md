# Constraints

Last reviewed: 2026-11-09 by @EarthWittawat

This file holds the numbers a change must not break: LLM token use, verdict quality and
analysis time.
Do not weaken a number here to make a change pass; change it in its own pull request, with
the reason.

## Running cost

The system runs on our own machines (see [Where the system runs](#where-the-system-runs)), so an
analysis has no per-run hosting cost. The one cost that grows with use is LLM tokens.

| Metric | Rule | Checked by |
| --- | --- | --- |
| LLM tokens per analysis | must not grow without a reason in the PR | each analysis record has `llm_tokens` from SCRUM-326 on, keyed like `judge_prompt` |

## Verdict quality

A change to the prompts, the retrieval, the passage cutting or the models must not lose a check
that production found decisive. A lost "backed" or "contradicted" check is the costly error: the
reader never learns the paper cited a source that settles the claim.

| Rule | Number | Why this number |
| --- | --- | --- |
| Decisive checks kept, 3 runs each without the answer cache, the PR and main run the same day with the same settings | every row main keeps in all 3 of its runs, the PR keeps in all 3 of its runs; the count out of 13 is recorded, not enforced | SCRUM-376: on 19 Oct 2026 main fell from 13, 12, 12 to 11, 10, 10 with the same prompt, passages and request as the day before, because the model behind the gateway had changed. A fixed count cannot hold on a model we do not control |

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
SCRUM-376 replaced the fixed count with a comparison against main. On 19 Oct 2026 main kept
11, 10, 10: the MTEB and DensePhrases rows said refutes in every run. The prompt, the retrieved
passages and the HTTP request were the same as on 18 Oct, byte for byte, so the model behind
the gateway's `qwen3.8-27b-fp8` had changed (the gateway serves it as `qwen/qwen3.8-27b-nvfp4`
from a staging host), and nothing on our side recorded when. A count out of 13 therefore says
as much about the model that day as about the change under test. A row that flips between
main's own runs is noise and does not count against the PR. `eval_decisive.py` prints the
gateway's model id before the first run, so the next change of model has a date.
SCRUM-416 changed the MTEB check to refutes. Once passages end at sentence ends, the judge
gets the abstract's whole sentence "We find there to be no single best solution, with different
models dominating different tasks" and says refutes in all 3 runs, as production did. The claim
says LLM-based models top the leaderboards and the cited paper says no model dominates, so
refutes holds.

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

The assistant in `docs/ideas/secretsource-assistant.md` answers from `backend/app/assistant.py`
since SCRUM-360; no screen calls it yet. These numbers come from two tests, each answering 20 questions as short statements that the judge then checks. In #504
every question names one of the three decisive-check papers. In #506 no paper is named: 14
questions are answered from the whole local library (about 30 papers) and 6 ask about topics it
does not hold. They become rules when the first assistant PR lands.

| Metric | Today | Direction |
| --- | --- | --- |
| Slowest checked answer about one paper, in each of 3 runs without the answer cache | 13.0 s, local GPU, one user at a time | must stay under 20 s, the one-pager's target |
| Slowest checked answer from the whole library, the same way | 19.3 to 27.1 s; 5 of 42 answers over 20 s | must fall under 20 s |
| Statements the judge does not back | 1 to 3% about one paper, 0 to 1% from the library | must not rise above 3% |
| Questions outside the library answered with no statements | 6 of 6 in every run | must stay 6 of 6 |
| First statement of an answer, 5 people chatting at once (SCRUM-363) | median 8.1 s, p90 14.3 s | median must stay under 10 s |
| Last verdict, one person asking about one paper, on 9arm with the cap of 3 | median 14.3 s and 12.2 s, slowest 19.0 s and 27.9 s (2 runs, 19 Oct 2026) | median must stay under 20 s, the one-pager's target |
| Last verdict, 5 people chatting at once | median 61.7 s, p90 131.6 s | not a target; see below |
| Statements not backed, 5 people chatting at once | 4% (7 of 183) | must stay under one third, the one-pager's ceiling |

Checked by `python eval_assistant.py ../docs/eval/assistant-questions.csv --runs 3 --fresh`, and the
same with `assistant-library-questions.csv`, in the worker container with
`PAPERS_DIR=/app/data/papers`, alone on the LLM gateway.

The two rows for 5 people come from `python load_assistant.py <gateway> ../docs/eval/assistant-*questions.csv
--users 5`: 40 questions through the chat routes, on a fresh gateway (each paper indexed in ColBERT the
first time a check reads it) with the 9arm key's cap of 3 requests. A second run on the same gateway
replays dspy's and the store's answer caches, so only a first run measures the work.

The 20 s target holds for one person, not for 5 at once. The 9arm key allows 3 requests at a time, and a
checked answer makes about 7 (one answer, up to 6 checks) at about 8 s each under load: 223 calls took
605 s. Five people would need about 1.5 calls per answer to finish in 20 s. So with several people the
statements come first, and the panel shows each verdict as it lands (Checking… until then). Re-adding
a paper ColBERT already holds is not the cost: it takes 0.04 to 0.21 s, since the service skips
papers whose content hash it already has.

## How quality and time are checked

| Rule | Checked by | Runs |
| --- | --- | --- |
| Decisive checks kept | `python eval_decisive.py ../docs/eval/decisive-checks.csv --runs 3 --fresh` in the worker container, once on the PR and once on main, the same day | by hand before merging a change to the pipeline, prompts, retrieval or models; both results, the gateway's model id and the rows that differ go in the PR's Verified section |
| Analysis time | `python bench_analysis.py data/papers/<new paper>.pdf` in the gateway container | the same changes, by hand |

Neither runs in CI: both need the LLM gateway and a GPU, which the shared CI runner does not have.

## Where the system runs

Production runs on our own machines with Docker Compose, not on Google Cloud.

| Machine | Runs |
| --- | --- |
| Mini PC | `web`, `gateway`, `redis` (the analysis queue) and the papers folder, reached through a Cloudflare tunnel |
| PC with an RTX 5070 Ti | GROBID, ColBERT, ColPali and the workers |

Ask before any Google Cloud deploy.

## Exceptions

None.
