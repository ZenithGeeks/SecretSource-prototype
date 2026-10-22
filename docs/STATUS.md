# SecretSource status

Last updated: 2026-10-22 (Asia/Bangkok)

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

Sprint 4 (Multimodal) is the current window: today, 22 Oct 2026, falls inside Sprint 4, which ends Friday 23 Oct. Sprint 5 (Product) runs 24 Oct to 6 Nov and ends at the feature freeze ([SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88), 6 Nov). Sprint 6 (Evaluation) runs 7 to 20 Nov. Sprint 7 (Report & Delivery) runs 21 Nov to 9 Dec (final submission [SCRUM-101](https://secretsources.atlassian.net/browse/SCRUM-101)). The board still lists every sprint, including this one, as future.

- Feature freeze: 6 Nov 2026 — [SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88) "Feature freeze (6 Nov)". Highest, unassigned, To Do.
- Final presentation and submission: 9 Dec 2026 — [SCRUM-101](https://secretsources.atlassian.net/browse/SCRUM-101) "Final presentation and submission (9 Dec)". Highest, unassigned, To Do.

## Progress

Since the 21 Oct refresh, the Sprint 4 vision judge is Done and assistant memory is built.

[SCRUM-80](https://secretsources.atlassian.net/browse/SCRUM-80) (vision judge, the Sprint 4 goal) is Done in Jira. The eval harness reports precision, recall and F1 per judge call ([PR #658](https://github.com/ZenithGeeks/SecretSource-prototype/pull/658)).

[SCRUM-370](https://secretsources.atlassian.net/browse/SCRUM-370) assistant memory is built and Done ([PR #659](https://github.com/ZenithGeeks/SecretSource-prototype/pull/659), [PR #661](https://github.com/ZenithGeeks/SecretSource-prototype/pull/661), [PR #663](https://github.com/ZenithGeeks/SecretSource-prototype/pull/663), [PR #666](https://github.com/ZenithGeeks/SecretSource-prototype/pull/666); [issue #540](https://github.com/ZenithGeeks/SecretSource-prototype/issues/540) closed). The SPEC.md memory decision is no longer open.

[SCRUM-397](https://secretsources.atlassian.net/browse/SCRUM-397) upload validation is Done ([PR #657](https://github.com/ZenithGeeks/SecretSource-prototype/pull/657), [PR #665](https://github.com/ZenithGeeks/SecretSource-prototype/pull/665)). [SCRUM-402](https://secretsources.atlassian.net/browse/SCRUM-402) repaired the Supabase migration history ([PR #660](https://github.com/ZenithGeeks/SecretSource-prototype/pull/660); [issue #307](https://github.com/ZenithGeeks/SecretSource-prototype/issues/307) closed). [SCRUM-403](https://secretsources.atlassian.net/browse/SCRUM-403) (the agent `submit_analysis` fix) is Done ([PR #662](https://github.com/ZenithGeeks/SecretSource-prototype/pull/662)). [SCRUM-310](https://secretsources.atlassian.net/browse/SCRUM-310) is Done.

Jira project SCRUM on 22 Oct: 74 To Do, 9 In Progress, 12 In Review, and 261 Done. 49 are open and unassigned. 18 are overdue. Checks on `main` are green.

On 20 Oct, 46 pull requests merged ([#561](https://github.com/ZenithGeeks/SecretSource-prototype/pull/561) to [#653](https://github.com/ZenithGeeks/SecretSource-prototype/pull/653)). Most of them are the labeler and the assistant.

The labeler can search all of Scopus or a pasted DOI ([#613](https://github.com/ZenithGeeks/SecretSource-prototype/pull/613)), upload a PDF when the analysis cannot download one ([#618](https://github.com/ZenithGeeks/SecretSource-prototype/pull/618)), put papers side by side ([#595](https://github.com/ZenithGeeks/SecretSource-prototype/pull/595)), open a status bell ([#599](https://github.com/ZenithGeeks/SecretSource-prototype/pull/599)), filter the paper list ([#583](https://github.com/ZenithGeeks/SecretSource-prototype/pull/583)), and download one account's own labels ([#589](https://github.com/ZenithGeeks/SecretSource-prototype/pull/589)). Ask AI in the labeler reviews a saved claim ([#611](https://github.com/ZenithGeeks/SecretSource-prototype/pull/611)).

Ask is on every role: the researcher screens ([#569](https://github.com/ZenithGeeks/SecretSource-prototype/pull/569)), Author and Teacher ([#575](https://github.com/ZenithGeeks/SecretSource-prototype/pull/575)), and the labeler ([#611](https://github.com/ZenithGeeks/SecretSource-prototype/pull/611)). The Ask panel on the researcher screens and on Author and Teacher is [SCRUM-364](https://secretsources.atlassian.net/browse/SCRUM-364), and Jira still lists that ticket as To Do. Ask also has a "Do it" screen agent that works the app with an AI cursor ([#619](https://github.com/ZenithGeeks/SecretSource-prototype/pull/619)), data tools over MCP for Claude Code and Codex ([#625](https://github.com/ZenithGeeks/SecretSource-prototype/pull/625), [#642](https://github.com/ZenithGeeks/SecretSource-prototype/pull/642)), `/` and `@` commands in the Ask box ([#642](https://github.com/ZenithGeeks/SecretSource-prototype/pull/642)), and a specialist hand-off for questions about the person's papers ([#647](https://github.com/ZenithGeeks/SecretSource-prototype/pull/647)).

## Current priorities

1. **Before the feature freeze** ([SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88), 6 Nov). Two product items are next. **[SCRUM-404](https://secretsources.atlassian.net/browse/SCRUM-404)** — Settings: list and delete remembered facts. To Do, unassigned, Medium. Open in [issue #664](https://github.com/ZenithGeeks/SecretSource-prototype/issues/664). **[SCRUM-85](https://secretsources.atlassian.net/browse/SCRUM-85)** — Draft mode. In Review, unassigned, High. [Issue #667](https://github.com/ZenithGeeks/SecretSource-prototype/issues/667) is the check of what draft mode still lacks before the freeze.
2. **Labeling has not started** (0 hand labels). **[SCRUM-70](https://secretsources.atlassian.net/browse/SCRUM-70)** — round 1, 80 claims. To Do, unassigned, High. **[SCRUM-79](https://secretsources.atlassian.net/browse/SCRUM-79)** — round 2, 160 claims. To Do, unassigned, High. **[SCRUM-84](https://secretsources.atlassian.net/browse/SCRUM-84)** — 300 claims and inter-annotator agreement. To Do, unassigned, Highest. The decisions that block a start are under Risks.
3. **[SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81)** — Show figure and table evidence with the region boxed. In Review, unassigned, High. The backend ([PR #564](https://github.com/ZenithGeeks/SecretSource-prototype/pull/564), from [issue #554](https://github.com/ZenithGeeks/SecretSource-prototype/issues/554)) and the claim card ([PR #568](https://github.com/ZenithGeeks/SecretSource-prototype/pull/568), from [issue #558](https://github.com/ZenithGeeks/SecretSource-prototype/issues/558)) are merged. [Issue #559](https://github.com/ZenithGeeks/SecretSource-prototype/issues/559) is still open. The remaining scope question is under Risks.
4. **[SCRUM-89](https://secretsources.atlassian.net/browse/SCRUM-89)** — Full evaluation matrix on the 300-claim benchmark. To Do, unassigned, Highest. **[SCRUM-86](https://secretsources.atlassian.net/browse/SCRUM-86)** — Public Cloud Run deployment with cost documented. To Do, unassigned, High. [Where the system runs](../CONSTRAINTS.md#where-the-system-runs) still keeps work on the local stack until the system is finished, then one planned Google Cloud release.

## Risks and blockers

- Labeling has not started (0 hand labels; `evidence_labels.csv` has only its header). The round 1 decisions in [issue #556](https://github.com/ZenithGeeks/SecretSource-prototype/issues/556) wait on Vitawat: the label scheme against [SCRUM-66](https://secretsources.atlassian.net/browse/SCRUM-66), the guideline, the unit of the 80 claims, annotator pairing ([SCRUM-68](https://secretsources.atlassian.net/browse/SCRUM-68)), the paper pool ([SCRUM-67](https://secretsources.atlassian.net/browse/SCRUM-67)), where labeling runs, the schedule, and the agreement bar. The verdict schema ([SCRUM-71](https://secretsources.atlassian.net/browse/SCRUM-71), 3 or 4 classes, To Do, assignee Vitawat, Highest) waits on Vitawat as well. That puts Sprint 6 evaluation ([SCRUM-76](https://secretsources.atlassian.net/browse/SCRUM-76), [SCRUM-84](https://secretsources.atlassian.net/browse/SCRUM-84), [SCRUM-89](https://secretsources.atlassian.net/browse/SCRUM-89)) at risk. [SCRUM-79](https://secretsources.atlassian.net/browse/SCRUM-79) (round 2, 160 claims) is still To Do, and Sprint 4 ends Friday 23 Oct. [Issue #655](https://github.com/ZenithGeeks/SecretSource-prototype/issues/655) is open to shortlist the round 1 papers.
- [SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81) has an open scope question: no full `VISUAL_EVIDENCE=1` analysis run yet, and "name the matching model" is not covered.
- Scope grew on 20 Oct: many new assistant and agent features merged in one day, and the feature freeze is 6 Nov ([SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88)). The GitHub issues for that work were opened the same day ([#610](https://github.com/ZenithGeeks/SecretSource-prototype/issues/610), [#616](https://github.com/ZenithGeeks/SecretSource-prototype/issues/616), [#621](https://github.com/ZenithGeeks/SecretSource-prototype/issues/621), [#641](https://github.com/ZenithGeeks/SecretSource-prototype/issues/641), [#643](https://github.com/ZenithGeeks/SecretSource-prototype/issues/643), [#646](https://github.com/ZenithGeeks/SecretSource-prototype/issues/646)) and none names a SCRUM ticket.
- Several Jira tickets still lag work already on `main`. [Issue #654](https://github.com/ZenithGeeks/SecretSource-prototype/issues/654) is the list. [SCRUM-364](https://secretsources.atlassian.net/browse/SCRUM-364) is still To Do after [#569](https://github.com/ZenithGeeks/SecretSource-prototype/pull/569) and [#575](https://github.com/ZenithGeeks/SecretSource-prototype/pull/575). [SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81) is still In Review after [#564](https://github.com/ZenithGeeks/SecretSource-prototype/pull/564) and [#568](https://github.com/ZenithGeeks/SecretSource-prototype/pull/568). [SCRUM-80](https://secretsources.atlassian.net/browse/SCRUM-80) and [SCRUM-310](https://secretsources.atlassian.net/browse/SCRUM-310) are Done.
- [Issue #544](https://github.com/ZenithGeeks/SecretSource-prototype/issues/544) (Scopus label, [SCRUM-374](https://secretsources.atlassian.net/browse/SCRUM-374)) is blocked on checking that Elsevier's API Service Agreement allows showing and caching Scopus data.
- [SCRUM-86](https://secretsources.atlassian.net/browse/SCRUM-86) asks for a public Cloud Run deploy. [CONSTRAINTS.md](../CONSTRAINTS.md#where-the-system-runs) allows no Google Cloud deploy until the finished release (merged in [PR #488](https://github.com/ZenithGeeks/SecretSource-prototype/pull/488)).

## Recent decisions

- **2026-10-21.** [SCRUM-370](https://secretsources.atlassian.net/browse/SCRUM-370) is Done and [issue #540](https://github.com/ZenithGeeks/SecretSource-prototype/issues/540) is closed. The SPEC.md memory decision is no longer open: remembered facts are stored, distilled from a finished chat, and read with `load_memory` ([PR #659](https://github.com/ZenithGeeks/SecretSource-prototype/pull/659), [PR #661](https://github.com/ZenithGeeks/SecretSource-prototype/pull/661), [PR #663](https://github.com/ZenithGeeks/SecretSource-prototype/pull/663), [PR #666](https://github.com/ZenithGeeks/SecretSource-prototype/pull/666)).
- **2026-10-20.** [SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81) was split into a backend half ([issue #554](https://github.com/ZenithGeeks/SecretSource-prototype/issues/554), merged as [PR #564](https://github.com/ZenithGeeks/SecretSource-prototype/pull/564)) and a claim-card half ([issue #558](https://github.com/ZenithGeeks/SecretSource-prototype/issues/558), merged as [PR #568](https://github.com/ZenithGeeks/SecretSource-prototype/pull/568)).
- **2026-10-20.** [Issue #567](https://github.com/ZenithGeeks/SecretSource-prototype/issues/567) (Docling table images adding time on papers with tables) was closed as not planned. A timed check showed table images cost about 1.5 s per analysis, and the bench gap came from a cold run, not the table images.
- **2026-10-20.** [SCRUM-78](https://secretsources.atlassian.net/browse/SCRUM-78) moved to Done. The review in [issue #555](https://github.com/ZenithGeeks/SecretSource-prototype/issues/555) found the spike done: a vision model was tried on ColPali hits, the prompt shape was chosen, and the retrieval model was compared.
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

- **2026-10-19.** Before the Google Cloud release, add the `SESSION_DB_URL` repo secret (the Supabase session pooler URL). `deploy-gateway.yml` passes it from [PR #532](https://github.com/ZenithGeeks/SecretSource-prototype/pull/532) on. Without it, assistant chats are kept in memory, and the gateway loses them every time it scales to zero.
- **2026-10-19.** The assistant can't give 5 people at once a fully checked answer within 20 s on the 9arm key. The key allows 3 requests at a time, and one answer makes about 7 LLM calls at about 8 s each. The first statement still arrives in about 8 s. CONSTRAINTS.md targets are now the first statement under 10 s for 5 people and the last verdict under 20 s for one person ([PR #545](https://github.com/ZenithGeeks/SecretSource-prototype/pull/545)). Going further needs a design change: judge several statements in one call, or check only on request.
- **2026-10-19.** Two sessions filed the same assistant ticket drafts. The duplicates are closed: #535 to #539 (SCRUM-365 to 369) and #542 (SCRUM-372). The live tickets are #527 to #529 (Done), #533, #534 and #547. A6, A7 and A9 are SCRUM-370, 371 and 373, still To Do.
- **2026-10-19.** A6 (assistant memory, SPEC.md) conflicts with the shipped chat route. The route answers through `app/assistant.py` directly, not through the ADK agent, so `load_memory` is never called. SPEC.md needs a decision on how facts reach an answer before A6 is built.
