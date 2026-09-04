/**
 * Mock payloads for the researcher screens, shaped exactly like the gateway responses will
 * be (types in src/lib/researcher.ts). Content mirrors the Figma prototype so screens match
 * the design until the endpoints exist. Nothing outside src/lib/researcher.ts imports this.
 */

import type { FieldConsensus, ResearcherHome, ResearcherLibrary } from '../lib/researcher'

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
