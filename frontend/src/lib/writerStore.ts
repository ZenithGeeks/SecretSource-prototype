/**
 * In-session mutable store for the writer screens. Seeded from the mocks and mutated by the
 * UI so create/replace/re-check actions actually persist while the app is open (until real
 * gateway endpoints exist). writer.ts reads its getters through this; mutations run via
 * useWriterActions, which invalidates the relevant React Query caches.
 */

import {
  D1_PARAGRAPHS_AFTER_C1_REPLACED,
  MOCK_CLAIMS,
  MOCK_DRAFTS,
  MOCK_HOME,
  MOCK_SEARCH,
} from '../mocks/writer'
import { DEFAULT_FILTER_KINDS } from './writer'
import type { Citation, Claim, Draft, DraftWord, CheckRun, SearchResponse, VerdictKind, WriterHome } from './writer'

/** Deep clone so mutations never touch the shared mock module. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const db = {
  drafts: clone(MOCK_DRAFTS) as Draft[],
  claims: clone(MOCK_CLAIMS) as Claim[],
  home: clone(MOCK_HOME) as WriterHome,
  search: clone(MOCK_SEARCH) as SearchResponse,
  // claimId -> what it had before a replacement, so Undo can restore it and Draft check
  // can show the 08b "citation replaced" toast.
  pendingReplacements: {} as Record<
    string,
    {
      previousCitation: Citation | undefined
      previousVerdict: VerdictKind | undefined
      previousParagraphs: DraftWord[][]
      newCitationLabel: string
    }
  >,
}

let seq = 1

/** The draft Home/Draft check operate on when no id is given, matching today's single-draft screens. */
const DEFAULT_DRAFT_ID = db.drafts[0]?.id ?? 'd1'

function findDraft(id: string): Draft {
  return db.drafts.find((d) => d.id === id) ?? db.drafts[0]
}

function claimsFor(draftId: string): Claim[] {
  return db.claims.filter((c) => c.draftId === draftId)
}

