# SecretSource status

Last updated: 2026-10-20 (Asia/Bangkok)

The project manager assistant refreshes this file every weekday morning via pull request. Humans and Claude Code may edit it.

## Read these instead of this file

| Doc | What it holds |
| --- | --- |
| [README.md](../README.md) | What SecretSource is, how to run it, and the roadmap |
| [SPEC.md](../SPEC.md) | Draft spec for assistant memory (2026-10-17) |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Parts, the steps of an analysis, and which pattern each part uses |
| [CONSTRAINTS.md](../CONSTRAINTS.md) | Cost, verdict quality, analysis time, and where the system runs |
| [tasks/plan.md](../tasks/plan.md) | RQ + Redis job-queue plan (complete) |
| [tasks/todo.md](../tasks/todo.md) | Task list for that same plan (every task checked) |

## Mission

SecretSource checks whether the papers a research paper cites really say what it claims. It reads a paper, finds the claims, and checks each claim against the cited paper. Every result is a verdict (`supports`, `refutes`, or `insufficient`), the quote from the cited paper, and the page where that quote is. See [What it is](../README.md#what-it-is).

## Timeline and milestones

Jira project [SCRUM](https://secretsources.atlassian.net/jira/software/projects/SCRUM/boards/1) on secretsources.atlassian.net. Dates below are the sprint start and end dates on that board.

| Sprint | Dates | Goal on the board |
| --- | --- | --- |
| Sprint 4 — Multimodal (current) | 10–23 Oct 2026 | Vision judge, figure/table evidence, labeling round 2 |
| Sprint 5 — Product | 24 Oct–6 Nov 2026 | Batch mode, draft mode, deployment, labeling complete, feature freeze |
| Sprint 6 — Evaluation | 7–20 Nov 2026 | Full evaluation matrix, model/human comparison, ablation |
| Sprint 7 — Report & Delivery | 21 Nov–9 Dec 2026 | Final report, docs, slides, rehearsals, final presentation |

Sprint 4 is the current window: today, 20 Oct 2026, falls inside Sprint 4, which ends 23 Oct. The board still lists every sprint, including this one, as future.

- Feature freeze: 6 Nov 2026 — [SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88) "Feature freeze (6 Nov)". Highest, unassigned, To Do.
- Final presentation and submission: 9 Dec 2026 — [SCRUM-101](https://secretsources.atlassian.net/browse/SCRUM-101) "Final presentation and submission (9 Dec)". Highest, unassigned, To Do.

## Current priorities

1. **[SCRUM-70](https://secretsources.atlassian.net/browse/SCRUM-70)** — Labeling round 1: 80 claims. To Do, unassigned, High. [PR #510](https://github.com/ZenithGeeks/SecretSource-prototype/pull/510) (merged 2026-10-19) says the hand labels do not exist yet.
2. **[SCRUM-84](https://secretsources.atlassian.net/browse/SCRUM-84)** — Labeling complete: 300 claims and inter-annotator agreement. To Do, unassigned, Highest.
3. **[SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81)** — Show figure and table evidence with the region boxed. To Do, unassigned, High. Sprint 4 goal. Tracked in [issue #554](https://github.com/ZenithGeeks/SecretSource-prototype/issues/554).
4. **[SCRUM-364](https://secretsources.atlassian.net/browse/SCRUM-364)** — Assistant panel on the Library, Graph and Analysis screens. To Do, unassigned, Medium. Tracked in [issue #534](https://github.com/ZenithGeeks/SecretSource-prototype/issues/534).
5. **[SCRUM-80](https://secretsources.atlassian.net/browse/SCRUM-80)** — Vision judge returns a verdict and a reason. To Do, unassigned, Highest. Sprint 4 goal. **[SCRUM-78](https://secretsources.atlassian.net/browse/SCRUM-78)** — Spike: vision judge approach for tables and figures. To Do, unassigned, High. Both are still To Do in Jira. [PR #501](https://github.com/ZenithGeeks/SecretSource-prototype/pull/501), [PR #513](https://github.com/ZenithGeeks/SecretSource-prototype/pull/513) and [PR #516](https://github.com/ZenithGeeks/SecretSource-prototype/pull/516) are merged. [Issue #555](https://github.com/ZenithGeeks/SecretSource-prototype/issues/555) checks whether they can close.
6. **[SCRUM-89](https://secretsources.atlassian.net/browse/SCRUM-89)** — Full evaluation matrix on the 300-claim benchmark. To Do, unassigned, Highest.
7. **[SCRUM-86](https://secretsources.atlassian.net/browse/SCRUM-86)** — Public Cloud Run deployment with cost documented. To Do, unassigned, High. [Where the system runs](../CONSTRAINTS.md#where-the-system-runs) keeps work on the local stack until the system is finished, then one planned Google Cloud release.
8. **Partly done, still In Review** (assignee Vitawat). Where the GitHub issue is still open, the merged pull request covers only part of it:
   - [SCRUM-310](https://secretsources.atlassian.net/browse/SCRUM-310) — `search_passages` returns full passage text for up to 100 hits, with nothing to mark a weak result. GitHub work is finished: [issue #416](https://github.com/ZenithGeeks/SecretSource-prototype/issues/416) is closed by [PR #521](https://github.com/ZenithGeeks/SecretSource-prototype/pull/521). The Jira ticket is still In Review and only needs closing.
   - [SCRUM-318](https://secretsources.atlassian.net/browse/SCRUM-318) — nothing measures how accurate the judge's verdicts are. [PR #435](https://github.com/ZenithGeeks/SecretSource-prototype/pull/435), [issue #423](https://github.com/ZenithGeeks/SecretSource-prototype/issues/423).
   - [SCRUM-320](https://secretsources.atlassian.net/browse/SCRUM-320) — test the citation checks on the 10 papers Sakana's AI Scientist generated. [PR #440](https://github.com/ZenithGeeks/SecretSource-prototype/pull/440), [PR #456](https://github.com/ZenithGeeks/SecretSource-prototype/pull/456), [issue #425](https://github.com/ZenithGeeks/SecretSource-prototype/issues/425).

## Risks and blockers

- Highest-priority deliverables with no assignee, all To Do: [SCRUM-84](https://secretsources.atlassian.net/browse/SCRUM-84), [SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88), [SCRUM-89](https://secretsources.atlassian.net/browse/SCRUM-89), and [SCRUM-95](https://secretsources.atlassian.net/browse/SCRUM-95) (final report draft to advisor). [SCRUM-80](https://secretsources.atlassian.net/browse/SCRUM-80) and [SCRUM-101](https://secretsources.atlassian.net/browse/SCRUM-101) are Highest and unassigned as well.
- [SCRUM-86](https://secretsources.atlassian.net/browse/SCRUM-86) asks for a public Cloud Run deploy. [CONSTRAINTS.md](../CONSTRAINTS.md#where-the-system-runs) allows no Google Cloud deploy until the finished release (merged in [PR #488](https://github.com/ZenithGeeks/SecretSource-prototype/pull/488)).
- [Issue #307](https://github.com/ZenithGeeks/SecretSource-prototype/issues/307) — Supabase migration history out of sync. Open and unassigned. The issue records the decision to run its repair commands, then `supabase db push --dry-run`. That still needs someone with Supabase login and the database password.
- No hand labels exist yet. Sprint 4 (labeling round 2, [SCRUM-79](https://secretsources.atlassian.net/browse/SCRUM-79), cumulative 160 claims) ends 23 Oct, so the evaluation work in Sprint 6 ([SCRUM-76](https://secretsources.atlassian.net/browse/SCRUM-76), [SCRUM-84](https://secretsources.atlassian.net/browse/SCRUM-84), [SCRUM-89](https://secretsources.atlassian.net/browse/SCRUM-89)) is at risk. [Issue #556](https://github.com/ZenithGeeks/SecretSource-prototype/issues/556) lists what labeling round 1 ([SCRUM-70](https://secretsources.atlassian.net/browse/SCRUM-70)) needs.
- [Issue #544](https://github.com/ZenithGeeks/SecretSource-prototype/issues/544) (Scopus label, [SCRUM-374](https://secretsources.atlassian.net/browse/SCRUM-374)) is blocked on checking that Elsevier's API Service Agreement allows showing and caching Scopus data.

## Recent decisions

- **2026-10-19.** The assistant shipped as a checked-statement chat route ([PR #532](https://github.com/ZenithGeeks/SecretSource-prototype/pull/532)) and the gap finder merged ([PR #548](https://github.com/ZenithGeeks/SecretSource-prototype/pull/548)). Assistant targets in [CONSTRAINTS.md](../CONSTRAINTS.md#assistant-answers-measured-not-yet-enforced) are now the first statement under 10 s for 5 people and the last verdict under 20 s for one person ([PR #545](https://github.com/ZenithGeeks/SecretSource-prototype/pull/545)).
- **2026-10-19.** Jira cleanup closed 87 tickets whose pull requests were already merged to `main`. All 87 keys are Done.
- **2026-10-19.** [PR #488](https://github.com/ZenithGeeks/SecretSource-prototype/pull/488) merged. Development and runs stay on the local stack until the system is finished, then one planned Google Cloud release. See [Where the system runs](../CONSTRAINTS.md#where-the-system-runs).
- **2026-10-17.** Assistant memory: our own memory service on a Supabase table, a few facts distilled by the LLM at the end of each chat, read with `load_memory`. See [SPEC.md](../SPEC.md).

## Task board

[GitHub Issues](https://github.com/ZenithGeeks/SecretSource-prototype/issues) is the shared task board for Vitawat, the Grok Bot assistants, Claude Code, and Cursor.

| Label | Meaning |
| --- | --- |
| `agent-claude` | Task for Claude Code |
| `agent-cursor` | Task for Cursor (agent or cloud agent) |
| `agent-grok` | Task for Grok Bot assistants |
| `today` | In today's daily plan |

The Project Manager bot labels each weekday's plan with `today`, and removes that label from finished or deferred items. Agents work only on issues labeled `today`, so a session does not spend tokens on the rest of the backlog. See the session rule in [CLAUDE.md](../CLAUDE.md).

## Who does what

| Who | Role |
| --- | --- |
| Vitawat | Lead |
| Grok Bot — Project Manager | Daily status (this file, weekday morning pull request) |
| Grok Bot — Lead Engineer SecretSource | Lead Engineer |
| Grok Bot — QA SecretSource | QA |
| Grok Bot — Report SecretSource | Final report and slides |
| Claude Code | Implementation |

Cursor agents follow the same daily-plan rule for `agent-cursor`: work only on issues labeled `today`.

## Notes from Claude Code

Claude Code: when you find a blocker, an open question, or a big-picture change, append a dated bullet in this section. Put the newest entry at the top.

- **2026-10-25.** The root `.env` sets `REDIS_URL` to the team's shared Redis Cloud queue, and `docker-compose.yml` passes it to the gateway and the worker. Any local stack started from that `.env` therefore shares one job queue with every other machine that uses it. A worker on another machine can take a job, look for the draft or paper in its own database, and fail it: an Author check ended "the draft was deleted" this way during #711. Docker Desktop also restarts the everyday stack on launch (`restart: unless-stopped`), so its worker joins that queue without anyone starting it. Tests use `docker-compose.e2e.yml`, which gives that stack its own Redis (`frontend/e2e/README.md`). Open question: should local stacks default to their own Redis, and only the shared deployment name the shared queue?
- **2026-10-25.** `answer_from_docs` and ColBERT's `search_passages` searched the shared index, so one user's question could return another user's passage text, including in DSPy context spans, ADK tool spans and retriever spans. User-facing search now names that caller's papers (`papers_of`) and an empty set searches nothing. The MCP tool returns nothing unless the caller sends `X-Paper-Scope`. An unscoped retriever span records a hash instead of the file name, and never the passage text.
- **2026-10-19.** Before the Google Cloud release, add the `SESSION_DB_URL` repo secret (the Supabase session pooler URL). `deploy-gateway.yml` passes it from [PR #532](https://github.com/ZenithGeeks/SecretSource-prototype/pull/532) on. Without it, assistant chats are kept in memory, and the gateway loses them every time it scales to zero.
- **2026-10-19.** The assistant can't give 5 people at once a fully checked answer within 20 s on the 9arm key. The key allows 3 requests at a time, and one answer makes about 7 LLM calls at about 8 s each. The first statement still arrives in about 8 s. CONSTRAINTS.md targets are now the first statement under 10 s for 5 people and the last verdict under 20 s for one person ([PR #545](https://github.com/ZenithGeeks/SecretSource-prototype/pull/545)). Going further needs a design change: judge several statements in one call, or check only on request.
- **2026-10-19.** Two sessions filed the same assistant ticket drafts. The duplicates are closed: #535 to #539 (SCRUM-365 to 369) and #542 (SCRUM-372). The live tickets are #527 to #529 (Done), #533, #534 and #547. A6, A7 and A9 are SCRUM-370, 371 and 373, still To Do.
- **2026-10-19.** A6 (assistant memory, SPEC.md) conflicts with the shipped chat route. The route answers through `app/assistant.py` directly, not through the ADK agent, so `load_memory` is never called. SPEC.md needs a decision on how facts reach an answer before A6 is built.
