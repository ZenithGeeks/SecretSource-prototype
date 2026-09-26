/**
 * Mock payloads for the writer screens, shaped exactly like the gateway responses will be
 * (types in src/lib/writer.ts). Content mirrors the Figma prototype so screens match the
 * design until the endpoints exist. Nothing outside src/lib/writer.ts and writerStore.ts
 * imports this.
 */

import type { Claim, Draft, DraftWord, Paper, SearchResponse, VerdictKind, WriterHome } from '../lib/writer'

function w(text: string): DraftWord {
  return { text }
}

function m(text: string, mark: VerdictKind): DraftWord {
  return { text, mark }
}

export const MOCK_CLAIMS: Claim[] = [
  {
    id: 'c1',
    draftId: 'd1',
    text: 'ColBERTv2 reduces index size by 6–10× relative to ColBERT while matching retrieval quality.',
    citation: { id: 'cit1', label: 'Khattab & Zaharia, 2020' },
    verdict: 'refutes',
    explanation:
      'Your sentence says ColBERT (2020) cuts index size 6–10×. That result is from ColBERTv2 (Santhanam et al., 2022); the 2020 paper reports the uncompressed 154 GiB index and defers compression.',
    quote: '"…we leave compression of the embeddings to future work."',
    quoteLocation: 'colbert.pdf p.7',
    suggestion: {
      id: 's1',
      citation: 'Santhanam et al. (2022)',
      title: 'ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction',
      verdict: 'supports',
      similarity: 0.91,
      location: 'p.4',
      quote: '"…residual compression reduces the space footprint of ColBERT by 6–10× with no loss in quality."',
      inLibrary: true,
      openAccess: false,
      isCurrentCitation: false,
      isBestMatch: true,
    },
  },
  {
    id: 'c2',
    draftId: 'd1',
    text: 'Late interaction outperforms single-vector retrieval on BEIR out-of-domain benchmarks.',
    citation: { id: 'cit2', label: 'Thakur et al., 2021' },
    verdict: 'insufficient',
    explanation: 'BEIR (Thakur et al., 2021) is silent on "outperform single-vector retrievers". Weaken the claim or find a source.',
  },
  {
    id: 'c3',
    draftId: 'd1',
    text: 'MS MARCO contains 8.8M passages drawn from web documents.',
    citation: { id: 'cit3', label: 'Nguyen et al., 2016' },
    verdict: 'supports',
  },
  {
    id: 'c4',
    draftId: 'd1',
    // edge case: a claim with no citation at all
    text: 'Retrieval-augmented models are becoming the default architecture for open-domain QA.',
  },
  {
    id: 'c5',
    draftId: 'd2',
    text: 'Open-domain QA systems retrieve supporting passages before generating an answer.',
    citation: { id: 'cit4', label: 'Lewis et al., 2020' },
    verdict: 'supports',
  },
]

export const MOCK_PAPERS: Paper[] = [
  { id: 'p1', fileName: 'colbertv2.pdf', summary: '6 claims · 1 contradicted' },
  { id: 'p2', fileName: '2112.01488.pdf', summary: '6 claims · all checked' },
  { id: 'p3', fileName: 'bert.pdf', summary: 'indexed, not analyzed' },
  { id: 'p4', fileName: 'workshop-abstract.pdf', summary: '0 claims found' },
  {
    id: 'p5',
    fileName: 'a-comprehensive-survey-of-retrieval-augmented-generation-methods-for-large-language-models.pdf',
    summary: '14 claims · 3 need work',
  },
]

export const MOCK_HOME: WriterHome = {
  user: 'Alex',
  alert: '2 claims in your draft still point at sources that do not say that.',
  draftFileName: 'draft-v3.docx',
  draftLastCheckedLabel: 'checked 2h ago',
  attention: MOCK_CLAIMS.slice(0, 3), // one refutes, one insufficient, one supports
  recentPapers: MOCK_PAPERS.slice(0, 3),
}

const D1_LATEX_SOURCE = String.raw`\section{Related work}
Late interaction retrievers encode queries and documents into token-level vectors and score them with MaxSim \cite{cit1}. ColBERTv2 further reduces index size by 6--10\times{} while matching retrieval quality \cite{cit1}. On out-of-domain data these models outperform single-vector retrievers on BEIR \cite{cit2}.

Denoised supervision from a cross-encoder teacher improves learned representations \cite{cit1}. MS MARCO contains 8.8M passages \cite{cit3}.`

const D1_PARAGRAPHS: DraftWord[][] = [
  [
    w('Late'), w('interaction'), w('retrievers'), w('encode'), w('queries'), w('and'), w('documents'),
    w('into'), w('token-level'), w('vectors'), w('and'), w('score'), w('them'), w('with'), w('MaxSim'),
    m('[Khattab', 'supports'), m('&', 'supports'), m('Zaharia,', 'supports'), m('2020].', 'supports'),
    w('ColBERTv2'), w('further'),
    m('reduces', 'refutes'), m('index', 'refutes'), m('size', 'refutes'), m('by', 'refutes'),
    m('6–10×', 'refutes'), m('while', 'refutes'), m('matching', 'refutes'), m('retrieval', 'refutes'),
    m('quality', 'refutes'), m('[Khattab', 'refutes'), m('&', 'refutes'), m('Zaharia,', 'refutes'),
    m('2020].', 'refutes'),
    w('On'), w('out-of-domain'), w('data'), w('these'), w('models'),
    m('outperform', 'insufficient'), m('single-vector', 'insufficient'), m('retrievers', 'insufficient'),
    m('on', 'insufficient'), m('BEIR', 'insufficient'), m('[Thakur', 'insufficient'), m('et', 'insufficient'),
    m('al.,', 'insufficient'), m('2021].', 'insufficient'),
  ],
  [
    w('Denoised'), w('supervision'), w('from'), w('a'), w('cross-encoder'), w('teacher'), w('improves'),
    w('learned'), w('representations'),
    m('[Santhanam', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2022].', 'supports'),
    w('MS'), w('MARCO'), w('contains'), w('8.8M'), w('passages'),
    m('[Nguyen', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2016].', 'supports'),
  ],
]

