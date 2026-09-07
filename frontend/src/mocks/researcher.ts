/**
 * Mock payloads for the researcher screens, shaped exactly like the gateway responses will
 * be (types in src/lib/researcher.ts). Content mirrors the Figma prototype so screens match
 * the design until the endpoints exist. Nothing outside src/lib/researcher.ts imports this.
 */

import type {
  FieldConsensus,
  KnowledgeGraph,
  ResearcherHome,
  ResearcherLibrary,
} from '../lib/researcher'

export const MOCK_HOME: ResearcherHome = {
  user: 'Wittawat',
  alert: '3 new papers in your library disagree with something you saved.',
  conflicts: [
    {
      claim: 'Late interaction beats single-vector retrieval out of domain',
      for: ['ColBERTv2', 'PLAID'],
      against: ['DPR (BEIR §5)'],
    },
    {
      claim: 'Residual compression loses no quality',
      for: ['ColBERTv2'],
      against: ['Thakur 2021 (BEIR)'],
    },
    {
      claim: 'Cross-encoder distillation is required for SOTA',
      for: ['ColBERTv2', 'PLAID'],
      against: [],
    },
  ],
  queue: [
    { paper: 'PLAID (2022)', note: 'cited by 3 papers you read, not in library' },
    { paper: 'SPLADE v2 (2021)', note: 'closest to your saved claim on sparse retrieval' },
    { paper: 'BEIR (2021)', note: 'refutes 1 claim you saved' },
    { paper: 'DPR (2020)', note: 'most cited in your library' },
  ],
  library: {
    papers: 9,
    claims: 52,
    verified: 38,
    tally: { backed: 28, silent: 7, contradicted: 3, unchecked: 14 },
  },
}

export const MOCK_CONSENSUS: FieldConsensus = {
  question: 'late interaction outperforms single-vector retrieval out of domain',
  supports: 5,
  refutes: 2,
  silent: 2,
  span: '2019–2023',
  note:
    'Consensus shifted in 2021: papers before BEIR assert it; BEIR and DPR-style follow-ups ' +
    'qualify it to specific domains. Newest evidence (PLAID 2022) supports with caveats.',
  rows: [
    {
      paper: 'PLAID',
      cite: 'Santhanam et al., 2022',
      verdict: 'supports',
      quote: '…ColBERTv2 retains its out-of-domain advantage on BEIR while PLAID cuts latency by 7×.',
    },
    {
      paper: 'ColBERTv2',
      cite: 'Santhanam et al., 2022',
      verdict: 'supports',
      quote: '…outperforms single-vector baselines on 13 of 13 BEIR datasets.',
    },
    {
      paper: 'BEIR',
      cite: 'Thakur et al., 2021',
      verdict: 'insufficient',
      quote: '…late interaction is competitive but no single model dominates across domains.',
    },
    {
      paper: 'DPR',
      cite: 'Karpukhin et al., 2020',
      verdict: 'refutes',
      quote: '…dense single-vector retrieval outperforms sparse and multi-vector baselines on open-domain QA.',
    },
    {
      paper: 'ColBERT',
      cite: 'Khattab & Zaharia, 2020',
      verdict: 'supports',
      quote: '…late interaction generalizes better than single-vector encoders in our zero-shot setting.',
    },
  ],
  unlisted: 4,
}

