# Author Library on the shared Library frame (SCRUM-431, SCRUM-432)

## Problem Statement

How might we restyle the Author Library (A4) and Project detail (A5) on the same Library frame as
the Researcher, each role keeping its own content, while total JS and total CSS both get smaller?

On `main` (13 Nov 2026): total JS 1,206,876 gzip bytes (budget 1,225,000), total CSS 14,956
(budget 15,000, 44 bytes of room). Both roles carry their own `ProjectCard`, `ProjectMenu`,
`DeleteProjectDialog`, new-project dialog and rename field.

## Recommended Direction

Lift the Researcher's Library pieces into `src/components/library/`: modal, header, project card,
project menu, delete dialog. Move the Researcher onto them first, with no visual change, and
measure. Then rebuild the Author Library on the same frame. Projects use the shared card. Unsorted
and "+ New project" are extra grid cards. "Needs attention" and "Saved sources" stay Author-only
sections below the grid.

Project detail (A5) uses the shared back link and header. Its own content is the draft rows (vN,
status pill), check history, "Since vN" and Compare, all on the existing check-history endpoints.
Where Figma differs from the Researcher, the Researcher look wins.

Ship it as one PR (`Fixes #719`, `Fixes #720`), because both issues depend on the same frame and PRs
are never stacked on a feature branch. Finish with an `/impeccable critique` of both roles' Library
screens.

## Key Assumptions to Validate

- [ ] One project card API serves both roles without losing `data-ask-target` or save-on-Enter
      rename (#851). Check: the Author and Researcher tests still pass, with the same intent.
- [ ] The Researcher Library looks the same after the move. Check: screenshots before and after.
- [ ] CSS drops below 14,956 and JS below 1,206,876. Check: `npm run check:bundle` after the extract
      step and again at the end.
- [ ] The Researcher tally bar and the Author verdict bar can share one colour scale. If they
      can't, keep two bars.

## MVP Scope

In: the shared library components; the Researcher migrated onto them; Author A4 and A5 on the
frame; Author-only arbitrary CSS values swapped for the Researcher's type tokens; lint, build,
`check:bundle` and tests all green; an impeccable critique score; the PR; a note on #720 that the
"Find a source" dependency is void.

## Not Doing (and Why)

- A3 and "Find a source": the feature was dropped from the Author role on 26 Oct; Ask AI covers
  paper search.
- One Library screen with a role switch: it would tangle the two roles' data hooks.
- Teacher on the frame: unplanned work.
- Following Figma where it differs from the Researcher: the Researcher look wins, and the CSS
  budget can't absorb new styles.
- Raising either bundle budget: the goal is a net shrink.
- Backend changes: A5 reuses the existing endpoints.

## Open Questions

- Editing the SCRUM-432 Jira description and posting on #720 are visible to the team; confirm
  before posting. `gh` is not installed on the machine that drafted this.
