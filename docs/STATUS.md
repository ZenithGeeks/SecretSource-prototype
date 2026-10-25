# SecretSource status

Last updated: 2026-10-25 (Asia/Bangkok)

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
| Sprint 4 — Multimodal | 10–23 Oct 2026 | Vision judge, figure/table evidence, labeling round 2 |
| Sprint 5 — Product (current) | 24 Oct–6 Nov 2026 | Batch mode, draft mode, deployment, labeling complete, feature freeze |
| Sprint 6 — Evaluation | 7–20 Nov 2026 | Full evaluation matrix, model/human comparison, ablation |
| Sprint 7 — Report & Delivery | 21 Nov–9 Dec 2026 | Final report, docs, slides, rehearsals, final presentation |

Sprint 5 (Product) is the current sprint. It started Saturday 24 Oct 2026 and is the active sprint on the board. It runs to 6 Nov, the feature freeze ([SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88)). Today is Sunday 25 Oct. Sprint 4's planned dates ended on 23 Oct, but the sprint was never started or closed in Jira. Sprint 6 (Evaluation) runs 7 to 20 Nov. Sprint 7 (Report & Delivery) runs 21 Nov to 9 Dec (final submission [SCRUM-101](https://secretsources.atlassian.net/browse/SCRUM-101)). Sprints 1, 2, 3, 4, 6 and 7 are still listed as future.

