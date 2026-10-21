# SecretSource status

Last updated: 2026-10-21 (Asia/Bangkok)

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

Sprint 4 is the current window: today, 21 Oct 2026, falls inside Sprint 4, which ends Friday 23 Oct. Sprint 5 (Product) starts 24 Oct. Feature freeze is 6 Nov ([SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88)) and the final presentation and submission is 9 Dec ([SCRUM-101](https://secretsources.atlassian.net/browse/SCRUM-101)). The board still lists every sprint, including this one, as future.

- Feature freeze: 6 Nov 2026 — [SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88) "Feature freeze (6 Nov)". Highest, unassigned, To Do.
- Final presentation and submission: 9 Dec 2026 — [SCRUM-101](https://secretsources.atlassian.net/browse/SCRUM-101) "Final presentation and submission (9 Dec)". Highest, unassigned, To Do.

## Progress

On 20 Oct, 46 pull requests merged ([#561](https://github.com/ZenithGeeks/SecretSource-prototype/pull/561) to [#653](https://github.com/ZenithGeeks/SecretSource-prototype/pull/653)). Most of them are the labeler and the assistant.

The labeler can search all of Scopus or a pasted DOI ([#613](https://github.com/ZenithGeeks/SecretSource-prototype/pull/613)), upload a PDF when the analysis cannot download one ([#618](https://github.com/ZenithGeeks/SecretSource-prototype/pull/618)), put papers side by side ([#595](https://github.com/ZenithGeeks/SecretSource-prototype/pull/595)), open a status bell ([#599](https://github.com/ZenithGeeks/SecretSource-prototype/pull/599)), filter the paper list ([#583](https://github.com/ZenithGeeks/SecretSource-prototype/pull/583)), and download one account's own labels ([#589](https://github.com/ZenithGeeks/SecretSource-prototype/pull/589)). Ask AI in the labeler reviews a saved claim ([#611](https://github.com/ZenithGeeks/SecretSource-prototype/pull/611)).

Ask is on every role: the researcher screens ([#569](https://github.com/ZenithGeeks/SecretSource-prototype/pull/569)), Author and Teacher ([#575](https://github.com/ZenithGeeks/SecretSource-prototype/pull/575)), and the labeler ([#611](https://github.com/ZenithGeeks/SecretSource-prototype/pull/611)). The Ask panel on the researcher screens and on Author and Teacher is [SCRUM-364](https://secretsources.atlassian.net/browse/SCRUM-364), and Jira still lists that ticket as To Do. Ask also has a "Do it" screen agent that works the app with an AI cursor ([#619](https://github.com/ZenithGeeks/SecretSource-prototype/pull/619)), data tools over MCP for Claude Code and Codex ([#625](https://github.com/ZenithGeeks/SecretSource-prototype/pull/625), [#642](https://github.com/ZenithGeeks/SecretSource-prototype/pull/642)), `/` and `@` commands in the Ask box ([#642](https://github.com/ZenithGeeks/SecretSource-prototype/pull/642)), and a specialist hand-off for questions about the person's papers ([#647](https://github.com/ZenithGeeks/SecretSource-prototype/pull/647)).

Jira project SCRUM: 80 To Do, 9 In Progress, 14 In Review, 49 open with no assignee, and 18 open and overdue. [SCRUM-78](https://secretsources.atlassian.net/browse/SCRUM-78) moved to Done on 20 Oct.

## Current priorities

1. **[SCRUM-70](https://secretsources.atlassian.net/browse/SCRUM-70)** — Labeling round 1: 80 claims. To Do, unassigned, High. **[SCRUM-84](https://secretsources.atlassian.net/browse/SCRUM-84)** — Labeling complete: 300 claims and inter-annotator agreement. To Do, unassigned, Highest. There are still no hand labels (`evidence_labels.csv` has only its header). [Issue #556](https://github.com/ZenithGeeks/SecretSource-prototype/issues/556) is the round 1 checklist. It leaves eight decisions for Vitawat: the label scheme against [SCRUM-66](https://secretsources.atlassian.net/browse/SCRUM-66), the guideline, the unit of the 80 claims, annotator pairing ([SCRUM-68](https://secretsources.atlassian.net/browse/SCRUM-68)), the paper pool ([SCRUM-67](https://secretsources.atlassian.net/browse/SCRUM-67)), where labeling runs, the schedule, and the agreement bar. [Issue #655](https://github.com/ZenithGeeks/SecretSource-prototype/issues/655) is open to shortlist the round 1 papers.
2. **[SCRUM-80](https://secretsources.atlassian.net/browse/SCRUM-80)** — Vision judge returns a verdict and a reason. To Do, unassigned, Highest. The review in [issue #555](https://github.com/ZenithGeeks/SecretSource-prototype/issues/555) says per-modality F1 is the only criterion not met. That work is [issue #584](https://github.com/ZenithGeeks/SecretSource-prototype/issues/584).
3. **[SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81)** — Show figure and table evidence with the region boxed. In Review, unassigned, High. The backend ([PR #564](https://github.com/ZenithGeeks/SecretSource-prototype/pull/564), from [issue #554](https://github.com/ZenithGeeks/SecretSource-prototype/issues/554)) and the claim card ([PR #568](https://github.com/ZenithGeeks/SecretSource-prototype/pull/568), from [issue #558](https://github.com/ZenithGeeks/SecretSource-prototype/issues/558)) are merged. The review issue [#559](https://github.com/ZenithGeeks/SecretSource-prototype/issues/559) is still open.
4. **[SCRUM-397](https://secretsources.atlassian.net/browse/SCRUM-397)** — `POST /analyses/upload` accepts any file type and any size. To Do, Vitawat, Medium. Tracked in [issue #620](https://github.com/ZenithGeeks/SecretSource-prototype/issues/620). Labelers reach that route from the Upload the PDF button ([PR #618](https://github.com/ZenithGeeks/SecretSource-prototype/pull/618)). The browser picker asks for a PDF, and nginx caps a proxied body at 100 MB. A caller that reaches the gateway directly has no cap, and the route does not check for a PDF header.
5. **[SCRUM-89](https://secretsources.atlassian.net/browse/SCRUM-89)** — Full evaluation matrix on the 300-claim benchmark. To Do, unassigned, Highest. **[SCRUM-86](https://secretsources.atlassian.net/browse/SCRUM-86)** — Public Cloud Run deployment with cost documented. To Do, unassigned, High. [Where the system runs](../CONSTRAINTS.md#where-the-system-runs) still keeps work on the local stack until the system is finished, then one planned Google Cloud release.

## Risks and blockers

- No hand labels exist yet, two days before Sprint 4 ends on 23 Oct. Labeling round 2 ([SCRUM-79](https://secretsources.atlassian.net/browse/SCRUM-79), cumulative 160 claims) cannot finish in Sprint 4, and the Sprint 6 evaluation ([SCRUM-76](https://secretsources.atlassian.net/browse/SCRUM-76), [SCRUM-84](https://secretsources.atlassian.net/browse/SCRUM-84), [SCRUM-89](https://secretsources.atlassian.net/browse/SCRUM-89)) depends on those labels.
- Scope grew on 20 Oct: many new assistant and agent features merged in one day, and the feature freeze is 16 days away (6 Nov, [SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88)). The GitHub issues for that work were opened the same day ([#610](https://github.com/ZenithGeeks/SecretSource-prototype/issues/610), [#616](https://github.com/ZenithGeeks/SecretSource-prototype/issues/616), [#621](https://github.com/ZenithGeeks/SecretSource-prototype/issues/621), [#641](https://github.com/ZenithGeeks/SecretSource-prototype/issues/641), [#643](https://github.com/ZenithGeeks/SecretSource-prototype/issues/643), [#646](https://github.com/ZenithGeeks/SecretSource-prototype/issues/646)) and none names a SCRUM ticket.
- Several Jira tickets still lag work already on `main`. [Issue #654](https://github.com/ZenithGeeks/SecretSource-prototype/issues/654) is the list. [SCRUM-364](https://secretsources.atlassian.net/browse/SCRUM-364) is To Do after [#569](https://github.com/ZenithGeeks/SecretSource-prototype/pull/569) and [#575](https://github.com/ZenithGeeks/SecretSource-prototype/pull/575). [SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81) is In Review after [#564](https://github.com/ZenithGeeks/SecretSource-prototype/pull/564) and [#568](https://github.com/ZenithGeeks/SecretSource-prototype/pull/568).
- [Issue #307](https://github.com/ZenithGeeks/SecretSource-prototype/issues/307) — Supabase migration history out of sync. Open and unassigned. The issue records the decision to run its repair commands, then `supabase db push --dry-run`. That still needs someone with Supabase login and the database password.
- [Issue #544](https://github.com/ZenithGeeks/SecretSource-prototype/issues/544) (Scopus label, [SCRUM-374](https://secretsources.atlassian.net/browse/SCRUM-374)) is blocked on checking that Elsevier's API Service Agreement allows showing and caching Scopus data.
- [SCRUM-86](https://secretsources.atlassian.net/browse/SCRUM-86) asks for a public Cloud Run deploy. [CONSTRAINTS.md](../CONSTRAINTS.md#where-the-system-runs) allows no Google Cloud deploy until the finished release (merged in [PR #488](https://github.com/ZenithGeeks/SecretSource-prototype/pull/488)).

## Recent decisions

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
