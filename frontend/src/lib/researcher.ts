/**
 * Typed client for the researcher-role data. The gateway has no researcher endpoints yet,
 * so every call resolves mock payloads from src/mocks/researcher.ts. When an endpoint
 * lands, replace that call's body with a request() to it (see the TODO on each) — the
 * types, hooks and screens stay as they are.
 */

import { MOCK_CONSENSUS, MOCK_GRAPH, MOCK_HOME, MOCK_LIBRARIES, MOCK_PROJECTS } from '../mocks/researcher'

export type ClaimStanding = 'backed' | 'silent' | 'contradicted' | 'unchecked'

/** Per-standing claim counts; drives the stacked bar and its legend. */
export type ClaimTally = Record<ClaimStanding, number>

export type Conflict = {
  claim: string
  for: string[] // papers backing the claim
  against: string[] // papers contradicting it
}

export type QueueEntry = {
  paper: string
  note: string // why it is suggested, in a reader's words
}

export type LibrarySummary = {
  papers: number
  claims: number
  verified: number
  tally: ClaimTally
}

export type ResearcherHome = {
  user: string
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
  title: string
  cite: string
  cluster: string
  claims: number
  backed: number | null // null when the paper has not been verified yet
  contradicted: number | null
  linked: string[] // other library papers it cites or is cited by
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
  updated: string // human line, e.g. "Updated today" (or "New uploads land here")
  unsorted?: boolean // the catch-all for new uploads
}

/**
 * The knowledge graph ("What rests on what" / "How your library relates"). GLOBAL — like the
 * History tab it spans every analysis in the store (all projects and roles), not one project.
 * Papers and claims are the two node kinds; edges are typed relations (claims view) or
 * paper-to-paper similarity/citation links (papers view).
 */
export type GraphRelation = 'asserts' | 'backs' | 'contradicts' | 'silent'

export type GraphNode =
  | { id: string; kind: 'paper'; label: string; year: string; cluster: string }
  | { id: string; kind: 'claim'; label: string }

export type GraphEdge = {
  id: string
  source: string // paper node id
  target: string // claim node id
  relation: GraphRelation
  note?: string
  quote?: string
  page?: string
}

export type PaperEdge = {
  id: string
  a: string
  b: string
  similarity: number // 0..1, ColBERT passage similarity
  sharedPassages: number
  citations: number
  cites: boolean // one cites the other → drawn dashed
  contradicted?: number
  passages: { paper: string; page: string; quote: string }[]
}

export type GraphStat = { count: number; label: string }

export type KnowledgeGraph = {
  stats: GraphStat[]
  clusters: string[]
  nodes: GraphNode[]
  edges: GraphEdge[] // paper → claim (claims view)
  paperEdges: PaperEdge[] // paper ↔ paper (papers view)
}

export const researcherApi = {
  // TODO gateway: GET /graph — GLOBAL, built from every analysis in the store (all projects
  // and roles), the same set History lists. Not scoped to one project.
  getGraph: async (): Promise<KnowledgeGraph> => MOCK_GRAPH,

  // TODO gateway: GET /researcher/home
  getHome: async (): Promise<ResearcherHome> => MOCK_HOME,

  // TODO gateway: POST /researcher/consensus {"question": ...}
  askConsensus: async (question: string): Promise<FieldConsensus> => ({
    ...MOCK_CONSENSUS,
    question: question || MOCK_CONSENSUS.question,
  }),

  // TODO gateway: GET /researcher/projects
  getProjects: async (): Promise<Project[]> => MOCK_PROJECTS,

  // TODO gateway: GET /researcher/projects/{id}/library
  getLibrary: async (projectId: string): Promise<ResearcherLibrary> =>
    MOCK_LIBRARIES[projectId] ?? MOCK_LIBRARIES['retrieval-survey'],
}