function buildCheckRun(draftId: string, filterKinds: VerdictKind[] = DEFAULT_FILTER_KINDS): CheckRun {
  const seededDraft = findDraft(draftId)
  const claims = claimsFor(draftId)
  const issues = claims.filter(
    (c): c is CheckRun['issues'][number] => c.verdict !== undefined && filterKinds.includes(c.verdict),
  )
  const pendingClaim = claims.find((c) => c.id in db.pendingReplacements)
  const pendingReplacement = pendingClaim
    ? { claimId: pendingClaim.id, newCitationLabel: db.pendingReplacements[pendingClaim.id].newCitationLabel }
    : undefined
  // Derived live, not the mock's static counts — otherwise the header keeps reading e.g. "5
  // citations found, 2 need work" after a Re-check resolves an issue, while the panel right next
  // to it already says "1 of 1 issues". citationsFound counts actual \cite{} markers in the
  // source (there are more citation marks in the draft than claims — e.g. d1's own current
  // citation, never a Claim — so counting claims-with-a-citation undercounts). issuesRemaining
  // always counts against DEFAULT_FILTER_KINDS regardless of the active filterKinds — it's the
  // ground truth "needs work" count, not a reflection of what's currently shown.
  const draft: Draft = {
    ...seededDraft,
    citationsFound: (seededDraft.latexSource.match(/\\cite\{/g) ?? []).length,
    issuesRemaining: claims.filter((c) => c.verdict && DEFAULT_FILTER_KINDS.includes(c.verdict)).length,
  }
  return { draft, issues, pendingReplacement }
}

export const store = {
  drafts: (): Draft[] => db.drafts,
  draft: (id: string): Draft => findDraft(id),
  checkRun: (draftId: string = DEFAULT_DRAFT_ID, filterKinds?: VerdictKind[]): CheckRun =>
    buildCheckRun(draftId, filterKinds),
  home: (): WriterHome => db.home,
  search: (): SearchResponse => db.search,

  /** Create an empty draft and return its id. */
  createDraft(title?: string): string {
    const id = `draft-${seq++}` // distinct prefix from seeded d1/d2, so ids never collide
    db.drafts.unshift({
      id,
      fileName: title ?? `untitled-${id}.tex`,
      heading: 'Untitled section',
      latexSource: '',
      paragraphs: [],
      citationsFound: 0,
      issuesRemaining: 0,
      lastCheckedLabel: 'not checked yet',
    })
    return id
  },

  /** Update a draft's LaTeX source. Claims whose exact sentence no longer appears in the
   * new source are treated as edited and fall back to unchecked — there is no real re-parse
   * of LaTeX into claims here, just a verbatim-substring check against the mock claim text. */
  saveDraftSource(draftId: string, latexSource: string): void {
    const draft = findDraft(draftId)
    draft.latexSource = latexSource
    for (const claim of claimsFor(draftId)) {
      if (!latexSource.includes(claim.text)) claim.verdict = undefined
    }
  },

  /** Replace a claim's citation with an explicit source (Find a source's "Use this source"). */
  replaceCitation(claimId: string, sourceId: string): CheckRun {
    const claim = db.claims.find((c) => c.id === claimId)
    if (!claim) return buildCheckRun(DEFAULT_DRAFT_ID)
    const source = db.search.results.find((s) => s.id === sourceId)
    const draft = findDraft(claim.draftId)
    db.pendingReplacements[claimId] = {
      previousCitation: claim.citation,
      previousVerdict: claim.verdict,
      previousParagraphs: clone(draft.paragraphs),
      newCitationLabel: source?.citation ?? claim.citation?.label ?? '',
    }
    if (source) claim.citation = { id: source.id, label: source.citation }
    claim.verdict = undefined
    // Scripted paragraph swap for the c1 -> s1 (Santhanam) demo case only — see mocks/writer.ts.
    if (claimId === 'c1' && sourceId === 's1') draft.paragraphs = clone(D1_PARAGRAPHS_AFTER_C1_REPLACED)
    return buildCheckRun(claim.draftId)
  },

  /** Undo a pending citation replacement, restoring the previous citation, verdict, and
   * paragraphs (the scripted c1/s1 swap rewrites the whole draft body, not just the claim). */
  undoReplacement(claimId: string): CheckRun {
    const claim = db.claims.find((c) => c.id === claimId)
    const pending = db.pendingReplacements[claimId]
    if (claim && pending) {
      claim.citation = pending.previousCitation
      claim.verdict = pending.previousVerdict
      findDraft(claim.draftId).paragraphs = pending.previousParagraphs
      delete db.pendingReplacements[claimId]
    }
    return buildCheckRun(claim?.draftId ?? DEFAULT_DRAFT_ID)
  },

  hasPendingReplacement(claimId: string): boolean {
    return claimId in db.pendingReplacements
  },

  /** Dismiss a pending replacement's toast without undoing the swap. */
  dismissReplacement(claimId: string): CheckRun {
    const claim = db.claims.find((c) => c.id === claimId)
    delete db.pendingReplacements[claimId]
    return buildCheckRun(claim?.draftId ?? DEFAULT_DRAFT_ID)
  },

  /** Simulated re-check: after a delay, resolves to the claim's suggestion's verdict (or
   * `supports` when there's nothing left to disagree with). */
  recheckClaim(claimId: string): CheckRun {
    const claim = db.claims.find((c) => c.id === claimId)
    if (claim) claim.verdict = claim.suggestion?.verdict ?? 'supports'
    return buildCheckRun(claim?.draftId ?? DEFAULT_DRAFT_ID)
  },

  /** Flip a candidate source's in-library flag ("Add to library" in Find a source). */
  markInLibrary(sourceId: string): SearchResponse {
    const source = db.search.results.find((s) => s.id === sourceId)
    if (source) source.inLibrary = true
    return db.search
  },

  /** Clear every draft and claim back to empty (writer Settings "Delete all"). */
  deleteAll(): void {
    db.drafts = []
    db.claims = []
    db.home = { ...db.home, attention: [], recentPapers: [] }
  },
}
