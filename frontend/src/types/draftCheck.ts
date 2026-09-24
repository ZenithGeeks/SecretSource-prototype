/**
 * The data model shared by every Author screen: Draft check (Figma 558:3647), the LaTeX
 * editor (565:3957) and its Export menu (565:4207). Defined once here so the screens, the
 * store and the mocks agree on shapes and, through the store, on counts.
 *
 * `Verdict` is the ONE verdict union for the Author role. Its labels, badge kind and colour
 * classes live in src/lib/verdict.ts — screens never map a verdict to a word or a colour
 * themselves.
 */

/**
 * How a cited source stood up to the sentence that cites it.
 * - supports / refutes / insufficient: the gateway's three verdicts (README: "supports,
 *   refutes or insufficient"); insufficient is shown to authors as "partial" / "silent".
 * - unavailable: the check ran but the source could not be read (no open-access PDF).
 * - unchecked: never checked — no bib entry to resolve, or no check run yet.
 */
export type Verdict = 'supports' | 'refutes' | 'insufficient' | 'unavailable' | 'unchecked'

/** One file of a draft's LaTeX project. `dirty` = edited since the last save. */
export type ProjectFile = {
  name: string // "related-work.tex", "main.bib"
  kind: 'tex' | 'bib'
  content: string
  dirty: boolean
}

/** The work a \cite key resolves to, as far as the bibliography (and Crossref) know it. */
export type SourceRef = {
  key: string // the bib key
  title: string
  authors: string // "Khattab & Zaharia"
  year: number
  venue?: string
  doi?: string
  url?: string
  /** The PDF the check read, if one was found or uploaded: "colbert.pdf". */
  pdf?: string
}

/** The passage the verdict rests on, and where it is in the source PDF. */
export type Evidence = {
  passage: string
  pdf: string
  page: number
}

/** What the author did about an issue. A resolved issue stays in the list but is not open. */
export type Resolution = {
  kind: 'replaced' | 'overridden'
  /** For `replaced`: the key the citation had before. For `overridden`: the author's note. */
  previousKey?: string
  note?: string
  at: string // ISO time
}

/** One \cite in one sentence, and the check's verdict on it. */
export type Citation = {
  id: string
  draftId: string
  key: string // the \cite key as written
  file: string // ProjectFile.name
  line: number // 1-based line holding the \cite
  section?: string // "Related work", for the "By section" filter
  sentence: string // the raw LaTeX sentence, as shown in "Your sentence"
  claim: string // the sentence in plain words, as shown in the issue row
  verdict: Verdict
  confidence?: number // 0..1; absent when unavailable or unchecked
  sourceRef?: SourceRef
  evidence?: Evidence
  explanation?: string // the "Why:" line
  /** "Bib metadata matches Crossref — title, authors, year, DOI", or what did not match. */
  metadataMatch?: { ok: boolean; text: string }
  suggestedReplacement?: SearchResult
  resolution?: Resolution
}

export type ParseWarningType = 'missing-key' | 'duplicate-key' | 'unused-entry' | 'no-doi-url'

/** Something the LaTeX/BibTeX parse found worth fixing before a check. */
export type ParseWarning = {
  type: ParseWarningType
  detail: string // "\cite{liu2023} in intro.tex L18"
  file: string
  line: number
}

/** What the parser found in a draft's project. */
export type ParseResult = {
  texFiles: number
  citeCommands: number
  bibEntries: number
  warnings: ParseWarning[]
}

/** A draft's check at a glance: how many citations got each verdict, how many are open. */
export type DraftStatus = {
  checked: number // citations with a verdict other than unchecked
  counts: Record<Verdict, number>
  open: number // citations that need work and are not resolved
}

/** What changed between the last two checks, for the "Since v2" box. */
export type CheckDelta = {
  previousVersion: number
  addedCitations: number
  fixedIssues: number
  newIssues: number
}

export type Draft = {
  id: string
  title: string
  version: number
  lastCheckedAt: string | null // ISO; null = not checked yet
  status: DraftStatus
  files: ProjectFile[]
  sinceLastCheck?: CheckDelta
}

/** A paper found by "Find sources" (Semantic Scholar · Crossref · arXiv). */
export type SearchResult = {
  id: string
  key: string // the bib key it would get
  title: string
  authors: string // "Santhanam et al."
  venue: string // "NAACL"
  year: number
  citedBy: number
  openAccess: boolean
  similarity: number // 0..1
  bibtex: string // the entry to add when it is cited
  /** The passage that matched, when the search had one — shown as the suggested fix. */
  evidence?: Evidence
  /** Set when this result is the suggested fix for a specific issue. */
  suggestedForCitationId?: string
}
