# Assessment: replacing the static draft view with a real rich-text editor

Status: assessment only, no code or design started. Written to scope the work
before it's broken into implementation issues.

Scope: replace the author's static draft view (formatting — font size, color,
bold/italic — plus citation claims marked inline with their verdicts) with a
real rich-text editor. Follows on from SCRUM-236 (`docs/draft-check-slice.md`),
which deliberately deferred claim extraction and a `drafts` table (tracked as
#207) so this could be designed against something real instead of guessed.

## 1. What breaks today when the document becomes editable

`Draft.paragraphs` is typed as `DraftWord[][]` — an array of paragraphs, each
an array of `{ text, mark? }` objects (`frontend/src/lib/writer.ts:66-77`).
The renderer just maps over that array, wrapping each word in a `<mark>` when
it has a verdict, or a plain `<span>` otherwise
(`frontend/src/roles/writer/screens/DraftCheck.tsx:30-49`).

Three things about this are load-bearing, and all three break the moment the
text becomes editable:

- **Position = array index, not a reference.** A word's mark exists only
  because it sits at that index in that paragraph's array. There is no id,
  offset, or range object anywhere — the mark *is* the word.
- **The data is pre-baked, not derived.** `writerStore.ts` builds these
  arrays once (from mocks, or via a scripted swap in
  `replaceCitationWithSuggestion` — see the hardcoded
  `D1_PARAGRAPHS_AFTER_C1_REPLACED` blob at `writerStore.ts:104`). There is
  no code path that re-tokenizes text into a marked-up paragraph array; it's
  authored once and displayed.
- **Claims and marked words are linked only by luck.** A `Claim` has its own
  `text` field (the full sentence) and its own `verdict`
  (`writer.ts:47-57`), entirely separate from the words array. The only
  place these two representations touch is `saveDraftSource`, which does a
  verbatim substring check — if `claim.text` no longer appears in the LaTeX
  source, the verdict is cleared (`writerStore.ts:73-82`). That's a
  heuristic over raw text, not a link between a claim and a position in a
  document.

Bottom line: there is currently no representation of "this mark covers this
claim, wherever its text ends up." Making the document editable requires
building that concept from scratch — it doesn't exist yet, mocked or
otherwise.

## 2. Editor choice: TipTap/ProseMirror

All of TipTap/ProseMirror, Lexical, and Slate solve "a position or range
needs to survive edits elsewhere in the document," at different levels of
the stack:

| Editor | Mechanism | What you get for free | What you still build |
|---|---|---|---|
| **TipTap / ProseMirror** | Marks are a first-class schema concept, applied over a range. Every edit is a `Transaction` made of `Step`s, each exposing a position-mapping function; marks are carried by the document structure itself and move automatically as steps are mapped. | A claim mark that survives typing, pasting, and undo/redo with no custom position-tracking code. Marks can carry arbitrary attributes (e.g. a `claimId`). | Deciding what happens when an edit lands *inside* a marked range (extend the mark, or split it) — a schema/config choice (mark "inclusivity"), not automatic. |
| **Lexical** | Every node has a stable `NodeKey` that survives reconciliation; nodes are looked up by key, not by position. | A key-based reference to a specific node that doesn't rot. Good when a claim maps cleanly onto one text node. | Lexical's inline-mark story for ranges that need to merge/split across multiple text node boundaries is newer and thinner than ProseMirror's — more manual node-splitting logic to write. |
| **Slate** | `PointRef`/`RangeRef` objects explicitly track a point or range through subsequent operations, with an "affinity" setting controlling growth vs. holding at edited boundaries. | Fine-grained control over boundary behavior when needed. | Refs are created and managed manually, including `unref()`; Slate's API has also churned more across versions than ProseMirror's. |

**Recommendation: TipTap** (ProseMirror underneath).

- The exact use case — highlight a range of text and keep it highlighted
  while the document is edited around it — is ProseMirror's most common
  community pattern for comments/annotations. Not a novel application.
- Marks carrying attributes is the natural place for a `claimId`, directly
  answering the storage question in section 3 — the reference lives in the
  document itself, not in a side table kept in sync by hand.
- TipTap wraps ProseMirror with a React-friendly API and a maintained
  extension ecosystem, without giving up ProseMirror's transaction/mapping
  machinery underneath — a real advantage given the rest of this app is
  React.
- Lexical is a reasonable second choice if the team already has deep Lexical
  experience; its cross-node inline-range story is less battle-tested for
  this "mark spans arbitrary, edit-shifting text" case. Slate is the least
  attractive option here: smaller ecosystem, more DIY, more historical API
  churn to absorb over the project's life.

## 3. Storage: document JSON, claims as mark attributes

Persist the editor's document JSON, not HTML.

- ProseMirror's document JSON is a structured tree (nodes + marks with
  attributes) that round-trips losslessly through the editor. HTML is a
  serialization format, not the model — parsing it back into a document on
  load is lossy and fragile once marks carry structured data like a
  `claimId` or a verdict enum.
