/**
 * The data model shared by every Author screen: Home (Redesign A1 716:4922), the LaTeX
 * editor (565:3957) and its Export menu (565:4207), the Library (597:3631) and a project's
 * detail (597:4404). These are the shapes the gateway's
 * /author routes answer with (backend/app/author/router.py), defined once here so the
 * service, the hooks and the screens agree.
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

/** One file of a draft's LaTeX project. `shared` marks the project's .bib, which every draft
 * of the project reads; `dirty` is the editor's own flag for unsaved typing. */
export type ProjectFile = {
  name: string // "related-work.tex", "main.bib", "chapters/intro.tex"
  kind: 'tex' | 'bib'
  content: string
  shared?: boolean
  dirty?: boolean
}

/** The work a \cite key resolves to, as far as the bibliography knows it. */
export type SourceRef = {
  key: string // the bib key
  title: string
  authors: string // "Khattab & Zaharia"
  year: number | null
  venue?: string
  doi?: string
  url?: string
  /** The PDF the check read, if one was found or uploaded: "colbert-1a2b3c.pdf". */
  pdf?: string
}

/** The passage the verdict rests on, and where it is in the source PDF. */
export type Evidence = {
  passage: string
  pdf: string
  page: number | null
}

/** Something the gateway's audit (backend/app/pipeline/audit.py) found wrong with a verdict,
 * such as a quote that is not in the passages the check read. The verdict is kept as given. */
export type AuditFinding = {
  check: 'quote-not-in-evidence' | 'decided-without-quote' | 'unknown-verdict' | (string & {})
  detail: string
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
  key: string // the \cite key as written
  file: string // ProjectFile.name
  line: number // 1-based line holding the \cite
  column: number
  section?: string // "Related work", for the "By section" filter
  sentence: string // the raw LaTeX sentence, as shown in "Your sentence"
  claim: string // the sentence in plain words, what the pipeline judged
  verdict: Verdict
  sourceRef?: SourceRef
  evidence?: Evidence
  explanation?: string // the "Why:" line
  /** Set when the check read the source's arXiv copy, not the publisher's PDF (#424). */
  sourceVersion?: 'preprint'
  arxiv?: string // that copy's arXiv id, e.g. "2507.11408"
  /** Why the source could not be read (unavailable) or the key could not resolve (unchecked). */
  reason?: string
  message?: string
  resolution?: Resolution
  audit?: AuditFinding[]
  /** From looking the bib entry's DOI up in Crossref and OpenAlex (#421), or, for an entry
   * with no DOI and no link, its title and first author in those and arXiv and Semantic
   * Scholar (#439). "no": no index knows it, so the reference may be made up. "unknown": an
   * index could not be reached. Missing when the entry was not looked up. */
  exists?: 'yes' | 'no' | 'unknown'
  index?: string // the index that knew the work, for example "Crossref"
  mismatches?: string[] // where the .bib entry disagrees with that index's record (DOI only)
  lookedUpBy?: 'title' // missing for a DOI lookup
}

export type ParseWarningType = 'missing-key' | 'duplicate-key' | 'unused-entry' | 'no-doi-url'

/** Something the LaTeX/BibTeX parse found worth fixing before a check. */
export type ParseWarning = {
  type: ParseWarningType
  detail: string // "\cite{liu2023} in intro.tex L18"
  file: string
  line: number
  /** On a project's lint: the draft it is in, or null for the project's own .bib. */
  draftId?: string | null
}

/** What the parser found in a draft's project. */
export type ParseResult = {
  texFiles: number
  citeCommands: number
  bibEntries: number
  warnings: ParseWarning[]
}

/** GET /author/projects/{id}/lint: the same, across all the project's drafts (#714). */
export type ProjectLint = ParseResult & {
  bibName: string | null
  drafts: number
}

/** A draft's check at a glance: how many citations got each verdict, how many are open. */
export type DraftStatus = {
  checked: number // citations with a verdict other than unchecked
  counts: Record<Verdict, number>
  open: number // citations that need work and are not resolved
}

/** What changed between the last two checks, for the "Since v2" box. */
export type CheckDelta = {
  addedCitations: number
  fixedIssues: number
  newIssues: number
}

export type Draft = {
  id: string
  projectId: string | null
  title: string
  version: number
  files: ProjectFile[]
  /** Uploaded source PDFs by bib key. */
  pdfs: Record<string, string>
  status: DraftStatus
  lastCheckedAt: string | null // ISO; null = not checked yet
  lastCheckId: string | null
  runningCheckId: string | null
  sinceLastCheck: CheckDelta | null
  checks: number
  created: string
  updated: string
  /** The last change to its text (`updated` also moves on Save, a check, a PDF). Missing on
   * drafts made before it existed. */
  edited?: string
  savedAt: string
}

/** A stage of a running check, streamed over SSE like an analysis's stages. */
export type CheckStage = {
  stage: 'queued' | 'planned' | 'checking' | 'checked' | 'done' | 'error'
  at?: number
  checks?: number
  sources?: number
  claim?: number
  key?: string
  source?: string // what the citation is being checked against
  verdict?: Verdict
  reason?: string
  message?: string
}

/** One run of "Re-check" on a draft: its citations and how it compares with the run before. */
export type CheckRun = {
  id: string
  draftId: string
  version: number
  status: 'running' | 'done' | 'error'
  message?: string
  startedAt: string
  finishedAt: string | null
  summary: DraftStatus
  sinceLastCheck: CheckDelta | null
  previousVersion: number | null
  previousId: string | null
  /** The same text and bibliography as the check before: a re-check without edits. */
  unchanged: boolean
  stages: CheckStage[]
  citations?: Citation[]
}

/** One row of "Compare vN with vN-1". */
export type CompareRow = {
  key: string
  claim: string
  file: string
  line: number
  before: Verdict | null
  after: Verdict | null
  change: 'added' | 'removed' | 'fixed' | 'new' | 'changed' | 'same'
}

export type Comparison = {
  current: { id: string; version: number }
  previous: { id: string; version: number }
  rows: CompareRow[]
}

/** A source kept in a project (or in Unsorted sources) that need not be in a .bib. */
export type SavedSource = {
  id: string
  projectId: string | null
  key: string
  title: string
  authors: string
  authorsList: string[]
  year: number | null
  venue: string
  doi: string
  arxiv: string
  url: string
  identifier: string
  openAccess: boolean
  citedBy: number | null
  bibtex: string
  claim?: string | null
  verdict?: Verdict | null
  evidence?: Evidence | null
  pdf?: string
  inBib: boolean
  bibName: string | null
  savedAt: string
}

/** A project card on the Library (597:3631): a .bib plus the drafts written against it. */
export type Project = {
  id: string
  name: string
  bibName: string | null
  entries: number
  cited: number
  needWork: number
  tally: Record<Verdict, number>
  drafts: number
  checkedAt: string | null
  pdfs: Record<string, string>
  created: string
  updated: string
}

/** The project detail (597:4404): the card plus its .bib, drafts and their check histories. */
export type ProjectDetail = Project & {
  bib: { name: string; content: string } | null
  draftList: Draft[]
  history: Record<string, CheckRun[]>
}

/** A "Needs attention" row on the Library. */
export type AttentionRow = {
  kind: 'replace' | 'upload-pdf' | 'remove'
  key: string
  title: string
  detail: string
  draftId?: string
  projectId?: string | null
  checkId?: string
  citationId?: string
}

export type LibraryView = {
  projects: Project[]
  unsorted: { sources: number; pdfs: number; drafts: number }
  attention: AttentionRow[]
  saved: SavedSource[]
}
