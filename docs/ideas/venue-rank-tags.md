# Venue rank tags in the Labeler

One-pager from the idea-refine session on 2026-10-26 (SCRUM-445). It started as "when the Labeler fetches
a paper, tag it Q1, Q2 or Q3".

## Problem Statement

How might we show labelers how strong a paper's venue is (Q1-Q4 for journals, A*-C for
conferences) when they pick papers, let them filter by it, and report it for the labeled set in
the thesis?

## Today

- `backend/app/labeling/scopus.py` asks Scopus for `prism:publicationName` only (`FIELDS`), so a
  result has a venue name and no rank.
- "Topic venues" searches use the fixed `VENUES` list in the same file; "all venues" searches
  any source Scopus indexes.
- Many team venues are conferences (SIGIR, ACL, ICCV). Quartiles rank journals, so conferences
  need another ranking.

## Recommended Direction

Journals get their SJR best quartile (SCImago's free yearly table), matched by ISSN against one
year, stated on the tag. Conferences get their CORE rank (A*, A, B, C). The topic venues get their
rank written next to them in `VENUES`, checked once by hand. Outside that list, journals are still
matched by ISSN, and an unknown conference shows "Conference, unranked": matching Scopus's
"Proceedings of the 43rd International ACM SIGIR Conference..." to a CORE row by fuzzy text can
pick the wrong conference, and a wrong rank is worse than none.

The rank is stored on each pool paper when it is added (`system`, `value`, `year`) and goes into
the labels CSV export, so the thesis can say how many labeled papers came from Q1, Q2, A*, ...
venues. Scopus cannot filter by rank itself. For topic venues the filter leaves low-ranked venues
out of the query, which is exact. For "all venues" it filters the returned page, and the page says
"showing 9 of 25".

## Key Assumptions to Validate

- [ ] Scopus search returns `prism:issn`, `prism:eIssn` and the source type on our key: one test call.
- [ ] The SJR and CORE terms allow committing their tables to the repo: read both, cite them in the README.
- [ ] Hand ranks cover the topic venues: list `VENUES` with their SJR or CORE rank and check each by hand.

## MVP Scope

In: an SJR table trimmed to title, ISSNs, best quartile and year; CORE ranks for the topic
venues; the rank on Scopus search results; a rank filter; the rank stored on pool papers and in
the labels CSV.

Out: everything in Not Doing.

## Not Doing (and Why)

- JCR (Clarivate) quartiles: paywalled.
- Fuzzy CORE matching for any conference: a wrong rank is worse than none.
- A quartile per publication year: one SJR year, stated on the tag, is enough for picking and for
  the thesis table.
- Ranks in other roles (Researcher library, Author references): they can reuse the same lookup later.

## Open Questions

- Which SJR year: 2025, the latest, for every paper?
- Should papers already in the pool get their rank filled in once?
