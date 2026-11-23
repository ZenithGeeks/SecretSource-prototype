Read CONSTRAINTS.md before changing code. Do not weaken it to make a change pass.
Read docs/STATUS.md at the start of a session for the big picture and current priorities. Record blockers, open questions, or big-picture changes under "Notes from Claude Code" in that file.
At session start, run `gh issue list --label agent-claude --label today --state open` and work only on those issues.
If none are labeled `today`, ask Vitawat before picking up other `agent-claude` issues.
Don't start unplanned work.
When finished, open a PR that says `Fixes #N`, and comment any blocker on the issue.

## Commands

- Lint backend: `ruff check backend services` from the repo root. CI's ruff is newer than most
  local installs and flags `zip()` without `strict=`, so add it.
- Backend tests: run inside the gateway image, see "Tests" in `backend/README.md`. Host Python
  lacks `google-adk` and `pymupdf`; only `tests/test_sources.py` runs on the host.
- Front end, in `frontend/`: `npm run lint`, `npm run build`, `npm run check:bundle`, `npm test`.
- Every worktree shares one compose project. Check a container's `working_dir` label before
  trusting what is running.

## Conventions

- Branch from `main` and base PRs on `main`, never on another feature branch.
- Commit and PR titles: Conventional Commits with the Jira key as scope, e.g.
  `fix(SCRUM-167): ...`. No AI attribution lines in commits, PRs or issues.
- Run `ruff format` only on code you change, not on whole files.

## Boundaries

- Analyses are owner-only. Do not add a cross-user read without asking.
- ADK session tables live in schema `adk`, never `public`: the anon key can read `public`.
- Supabase MCP `apply_migration` and `execute_sql` hit production. Test RLS in a throwaway
  Postgres container first.
- Ask before a multi-run eval; it takes hours and LLM budget.
- Never commit `.env` or anything under `backend/secrets/`.