export const MOCK_LIBRARY: ResearcherLibrary = {
  summary: '9 papers · 3 clusters · indexed for search by meaning',
  clusters: ['All', 'Late interaction', 'Dense retrieval', 'Benchmarks', 'Unverified'],
  papers: [
    {
      title: 'ColBERTv2: Effective and Efficient Retrieval…',
      cite: 'Santhanam et al. 2022',
      cluster: 'Late interaction',
      claims: 6,
      backed: 4,
      contradicted: 1,
      linked: ['ColBERT', 'PLAID', 'MS MARCO'],
    },
    {
      title: 'PLAID: An Efficient Engine for Late Interaction',
      cite: 'Santhanam et al. 2022',
      cluster: 'Late interaction',
      claims: 5,
      backed: 5,
      contradicted: 0,
      linked: ['ColBERTv2'],
    },
    {
      title: 'ColBERT: Efficient and Effective Passage Search…',
      cite: 'Khattab & Zaharia 2020',
      cluster: 'Late interaction',
      claims: 8,
      backed: 6,
      contradicted: 0,
      linked: ['BERT', 'DPR', 'ColBERTv2'],
    },
    {
      title: 'BEIR: A Heterogeneous Benchmark…',
      cite: 'Thakur et al. 2021',
      cluster: 'Benchmarks',
      claims: 7,
      backed: 3,
      contradicted: 2,
      linked: ['MS MARCO', 'DPR'],
    },
    {
      title: 'Dense Passage Retrieval for Open-Domain QA',
      cite: 'Karpukhin et al. 2020',
      cluster: 'Dense retrieval',
      claims: 9,
      backed: 7,
      contradicted: 0,
      linked: ['BERT', 'BEIR'],
    },
    {
      title: 'MS MARCO: A Human Generated MAchine Reading…',
      cite: 'Nguyen et al. 2016',
      cluster: 'Benchmarks',
      claims: 4,
      backed: 4,
      contradicted: 0,
      linked: ['BEIR'],
    },
    {
      title: 'BERT: Pre-training of Deep Bidirectional…',
      cite: 'Devlin et al. 2019',
      cluster: 'Dense retrieval',
      claims: 7,
      backed: 6,
      contradicted: 0,
      linked: ['ColBERT', 'DPR'],
    },
    {
      title: 'Docling Technical Report',
      cite: 'IBM 2024',
      cluster: 'PDF tooling',
      claims: 3,
      backed: null,
      contradicted: null,
      linked: ['GROBID'],
    },
    {
      title: 'GROBID',
      cite: 'Lopez 2009',
      cluster: 'PDF tooling',
      claims: 3,
      backed: null,
      contradicted: null,
      linked: ['Docling'],
    },
  ],
}

