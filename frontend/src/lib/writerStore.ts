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
import type { Citation, Claim, Draft, CheckRun, SearchResponse, SearchScope, Source, WriterHome } from './writer'

/** Deep clone so mutations never touch the shared mock module. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const db = {
  drafts: clone(MOCK_DRAFTS) as Draft[],
  claims: clone(MOCK_CLAIMS) as Claim[],
  home: clone(MOCK_HOME) as WriterHome,
  search: clone(MOCK_SEARCH) as SearchResponse,
  // claimId -> the citation it had before a replacement, so Undo can restore it.
  pendingReplacements: {} as Record<string, { previousCitation: Citation | undefined }>,
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

function buildCheckRun(draftId: string): CheckRun {
  const draft = findDraft(draftId)
  const issues = claimsFor(draftId).filter(
    (c): c is CheckRun['issues'][number] => c.verdict === 'refutes' || c.verdict === 'insufficient',
  )
  return { draft, issues, currentIssueIndex: 0 }
}

export const store = {
  drafts: (): Draft[] => db.drafts,
  draft: (id: string): Draft => findDraft(id),
  checkRun: (draftId: string = DEFAULT_DRAFT_ID): CheckRun => buildCheckRun(draftId),
  home: (): WriterHome => db.home,

  /** Filters search results by text (title/citation) and by which "search in" scopes are
   * active. The current citation always shows — it's context for the swap, not a candidate
   * competing for the scope filters. An all-off scope (every toggle unchecked) falls back to
   * showing everything rather than nothing. */
  search: (query = '', scope: SearchScope = {}): SearchResponse => {
    const q = query.trim().toLowerCase()
    const noScopeActive = !scope.libraryOnly && !scope.openAccess && !scope.citedByLibrary
    const matchesScope = (s: Source) =>
      s.isCurrentCitation ||
      noScopeActive ||
      (scope.libraryOnly && s.inLibrary) ||
      (scope.openAccess && s.openAccess) ||
      (scope.citedByLibrary && s.citedByLibrary)
    const matchesQuery = (s: Source) =>
      q.length === 0 || s.title.toLowerCase().includes(q) || s.citation.toLowerCase().includes(q)
    return { ...db.search, results: db.search.results.filter((s) => matchesScope(s) && matchesQuery(s)) }
  },

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
    db.pendingReplacements[claimId] = { previousCitation: claim.citation }
    if (source) claim.citation = { id: source.id, label: source.citation }
    claim.verdict = undefined
    return buildCheckRun(claim.draftId)
  },

  /** Back-compat for DraftCheck's existing "Replace citation" button, which applies the
   * claim's own bundled `suggestion` rather than a source picked in Find a source. */
  replaceCitationWithSuggestion(claimId: string): CheckRun {
    const claim = db.claims.find((c) => c.id === claimId)
    if (!claim) return buildCheckRun(DEFAULT_DRAFT_ID)
    db.pendingReplacements[claimId] = { previousCitation: claim.citation }
    if (claim.suggestion) claim.citation = { id: claim.suggestion.id, label: claim.suggestion.citation }
    claim.verdict = claim.suggestion?.verdict
    // Scripted paragraph swap for the c1/d1 demo case only — see mocks/writer.ts.
    if (claimId === 'c1') findDraft(claim.draftId).paragraphs = clone(D1_PARAGRAPHS_AFTER_C1_REPLACED)
    return buildCheckRun(claim.draftId)
  },

  /** Undo a pending citation replacement, restoring the previous citation. */
  undoReplacement(claimId: string): CheckRun {
    const claim = db.claims.find((c) => c.id === claimId)
    const pending = db.pendingReplacements[claimId]
    if (claim && pending) {
      claim.citation = pending.previousCitation
      delete db.pendingReplacements[claimId]
    }
    return buildCheckRun(claim?.draftId ?? DEFAULT_DRAFT_ID)
  },

  hasPendingReplacement(claimId: string): boolean {
    return claimId in db.pendingReplacements
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
