/**
 * Typed client for the researcher screens. Every call goes to the gateway's /researcher routes,
 * which build the answer from the signed-in user's own analyses (backend/app/researcher.py).
 */

import { request } from './api'

export type ClaimStanding = 'backed' | 'silent' | 'contradicted' | 'unchecked'

/** Per-standing claim counts; drives the stacked bar and its legend. */
export type ClaimTally = Record<ClaimStanding, number>

export type Conflict = {
  claim: string
  for: string[] // papers backing the claim
  against: string[] // papers contradicting it
  analysis: string // the analysis the claim is in
  claimIndex: number
}

export type QueueEntry = {
  paper: string
  note: string // why it is suggested, in a reader's words
  identifier: string // DOI, arXiv ID or title
  analysis: string // the analysis that cites it, to open on click
}

export type LibrarySummary = {
  papers: number
  claims: number
  verified: number
  tally: ClaimTally
}

export type ResearcherHome = {
  alert: string // the one-line "what changed" under the greeting
  conflicts: Conflict[]
  queue: QueueEntry[]
  library: LibrarySummary
}

export type ConsensusVerdict = 'supports' | 'refutes' | 'insufficient'

export type ConsensusRow = {
  paper: string
  cite: string
  verdict: ConsensusVerdict
  quote: string // the deciding passage
  claim: string // the claim in the user's paper this verdict answers
  analysis: string
  claimIndex: number
}

export type FieldConsensus = {
  question: string
  supports: number
  refutes: number
  silent: number
  span: string // publication years covered, e.g. "2019–2023"
  note: string // the one-paragraph consensus summary
  rows: ConsensusRow[]
  unlisted: number // papers that are silent or unchecked, folded behind "show"
}

export type LibraryPaper = {
  id: string // the analysis
  title: string
  cite: string
  cluster: string
  claims: number
  backed: number | null // null when the paper has not been verified yet
  contradicted: number | null
  linked: string[] // other library papers it cites or is cited by
  sourcesIndexed: number // distinct cited works a public index knew (#21)
  sourcesNotIndexed: number // distinct cited works no public index knew
  indexed: 'yes' | 'no' | '' // whether the paper itself (not what it cites) is known to a public index
  index: string // the index that answered, e.g. "Semantic Scholar"; '' when not known or not found
}

export type ResearcherLibrary = {
  summary: string // e.g. "9 papers · 3 clusters · indexed for search by meaning"
  clusters: string[] // filter chips, in display order
  papers: LibraryPaper[]
}

/**
 * A project groups a researcher's papers so each stays its own library and graph. The
 * Library opens on the project list; opening a project shows that project's papers.
 * New uploads land in the `unsorted` project until they're filed.
 */
export type Project = {
  id: string
  name: string
  papers: number
  claims: number
  clusters: number
  tally: ClaimTally // drives the card's mini bar
  updated: string // ISO time of the last change; empty for Unsorted
  unsorted?: boolean // the catch-all for new uploads
}

/**
 * The knowledge graph ("What rests on what" / "How your library relates"), built from every
 * paper the user analysed. Papers and claims are the two node kinds; edges are typed relations
 * (claims view) or paper-to-paper links (papers view).
 */
export type GraphRelation = 'asserts' | 'backs' | 'contradicts' | 'silent' | 'unchecked'

/**
 * Whether a public index (Semantic Scholar, arXiv, Unpaywall) knew a cited work: 'yes', 'no',
 * or '' when the run does not say, as for the analysed papers themselves. Not a Scopus check.
 */
export type Indexed = 'yes' | 'no' | ''

export type GraphNode =
  | {
      id: string
      kind: 'paper'
      label: string
      year: string
      cluster: string
      indexed: Indexed
      index: string // the index that answered, e.g. "Semantic Scholar"; '' when not known
    }
  | { id: string; kind: 'claim'; label: string }

export type GraphEdge = {
  id: string
  source: string // paper node id
  target: string // claim node id
  relation: GraphRelation
  reason?: string // why the check could not run, for 'unchecked'
  note?: string
  quote?: string
  page?: string
}

export type PaperEdge = {
  id: string
  a: string
  b: string
  similarity: number // 0..1: share of a paper's claims that cite the other, or of cited works both share
  sharedPassages: number // quotes shown for the pair
  citations: number // claims that cite the other paper, or works both cite
  cites: boolean // one cites the other → drawn dashed
  contradicted?: number
  passages: { paper: string; page: string; quote: string }[]
}

// The graph's headline numbers are derived on the client in Graph.tsx (computeInsights), so the
// backend's `stats` field is no longer read here and is intentionally left off this type.
export type KnowledgeGraph = {
  clusters: string[]
  nodes: GraphNode[]
  edges: GraphEdge[] // paper → claim (claims view)
  paperEdges: PaperEdge[] // paper ↔ paper (papers view)
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const researcherApi = {
  getGraph: () => request<KnowledgeGraph>('/researcher/graph'),

  getHome: () => request<ResearcherHome>('/researcher/home'),

  askConsensus: (question: string) => request<FieldConsensus>('/researcher/consensus', json({ question })),

  getProjects: () => request<Project[]>('/researcher/projects'),

  getLibrary: (projectId: string) =>
    request<ResearcherLibrary>(`/researcher/projects/${encodeURIComponent(projectId)}/library`),

  createProject: (name: string, description: string) =>
    request<Project>('/researcher/projects', json({ name, description })),

  addToProject: (projectId: string, analysisId: string) =>
    request<Project>(`/researcher/projects/${encodeURIComponent(projectId)}/papers`, json({ analysis_id: analysisId })),
}

/** "Updated today", "Updated 3 days ago", from a project's ISO time. */
export function updatedText(project: Project) {
  if (project.unsorted) return 'New analyses land here'
  if (!project.updated) return ''
  const days = Math.floor((Date.now() - new Date(project.updated).getTime()) / 86_400_000)
  if (days <= 0) return 'Updated today'
  if (days === 1) return 'Updated yesterday'
  return `Updated ${days} days ago`
}
