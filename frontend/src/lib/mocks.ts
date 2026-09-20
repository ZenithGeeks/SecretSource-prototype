/**
 * Local mock data for the researcher screens, so the frontend runs with no backend.
 *
 * Off by default. Turn on with `VITE_USE_MOCKS=1 npm run dev` (or set it in .env). When on,
 * `request()` in api.ts routes matching paths here instead of calling `/api`. It covers the
 * researcher surface (home, projects, library, field consensus, graph) plus a stub analyses
 * list — enough to click through the UI. Anything not matched falls through to a real request.
 */

import type {
  FieldConsensus,
  KnowledgeGraph,
  Project,
  ResearcherHome,
  ResearcherLibrary,
} from './researcher'

export const mocksEnabled = import.meta.env.VITE_USE_MOCKS === '1'

const tally = (backed: number, silent: number, contradicted: number, unchecked: number) => ({
  backed,
  silent,
  contradicted,
  unchecked,
})

const projects: Project[] = [
  { id: 'p-retrieval', name: 'Retrieval survey', papers: 6, claims: 41, clusters: 3, tally: tally(28, 7, 3, 3), updated: new Date().toISOString() },
  { id: 'p-recsys', name: 'Recommender baselines', papers: 3, claims: 12, clusters: 2, tally: tally(6, 2, 2, 2), updated: new Date(Date.now() - 4 * 86_400_000).toISOString() },
  { id: 'unsorted', name: 'Unsorted', papers: 2, claims: 0, clusters: 0, tally: tally(0, 0, 0, 0), updated: '', unsorted: true },
]

const library: ResearcherLibrary = {
  summary: '6 papers · 2 clusters · indexed for search by meaning',
  clusters: ['All', 'Late interaction', 'Benchmarks'],
  papers: [
    { id: 'a1', title: 'ColBERTv2: Effective and Efficient Retrieval', cite: 'Santhanam et al. 2022', cluster: 'Late interaction', claims: 6, backed: 4, contradicted: 1, linked: ['ColBERT', 'PLAID'] },
    { id: 'a2', title: 'PLAID: An Efficient Engine for Late Interaction', cite: 'Santhanam et al. 2022', cluster: 'Late interaction', claims: 5, backed: 5, contradicted: 0, linked: ['ColBERTv2'] },
    { id: 'a3', title: 'BEIR: A Heterogeneous Benchmark', cite: 'Thakur et al. 2021', cluster: 'Benchmarks', claims: 7, backed: 3, contradicted: 2, linked: [] },
  ],
}

function consensus(question: string): FieldConsensus {
  return {
    question,
    supports: 5,
    refutes: 2,
    silent: 3,
    span: '2019–2023',
    note: 'Most recent work supports the claim, but two papers find the effect shrinks out of domain.',
    unlisted: 3,
    rows: [
      { paper: 'ColBERTv2', cite: 'Santhanam et al. 2022', verdict: 'supports', quote: 'retains accuracy on out-of-domain BEIR tasks.', claim: question || 'late interaction generalizes out of domain', analysis: 'a1', claimIndex: 0 },
      { paper: 'DPR', cite: 'Karpukhin et al. 2020', verdict: 'refutes', quote: 'no significant gain once the query domain shifts.', claim: question || 'late interaction generalizes out of domain', analysis: 'a4', claimIndex: 0 },
      { paper: 'BEIR', cite: 'Thakur et al. 2021', verdict: 'insufficient', quote: 'late interaction not evaluated on every track.', claim: question || 'late interaction generalizes out of domain', analysis: 'a3', claimIndex: 0 },
    ],
  }
}

const home: ResearcherHome = {
  alert: 'You have 24 papers. 3 claims are contradicted by their sources — worth a look today.',
  conflicts: [
    { claim: 'Late interaction beats single-vector retrieval out of domain', for: ['ColBERTv2', 'PLAID'], against: ['DPR (BEIR §5)'], analysis: 'a1', claimIndex: 0 },
    { claim: 'Residual compression loses no quality', for: ['ColBERTv2'], against: ['Thakur 2021'], analysis: 'a1', claimIndex: 1 },
  ],
  queue: [
    { paper: 'PLAID (2022)', note: 'cited by 3 papers you read, not in library', identifier: 'arXiv:2205.09707' },
    { paper: 'SPLADE v2 (2021)', note: 'closest to your saved claim on sparse retrieval', identifier: 'arXiv:2109.10086' },
  ],
  library: { papers: 24, claims: 142, verified: 125, tally: tally(85, 17, 12, 28) },
}