- Feature freeze: 6 Nov 2026 — [SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88) "Feature freeze (6 Nov)". Highest, unassigned, To Do.
- Final presentation and submission: 9 Dec 2026 — [SCRUM-101](https://secretsources.atlassian.net/browse/SCRUM-101) "Final presentation and submission (9 Dec)". Highest, unassigned, To Do.

## Progress

Since the 23 Oct refresh, six pull requests merged to `main`. Checks on `main` are green.

Merged on 23 Oct:

- Settings, Agents points at the Gatehouse `/me/` page, where a listed email gets its first key on Google sign-in ([SCRUM-409](https://secretsources.atlassian.net/browse/SCRUM-409), [PR #690](https://github.com/ZenithGeeks/SecretSource-prototype/pull/690); [issue #677](https://github.com/ZenithGeeks/SecretSource-prototype/issues/677) closed). Done in Jira. The gateway does not create or revoke keys.
- The gateway loads LiteLLM before the first request, so a chat cannot hang it ([SCRUM-415](https://secretsources.atlassian.net/browse/SCRUM-415), [PR #692](https://github.com/ZenithGeeks/SecretSource-prototype/pull/692); [issue #691](https://github.com/ZenithGeeks/SecretSource-prototype/issues/691) closed). Done in Jira.

Merged on 24 Oct:

- A refutes is asked again with the citation marked in its sentence, and that second verdict wins when it disagrees ([SCRUM-407](https://secretsources.atlassian.net/browse/SCRUM-407), [PR #693](https://github.com/ZenithGeeks/SecretSource-prototype/pull/693); [issue #672](https://github.com/ZenithGeeks/SecretSource-prototype/issues/672) closed). Done in Jira.

Merged on 25 Oct:

- The figure judge also runs after a text refutes, and it replaces that refutes only when the figure supports the claim ([SCRUM-417](https://secretsources.atlassian.net/browse/SCRUM-417), [PR #698](https://github.com/ZenithGeeks/SecretSource-prototype/pull/698); [issue #696](https://github.com/ZenithGeeks/SecretSource-prototype/issues/696) closed). Done in Jira.
- ColBERT passages end at a sentence, and a word hyphenated across a line break is joined ([SCRUM-416](https://secretsources.atlassian.net/browse/SCRUM-416), [PR #699](https://github.com/ZenithGeeks/SecretSource-prototype/pull/699); [issue #695](https://github.com/ZenithGeeks/SecretSource-prototype/issues/695) closed). Done in Jira.
- The data agent stops retrying `find_in_paper` with guessed words and uses `find_support` or `ask_library` for a topic ([SCRUM-420](https://secretsources.atlassian.net/browse/SCRUM-420), [PR #704](https://github.com/ZenithGeeks/SecretSource-prototype/pull/704); [issue #701](https://github.com/ZenithGeeks/SecretSource-prototype/issues/701) closed). Jira still lists it as In Review.

Open pull requests:

- The round 1 annotation guideline is drafted in [PR #694](https://github.com/ZenithGeeks/SecretSource-prototype/pull/694) ([issue #688](https://github.com/ZenithGeeks/SecretSource-prototype/issues/688), [SCRUM-66](https://secretsources.atlassian.net/browse/SCRUM-66)). Jira lists SCRUM-66 as In Review. The guideline is not merged, and its open questions are not decided.
- Phoenix retriever spans for ColBERT and ColPali searches: [PR #702](https://github.com/ZenithGeeks/SecretSource-prototype/pull/702) ([issue #697](https://github.com/ZenithGeeks/SecretSource-prototype/issues/697), [SCRUM-418](https://secretsources.atlassian.net/browse/SCRUM-418), In Review).
- Index the analysed paper in ColBERT, not only the works it cites: [PR #703](https://github.com/ZenithGeeks/SecretSource-prototype/pull/703) ([issue #700](https://github.com/ZenithGeeks/SecretSource-prototype/issues/700), [SCRUM-419](https://secretsources.atlassian.net/browse/SCRUM-419), In Review).

Jira project SCRUM on 25 Oct: 70 To Do, 8 In Progress, 11 In Review, and 283 Done. 47 are open and unassigned. 21 are overdue (a due date before 25 Oct, and not Done).

Open issues still labeled `today`: [issue #655](https://github.com/ZenithGeeks/SecretSource-prototype/issues/655) (the round 1 paper shortlist; five answers still waiting), [issue #688](https://github.com/ZenithGeeks/SecretSource-prototype/issues/688) (the guideline draft, now [PR #694](https://github.com/ZenithGeeks/SecretSource-prototype/pull/694)), and [issue #689](https://github.com/ZenithGeeks/SecretSource-prototype/issues/689) (Cursor's review of the merged MCP permission pull requests [#679](https://github.com/ZenithGeeks/SecretSource-prototype/pull/679) and [#680](https://github.com/ZenithGeeks/SecretSource-prototype/pull/680)). [Issue #672](https://github.com/ZenithGeeks/SecretSource-prototype/issues/672) is closed.

Since the 21 Oct refresh, the Sprint 4 vision judge is Done and assistant memory is built.

[SCRUM-80](https://secretsources.atlassian.net/browse/SCRUM-80) (vision judge, the Sprint 4 goal) is Done in Jira. The eval harness reports precision, recall and F1 per judge call ([PR #658](https://github.com/ZenithGeeks/SecretSource-prototype/pull/658)).

[SCRUM-370](https://secretsources.atlassian.net/browse/SCRUM-370) assistant memory is built and Done ([PR #659](https://github.com/ZenithGeeks/SecretSource-prototype/pull/659), [PR #661](https://github.com/ZenithGeeks/SecretSource-prototype/pull/661), [PR #663](https://github.com/ZenithGeeks/SecretSource-prototype/pull/663), [PR #666](https://github.com/ZenithGeeks/SecretSource-prototype/pull/666); [issue #540](https://github.com/ZenithGeeks/SecretSource-prototype/issues/540) closed). The SPEC.md memory decision is no longer open.

[SCRUM-397](https://secretsources.atlassian.net/browse/SCRUM-397) upload validation is Done ([PR #657](https://github.com/ZenithGeeks/SecretSource-prototype/pull/657), [PR #665](https://github.com/ZenithGeeks/SecretSource-prototype/pull/665)). [SCRUM-402](https://secretsources.atlassian.net/browse/SCRUM-402) repaired the Supabase migration history ([PR #660](https://github.com/ZenithGeeks/SecretSource-prototype/pull/660); [issue #307](https://github.com/ZenithGeeks/SecretSource-prototype/issues/307) closed). [SCRUM-403](https://secretsources.atlassian.net/browse/SCRUM-403) (the agent `submit_analysis` fix) is Done ([PR #662](https://github.com/ZenithGeeks/SecretSource-prototype/pull/662)). [SCRUM-310](https://secretsources.atlassian.net/browse/SCRUM-310) is Done.

On 20 Oct UTC, 47 pull requests merged. One is [#557](https://github.com/ZenithGeeks/SecretSource-prototype/pull/557), that day's status refresh. The other 46 are the pull requests from [#561](https://github.com/ZenithGeeks/SecretSource-prototype/pull/561) through [#653](https://github.com/ZenithGeeks/SecretSource-prototype/pull/653) that merged that UTC day. By Bangkok time the count is 49, because [#546](https://github.com/ZenithGeeks/SecretSource-prototype/pull/546) and [#553](https://github.com/ZenithGeeks/SecretSource-prototype/pull/553) merged at 00:27 ICT on 20 Oct (17:27 UTC on 19 Oct). Most of them are the labeler and the assistant.

The labeler can search all of Scopus or a pasted DOI ([#613](https://github.com/ZenithGeeks/SecretSource-prototype/pull/613)), upload a PDF when the analysis cannot download one ([#618](https://github.com/ZenithGeeks/SecretSource-prototype/pull/618)), put papers side by side ([#595](https://github.com/ZenithGeeks/SecretSource-prototype/pull/595)), open a status bell ([#599](https://github.com/ZenithGeeks/SecretSource-prototype/pull/599)), filter the paper list ([#583](https://github.com/ZenithGeeks/SecretSource-prototype/pull/583)), and download one account's own labels ([#589](https://github.com/ZenithGeeks/SecretSource-prototype/pull/589)). Ask AI in the labeler reviews a saved claim ([#611](https://github.com/ZenithGeeks/SecretSource-prototype/pull/611)).

Ask is on every role: the researcher screens ([#569](https://github.com/ZenithGeeks/SecretSource-prototype/pull/569)), Author and Teacher ([#575](https://github.com/ZenithGeeks/SecretSource-prototype/pull/575)), and the labeler ([#611](https://github.com/ZenithGeeks/SecretSource-prototype/pull/611)). The Ask panel on the researcher screens and on Author and Teacher is [SCRUM-364](https://secretsources.atlassian.net/browse/SCRUM-364), and Jira lists that ticket as Done. Ask also has a "Do it" screen agent that works the app with an AI cursor ([#619](https://github.com/ZenithGeeks/SecretSource-prototype/pull/619)), data tools over MCP for Claude Code and Codex ([#625](https://github.com/ZenithGeeks/SecretSource-prototype/pull/625), [#642](https://github.com/ZenithGeeks/SecretSource-prototype/pull/642)), `/` and `@` commands in the Ask box ([#642](https://github.com/ZenithGeeks/SecretSource-prototype/pull/642)), and a specialist hand-off for questions about the person's papers ([#647](https://github.com/ZenithGeeks/SecretSource-prototype/pull/647)).

Merged on 22 Oct, ten pull requests:

- An Agents tab in Settings, and per-person MCP tool permissions: [SCRUM-410](https://secretsources.atlassian.net/browse/SCRUM-410) and [SCRUM-408](https://secretsources.atlassian.net/browse/SCRUM-408) ([PR #678](https://github.com/ZenithGeeks/SecretSource-prototype/pull/678), [PR #679](https://github.com/ZenithGeeks/SecretSource-prototype/pull/679), [PR #680](https://github.com/ZenithGeeks/SecretSource-prototype/pull/680)). SCRUM-410 is Done. SCRUM-408 is still In Review.
- The Ask panel empty state ([SCRUM-411](https://secretsources.atlassian.net/browse/SCRUM-411), [PR #682](https://github.com/ZenithGeeks/SecretSource-prototype/pull/682)), and the thinking state, answer actions, citation preview, and shared UI components ([SCRUM-413](https://secretsources.atlassian.net/browse/SCRUM-413), [SCRUM-414](https://secretsources.atlassian.net/browse/SCRUM-414), [PR #687](https://github.com/ZenithGeeks/SecretSource-prototype/pull/687)). All three are Done in Jira.
- [SCRUM-412](https://secretsources.atlassian.net/browse/SCRUM-412) pinned litellm below 1.106 after a clean build broke every LLM call ([PR #684](https://github.com/ZenithGeeks/SecretSource-prototype/pull/684)). Done in Jira.
- Names-only claims are listed as "names only" ([SCRUM-406](https://secretsources.atlassian.net/browse/SCRUM-406), [PR #674](https://github.com/ZenithGeeks/SecretSource-prototype/pull/674)). Done in Jira.
- Settings lists and deletes remembered facts ([SCRUM-404](https://secretsources.atlassian.net/browse/SCRUM-404), [PR #671](https://github.com/ZenithGeeks/SecretSource-prototype/pull/671)). Done in Jira.
- The labeler claim panel has more room and can be resized ([SCRUM-405](https://secretsources.atlassian.net/browse/SCRUM-405), [PR #670](https://github.com/ZenithGeeks/SecretSource-prototype/pull/670)). Done in Jira.
- [SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81) rereads a broken figure manifest and documents the crop fields ([PR #668](https://github.com/ZenithGeeks/SecretSource-prototype/pull/668)). The ticket is still In Review.

## Current priorities

1. **Sprint 5 is underway** (started 24 Oct, active on the board). The feature freeze is 6 Nov ([SCRUM-88](https://secretsources.atlassian.net/browse/SCRUM-88), Highest, unassigned, To Do). The open product call is **[SCRUM-85](https://secretsources.atlassian.net/browse/SCRUM-85)** — Draft mode. In Review, unassigned, High. [Issue #667](https://github.com/ZenithGeeks/SecretSource-prototype/issues/667) found that `main` ships a LaTeX-first Author flow. Vitawat chooses whether to rewrite the ticket to that scope or keep it and add follow-ups (plain-text paste, suggested replacement). The choice is under Decisions.
2. **Labeling round 1 has not started.** **[SCRUM-70](https://secretsources.atlassian.net/browse/SCRUM-70)** — 80 claims. To Do, unassigned, High. It waits on decisions in [issue #655](https://github.com/ZenithGeeks/SecretSource-prototype/issues/655) and [issue #556](https://github.com/ZenithGeeks/SecretSource-prototype/issues/556). A read-only count of `public.labeling_rows` on 22 Oct shows 26 label rows, 45 claim rows and 102 candidate rows from 3 or 4 accounts. The table is append-only, so those rows may include test saves, and nobody has called them round 1. `evidence_labels.csv` still has only its header. The paper shortlist ([SCRUM-67](https://secretsources.atlassian.net/browse/SCRUM-67), In Progress, unassigned, High) waits on 5 answers: the round 1 mix of domains, the judge's knowledge cutoff, whether to keep ColBERTv2, the table and figure targets, and whether pasting a DOI is enough when Scopus misses IEEE and ACM open copies. The annotation guideline (**[SCRUM-66](https://secretsources.atlassian.net/browse/SCRUM-66)**, Highest, In Review) is drafted in open [PR #694](https://github.com/ZenithGeeks/SecretSource-prototype/pull/694) and is not merged. **[SCRUM-79](https://secretsources.atlassian.net/browse/SCRUM-79)** — round 2, 160 claims. To Do, unassigned, High. **[SCRUM-84](https://secretsources.atlassian.net/browse/SCRUM-84)** — 300 claims and inter-annotator agreement. To Do, unassigned, Highest. Sprint 6 evaluation depends on these labels.
3. **[SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81)** — Show figure and table evidence with the region boxed. In Review, unassigned, High. The backend ([PR #564](https://github.com/ZenithGeeks/SecretSource-prototype/pull/564), from [issue #554](https://github.com/ZenithGeeks/SecretSource-prototype/issues/554)), the claim card ([PR #568](https://github.com/ZenithGeeks/SecretSource-prototype/pull/568), from [issue #558](https://github.com/ZenithGeeks/SecretSource-prototype/issues/558)), and the manifest fix ([PR #668](https://github.com/ZenithGeeks/SecretSource-prototype/pull/668)) are merged. [Issue #559](https://github.com/ZenithGeeks/SecretSource-prototype/issues/559) is closed. The review of that backend work is on [PR #564](https://github.com/ZenithGeeks/SecretSource-prototype/pull/564). The remaining gaps are under Risks.
4. **[SCRUM-89](https://secretsources.atlassian.net/browse/SCRUM-89)** — Full evaluation matrix on the 300-claim benchmark. To Do, unassigned, Highest. **[SCRUM-86](https://secretsources.atlassian.net/browse/SCRUM-86)** — Public Cloud Run deployment with cost documented. To Do, unassigned, High. The release still needs the `SESSION_DB_URL` secret. [Where the system runs](../CONSTRAINTS.md#where-the-system-runs) still keeps work on the local stack until the system is finished, then one planned Google Cloud release.

## Risks and blockers

- Labeling round 1 has not started ([SCRUM-70](https://secretsources.atlassian.net/browse/SCRUM-70), 80 claims, To Do, unassigned, High). It waits on decisions in [issue #655](https://github.com/ZenithGeeks/SecretSource-prototype/issues/655) and [issue #556](https://github.com/ZenithGeeks/SecretSource-prototype/issues/556). A read-only count of `public.labeling_rows` on 22 Oct shows 26 label rows, 45 claim rows and 102 candidate rows from 3 or 4 accounts. Those are append-only ledger rows, so they may include test saves, and nobody has called them round 1. `evidence_labels.csv` still has only its header. The guideline draft is open in [PR #694](https://github.com/ZenithGeeks/SecretSource-prototype/pull/694) ([SCRUM-66](https://secretsources.atlassian.net/browse/SCRUM-66), Highest, In Review) and is not merged. The shortlist's five answers are still open: the round 1 mix of domains, the judge's knowledge cutoff, whether to keep ColBERTv2, the table and figure targets, and whether pasting a DOI is enough when Scopus misses IEEE and ACM open copies. Sprint 4's planned dates ended on 23 Oct, but the sprint was never started or closed in Jira. Sprint 6 evaluation ([SCRUM-76](https://secretsources.atlassian.net/browse/SCRUM-76), [SCRUM-84](https://secretsources.atlassian.net/browse/SCRUM-84), [SCRUM-89](https://secretsources.atlassian.net/browse/SCRUM-89)) depends on the labels. [SCRUM-79](https://secretsources.atlassian.net/browse/SCRUM-79) (round 2, 160 claims) is still To Do.
- [SCRUM-86](https://secretsources.atlassian.net/browse/SCRUM-86) still needs the `SESSION_DB_URL` repo secret before a Cloud Run release. Without it, assistant chats stay in memory and the gateway loses them when it scales to zero. [CONSTRAINTS.md](../CONSTRAINTS.md#where-the-system-runs) allows no Google Cloud deploy until the finished release (merged in [PR #488](https://github.com/ZenithGeeks/SecretSource-prototype/pull/488)).
- [SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81) still has two gaps after [PR #668](https://github.com/ZenithGeeks/SecretSource-prototype/pull/668): no full `VISUAL_EVIDENCE=1` analysis has checked that a box lands on the page, and the matching model is stored as `page_model` and is not shown on the crop. The ticket is In Review. [Issue #559](https://github.com/ZenithGeeks/SecretSource-prototype/issues/559) is closed; the review of the backend is on [PR #564](https://github.com/ZenithGeeks/SecretSource-prototype/pull/564).
- Jira still lists these as In Review: [SCRUM-408](https://secretsources.atlassian.net/browse/SCRUM-408) (pull requests merged), [SCRUM-81](https://secretsources.atlassian.net/browse/SCRUM-81) (pull requests merged), [SCRUM-420](https://secretsources.atlassian.net/browse/SCRUM-420) ([PR #704](https://github.com/ZenithGeeks/SecretSource-prototype/pull/704) merged), [SCRUM-66](https://secretsources.atlassian.net/browse/SCRUM-66) ([PR #694](https://github.com/ZenithGeeks/SecretSource-prototype/pull/694) open), [SCRUM-418](https://secretsources.atlassian.net/browse/SCRUM-418) ([PR #702](https://github.com/ZenithGeeks/SecretSource-prototype/pull/702) open), [SCRUM-419](https://secretsources.atlassian.net/browse/SCRUM-419) ([PR #703](https://github.com/ZenithGeeks/SecretSource-prototype/pull/703) open), and [SCRUM-85](https://secretsources.atlassian.net/browse/SCRUM-85). Done since the 23 Oct refresh includes [SCRUM-406](https://secretsources.atlassian.net/browse/SCRUM-406), [SCRUM-407](https://secretsources.atlassian.net/browse/SCRUM-407), [SCRUM-409](https://secretsources.atlassian.net/browse/SCRUM-409), [SCRUM-410](https://secretsources.atlassian.net/browse/SCRUM-410), [SCRUM-411](https://secretsources.atlassian.net/browse/SCRUM-411), [SCRUM-413](https://secretsources.atlassian.net/browse/SCRUM-413), [SCRUM-414](https://secretsources.atlassian.net/browse/SCRUM-414), [SCRUM-415](https://secretsources.atlassian.net/browse/SCRUM-415), [SCRUM-416](https://secretsources.atlassian.net/browse/SCRUM-416), and [SCRUM-417](https://secretsources.atlassian.net/browse/SCRUM-417).
- [Issue #544](https://github.com/ZenithGeeks/SecretSource-prototype/issues/544) (Scopus label, [SCRUM-374](https://secretsources.atlassian.net/browse/SCRUM-374), To Do, assignee Vitawat) is blocked on checking that Elsevier's API Service Agreement allows showing and caching Scopus data.

## Recent decisions

- **2026-10-24.** [SCRUM-407](https://secretsources.atlassian.net/browse/SCRUM-407) is Done and [issue #672](https://github.com/ZenithGeeks/SecretSource-prototype/issues/672) is closed ([PR #693](https://github.com/ZenithGeeks/SecretSource-prototype/pull/693)). When the paper judge says refutes, the claim is asked again with "[cited]" where that citation stands in the sentence. The second verdict wins when it disagrees. Supports and insufficient are not sent through that second call.
- **2026-10-23.** [SCRUM-409](https://secretsources.atlassian.net/browse/SCRUM-409) is Done and [issue #677](https://github.com/ZenithGeeks/SecretSource-prototype/issues/677) is closed ([PR #690](https://github.com/ZenithGeeks/SecretSource-prototype/pull/690)). An email on Gatehouse's self sign-up list gets its first key at `/me/` on Google sign-in. Settings, Agents links there. The gateway does not call the Gatehouse admin API to create or revoke keys.
- **2026-10-22.** [SCRUM-71](https://secretsources.atlassian.net/browse/SCRUM-71) closed as won't do. A partial-verdict spike (branch `SCRUM-71-partial-verdict-spike`, not merged) showed no accuracy gain: the text judge used "partially supports" 5 times in 461 checks, accuracy stayed inside run-to-run noise, and one use softened a claim that should be refutes. The judge keeps its current verdict classes, and labelers keep the 1-4 support levels. Jira status is Done.
- **Pending, Vitawat.** [SCRUM-85](https://secretsources.atlassian.net/browse/SCRUM-85) draft mode. [Issue #667](https://github.com/ZenithGeeks/SecretSource-prototype/issues/667) found that `main` ships a LaTeX-first Author flow, a `.tex` and `.bib` project with a check per `\cite`. The ticket describes a writer pasting a paragraph. The options are to rewrite the ticket to the LaTeX-first scope, or keep the ticket and add follow-ups for plain-text paste and a suggested replacement.
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