/**
 * Draft after the ColBERT (2020) citation is replaced with Santhanam et al. (2022).
 * The "[Santhanam al., al., 2022]" repetition below is a typo baked into the source
 * mockup (missing "et", duplicated "al.,"). Ported verbatim, not fixed. writerStore's
 * replaceCitation swaps a draft's paragraphs to this scripted blob only for the c1/d1
 * demo case — there is no general re-tokenization of arbitrary LaTeX into marked words.
 */
export const D1_PARAGRAPHS_AFTER_C1_REPLACED: DraftWord[][] = [
  [
    w('Late'), w('interaction'), w('retrievers'), w('encode'), w('queries'), w('and'), w('documents'),
    w('into'), w('token-level'), w('vectors'), w('and'), w('score'), w('them'), w('with'), w('MaxSim'),
    m('[Santhanam', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2022].', 'supports'),
    w('ColBERTv2'), w('further'),
    m('reduces', 'supports'), m('index', 'supports'), m('size', 'supports'), m('by', 'supports'),
    m('6–10×', 'supports'), m('while', 'supports'), m('matching', 'supports'), m('retrieval', 'supports'),
    m('quality', 'supports'), m('[Santhanam', 'supports'), m('al.,', 'supports'), m('al.,', 'supports'),
    m('2022].', 'supports'),
    w('On'), w('out-of-domain'), w('data'), w('these'), w('models'),
    m('outperform', 'insufficient'), m('single-vector', 'insufficient'), m('retrievers', 'insufficient'),
    m('on', 'insufficient'), m('BEIR', 'insufficient'), m('[Thakur', 'insufficient'), m('et', 'insufficient'),
    m('al.,', 'insufficient'), m('2021].', 'insufficient'),
  ],
  [
    w('Denoised'), w('supervision'), w('from'), w('a'), w('cross-encoder'), w('teacher'), w('improves'),
    w('learned'), w('representations'),
    m('[Santhanam', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2022].', 'supports'),
    w('MS'), w('MARCO'), w('contains'), w('8.8M'), w('passages'),
    m('[Nguyen', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2016].', 'supports'),
  ],
]

const D2_LATEX_SOURCE = String.raw`\section{Introduction}
Open-domain QA systems retrieve supporting passages before generating an answer \cite{cit4}.`

const D2_PARAGRAPHS: DraftWord[][] = [
  [
    w('Open-domain'), w('QA'), w('systems'), w('retrieve'), w('supporting'), w('passages'), w('before'),
    w('generating'), w('an'), w('answer'), m('[Lewis', 'supports'), m('et', 'supports'), m('al.,', 'supports'),
    m('2020].', 'supports'),
  ],
]

export const MOCK_DRAFTS: Draft[] = [
  {
    id: 'd1',
    fileName: 'draft-v3.docx',
    heading: '2. Related work',
    latexSource: D1_LATEX_SOURCE,
    paragraphs: D1_PARAGRAPHS,
    citationsFound: 5,
    issuesRemaining: 2,
    lastCheckedLabel: 'checked 2h ago',
  },
  {
    id: 'd2',
    fileName: 'draft-intro.docx',
    heading: '1. Introduction',
    latexSource: D2_LATEX_SOURCE,
    paragraphs: D2_PARAGRAPHS,
    citationsFound: 1,
    issuesRemaining: 0,
    lastCheckedLabel: 'checked 1d ago',
  },
]

export const MOCK_SEARCH: SearchResponse = {
  libraryCount: 9,
  currentCitation: { id: 'cit1', label: 'Khattab & Zaharia (2020)' },
  currentCitationVerdict: 'refutes',
  results: [
    {
      id: 's1',
      citation: 'Santhanam et al. (2022)',
      title: 'ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction. NAACL.',
      verdict: 'supports',
      similarity: 0.91,
      location: 'p.4 §3.2',
      quote: '"…residual compression reduces the space footprint of ColBERT by 6–10× with no loss in quality."',
      inLibrary: true,
      openAccess: false,
      isCurrentCitation: false,
      isBestMatch: true,
    },
    {
      id: 's2',
      citation: 'Santhanam et al. (2022)',
      title: 'PLAID: An Efficient Engine for Late Interaction Retrieval. CIKM.',
      verdict: 'supports',
      similarity: 0.84,
      location: 'p.2 §2',
      quote: '"…building on ColBERTv2\'s compressed representations (6–10× smaller)…"',
      inLibrary: false,
      openAccess: true,
      isCurrentCitation: false,
      isBestMatch: false,
    },
    {
      id: 's3',
      citation: 'Khattab & Zaharia (2020)',
      title: 'ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT. SIGIR.',
      verdict: 'refutes',
      similarity: 0.62,
      location: 'p.7 §4.4',
      quote: '"…the index occupies 154 GiB; we leave compression of the embeddings to future work."',
      inLibrary: true,
      openAccess: false,
      isCurrentCitation: true,
      isBestMatch: false,
    },
  ],
}