- It sidesteps the "recompute offsets" problem entirely. If a claim's
  identity is a mark attribute embedded in the tree (e.g. a `claimMark` node
  with `attrs: { claimId, verdict }` wrapping a range of text), then "where
  is this claim in the document" is answered by walking the tree for that
  mark — there's no separate offset/range number to keep in sync as
  surrounding text changes. **`claimId` is a mark attribute, not a separate
  offsets table** — a separate table would drift out of sync on the next
  edit, which is exactly the failure mode section 1 describes.
- The existing `latexSource` field becomes an open question, not an
  automatic casualty (see "Open questions" below) — it may need to stay as
  an export target even if it stops being the editing source of truth.

This reshapes the `drafts` table deferred in #207: instead of modeling
paragraphs/words, it holds one JSON/JSONB blob per draft (the ProseMirror
doc), an owner reference, and metadata (title, timestamps, check status) —
no positional columns, because position is implicit in the document
structure. The `claims` table's role shifts too: a claim row still holds the
check result (verdict, quote, reasoning — everything `Claim` in
`writer.ts:47-57` already has), but it's located inside the document by its
`claimId` mark attribute rather than by any stored offset.

## 4. Verdict lifecycle on claim-text edits

| Option | Behavior | Trade-off |
|---|---|---|
| Invalidate immediately | Any edit inside the claim's marked range clears the verdict on the spot (today's crude substring check does this in spirit). | Simple and safe, but punishes a typo fix exactly as hard as an edit that changes the actual factual content — likely to feel naggy. |
| Re-check automatically | Any edit inside the range silently kicks off a fresh `/checks` call. | Ruled out by the pipeline itself: a check takes ~12 seconds end to end and hits a standing ColBERT service (`docs/draft-check-slice.md`, spike #204 finding D). Auto-firing this per keystroke or per pause burns quota and pipeline capacity for no reason on non-substantive edits. |
| **Mark stale (recommended)** | Compare the claim's live text under the mark against the text that was actually checked. If they differ, flip the claim to a "stale" state — verdict badge stays visible but visually downgraded — and surface a manual re-check action, reusing the existing `POST /checks` call and the store's `recheckClaim` pattern (`writerStore.ts:125-129`). | Needs one small piece of new state (the checked-text snapshot to diff against), but costs nothing at edit time, never fires the pipeline without the user asking, and gives an honest "this verdict may no longer apply" signal instead of silently keeping a stale verdict or aggressively wiping it on every keystroke. |

Decision: **mark stale, not auto-invalidate, not auto-recheck.** Because the
mark travels with its text (section 2), the comparison is exactly "does the
text currently under this mark match what was sent to `/checks`" — a
question the editor can answer directly, unlike today's system.

## 5. Sizing and phases

| Phase | Scope | Estimate |
|---|---|---|
| 0 — Read-only swap-in | Replace the `DraftWord[][]` renderer with a read-only TipTap instance rendering a ProseMirror doc whose claim marks carry `claimId`/`verdict` attributes. No editing. Forces the storage decision (section 3) and proves the mark-attribute approach renders correctly before any edit-tracking complexity is on the table. Genuinely useful alone: same static view users have today, on the model everything else builds on. | ~2-3 days |
| 1 — Editable text, no formatting toolbar | Turn on editing. Implement the stale-detection comparison (section 4) and the manual re-check affordance. No bold/italic/color/font-size yet — purely about proving marks survive real typing, pasting, and undo/redo before adding surface area. | ~1-1.5 weeks |
| 2 — Rich formatting + persistence | Add the formatting toolbar (bold, italic, font size, color), wire the new `drafts` table (section 3) so documents persist server-side instead of living in the in-memory `writerStore`, and connect claim extraction/re-check into that persisted flow end to end. | ~1.5-2 weeks |
| 3 — Edge cases and polish | Paste-from-Word/Google-Docs mark stripping, copy/paste of a claim mark itself, undo/redo interaction with the stale flag, multi-cursor edits if collaboration is ever in scope. Buffer, not fixed scope — the easiest phase to underestimate. | ~1 week buffer |

Rough engineering-time estimates for one contributor already familiar with
the codebase; exclude design iteration, QA, and backend infra work beyond the
`drafts` table itself.

## 6. ClaimCheckCard and POST /checks

**`POST /checks` stays, unchanged, as the underlying primitive.** It already
takes exactly `{ claim: str, source: str }` — free text, no coupling to any
draft or document (`writer.ts:160`) — precisely the shape an editor-based
flow needs to call once per extracted claim. `docs/draft-check-slice.md` is
explicit that SCRUM-236 deliberately excluded claim extraction and a drafts
table (#207 scope boundary) so the rest of draft-check could be designed
against something real instead of guessed. This editor work is that next
step, not a departure from the plan. The editor becomes a new, additional
caller of `/checks` (one call per claim mark), not a reason to change the
endpoint.

**`ClaimCheckCard`'s (`DraftCheck.tsx:54-119`) long-term fate is a product
decision, not a technical one — flagged for advisor input:**

- *Absorbed:* once claims are extracted automatically from the live document
  and checked inline via their marks, the manual "type a claim and a
  citation key" form has no obvious place on that same screen — its job is
  done by the editor itself.
- *Kept elsewhere:* still useful as an ad-hoc "spot-check any sentence
  against any source" utility independent of a draft. Worth keeping as a
  small standalone tool rather than deleting outright, even if it leaves the
  editor screen.

## Open questions for advisor review

1. Does `latexSource` survive as the source of truth, or does the editor's
   document JSON replace it entirely? Today the two are already only
   loosely connected (`saveDraftSource`'s substring check is the only
   bridge). If LaTeX export still matters, doc-JSON-to-LaTeX serialization
   is new work not scoped above.
2. Where does claim extraction come from? This assessment assumes claims
   arrive already marked (from an existing extraction step) and focuses on
   keeping marks anchored once they exist. If extraction from freeform
   editable text is itself unbuilt, that's separate, likely larger, scope.
3. Should `ClaimCheckCard` stay in the product at all once inline checking
   exists, and if so, where does it live? (Section 6.)

## Files referenced

- `frontend/src/lib/writer.ts` — types: `DraftWord`, `Draft`, `Claim`, `CheckResult`
- `frontend/src/lib/writerStore.ts` — in-memory store, `saveDraftSource`, `recheckClaim`
- `frontend/src/roles/writer/screens/DraftCheck.tsx` — `DraftParagraph` render, `ClaimCheckCard`
- `frontend/src/mocks/writer.ts` — seeded paragraph data
- `docs/draft-check-slice.md` — SCRUM-236 scope boundary, #204/#207 tracking

## Tracking

- Prior slice: SCRUM-236, tracked in #207
- This assessment's tracking issue: #210