const graph: KnowledgeGraph = {
  stats: [
    { count: 24, label: 'claims' },
    { count: 4, label: 'contradicted' },
    { count: 10, label: 'single source' },
    { count: 2, label: 'papers' },
  ],
  clusters: ['Analysed', 'Cited'],
  nodes: [
    { id: 'a:p1', kind: 'paper', label: 'ColBERT', year: "'20", cluster: 'Analysed', indexed: 'yes', index: 'Semantic Scholar' },
    { id: 'a:p2', kind: 'paper', label: 'ColBERTv2', year: "'22", cluster: 'Analysed', indexed: 'yes', index: 'Semantic Scholar' },
    { id: 'w:beir', kind: 'paper', label: 'BEIR', year: "'21", cluster: 'Cited', indexed: 'no', index: '' },
    { id: 'c1', kind: 'claim', label: 'Late interaction beats single-vector retrieval on MS MARCO' },
    { id: 'c2', kind: 'claim', label: 'Residual compression cuts index size 6–10×' },
    { id: 'c3', kind: 'claim', label: 'Late interaction generalizes better out of domain' },
  ],
  edges: [
    { id: 'a1', source: 'a:p1', target: 'c1', relation: 'asserts', note: '' },
    { id: 'x1', source: 'a:p2', target: 'c1', relation: 'backs', quote: 'confirmed on MS MARCO', page: 'p.4' },
    { id: 'a2', source: 'a:p2', target: 'c2', relation: 'asserts', note: '' },
    { id: 'x2', source: 'w:beir', target: 'c2', relation: 'contradicts', quote: 'small drop at extreme compression', page: 'p.7' },
    { id: 'a3', source: 'a:p1', target: 'c3', relation: 'asserts', note: '' },
    { id: 'x3', source: 'w:beir', target: 'c3', relation: 'silent', note: 'not addressed' },
  ],
  paperEdges: [
    { id: 'a:p1->a:p2', a: 'a:p1', b: 'a:p2', similarity: 0.6, sharedPassages: 1, citations: 3, cites: true, contradicted: 1, passages: [] },
  ],
}

/** Resolve a request path (as passed to api.ts `request`) to mock data. Returns `{hit:false}`
 * when unmatched so the caller falls through to a real request. */
export async function mockFor(path: string, init?: RequestInit): Promise<{ hit: boolean; data?: unknown }> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const body = (() => {
    try {
      return init?.body ? JSON.parse(init.body as string) : {}
    } catch {
      return {}
    }
  })()
  const p = path.split('?')[0]

  if (p === '/researcher/home') return { hit: true, data: home }
  if (p === '/researcher/graph') return { hit: true, data: graph }
  if (p === '/researcher/projects' && method === 'GET') return { hit: true, data: projects }
  if (p === '/researcher/projects' && method === 'POST')
    return { hit: true, data: { id: `p-${Date.now()}`, name: body.name ?? 'New project', papers: 0, claims: 0, clusters: 0, tally: tally(0, 0, 0, 0), updated: new Date().toISOString() } }
  if (/^\/researcher\/projects\/[^/]+\/library$/.test(p)) return { hit: true, data: library }
  if (/^\/researcher\/projects\/[^/]+\/papers$/.test(p)) return { hit: true, data: projects[0] }
  if (/^\/researcher\/projects\/[^/]+$/.test(p) && method === 'DELETE') return { hit: true, data: { deleted: p.split('/').pop() } }
  if (p === '/researcher/consensus') return { hit: true, data: consensus(body.question ?? '') }
  if (p === '/analyses' && method === 'GET') return { hit: true, data: [] }
  if (p === '/analyses' && method === 'POST') return { hit: true, data: { id: `a-${Date.now()}` } }

  return { hit: false }
}
