/**
 * Typed client for the writer-role data. The gateway has no writer endpoints yet, so every
 * call resolves through src/lib/writerStore.ts, itself seeded from src/mocks/writer.ts. When
 * an endpoint lands, replace that call's body with a request() to it (see the TODO on each) —
 * the types, hooks and screens stay as they are.
 */

import { store } from './writerStore'

export type VerdictKind = 'supports' | 'refutes' | 'insufficient'

export const VERDICT_BADGE_TEXT: Record<VerdictKind, string> = {
  supports: 'SOURCE BACKS IT',
  refutes: 'SOURCE CONTRADICTS',
  insufficient: 'SOURCE IS SILENT',
}

export const VERDICT_LEGEND_TEXT: Record<VerdictKind, string> = {
  supports: 'source backs it',
  refutes: 'source contradicts',
  insufficient: 'source is silent',
}

export type Citation = { id: string; label: string }

/** A candidate source: a work that may (or does) back, contradict, or stay silent on a claim. */
export type Source = {
  id: string
  citation: string // "Santhanam et al. (2022)"
  title: string
  venue?: string
  verdict: VerdictKind
  similarity: number // 0..1, cosine match to the searched claim
  location: string // "p.4 §3.2"
  quote: string
  inLibrary: boolean
  openAccess: boolean
  isCurrentCitation: boolean
  isBestMatch: boolean
}

/**
 * One claim in a draft, and how its citation stood up. `draftId` scopes it to its draft.
 * `citation` absent = nothing was cited (uncited). `verdict` absent = not checked yet.
 */
export type Claim = {
  id: string
  draftId: string
  text: string
  citation?: Citation
  verdict?: VerdictKind
  explanation?: string
  quote?: string
  quoteLocation?: string
  suggestion?: Source
}

/** A claim known to have a verdict — the shape of a draft's "needs work" issues. */
export type Issue = Claim & { verdict: VerdictKind }

export function hasVerdict(claim: Claim): claim is Issue {
  return claim.verdict === 'refutes' || claim.verdict === 'insufficient'
}

export type DraftWord = { text: string; mark?: VerdictKind }

export type Draft = {
  id: string
  fileName: string
  heading: string
  latexSource: string
  paragraphs: DraftWord[][]
  citationsFound: number
  issuesRemaining: number
  lastCheckedLabel: string // "checked 2h ago"
}

/** A draft plus the claims still needing attention, worst (or next) issue first. */
export type CheckRun = {
  draft: Draft
  issues: Issue[]
  currentIssueIndex: number
}

export type Paper = { id: string; fileName: string; summary: string }

export type WriterHome = {
  user: string
  alert: string // the one-line "what changed" under the greeting
  draftFileName: string
  draftLastCheckedLabel: string // "checked 2h ago"
  attention: Claim[]
  recentPapers: Paper[]
}

/** Result of searching the library (and open access) for a source that backs a sentence. */
export type SearchResponse = {
  libraryCount: number
  currentCitation: Citation
  currentCitationVerdict: 'refutes' | 'insufficient'
  results: Source[]
}

export const writerApi = {
  // TODO gateway: GET /writer/home
  getHome: async (): Promise<WriterHome> => store.home(),

  // TODO gateway: GET /writer/drafts/{id}/check
  getDraftCheck: async (draftId?: string): Promise<CheckRun> => store.checkRun(draftId),

  // TODO gateway: GET /writer/drafts/{id}
  getDraft: async (draftId: string): Promise<Draft> => store.draft(draftId),

  // TODO gateway: GET /writer/drafts/{id}/claims. Added for the read-only editor render
  // (docs/draft-editor-assessment.md Phase 0) — checkRun's issues only carry the
  // refutes/insufficient subset, but the claimId-guessing adapter needs supports claims too.
  getDraftClaims: async (draftId: string): Promise<Claim[]> => store.claims(draftId),

  // TODO gateway: GET /writer/drafts
  getDrafts: async (): Promise<Draft[]> => store.drafts(),

  // TODO gateway: POST /writer/draft-check/replace-citation {"claimId": ...}
  // Kept as the one-arg shim DraftCheck's "Replace citation" button already calls (it applies
  // the claim's own `suggestion`). useWriterActions.replaceCitation below takes an explicit
  // sourceId for the Find-a-source flow (#4/#5), and is the version future screens should use.
  replaceCitation: async (claimId: string): Promise<CheckRun> => store.replaceCitationWithSuggestion(claimId),

  // TODO gateway: GET /writer/search?q=...
  searchSources: async (_query: string): Promise<SearchResponse> => store.search(),
}