export const MOCK_GRAPH: KnowledgeGraph = {
  stats: [
    { count: 3, label: 'claims rest on a single source' },
    { count: 1, label: 'circular citation (A cites B cites A)' },
    { count: 2, label: 'claims with no primary evidence' },
    { count: 4, label: 'claims every paper agrees on' },
  ],
  clusters: ['Late interaction', 'Dense retrieval', 'Benchmarks', 'PDF tooling'],
  nodes: [
    { id: 'colbert20', kind: 'paper', label: 'ColBERT', year: "'20", cluster: 'Late interaction' },
    { id: 'colbertv222', kind: 'paper', label: 'ColBERTv2', year: "'22", cluster: 'Late interaction' },
    { id: 'plaid22', kind: 'paper', label: 'PLAID', year: "'22", cluster: 'Late interaction' },
    { id: 'beir21', kind: 'paper', label: 'BEIR', year: "'21", cluster: 'Benchmarks' },
    { id: 'dpr20', kind: 'paper', label: 'DPR', year: "'20", cluster: 'Dense retrieval' },
    { id: 'msmarco16', kind: 'paper', label: 'MS MARCO', year: "'16", cluster: 'Benchmarks' },
    { id: 'bert19', kind: 'paper', label: 'BERT', year: "'19", cluster: 'Dense retrieval' },
    { id: 'docling24', kind: 'paper', label: 'Docling', year: "'24", cluster: 'PDF tooling' },
    { id: 'grobid09', kind: 'paper', label: 'GROBID', year: "'09", cluster: 'PDF tooling' },
    { id: 'c_residual', kind: 'claim', label: 'Residual compression cuts index size 6–10×' },
    { id: 'c_lateinteraction', kind: 'claim', label: 'Late interaction generalizes better out of domain' },
    { id: 'c_msmarco', kind: 'claim', label: 'MS MARCO has 8.8M passages' },
    { id: 'c_distill', kind: 'claim', label: 'Cross-encoder distillation is required for SOTA' },
  ],
  edges: [
    // Residual compression cuts index size 6–10× — one source holds it up.
    {
      id: 'e1', source: 'colbertv222', target: 'c_residual', relation: 'asserts',
      note: 'origin — asserts',
      quote: '…reduces the space footprint by 6–10× [b13] with no loss in quality.', page: 'p.4',
    },
    {
      id: 'e2', source: 'colbert20', target: 'c_residual', relation: 'contradicts',
      note: 'cited as [b13] — contradicts',
      quote: '…154 GiB; we leave compression to future work.', page: 'p.7',
    },
    {
      id: 'e3', source: 'plaid22', target: 'c_residual', relation: 'backs',
      note: 'repeats — backs',
      quote: "…building on ColBERTv2's compressed representations…", page: 'p.2',
    },
    // Late interaction generalizes better out of domain.
    {
      id: 'e4', source: 'colbert20', target: 'c_lateinteraction', relation: 'asserts',
      note: 'origin — asserts',
      quote: '…late interaction generalizes better than single-vector encoders zero-shot.', page: 'p.6',
    },
    {
      id: 'e5', source: 'colbertv222', target: 'c_lateinteraction', relation: 'backs',
      note: 'backs', quote: '…outperforms single-vector baselines on 13 of 13 BEIR datasets.', page: 'p.5',
    },
    {
      id: 'e6', source: 'beir21', target: 'c_lateinteraction', relation: 'silent',
      note: 'measured, no verdict — silent',
      quote: '…no single model dominates across all domains.', page: '§5',
    },
    {
      id: 'e7', source: 'dpr20', target: 'c_lateinteraction', relation: 'contradicts',
      note: 'contradicts', quote: '…dense single-vector retrieval outperforms multi-vector baselines.', page: 'p.8',
    },
    // MS MARCO has 8.8M passages.
    {
      id: 'e8', source: 'msmarco16', target: 'c_msmarco', relation: 'asserts',
      note: 'origin — asserts', quote: '…a collection of 8.8 million passages.', page: 'p.3',
    },
    // Cross-encoder distillation is required for SOTA.
    {
      id: 'e9', source: 'colbertv222', target: 'c_distill', relation: 'asserts',
      note: 'origin — asserts', quote: '…distillation from a cross-encoder teacher is key to quality.', page: 'p.5',
    },
    {
      id: 'e10', source: 'plaid22', target: 'c_distill', relation: 'backs',
      note: 'backs', quote: '…inherits ColBERTv2 training, distillation included.', page: 'p.2',
    },
  ],
  paperEdges: [
    {
      id: 'p1', a: 'colbert20', b: 'colbertv222',
      similarity: 0.92, sharedPassages: 14, citations: 3, cites: true, contradicted: 1,
      passages: [
        { paper: 'ColBERTv2', page: 'p.3', quote: '…late interaction over token-level embeddings, as in ColBERT…' },
        { paper: 'ColBERT', page: 'p.2', quote: '…late interaction: a fine-grained MaxSim between query and document token embeddings.' },
        { paper: 'ColBERTv2', page: 'p.4', quote: '…residual compression reduces the space footprint by 6–10×…' },
        { paper: 'ColBERT', page: 'p.7', quote: '…the index for MS MARCO occupies 154 GiB…' },
      ],
    },
    { id: 'p2', a: 'colbertv222', b: 'plaid22', similarity: 0.85, sharedPassages: 9, citations: 2, cites: true, passages: [] },
    { id: 'p3', a: 'colbertv222', b: 'dpr20', similarity: 0.61, sharedPassages: 5, citations: 1, cites: false, passages: [] },
    { id: 'p4', a: 'colbert20', b: 'bert19', similarity: 0.52, sharedPassages: 4, citations: 1, cites: true, passages: [] },
    { id: 'p5', a: 'colbertv222', b: 'msmarco16', similarity: 0.44, sharedPassages: 3, citations: 1, cites: true, passages: [] },
    { id: 'p6', a: 'dpr20', b: 'beir21', similarity: 0.55, sharedPassages: 4, citations: 1, cites: false, passages: [] },
    { id: 'p7', a: 'beir21', b: 'msmarco16', similarity: 0.5, sharedPassages: 4, citations: 1, cites: false, passages: [] },
    { id: 'p8', a: 'dpr20', b: 'msmarco16', similarity: 0.46, sharedPassages: 3, citations: 1, cites: false, passages: [] },
    { id: 'p9', a: 'plaid22', b: 'dpr20', similarity: 0.4, sharedPassages: 2, citations: 0, cites: false, passages: [] },
    { id: 'p10', a: 'bert19', b: 'dpr20', similarity: 0.58, sharedPassages: 4, citations: 1, cites: true, passages: [] },
    { id: 'p11', a: 'docling24', b: 'grobid09', similarity: 0.7, sharedPassages: 6, citations: 1, cites: true, passages: [] },
  ],
}
