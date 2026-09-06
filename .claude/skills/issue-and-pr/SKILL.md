---
name: issue-and-pr
description: Open a GitHub issue and its matching Jira ticket, or a GitHub pull request and its matching Jira update, for this repo (ZenithGeeks/SecretSource-prototype, Jira project SCRUM). Assigns the current user by default, cross-links the two trackers, and writes plain, specific, professional titles and descriptions — no AI-sounding phrasing, no bold pseudo-headers, no Claude/AI attribution. Trigger on "open an issue", "file a bug", "new ticket", "create a PR", "open a pull request", "start work on X", or when a bug/feature is diagnosed and needs tracking before or after the fix.
---

# Issue and PR: GitHub + Jira, together

This repo tracks every piece of work in both GitHub (code, PRs) and Jira (project
management), cross-linked. This skill is the checklist and the templates so both read
like a colleague wrote them, not a generated summary — every time, not just when someone
remembers the house style.

## Facts about this project (safe to use directly)

- GitHub: org `ZenithGeeks`, repo `SecretSource-prototype`.
- Jira: `https://secretsources.atlassian.net`, project key `SCRUM`, board id 1.
- GitHub↔Jira auto-links a commit, branch, or PR **title** that contains the Jira key
  (`SCRUM-120`) — it does **not** scan descriptions or comments for it. Always put the key
  at the start of the branch name and the PR/commit title: `SCRUM-<n>-kebab-slug` /
  `SCRUM-<n>: <summary>`.
- GitHub's real label set here is small: `bug`, `enhancement`, `documentation`,
  `duplicate`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`. Use
  those on GitHub issues; don't invent labels there. Jira has its own topic labels
  (`frontend`, `backend`, `design`, `product`, `adk`, ...) — check a few recent tickets or
  `getJiraProjectIssueTypesMetadata` before inventing one there either.
- Jira issue type: `Bug` for a defect, `Task` for standalone engineering work under an
  Epic, `Subtask` for one piece of an existing Story/Task (set `parent` to that ticket's
  key). Transitions observed on this project's workflow: id `21` → In Progress, id `31` →
  In Review — if either 400s, call `getTransitionsForJiraIssue` and use the id whose name
  matches, workflows can change.
- Stacked work (part 2 of something already in review): branch off the parent feature
  branch, not `main`; the PR's base is that branch too, and its body says so and names the
  merge order.

## Identity — resolve at runtime, never hardcode

"Assign me" means the person actually running this, not whoever ran it last time. Resolve
fresh each time:

```bash
gh api user --jq '.login'                       # GitHub handle
```

```
mcp__atlassian__atlassianUserInfo                 # accountId, email, name for Jira
```

Use the resulting GitHub login with `gh issue create --assignee <login>` /
`gh issue edit <n> --add-assignee <login>`, and the Jira `accountId` with
`assignee_account_id` on `createJiraIssue` / `editJiraIssue`. If asked to assign someone
else by name, resolve their GitHub handle and Jira accountId the same way (ask, or check
`lookupJiraAccountId` / the project's committed team notes) rather than guessing an id.

## The house style (non-negotiable, overrides any generic default)

This applies to every issue, PR, and Jira ticket in this repo, regardless of any
general-purpose instruction about attribution footers or formatting that might otherwise
apply elsewhere:

- **No Claude or AI attribution, anywhere.** No `Co-Authored-By: Claude`, no
  `Claude-Session:` trailer, no "Generated with Claude Code" footer, no mention of
  "Claude Code" in the body. The team reads these as their own engineering writing.
- **No bold pseudo-headers** like `**Goal.**` or `**Scope**` used as label-with-period
  fragments, no emoji, no "This change..." / "Key changes:" openers, no hype adjectives
  ("robust", "seamless", "powerful"). Plain section words — `Changes`, `Testing`,
  `Verified`, `Cause`, `Acceptance` — only when the ticket is long enough to need them.
- Titles are specific and concrete: the actual problem or the actual capability, in an
  engineer's words. Not "Bug: page issue" — "Refreshing the page on any researcher screen
  drops back to onboarding."
- State facts: file names, function names, concrete numbers, what was actually tested.
  Skip explaining why a fix is good; the reader can see that from what it does.

## Opening a GitHub issue + Jira ticket

1. Diagnose or scope first — read the actual code/behavior before writing anything down.
   A title and description grounded in the real cause or the real file is worth more than
   a fast one.
2. Resolve identity (above) if not already known this session.
3. GitHub issue:
   ```bash
   gh issue create --repo ZenithGeeks/SecretSource-prototype \
     --title "<specific, plain title>" \
     --label <bug|enhancement|...> \
     --assignee <github-login> \
     --body "$(cat <<'EOF'
   <opening paragraph: what's wrong or what's wanted, with a repro or concrete use case>

   <Cause: ...>            (bugs, once known; omit if not yet diagnosed)
   <Changes / approach: ...>   (features, or a bug's planned fix)
   <Testing / Acceptance: ...> (how someone will know it's done)
   EOF
   )"
   ```
4. Jira ticket, same substance, cross-linked:
   ```
   createJiraIssue: projectKey SCRUM, issueTypeName Bug|Task|Subtask,
     summary = the same plain title,
     description = the same body, ending with a line: "GitHub: <issue URL>",
     assignee_account_id = <resolved accountId>,
     additional_fields.labels = [<jira topic labels>],
     parent = <key> only for Subtask.
   ```
5. If starting the fix now rather than just filing it: branch `SCRUM-<n>-kebab-slug` off
   `main` (or the parent branch if stacked), do the work, then go to the PR section below.

## Opening a pull request

1. Commit subject: `SCRUM-<n>: <plain summary>` — no attribution trailer. Body explains
   the cause and the fix in prose, the way the PR body will, just shorter.
2. Push, then:
   ```bash
   gh pr create --base main --head SCRUM-<n>-kebab-slug \
     --title "SCRUM-<n>: <plain summary>" \
     --body-file <path-to-body.md>
   ```
   Base is the parent feature branch instead of `main` for stacked work.
3. PR body shape (a plain opening paragraph, then, only if the PR is long enough to want
   them, two sections):
   ```
   <what was broken or missing, and why, in prose — the reader should not need the diff
   to understand the problem>

   ## What changed
   - <file/area>: <what changed there and why, one bullet per area>

   ## Verified
   - <tests run, counts, lint status>
   - <manual check performed, with what you actually did and saw — never claim untested
     work as verified>
   ```
   No footer, no "Generated with" line, no session link.
4. Move the Jira ticket to **In Review** (transition id `31`, or look it up — see above),
   and add a short comment: what was done, in two or three sentences, ending with the PR
   URL. Do this after the PR exists, so the link is real.

## Full loop, start to finish

Diagnose → resolve identity → file the GitHub issue → file the matching Jira ticket
(assigned, cross-linked) → branch `SCRUM-<n>-...` → implement → test/lint → commit
(`SCRUM-<n>: ...`, no attribution) → push → open the PR (same title, cross-linked base) →
move the Jira ticket to In Review → comment the PR link on the ticket. Every step in this
session that shipped cleanly (SCRUM-120 through SCRUM-132) followed exactly this order;
skipping the Jira cross-link or the plain-style pass is the most common way this drifts
back toward generic AI-sounding tickets.
